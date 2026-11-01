import { db } from '../db.js';

export const STATUSES = ['new', 'in_progress', 'resolved'];
export const SEVERITIES = ['low', 'minor', 'major', 'critical'];

const nextPosition = (perimeterId, status) =>
  db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM incidents WHERE perimeter_id=? AND status=?').get(perimeterId, status).n;

export const incidentsOf = (perimeterId) => db.prepare('SELECT * FROM incidents WHERE perimeter_id=? ORDER BY id').all(perimeterId);

const now = () => new Date().toISOString();

// ?perimeter_id= et/ou ?application_id= ; une application d'un autre périmètre donne une liste vide
const list = (q) => {
  const where = [];
  const params = [];
  for (const k of ['perimeter_id', 'application_id', 'status']) if (q[k]) { where.push(`${k}=?`); params.push(q[k]); }
  return db.prepare(`SELECT * FROM incidents${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`).all(...params);
};

// Déplace un incident à `index` dans la colonne `status` et renumérote les colonnes touchées (0..n-1)
export function moveIncident(id, status, index) {
  const t = db.prepare('SELECT * FROM incidents WHERE id=?').get(id);
  if (!t) return { code: 404, error: 'introuvable' };
  if (!STATUSES.includes(status)) return { code: 400, error: 'statut inconnu' };
  const column = (s) => db.prepare('SELECT id FROM incidents WHERE perimeter_id=? AND status=? AND id<>? ORDER BY position, id').all(t.perimeter_id, s, id).map((r) => r.id);
  const target = column(status);
  if (!Number.isInteger(index) || index < 0 || index > target.length) return { code: 400, error: 'index hors bornes' };
  target.splice(index, 0, id);
  const setPos = db.prepare('UPDATE incidents SET status=?, position=? WHERE id=?');
  db.exec('BEGIN');
  try {
    target.forEach((iid, i) => setPos.run(status, i, iid));
    if (t.status !== status) {
      column(t.status).forEach((iid, i) => setPos.run(t.status, i, iid));
      db.prepare('UPDATE incidents SET resolved_at=? WHERE id=?').run(status === 'resolved' ? now() : null, id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { code: 400, error: e.message };
  }
  return { code: 200, incidents: incidentsOf(t.perimeter_id) };
}

const appError = (applicationId, perimeterId) => {
  if (applicationId == null || applicationId === '') return null;
  const app = db.prepare('SELECT perimeter_id FROM applications WHERE id=?').get(applicationId);
  return app && app.perimeter_id === Number(perimeterId) ? null : 'application introuvable dans le périmètre';
};

export default {
  table: 'incidents',
  fields: ['perimeter_id', 'application_id', 'title', 'description', 'severity', 'status', 'position', 'opened_at', 'resolved_at'],
  required: ['perimeter_id', 'title'],
  enums: { severity: SEVERITIES, status: STATUSES },
  check: (b) => (String(b.title).trim().length > 200 ? 'titre trop long (200 max)' : appError(b.application_id, b.perimeter_id)),
  checkPut: (b, id) => {
    if (!('application_id' in b)) return null;
    const t = db.prepare('SELECT perimeter_id FROM incidents WHERE id=?').get(id);
    return t ? appError(b.application_id, t.perimeter_id) : null;
  },
  list,
  // position, dates et périmètre ne sont pas modifiables directement ; un changement de statut place l'incident en bas de la colonne cible
  prepareBody: (b, id) => {
    delete b.position; delete b.opened_at; delete b.resolved_at;
    if (id == null) {
      const status = b.status ?? 'new';
      return { ...b, application_id: b.application_id || null, title: String(b.title ?? '').trim(), opened_at: now(), resolved_at: status === 'resolved' ? now() : null, position: nextPosition(b.perimeter_id, status) };
    }
    delete b.perimeter_id;
    if ('title' in b) b.title = String(b.title).trim();
    if ('application_id' in b) b.application_id = b.application_id || null;
    const t = db.prepare('SELECT perimeter_id, status FROM incidents WHERE id=?').get(id);
    if (t && b.status && b.status !== t.status) {
      b.position = nextPosition(t.perimeter_id, b.status);
      b.resolved_at = b.status === 'resolved' ? now() : null;
    }
    return b;
  },
};
