import { db } from './db.js';

const log = (level, msg) => console[level === 'error' ? 'error' : 'log'](`[interactif] ${msg}`);

// Mode interactif : questions de l'IA, audit des changements de mode, notification.
// Mécanisme : l'IA signale chaque question par une ligne « [[QUESTION]] … » puis s'arrête ; l'exécution passe en
// « waiting » (sans timeout), la branche du ticket est conservée, et la reprise relance Copilot sur cette branche
// avec les réponses de l'opérateur dans le prompt.

export const QUESTION_TAG = '[[QUESTION]]';
const MAX_QUESTIONS = 10;
const MAX_QUESTION_LEN = 1000;
export const ANSWER_STATUSES = ['answered', 'validated', 'rejected'];

export const MODE_LABEL = { 1: 'interactif', 0: 'autonome' };

export const defaultInteractive = () => db.prepare("SELECT value FROM factory_settings WHERE key='interactive_default'").get()?.value === '1';

// Un sous-ticket suit le mode de son parent
export const isInteractive = (t) => {
  const own = t.interactive ?? (t.parent_id == null ? null : db.prepare('SELECT interactive FROM tickets WHERE id=?').get(t.parent_id)?.interactive ?? null);
  return own == null ? defaultInteractive() : own === 1;
};

export const modeName = (interactive) => (interactive ? 'interactif' : 'autonome');

export function audit(ticketId, actor, action, oldValue, newValue, detail = '') {
  db.prepare('INSERT INTO ticket_audit (ticket_id, actor, action, old_value, new_value, detail) VALUES (?,?,?,?,?,?)')
    .run(ticketId, actor, action, oldValue ?? null, newValue ?? null, detail);
}

// Opérateur : en-tête X-Operator. Si FACTORY_OPERATORS (liste séparée par des virgules) est défini, seuls ces noms sont acceptés.
export const operator = (req) => operatorNamed(req.get('x-operator'));
export function operatorNamed(raw) {
  const name = String(raw ?? '').trim().slice(0, 80) || 'opérateur';
  const allowed = String(process.env.FACTORY_OPERATORS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(name)) return { error: `opérateur « ${name} » non autorisé` };
  return { name };
}

// Suppression définitive : FACTORY_ADMINS (liste séparée par des virgules) restreint l'action ; sans elle, les règles d'opérateur s'appliquent.
export function deleterNamed(raw) {
  const op = operatorNamed(raw);
  if (op.error) return op;
  const admins = String(process.env.FACTORY_ADMINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (admins.length && !admins.includes(op.name)) return { error: `« ${op.name} » n'est pas autorisé à supprimer définitivement un ticket` };
  return op;
}

export const parseQuestions = (output) => {
  const seen = new Set();
  for (const line of String(output).split('\n')) {
    const m = line.match(/^\s*(?:[-*>]\s*)?\[\[QUESTION\]\]\s*(.+?)\s*$/);
    if (m && m[1] !== '…' && m[1] !== '...') seen.add(m[1].slice(0, MAX_QUESTION_LEN));
  }
  return [...seen].slice(0, MAX_QUESTIONS);
};

export const pendingCount = (ticketId) => db.prepare("SELECT COUNT(*) AS n FROM ticket_questions WHERE ticket_id=? AND status='pending'").get(ticketId).n;

export function addQuestions(ticketId, runId, questions) {
  const ins = db.prepare("INSERT INTO ticket_questions (ticket_id, run_id, question, created_at) VALUES (?,?,?,datetime('now'))");
  for (const q of questions) ins.run(ticketId, runId, q);
}

// Échanges déjà traités, à réinjecter dans le prompt de reprise (ceux déjà repris ne sont pas répétés : tous, dans l'ordre)
export function exchangesPrompt(ticketId) {
  const rows = db.prepare("SELECT * FROM ticket_questions WHERE ticket_id=? AND status<>'pending' ORDER BY id").all(ticketId);
  if (!rows.length) return '';
  const lines = rows.map((q) => {
    const a = q.answer ? ` ${q.answer}` : '';
    if (q.status === 'validated') return `- Q : ${q.question}\n  Décision : VALIDÉ (l'hypothèse ou le choix proposé est accepté).${a}`;
    if (q.status === 'rejected') return `- Q : ${q.question}\n  Décision : REJETÉ (ne fais pas cela, choisis une autre approche).${a}`;
    return `- Q : ${q.question}\n  Réponse de l'opérateur :${a}`;
  });
  return `Questions déjà posées et décisions de l'opérateur (à respecter) :\n${lines.join('\n')}`;
}

export const INTERACTIVE_INSTRUCTIONS = [
  "Mode interactif : tu ne dois pas faire d'hypothèse sur un point ambigu ou une décision qui engage le résultat.",
  `Pour poser une question à l'opérateur, écris-la seule sur une ligne commençant par ${QUESTION_TAG} (une ligne par question, sans retour à la ligne dans la question).`,
  "Après avoir posé tes questions, commite le travail déjà fait sur la branche, n'effectue pas la partie qui dépend des réponses et termine immédiatement. Tu seras relancé avec les réponses.",
  `Si tu n'as aucune question, ne mets aucune ligne ${QUESTION_TAG} et exécute le ticket normalement.`,
].join('\n');

const notifyDefault = process.env.FACTORY_NOTIFY_WEBHOOK;

export const validationUrl = (perimeterId, ticketId) =>
  `${(process.env.FACTORY_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')}/#ia-factory?p=${perimeterId}&t=${ticketId}`;

// Notification : webhook JSON (FACTORY_NOTIFY_WEBHOOK, compatible chat entrant : champ « text ») ; sans webhook, trace dans les logs.
// Un échec de notification ne bloque jamais l'attente du ticket.
export async function notifyQuestions(ticket, count) {
  const url = validationUrl(ticket.perimeter_id, ticket.id);
  const text = `🤖 Ticket #${ticket.id} « ${ticket.title} » : ${count} question(s) de l'IA en attente de validation — ${url}`;
  log('info', text);
  if (!notifyDefault) return;
  try {
    const res = await fetch(notifyDefault, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, url, ticket_id: ticket.id, questions: count }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log('error', `notification ticket ${ticket.id} : HTTP ${res.status}`);
  } catch (e) {
    log('error', `notification ticket ${ticket.id} : ${e.message}`);
  }
}
