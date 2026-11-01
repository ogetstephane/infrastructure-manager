import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Router } from 'express';
import { db, LINK_TABLES } from './db.js';
import { moveTicket, deleteTicket, setLaunchHook, autoStatus } from './entities/tickets.js';
import { SEVERITIES } from './entities/incidents.js';
import { listChanges, fileDiff } from './diff.js';
import {
  audit, operator, operatorNamed, deleterNamed, isInteractive, modeName, defaultInteractive, parseQuestions, addQuestions, pendingCount, exchangesPrompt,
  notifyQuestions, validationUrl, INTERACTIVE_INSTRUCTIONS, ANSWER_STATUSES,
} from './interactive.js';
import { createWorktree, removeWorktree, purge, sanitize, log } from './git.js';
import { preApprovals, startCopilot } from './copilot-terminal.js';

const BIN = process.env.COPILOT_BIN || 'copilot';
const WORKDIR = process.env.FACTORY_WORKDIR || process.cwd();
const MAX_OUTPUT = 1024 * 1024;
const ASSIST_OUTPUT_LIMIT = 1024 * 1024;

// Exécutions en cours par ticket, état des processus gardé en mémoire. Chaque ticket rattaché à une application avec dépôt tourne dans
// son propre worktree (parallélisme libre) ; sans application, une seule exécution à la fois dans FACTORY_WORKDIR.
const runs = new Map();
const assistSessions = new Map();

db.prepare("UPDATE ticket_runs SET status='failed', ended_at=datetime('now'), output=output || char(10) || 'interrompu (redémarrage du serveur)' WHERE status='running'").run();
// Verrou côté base : au plus une exécution « running » par ticket, même si le contrôle mémoire est contourné
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_runs_running ON ticket_runs(ticket_id) WHERE status='running'");

const copilotMissing = () => spawnSync(BIN, ['--version'], { stdio: 'ignore' }).error?.code === 'ENOENT';

const entityLabel = (type, id) => {
  const table = LINK_TABLES[type];
  const row = table && db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  return row ? row.name ?? row.title ?? row.label ?? `#${id}` : `#${id}`;
};

const describe = (t, subs) => {
  const links = db.prepare('SELECT entity_type, entity_id FROM ticket_links WHERE ticket_id=?').all(t.id);
  return [
    `Ticket : ${t.title}`,
    t.description ? `Description :\n${t.description}` : '',
    links.length ? `Éléments du catalogue concernés :\n${links.map((l) => `- ${l.entity_type} : ${entityLabel(l.entity_type, l.entity_id)}`).join('\n')}` : '',
    subs.length ? `Sous-tickets :\n${subs.map((s) => `- [${s.status}] ${s.title}${s.description ? `\n${s.description}` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
};

const MAX_ANCESTORS = 5;
const MAX_CONTEXT_DESC = 1500;
const clip = (x, n) => (x.length > n ? `${x.slice(0, n)}…` : x);

// Contexte en lecture seule d'un sous-ticket : chaîne des ancêtres (du plus lointain au plus proche, bornée) et résumé des frères/sœurs
function parentContext(t) {
  const chain = [];
  const seen = new Set([t.id]);
  for (let p = t.parent_id != null ? db.prepare('SELECT * FROM tickets WHERE id=?').get(t.parent_id) : null; p && !seen.has(p.id) && chain.length < MAX_ANCESTORS; p = p.parent_id != null ? db.prepare('SELECT * FROM tickets WHERE id=?').get(p.parent_id) : null) {
    seen.add(p.id);
    chain.unshift(p);
  }
  if (!chain.length) return '';
  const parent = chain[chain.length - 1];
  const siblings = subsOf(parent.id).filter((s) => s.id !== t.id);
  return [
    'Contexte (lecture seule, ces tickets ne sont PAS à exécuter ; ils donnent l\'objectif global, les contraintes et le périmètre) :',
    ...chain.map((a, i) => `${'  '.repeat(i)}Ticket parent${chain.length > 1 ? ` (niveau ${i + 1})` : ''} : ${a.title}${a.description ? `\n${clip(a.description, MAX_CONTEXT_DESC)}` : ''}`),
    siblings.length ? `Autres sous-tickets du parent :\n${siblings.map((s) => `- [${s.status}] ${s.title}`).join('\n')}` : '',
    'La tâche à réaliser est UNIQUEMENT celle du sous-ticket ci-dessous.',
  ].filter(Boolean).join('\n');
}

const subsOf = (id) => db.prepare('SELECT * FROM tickets WHERE parent_id=? ORDER BY position, id').all(id);

// Un sous-ticket est terminé en « En revue » ou « Terminé » ; les autres (échec, annulé, bloqué, non exécuté) empêchent la revue du parent
const incompleteSubs = (id) => subsOf(id).filter((s) => s.status !== 'review' && s.status !== 'done');

// Remet en « En cours » les tickets en revue dont des sous-tickets ne sont pas terminés (état incohérent hérité) ; renvoie leurs ids
export function repairPrematureReviews() {
  const fixed = [];
  for (const t of db.prepare("SELECT * FROM tickets WHERE status='review' AND parent_id IS NULL").all()) {
    const open = incompleteSubs(t.id);
    if (!open.length) continue;
    setStatus(t, 'doing');
    audit(t.id, 'système', 'review_repaired', null, null, `repassé « En cours » : ${open.length} sous-ticket(s) non terminé(s)`);
    fixed.push(t.id);
  }
  return fixed;
}

// Les sous-tickets n'ont pas de colonne : leur statut change directement
function setStatus(t, status) {
  if (t.parent_id != null) {
    autoStatus(t.id, status, status === 'doing' ? 'sous-ticket pris en charge' : 'avancement de ses sous-tickets', { reopen: t.status === 'review' });
    return;
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE perimeter_id=? AND status=? AND parent_id IS NULL AND id<>?').get(t.perimeter_id, status, t.id).n;
  moveTicket(t.id, status, n, { trigger: false });
}

// Application portant le dépôt du ticket : premier lien « application » du ticket, à défaut celui de son parent
const appOf = (t) => {
  for (const id of [t.id, t.parent_id]) {
    if (id == null) continue;
    const app = db.prepare("SELECT a.* FROM ticket_links l JOIN applications a ON a.id=l.entity_id WHERE l.ticket_id=? AND l.entity_type='application' ORDER BY l.id LIMIT 1").get(id);
    if (app) return app;
  }
  return null;
};

const setWorktree = (ticketId, path, branch) => db.prepare('UPDATE tickets SET worktree_path=?, worktree_branch=? WHERE id=?').run(path, branch, ticketId);

// Run d'un ticket ayant des sous-tickets : seuls les sous-tickets (feuilles) sont exécutés, séquentiellement dans l'ordre du tableau
// et en profondeur ; le parent n'est jamais exécuté et reçoit le statut « En revue » si tous sont terminés.
// Les sous-tickets déjà « done » sont ignorés. Un échec (ou une attente de réponses) d'un sous-ticket arrête la suite :
// l'exécution du parent est `failed` et son statut reste « En cours ». Le statut et la sortie de chaque sous-ticket sont recopiés dans la sortie de l'exécution du parent.
// `path` protège contre les cycles.
async function runSubs(t, parentRun, append, path = [t.id]) {
  for (const sub of subsOf(t.id)) {
    if (parentRun.cancelled) return { ok: false, cancelled: true };
    if (sub.status === 'done') { append(`[sous-ticket #${sub.id}] « ${sub.title} » déjà terminé, ignoré\n`); continue; }
    if (path.includes(sub.id)) { append(`[sous-ticket #${sub.id}] cycle détecté, ignoré\n`); continue; }
    const subApp = appOf(sub);
    if (subApp && !String(subApp.git_repo ?? '').trim()) return { ok: false, error: `sous-ticket #${sub.id} : l'application « ${subApp.name} » n'a pas de dépôt Git` };
    if (!subApp && !parentRun.legacy && [...runs.values()].some((r) => r.legacy)) return { ok: false, error: `sous-ticket #${sub.id} : une exécution sans application est déjà en cours` };
    if (runs.has(sub.id)) return { ok: false, error: `sous-ticket #${sub.id} : déjà en cours d'exécution` };
    append(`\n===== sous-ticket #${sub.id} « ${sub.title} » =====\n`);
    if (subsOf(sub.id).length) {
      // sous-ticket intermédiaire : seuls ses propres sous-tickets sont exécutés, son statut suit leur avancement
      const nested = await runSubs(sub, parentRun, append, [...path, sub.id]);
      const cur = db.prepare('SELECT * FROM tickets WHERE id=?').get(sub.id);
      if (!nested.ok) { if (cur.status === 'todo' || cur.status === 'backlog') setStatus(cur, 'doing'); return nested; }
      if (!incompleteSubs(sub.id).length && cur.status !== 'done') setStatus(cur, 'review');
      continue;
    }
    const status = await new Promise((resolve) => {
      const cur = db.prepare('SELECT * FROM tickets WHERE id=?').get(sub.id);
      const subRunId = startRun(cur, subApp, { onEnd: resolve, parentRun });
      append(`[sous-ticket #${sub.id}] exécution #${subRunId}\n`);
    });
    const row = db.prepare('SELECT output FROM ticket_runs WHERE ticket_id=? ORDER BY id DESC LIMIT 1').get(sub.id);
    append(`${row?.output ?? ''}\n[sous-ticket #${sub.id}] ${status}\n`);
    if (status === 'cancelled' && parentRun.cancelled) return { ok: false, cancelled: true };
    if (status !== 'succeeded') return { ok: false, error: `le sous-ticket #${sub.id} « ${sub.title} » a terminé avec le statut ${status} : exécution interrompue` };
  }
  return { ok: true };
}

function startRun(t, app, { resume = null, withSubs = false, onEnd = null, parentRun = null } = {}) {
  const interactive = isInteractive(t);
  const buildPrompt = () => [
    'Tu exécutes le ticket suivant dans le dossier de travail courant. Ne travaille que dans ce dossier et termine par un court résumé de ce que tu as fait.',
    app ? `Le dossier courant est un worktree git dédié à ce ticket (branche ticket/${t.id}, base ${app.git_branch}) : commite tes modifications sur cette branche, sans pousser.` : '',
    parentContext(t),
    describe(t, subsOf(t.id)),
    interactive ? INTERACTIVE_INSTRUCTIONS : '',
    exchangesPrompt(t.id),
    resume ? `Reprise : une exécution précédente de ce ticket (${resume.reason}) a déjà travaillé sur la branche. Le dossier contient ses commits ; poursuis sans repartir de zéro. Fin de sa sortie :\n${resume.tail}` : '',
  ].filter(Boolean).join('\n\n');
  // Verrou : un ticket déjà en cours n'est jamais relancé, l'exécution active est renvoyée
  if (runs.has(t.id)) return runs.get(t.id).id;
  let id;
  try {
    id = Number(db.prepare("INSERT INTO ticket_runs (ticket_id, status, started_at) VALUES (?, 'running', datetime('now'))").run(t.id).lastInsertRowid);
  } catch (e) {
    if (!/UNIQUE/i.test(e.message)) throw e;
    return db.prepare("SELECT id FROM ticket_runs WHERE ticket_id=? AND status='running'").get(t.id).id;
  }
  const run = { id, ticketId: t.id, child: null, output: '', outputStart: 0, truncated: false, cancelled: false, worktree: null, legacy: !app, interactive, suspend: false, restartInteractive: false, sub: null };
  if (parentRun) parentRun.sub = run;
  runs.set(t.id, run);
  const append = (chunk) => {
    run.output += chunk;
    if (run.output.length > MAX_OUTPUT) {
      run.outputStart += run.output.length - MAX_OUTPUT;
      run.output = run.output.slice(-MAX_OUTPUT);
      run.truncated = true;
    }
  };
  let finished = false;
  const finish = async (status, code, extra = '') => {
    if (finished) return;
    finished = true;
    if (extra) append(`\n${extra}`);
    const wt = run.worktree;
    if (wt) {
      // succès : les modifications restantes sont commitées et la branche conservée pour la revue ; échec/arrêt : abandon (sauf branche préexistante)
      const keepWork = status === 'succeeded' || status === 'waiting' || status === 'suspended';
      const keep = keepWork || wt.reused;
      const problems = await removeWorktree(app.id, t.id, { commit: keepWork, deleteBranch: !keep }).catch((e) => [e.message]);
      append(`\n[git] worktree supprimé${keep ? `, branche ${wt.branch} conservée` : ', branche supprimée'}${problems.length ? ` (problèmes : ${problems.join(' ; ')})` : ''}`);
      if (db.prepare('SELECT 1 FROM tickets WHERE id=?').get(t.id)) setWorktree(t.id, null, keep ? wt.branch : null);
    }
    const out = (run.truncated ? '[sortie tronquée, seule la fin est conservée]\n' : '') + run.output;
    db.prepare("UPDATE ticket_runs SET status=?, ended_at=datetime('now'), exit_code=?, output=? WHERE id=?").run(status, code, out, id);
    if (status === 'failed') {
      const reason = sanitize(extra || `code de sortie ${code}`);
      log('error', `ticket ${t.id} : exécution #${id} échouée : ${reason}`);
      if (db.prepare('SELECT 1 FROM tickets WHERE id=?').get(t.id)) audit(t.id, 'IA', 'run_failed', null, null, `exécution #${id} échouée : ${reason.slice(0, 300)}`);
    }
    const cur = db.prepare('SELECT * FROM tickets WHERE id=?').get(t.id);
    if (cur && status === 'succeeded') {
      const open = incompleteSubs(cur.id);
      if (open.length) {
        append(`\n[revue] ticket laissé « En cours » : sous-ticket(s) non terminé(s) : ${open.map((s) => `#${s.id} (${s.status})`).join(', ')}`);
        db.prepare('UPDATE ticket_runs SET output=? WHERE id=?').run(run.output, id);
        audit(cur.id, 'IA', 'review_blocked', null, null, `passage en revue refusé : ${open.length} sous-ticket(s) non terminé(s)`);
      } else if (cur.parent_id != null) autoStatus(cur.id, 'done', `exécution #${id} terminée sans erreur`);
      else setStatus(cur, 'review');
    }
    runs.delete(t.id);
    if (parentRun) parentRun.sub = null;
    // suspension d'un sous-ticket : la relance interactive prend le relais, le parent attend sa fin
    if (onEnd && !(status === 'suspended' && cur)) onEnd(status);
    if (status === 'waiting' && cur) {
      audit(t.id, 'IA', 'questions', null, null, `${pendingCount(t.id)} question(s) en attente (exécution #${id})`);
      notifyQuestions(cur, pendingCount(t.id));
    }
    if (status === 'suspended' && cur) {
      // bascule à chaud : relance immédiate en interactif sur la même branche
      const next = db.prepare('SELECT * FROM tickets WHERE id=?').get(t.id);
      startRun(next, app, { resume: { reason: 'suspendue lors du passage en mode interactif', tail: run.output.slice(-3000) }, withSubs, onEnd, parentRun });
    }
  };

  (async () => {
    let cwd = WORKDIR;
    if (withSubs && subsOf(t.id).length) {
      const r = await runSubs(t, run, append);
      if (run.cancelled) return finish('cancelled', null);
      if (!r.ok) return finish('failed', null, `Sous-tickets : ${r.error}`);
      // le parent n'est pas exécuté : ses sous-tickets l'ont été, il passe en revue via finish
      append('\n[parent] non exécuté : seuls ses sous-tickets le sont\n');
      return finish('succeeded', 0);
    }
    if (app) {
      append(`[git] préparation du worktree (dépôt ${sanitize(app.git_repo)}, base ${app.git_branch})…\n`);
      try {
        run.worktree = await createWorktree(app, t.id);
      } catch (e) {
        log('error', `ticket ${t.id} : ${e.message}`);
        return finish('failed', null, `Worktree indisponible : ${e.message}`);
      }
      cwd = run.worktree.path;
      setWorktree(t.id, cwd, run.worktree.branch);
      append(`[git] worktree ${cwd} — branche ${run.worktree.branch}${run.worktree.reused ? ' (existante)' : ''}\n\n`);
    }
    if (run.cancelled) return finish(run.suspend ? 'suspended' : 'cancelled', null);
    let child;
    try {
      child = startCopilot(buildPrompt(), cwd);
    } catch (e) {
      return finish('failed', null, `Lancement impossible : ${e.message}`);
    }
    run.child = child;
    child.onData(append);
    child.onExit(({ exitCode: code }) => {
      if (run.cancelled) return finish(run.suspend ? 'suspended' : 'cancelled', code);
      if (code !== 0) return finish('failed', code);
      const questions = run.interactive ? parseQuestions(run.output) : [];
      if (!questions.length) return finish('succeeded', code);
      addQuestions(t.id, id, questions);
      finish('waiting', code, `[interactif] ${questions.length} question(s) en attente de validation par l'opérateur`);
    });
  })().catch((e) => { log('error', `ticket ${t.id} : ${e.message}`); return finish('failed', null, `Erreur : ${sanitize(e.message)}`); });
  setStatus(t, 'doing');
  return id;
}

function cancelRun(run) {
  run.cancelled = true;
  if (run.sub) cancelRun(run.sub);
  if (!run.child) return; // encore en préparation : l'arrêt est pris en compte avant le lancement
  try { run.child.kill('SIGTERM'); } catch { /* déjà terminé */ }
  setTimeout(() => { if (runs.has(run.ticketId)) { try { run.child.kill('SIGKILL'); } catch { /* déjà terminé */ } } }, 5000).unref();
}

const runById = (id) => [...runs.values()].find((r) => r.id === id);

// Purge des worktrees orphelins, des dossiers d'applications supprimées et des branches de tickets supprimés ou fusionnés
export const purgeWorktrees = () => purge({
  app: (id) => !!db.prepare('SELECT 1 FROM applications WHERE id=?').get(id),
  ticket: (id) => { const t = db.prepare('SELECT status FROM tickets WHERE id=?').get(id); return !t ? 'missing' : t.status === 'done' ? 'done' : 'open'; },
  active: (id) => runs.has(id),
}).then((r) => {
  db.prepare('UPDATE tickets SET worktree_path=NULL WHERE worktree_path IS NOT NULL').run();
  for (const run of runs.values()) if (run.worktree) setWorktree(run.ticketId, run.worktree.path, run.worktree.branch);
  return r;
});

// Assistant : Copilot sans outils, uniquement pour rédiger ; la réponse doit être un JSON validé ici
const jsonOf = (text) => {
  const body = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g, '').replace(/```(?:json)?/g, '');
  let result = null;
  for (let start = 0; start < body.length; start++) {
    if (body[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < body.length; end++) {
      const char = body[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        const candidate = body.slice(start, end + 1);
        // le terminal replie les longues lignes : un saut de ligne brut dans une chaîne rend le JSON invalide
        const attempts = [candidate, candidate.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')];
        for (const attempt of attempts) {
          try { result = JSON.parse(attempt); break; } catch { /* keep scanning for a complete JSON object */ }
        }
        start = end;
        break;
      }
    }
  }
  return result;
};

const PRIORITIES = ['low', 'normal', 'high', 'critical'];

function startAssistantSession(prompt, parseResult) {
  const id = randomUUID();
  const terminal = startCopilot(prompt, tmpdir(), { allowAllTools: false });
  const session = { id, terminal, output: '', outputStart: 0, status: 'running', result: null, error: null, truncated: false };
  assistSessions.set(id, session);
  terminal.onData((chunk) => {
    session.output += chunk;
    if (session.output.length > ASSIST_OUTPUT_LIMIT) {
      session.outputStart += session.output.length - ASSIST_OUTPUT_LIMIT;
      session.output = session.output.slice(-ASSIST_OUTPUT_LIMIT);
      session.truncated = true;
    }
  });
  terminal.onExit(({ exitCode }) => {
    if (session.status === 'cancelled') return;
    session.status = exitCode === 0 ? 'completed' : 'failed';
    if (exitCode !== 0) {
      session.error = `Copilot a terminé avec le code ${exitCode}`;
      return;
    }
    try {
      session.result = parseResult(session.output);
    } catch (e) {
      session.status = 'failed';
      session.error = e.message;
    }
  });
  return session;
}

function validProposal(o) {
  const title = (s) => typeof s === 'string' && s.trim() && s.trim().length <= 200;
  if (!o || !title(o.title)) return null;
  const subs = o.subtickets ?? [];
  if (!Array.isArray(subs) || subs.length > 20 || !subs.every((s) => s && title(s.title))) return null;
  return {
    title: o.title.trim(),
    description: typeof o.description === 'string' ? o.description : '',
    priority: PRIORITIES.includes(o.priority) ? o.priority : 'normal',
    subtickets: subs.map((s) => ({ title: s.title.trim(), description: typeof s.description === 'string' ? s.description : '' })),
  };
}

// Service unique de lancement, partagé par le bouton Exécuter et le passage automatique en « En cours ».
// `auto` : un traitement déjà actif ou en attente de réponses n'est pas une erreur (idempotence), rien n'est relancé.
export function launchTicket(t, op, { auto = false } = {}) {
  if (op.error) return { code: 403, error: op.error };
  if (runs.has(t.id)) return auto ? { code: 200, already: true } : { code: 409, busy: true, error: 'ce ticket est déjà en cours d\'exécution' };
  if (pendingCount(t.id)) return auto ? { code: 200, already: true } : { code: 409, busy: true, error: 'ce ticket attend des réponses : traitez les questions puis utilisez « Reprendre »' };
  const app = appOf(t);
  if (app && !String(app.git_repo ?? '').trim()) {
    return { code: 409, error: `l'application « ${app.name} » n'a pas de dépôt Git : renseignez-le sur la fiche de l'application avant de lancer ce ticket` };
  }
  if (!app && [...runs.values()].some((r) => r.legacy)) return { code: 409, error: 'une exécution sans application est déjà en cours (un seul dossier de travail partagé)' };
  if (copilotMissing()) return { code: 503, error: 'Copilot CLI introuvable' };
  const id = startRun(t, app, { withSubs: true });
  if (auto) audit(t.id, op.name, 'run', null, null, `exécution #${id} (lancement automatique, passage en « En cours »)`);
  return { code: 201, id };
}

// Transition vers « En cours » : mêmes contrôles et mêmes droits que Exécuter, avec l'opérateur à l'origine de la transition.
// Renvoie un message d'erreur (tracé dans les logs et l'historique) ou null.
setLaunchHook((ticketId, actor) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!t) return null;
  const op = operatorNamed(actor);
  let r1;
  try { r1 = launchTicket(t, op, { auto: true }); } catch (e) { r1 = { code: 500, error: e.message }; }
  if (!r1.error) return null;
  log('error', `ticket ${ticketId} : lancement automatique échoué : ${r1.error}`);
  audit(ticketId, op.name ?? 'opérateur', 'run_failed', null, null, `lancement automatique échoué : ${r1.error}`);
  return r1.error;
});

export function factoryRouter() {
  try { const fixed = repairPrematureReviews(); if (fixed.length) log('info', `tickets en revue incohérents repassés en cours : ${fixed.join(', ')}`); } catch (e) { log('error', `réparation des revues : ${e.message}`); }
  const r = Router();
  const autoPurge = () => purgeWorktrees().catch((e) => log('error', `purge : ${e.message}`));
  autoPurge();
  setInterval(autoPurge, Number(process.env.FACTORY_PURGE_INTERVAL_MS) || 3_600_000).unref();

  r.get('/api/copilot_sessions/:id', (req, res) => {
    const session = assistSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session introuvable' });
    const offset = Number(req.query.offset ?? 0);
    const streamed = outputSegment(session.output, session.outputStart, offset, session.truncated);
    res.json({
      id: session.id,
      status: session.status,
      ...streamed,
      interactive: session.status === 'running',
      result: session.result,
      error: session.error,
    });
  });

  r.post('/api/copilot_sessions/:id/input', (req, res) => asOperator(req, res, () => {
    const session = assistSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session introuvable' });
    if (session.status !== 'running') return res.status(409).json({ error: 'session terminée' });
    const data = req.body?.data;
    if (typeof data !== 'string' || data.length > 4096) return res.status(400).json({ error: 'entrée invalide ou trop longue' });
    session.terminal.write(data);
    res.json({ ok: true });
  }));

  r.post('/api/copilot_sessions/:id/resize', (req, res) => asOperator(req, res, () => {
    const session = assistSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session introuvable' });
    if (session.status !== 'running') return res.status(409).json({ error: 'session terminée' });
    const { cols, rows } = req.body ?? {};
    if (!Number.isInteger(cols) || cols < 20 || cols > 300 || !Number.isInteger(rows) || rows < 5 || rows > 120) {
      return res.status(400).json({ error: 'dimensions de terminal invalides' });
    }
    session.terminal.resize(cols, rows);
    res.json({ ok: true });
  }));

  r.post('/api/copilot_sessions/:id/finish', (req, res) => asOperator(req, res, () => {
    const session = assistSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session introuvable' });
    if (session.status !== 'running') return res.status(409).json({ error: 'session terminée' });
    session.terminal.write('/quit\r');
    res.json({ ok: true });
  }));

  r.post('/api/copilot_sessions/:id/cancel', (req, res) => asOperator(req, res, () => {
    const session = assistSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'session introuvable' });
    if (session.status !== 'running') return res.status(409).json({ error: 'session terminée' });
    session.status = 'cancelled';
    session.terminal.kill('SIGTERM');
    res.json({ ok: true });
  }));

  r.post('/api/tickets/assist', async (req, res) => {
    const request = String(req.body.request ?? '').trim();
    if (!request || request.length > 4000) return res.status(400).json({ error: 'demande vide ou trop longue (4000 max)' });
    const perimeter = db.prepare('SELECT name FROM perimeters WHERE id=?').get(req.body.perimeter_id);
    if (!perimeter) return res.status(400).json({ error: 'périmètre inconnu' });
    let ticket = null;
    if (req.body.ticket_id != null) {
      ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.body.ticket_id);
      if (!ticket) return res.status(400).json({ error: 'ticket inconnu' });
    }
    if (copilotMissing()) return res.status(503).json({ error: 'Copilot CLI introuvable' });
    const prompt = [
      "Tu aides à rédiger un ticket de travail. N'utilise aucun outil, ne lis ni ne modifie aucun fichier.",
      `Périmètre : ${perimeter.name}`,
      ticket ? `Ticket existant à affiner :\n${describe(ticket, subsOf(ticket.id))}` : '',
      `Demande :\n${request}`,
      'Réponds uniquement par un objet JSON : {"title": string, "description": string (Markdown), "priority": "low"|"normal"|"high"|"critical", "subtickets": [{"title": string, "description": string}]}.',
    ].filter(Boolean).join('\n\n');
    try {
      const session = startAssistantSession(prompt, (output) => {
        const proposal = validProposal(jsonOf(output));
        if (!proposal) throw new Error(`réponse de Copilot inexploitable : ${output.trim().slice(-300)}`);
        return proposal;
      });
      res.status(201).json({ session_id: session.id });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(503).json({ error: 'Copilot CLI introuvable' });
      res.status(502).json({ error: e.message });
    }
  });

  r.post('/api/incidents/assist', async (req, res) => {
    const request = String(req.body.request ?? '').trim();
    if (!request || request.length > 4000) return res.status(400).json({ error: 'demande vide ou trop longue (4000 max)' });
    const perimeter = db.prepare('SELECT name FROM perimeters WHERE id=?').get(req.body.perimeter_id);
    if (!perimeter) return res.status(400).json({ error: 'périmètre inconnu' });
    let application = null;
    if (req.body.application_id != null) {
      application = db.prepare('SELECT name FROM applications WHERE id=? AND perimeter_id=?').get(req.body.application_id, req.body.perimeter_id);
      if (!application) return res.status(400).json({ error: 'application introuvable dans le périmètre' });
    }
    let incident = null;
    if (req.body.incident_id != null) {
      incident = db.prepare('SELECT * FROM incidents WHERE id=?').get(req.body.incident_id);
      if (!incident) return res.status(400).json({ error: 'incident inconnu' });
    }
    if (copilotMissing()) return res.status(503).json({ error: 'Copilot CLI introuvable' });
    const prompt = [
      "Tu aides à rédiger une fiche d'incident. N'utilise aucun outil, ne lis ni ne modifie aucun fichier.",
      `Périmètre : ${perimeter.name}`,
      application ? `Application : ${application.name}` : '',
      incident ? `Incident existant à affiner :\nTitre : ${incident.title}\nSévérité : ${incident.severity}\nStatut : ${incident.status}\n${incident.description}` : '',
      `Demande :\n${request}`,
      'La description (Markdown) suit le plan : ## Symptômes, ## Impact, ## Chronologie, ## Hypothèses, ## Actions. N\'invente aucun fait : écris « À préciser » quand l\'information manque.',
      'Réponds uniquement par un objet JSON : {"title": string, "description": string (Markdown), "severity": "low"|"minor"|"major"|"critical"}.',
    ].filter(Boolean).join('\n\n');
    try {
      const session = startAssistantSession(prompt, (output) => {
        const o = jsonOf(output);
        if (!o || typeof o.title !== 'string' || !o.title.trim() || o.title.trim().length > 200) {
          throw new Error(`réponse de Copilot inexploitable : ${output.trim().slice(-300)}`);
        }
        return {
          title: o.title.trim(),
          description: typeof o.description === 'string' ? o.description : '',
          severity: SEVERITIES.includes(o.severity) ? o.severity : 'minor',
        };
      });
      res.status(201).json({ session_id: session.id });
    } catch (e) {
      if (e.code === 'ENOENT') return res.status(503).json({ error: 'Copilot CLI introuvable' });
      res.status(502).json({ error: e.message });
    }
  });

  r.post('/api/tickets/:id/run', (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'introuvable' });
    const op = operator(req);
    let r1;
    try { r1 = launchTicket(t, op); } catch (e) {
      log('error', `ticket ${t.id} : lancement échoué : ${e.message}`);
      r1 = { code: 500, error: `lancement impossible : ${e.message}` };
    }
    if (r1.error) {
      log('error', `ticket ${t.id} : lancement refusé (${r1.code}) : ${r1.error}`);
      if (!r1.busy) audit(t.id, op.name ?? 'opérateur', 'run_failed', null, null, `lancement échoué : ${r1.error}`);
    }
    res.status(r1.code).json(r1.error ? { error: r1.error } : { id: r1.id });
  });

  // Bascule autonome/interactif d'un ticket. `value` : true, false, ou null (hérite du réglage global).
  // Un ticket en cours en autonome est suspendu (travail commité sur sa branche) puis relancé aussitôt en interactif.
  function switchMode(t, value, actor) {
    if (t.parent_id != null) return { code: 400, error: 'le mode se règle sur le ticket parent' };
    if (t.status === 'done') return { code: 409, error: 'ticket terminé : le mode ne peut plus être changé' };
    const before = isInteractive(t);
    const stored = value == null ? null : value ? 1 : 0;
    const after = stored == null ? defaultInteractive() : stored === 1;
    if (!after && pendingCount(t.id)) return { code: 409, error: 'des questions de l\'IA sont en attente : traitez-les avant de repasser en autonome' };
    const live = runs.get(t.id);
    if (live?.suspend) return { code: 409, error: 'bascule déjà en cours' };
    if (stored === t.interactive) return { code: 200, changed: false, restarted: false };
    if (after && !before && live && !live.interactive) {
      const app = appOf(t);
      if (copilotMissing()) return { code: 503, error: 'Copilot CLI introuvable' };
      db.prepare('UPDATE tickets SET interactive=? WHERE id=?').run(stored, t.id);
      audit(t.id, actor, 'mode', modeName(before), modeName(after), `exécution #${live.id} suspendue puis relancée en interactif${app ? ' sur la même branche' : ''}`);
      live.suspend = true;
      cancelRun(live);
      return { code: 200, changed: true, restarted: true };
    }
    db.prepare('UPDATE tickets SET interactive=? WHERE id=?').run(stored, t.id);
    const note = live ? "pris en compte à la prochaine exécution (l'exécution en cours garde son mode)" : stored == null ? 'hérite du réglage global' : '';
    audit(t.id, actor, 'mode', modeName(before), modeName(after), note);
    return { code: 200, changed: true, restarted: false };
  }

  // Droits : voir operator() (FACTORY_OPERATORS)
  const asOperator = (req, res, fn) => {
    const op = operator(req);
    if (op.error) return res.status(403).json({ error: op.error });
    return fn(op.name);
  };

  r.get('/api/factory/settings', (req, res) => res.json({ interactive_default: defaultInteractive(), operators_restricted: !!process.env.FACTORY_OPERATORS, can_delete: !deleterNamed(req.get('x-operator')).error }));

  r.put('/api/factory/settings', (req, res) => asOperator(req, res, (actor) => {
    const { interactive_default: v, apply_to_doing: apply } = req.body ?? {};
    if (typeof v !== 'boolean') return res.status(400).json({ error: 'interactive_default (booléen) requis' });
    const before = defaultInteractive();
    db.prepare("INSERT INTO factory_settings (key, value) VALUES ('interactive_default', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v ? '1' : '0');
    if (before !== v) audit(null, actor, 'mode_default', modeName(before), modeName(v), 'réglage global (nouveaux tickets)');
    const skipped = [];
    let switched = 0;
    if (apply === true) {
      for (const t of db.prepare("SELECT * FROM tickets WHERE status='doing' AND parent_id IS NULL ORDER BY id").all()) {
        if (isInteractive(t) === v && t.interactive === (v ? 1 : 0)) continue;
        const rs = switchMode(t, v, actor);
        if (rs.code === 200) switched += rs.changed ? 1 : 0; else skipped.push({ id: t.id, error: rs.error });
      }
    }
    res.json({ interactive_default: v, switched, skipped });
  }));

  r.post('/api/tickets/:id/mode', (req, res) => asOperator(req, res, (actor) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'introuvable' });
    const v = req.body?.interactive;
    if (v !== null && typeof v !== 'boolean') return res.status(400).json({ error: 'interactive : true, false ou null' });
    const { code, error, ...rest } = switchMode(t, v, actor);
    res.status(code).json(error ? { error } : rest);
  }));

  r.get('/api/ticket_questions', (req, res) => {
    const t = req.query.ticket_id ?? null;
    const s = req.query.status ?? null;
    res.json(db.prepare('SELECT * FROM ticket_questions WHERE (? IS NULL OR ticket_id=?) AND (? IS NULL OR status=?) ORDER BY id').all(t, t, s, s));
  });

  r.post('/api/ticket_questions/:id/answer', (req, res) => asOperator(req, res, (actor) => {
    const q = db.prepare('SELECT * FROM ticket_questions WHERE id=?').get(req.params.id);
    if (!q) return res.status(404).json({ error: 'introuvable' });
    const status = req.body?.status;
    const answer = String(req.body?.answer ?? '').trim();
    if (!ANSWER_STATUSES.includes(status)) return res.status(400).json({ error: `status : ${ANSWER_STATUSES.join(' | ')}` });
    if (status === 'answered' && !answer) return res.status(400).json({ error: 'une réponse est requise' });
    if (answer.length > 4000) return res.status(400).json({ error: 'réponse trop longue (4000 max)' });
    if (q.status !== 'pending') return res.status(409).json({ error: 'question déjà traitée' });
    db.prepare("UPDATE ticket_questions SET status=?, answer=?, answered_at=datetime('now'), answered_by=? WHERE id=?").run(status, answer, actor, q.id);
    audit(q.ticket_id, actor, 'answer', null, status, `Q : ${q.question}${answer ? ` — R : ${answer}` : ''}`);
    res.json({ ok: true, pending: pendingCount(q.ticket_id) });
  }));

  r.post('/api/tickets/:id/resume', (req, res) => asOperator(req, res, (actor) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'introuvable' });
    if (runs.has(t.id)) return res.status(409).json({ error: 'ce ticket est déjà en cours d\'exécution' });
    const last = db.prepare('SELECT * FROM ticket_runs WHERE ticket_id=? ORDER BY id DESC LIMIT 1').get(t.id);
    // parent : la reprise relance l'exécution des sous-tickets (ceux en attente reprennent avec leurs réponses)
    const hasSubs = subsOf(t.id).length > 0;
    if (hasSubs ? last?.status !== 'failed' && last?.status !== 'waiting' : last?.status !== 'waiting') return res.status(409).json({ error: "ce ticket n'est pas en attente de réponses" });
    const n = hasSubs ? 0 : pendingCount(t.id);
    if (n) return res.status(409).json({ error: `${n} question(s) sans réponse : répondez, validez ou rejetez chacune avant de reprendre` });
    const app = appOf(t);
    if (app && !String(app.git_repo ?? '').trim()) return res.status(409).json({ error: `l'application « ${app.name} » n'a pas de dépôt Git` });
    if (!app && [...runs.values()].some((x) => x.legacy)) return res.status(409).json({ error: 'une exécution sans application est déjà en cours (un seul dossier de travail partagé)' });
    if (copilotMissing()) return res.status(503).json({ error: 'Copilot CLI introuvable' });
    if (last.status === 'waiting') db.prepare("UPDATE ticket_runs SET status='resumed' WHERE id=?").run(last.id);
    audit(t.id, actor, 'resume', null, null, `reprise après l'exécution #${last.id}`);
    if (hasSubs) return res.status(201).json({ id: startRun(t, app, { withSubs: true }) });
    res.status(201).json({ id: startRun(t, app, { resume: { reason: 'en attente de réponses de l\'opérateur', tail: String(last.output).slice(-3000) } }) });
  }));

  r.get('/api/ticket_audit', (req, res) => {
    const t = req.query.ticket_id ?? null;
    res.json(db.prepare('SELECT * FROM ticket_audit WHERE (? IS NULL OR ticket_id=?) ORDER BY id DESC LIMIT 500').all(t, t));
  });

  r.get('/api/tickets/:id/validation_url', (req, res) => {
    const t = db.prepare('SELECT perimeter_id, id FROM tickets WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'introuvable' });
    res.json({ url: validationUrl(t.perimeter_id, t.id) });
  });

  // Suppression définitive (droits : FACTORY_ADMINS) ; une exécution en cours est arrêtée avant la suppression
  r.delete('/api/tickets/:id', (req, res) => {
    const op = deleterNamed(req.get('x-operator'));
    if (op.error) return res.status(403).json({ error: op.error });
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM tickets WHERE id=?').get(id)) return res.status(404).json({ error: 'introuvable' });
    if (db.prepare('SELECT 1 FROM tickets WHERE parent_id=?').get(id)) return res.status(409).json({ error: deleteTicket(id, op.name).error });
    const run = runs.get(id);
    if (run) cancelRun(run);
    const { code, error } = deleteTicket(id, op.name);
    if (code === 200) purgeWorktrees().catch((e) => log('error', `purge : ${e.message}`));
    res.status(code).json(error ? { error } : { ok: true });
  });

  r.get('/api/ticket_deletions', (_req, res) => res.json(db.prepare('SELECT * FROM ticket_deletions ORDER BY id DESC LIMIT 500').all()));

  // Mode diff git (lecture seule) : uniquement pour un ticket en revue
  const reviewDiff = (fn) => async (req, res) => {
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'introuvable' });
    if (t.status !== 'review') return res.status(409).json({ error: 'le diff git n\'est disponible que pour un ticket en revue' });
    const app = appOf(t);
    if (!app) return res.status(409).json({ error: "ce ticket n'est lié à aucune application : pas de dépôt Git" });
    try {
      res.json(await fn(app, t, req));
    } catch (e) {
      if (e.code === 404 || e.code === 409) return res.status(e.code).json({ error: sanitize(e.message) });
      log('error', `diff ticket ${t.id} : ${e.message}`);
      res.status(502).json({ error: sanitize(e.message) });
    }
  };
  r.get('/api/tickets/:id/diff', reviewDiff((app, t) => listChanges(app, t.id)));
  r.get('/api/tickets/:id/diff/file', reviewDiff((app, t, req) => {
    if (typeof req.query.path !== 'string' || !req.query.path) throw Object.assign(new Error('chemin manquant'), { code: 404 });
    return fileDiff(app, t.id, req.query.path, req.query.offset);
  }));

  r.post('/api/worktrees/purge', async (_req, res) => {
    try { res.json(await purgeWorktrees()); } catch (e) { res.status(500).json({ error: sanitize(e.message) }); }
  });

  r.get('/api/ticket_runs', (req, res) => {
    const rows = db.prepare('SELECT id, ticket_id, status, started_at, ended_at, exit_code FROM ticket_runs WHERE (? IS NULL OR ticket_id=?) ORDER BY id DESC').all(req.query.ticket_id ?? null, req.query.ticket_id ?? null);
    res.json(rows);
  });

  r.get('/api/ticket_runs/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM ticket_runs WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'introuvable' });
    const live = runById(row.id);
    const offset = Number(req.query.offset ?? 0);
    if (live) {
      res.json({ ...row, ...outputSegment(live.output, live.outputStart, offset, live.truncated), interactive: !!live.child });
    } else {
      res.json({ ...row, ...outputSegment(String(row.output), 0, offset, false), interactive: false });
    }
  });

  r.post('/api/ticket_runs/:id/cancel', (req, res) => asOperator(req, res, () => {
    const live = runById(Number(req.params.id));
    if (!live) return res.status(409).json({ error: "cette exécution n'est pas en cours" });
    cancelRun(live);
    res.json({ ok: true });
  }));

  r.post('/api/ticket_runs/:id/input', (req, res) => asOperator(req, res, () => {
    const live = runById(Number(req.params.id));
    if (!live?.child) return res.status(409).json({ error: "cette exécution n'est pas en cours" });
    const data = req.body?.data;
    if (typeof data !== 'string' || data.length > 4096) return res.status(400).json({ error: 'entrée invalide ou trop longue' });
    live.child.write(data);
    res.json({ ok: true });
  }));

  r.post('/api/ticket_runs/:id/resize', (req, res) => asOperator(req, res, () => {
    const live = runById(Number(req.params.id));
    if (!live?.child) return res.status(409).json({ error: "cette exécution n'est pas en cours" });
    const { cols, rows } = req.body ?? {};
    if (!Number.isInteger(cols) || cols < 20 || cols > 300 || !Number.isInteger(rows) || rows < 5 || rows > 120) {
      return res.status(400).json({ error: 'dimensions de terminal invalides' });
    }
    live.child.resize(cols, rows);
    res.json({ ok: true });
  }));

  r.post('/api/ticket_runs/:id/finish', (req, res) => asOperator(req, res, () => {
    const live = runById(Number(req.params.id));
    if (!live?.child) return res.status(409).json({ error: "cette exécution n'est pas en cours" });
    live.child.write('/quit\r');
    res.json({ ok: true });
  }));

  return r;
}

function outputSegment(output, start, offset, truncated) {
  const cursor = start + output.length;
  const reset = !Number.isSafeInteger(offset) || offset < start || offset > cursor;
  return {
    output: reset ? `${truncated ? '[sortie tronquée, seule la fin est conservée]\n' : ''}${output}` : output.slice(offset - start),
    cursor,
    reset,
  };
}
