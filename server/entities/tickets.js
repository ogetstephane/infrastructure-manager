import { db } from '../db.js';

export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'];
export const PRIORITIES = ['low', 'normal', 'high', 'critical'];

const nextPosition = (perimeterId, status) =>
  db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tickets WHERE perimeter_id=? AND status=? AND parent_id IS NULL').get(perimeterId, status).n;

export const ticketsOf = (perimeterId) => db.prepare('SELECT * FROM tickets WHERE perimeter_id=? ORDER BY id').all(perimeterId);

// ?perimeter_id= et/ou ?application_id= (lien direct vers l'application) ; une application d'un autre périmètre donne une liste vide
const list = (q) => {
  const where = [];
  const params = [];
  if (q.perimeter_id) { where.push('t.perimeter_id=?'); params.push(q.perimeter_id); }
  if (q.id) { where.push('t.id=?'); params.push(q.id); }
  if (q.status) { where.push('t.status=?'); params.push(q.status); }
  if (q.application_id) {
    where.push("EXISTS (SELECT 1 FROM ticket_links l WHERE l.ticket_id=t.id AND l.entity_type='application' AND l.entity_id=?)");
    params.push(q.application_id);
  }
  return db.prepare(`SELECT t.* FROM tickets t${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY t.id`).all(...params);
};

// Liste blanche des changements de colonne autorisés par glisser-déposer (à garder identique à web/.../factory.js).
// Le réordonnancement dans une même colonne reste libre ; les autres passages (agent IA…) ne passent pas par ce contrôle.
export const MANUAL_TRANSITIONS = { backlog: ['todo'], review: ['done'] };
export const canMoveManually = (from, to) => from === to || (MANUAL_TRANSITIONS[from] ?? []).includes(to);

// Les raccourcis d'action (flèche sur la carte) ajoutent À faire → En cours à la liste blanche du glisser-déposer
export const SHORTCUT_TRANSITIONS = { ...MANUAL_TRANSITIONS, todo: ['doing'] };
export const canShortcut = (from, to) => (SHORTCUT_TRANSITIONS[from] ?? []).includes(to);

// Lancement automatique : factory.js enregistre ici le service partagé avec le bouton Exécuter.
// Il renvoie null (lancé ou déjà lancé) ou un message d'erreur ; en cas d'erreur la transition est annulée.
let launchHook = null;
export const setLaunchHook = (fn) => { launchHook = fn; };

// Un sous-ticket terminé (« En revue » ou « Terminé ») ne revient à un statut antérieur que par réouverture explicite
const FINISHED = ['review', 'done'];
const EARLIER = { review: ['backlog', 'todo', 'doing'], done: ['backlog', 'todo', 'doing', 'review'] };
export const canAutoMove = (from, to) => !(EARLIER[from] ?? []).includes(to);

// Changement de statut automatique tracé dans l'historique (origine « automatique », avec la cause).
// `reopen` : réouverture explicite, qui autorise le retour en arrière. Renvoie false si rien n'a changé ou si la transition est refusée.
export function autoStatus(ticketId, to, cause, { reopen = false } = {}) {
  const cur = db.prepare('SELECT status, parent_id FROM tickets WHERE id=?').get(ticketId);
  if (!cur || cur.status === to) return false;
  if (cur.parent_id != null && !reopen && !canAutoMove(cur.status, to)) return false;
  db.prepare('UPDATE tickets SET status=? WHERE id=?').run(to, ticketId);
  const audit = db.prepare('INSERT INTO ticket_audit (ticket_id, actor, action, old_value, new_value, detail) VALUES (?,?,?,?,?,?)');
  audit.run(ticketId, 'automatique', 'status', cur.status, to, cause);
  if (cur.parent_id != null && FINISHED.includes(to)) signalParentReady(cur.parent_id, ticketId);
  return true;
}

// Tous les sous-tickets du parent sont terminés : le parent est signalé « prêt à clôturer » dans son historique
function signalParentReady(parentId, subId) {
  const open = db.prepare("SELECT 1 FROM tickets WHERE parent_id=? AND status NOT IN ('review','done')").get(parentId);
  if (open) return;
  db.prepare('INSERT INTO ticket_audit (ticket_id, actor, action, old_value, new_value, detail) VALUES (?,?,?,?,?,?)')
    .run(parentId, 'automatique', 'ready_to_close', null, null, `tous les sous-tickets sont terminés (dernier : #${subId}), prêt à clôturer`);
}

// Parent → « À faire » : tous les sous-tickets (récursivement) repassent « À faire », quel que soit leur statut.
// Écriture directe en base, sans repasser par onStatusChange : aucune boucle de déclenchement possible.
export function cascadeTodo(parentId, seen = new Set([parentId])) {
  for (const { id } of db.prepare('SELECT id FROM tickets WHERE parent_id=? ORDER BY id').all(parentId)) {
    if (seen.has(id)) continue;
    seen.add(id);
    autoStatus(id, 'todo', `ticket parent #${parentId} passé à « À faire »`, { reopen: true });
    cascadeTodo(id, seen);
  }
}

export function onStatusChange(id, from, to, actor) {
  if (to === 'todo' && from !== to) cascadeTodo(id);
  if (to !== 'doing' || from === to || !launchHook) return null;
  const error = launchHook(id, actor);
  if (!error) return null;
  const t = db.prepare('SELECT perimeter_id FROM tickets WHERE id=?').get(id);
  if (t) db.prepare('UPDATE tickets SET status=?, position=? WHERE id=?').run(from, nextPosition(t.perimeter_id, from), id);
  return error;
}

// Déplace un ticket à `index` dans la colonne `status` et renumérote les colonnes touchées (0..n-1).
// `manual` : déplacement utilisateur, soumis à la liste blanche.
export function moveTicket(id, status, index, { manual = false, shortcut = false, actor = null, trigger = true } = {}) {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!t) return { code: 404, error: 'introuvable' };
  if (!STATUSES.includes(status)) return { code: 400, error: 'statut inconnu' };
  if (shortcut ? !canShortcut(t.status, status) : manual && !canMoveManually(t.status, status)) return { code: 409, error: `transition interdite : ${t.status} → ${status}` };
  if (t.parent_id != null) return { code: 400, error: 'un sous-ticket ne se déplace pas sur le tableau' };
  const column = (s) => db.prepare('SELECT id FROM tickets WHERE perimeter_id=? AND status=? AND parent_id IS NULL AND id<>? ORDER BY position, id').all(t.perimeter_id, s, id).map((r) => r.id);
  const target = column(status);
  if (!Number.isInteger(index) || index < 0 || index > target.length) return { code: 400, error: 'index hors bornes' };
  target.splice(index, 0, id);
  const setPos = db.prepare('UPDATE tickets SET status=?, position=? WHERE id=?');
  db.exec('BEGIN');
  try {
    target.forEach((tid, i) => setPos.run(status, i, tid));
    if (t.status !== status) column(t.status).forEach((tid, i) => setPos.run(t.status, i, tid));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { code: 400, error: e.message };
  }
  if (trigger && t.status !== status) {
    const error = onStatusChange(id, t.status, status, actor);
    if (error) return { code: 409, error: `lancement impossible, ticket remis à « ${t.status} » : ${error}` };
  }
  return { code: 200, tickets: ticketsOf(t.perimeter_id) };
}

// Suppression définitive : bloquée si le ticket a des sous-tickets ; les données associées (liens, exécutions, questions,
// historique) partent en cascade et la trace d'audit (sans contenu) est écrite dans la même transaction.
export function deleteTicket(id, actor) {
  const t = db.prepare('SELECT id FROM tickets WHERE id=?').get(id);
  if (!t) return { code: 404, error: 'introuvable' };
  const n = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE parent_id=?').get(id).n;
  if (n) return { code: 409, error: `suppression impossible : ce ticket a ${n} sous-ticket(s), supprimez-les d'abord` };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM tickets WHERE id=?').run(id);
    db.prepare('INSERT INTO ticket_deletions (ticket_id, actor) VALUES (?,?)').run(id, actor);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { code: 500, error: e.message };
  }
  return { code: 200 };
}

// Un sous-ticket a pour parent un ticket du même périmètre qui n'est pas lui-même un sous-ticket (un seul niveau)
function parentError(parentId, perimeterId, id) {
  if (parentId == null || parentId === '') return null;
  const p = db.prepare('SELECT perimeter_id, parent_id FROM tickets WHERE id=?').get(parentId);
  if (!p || p.perimeter_id !== Number(perimeterId)) return 'ticket parent introuvable dans le périmètre';
  if (p.parent_id != null) return 'un sous-ticket ne peut pas avoir de sous-ticket';
  if (id != null && (Number(parentId) === Number(id) || db.prepare('SELECT 1 FROM tickets WHERE parent_id=?').get(id))) return 'un ticket ayant des sous-tickets ne peut pas devenir sous-ticket';
  return null;
}

export default {
  table: 'tickets',
  fields: ['perimeter_id', 'title', 'description', 'priority', 'status', 'position', 'parent_id'],
  required: ['perimeter_id', 'title'],
  enums: { priority: PRIORITIES, status: STATUSES },
  check: (b) => {
    if (String(b.title).trim().length > 200) return 'titre trop long (200 max)';
    const pe = parentError(b.parent_id, b.perimeter_id);
    if (pe) return pe;
    if (b.link_application_id != null && b.link_application_id !== '') {
      const app = db.prepare('SELECT perimeter_id FROM applications WHERE id=?').get(b.link_application_id);
      if (!app || app.perimeter_id !== Number(b.perimeter_id)) return "application introuvable dans le périmètre du ticket";
    }
    return null;
  },
  checkPut: (b, id) => {
    if (!('parent_id' in b)) return null;
    const t = db.prepare('SELECT perimeter_id FROM tickets WHERE id=?').get(id);
    return t ? parentError(b.parent_id, t.perimeter_id, id) : null;
  },
  list,
  after: (b, id) => {
    if (b.link_application_id != null && b.link_application_id !== '') {
      db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id, b.link_application_id);
    }
  },
  // position et périmètre ne sont pas modifiables directement ; un changement de statut place le ticket en bas de la colonne cible
  prepareBody: (b, id) => {
    delete b.position;
    if (id == null) return { ...b, parent_id: b.parent_id || null, title: String(b.title ?? '').trim(), position: nextPosition(b.perimeter_id, b.status ?? 'backlog') };
    delete b.perimeter_id;
    if ('title' in b) b.title = String(b.title).trim();
    const t = db.prepare('SELECT perimeter_id, status FROM tickets WHERE id=?').get(id);
    if (t && b.status && b.status !== t.status) { b.position = nextPosition(t.perimeter_id, b.status); b._from = t.status; }
    return b;
  },
  afterPut: (b, id, req) => (b._from ? onStatusChange(Number(id), b._from, b.status, req?.get('x-operator') || null) : null),
  children: { links: (id) => db.prepare('SELECT * FROM ticket_links WHERE ticket_id=? ORDER BY id').all(id) },
};
