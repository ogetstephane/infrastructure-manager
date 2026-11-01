import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fake-copilot-'));
const bin = join(dir, 'copilot');
writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && exit 0
printf '%s|%s|%s\\n' "$1" "$3" "$4" >> ${join(dir, 'args.log')}
case "$2" in
  *"Réponds uniquement par un objet JSON"*) echo '{"title":"Proposition interactive","description":"Réponse obtenue dans le terminal","priority":"normal","subtickets":[]}' ;;
  *"terminal-interaction-control-test"*) echo "attente de saisie"; read -r reply; printf '%s' "$reply" > ${join(dir, 'input.log')}; echo "réponse=$reply" ;;
  *"Décision"*|*"Réponse de l'opérateur"*) echo "travail terminé avec la réponse" ;;
  *"[[QUESTION]]"*) echo "je me pose une question"; echo "[[QUESTION]] Quelle base utiliser ?"; echo "[[QUESTION]] Quelle base utiliser ?"; echo "- [[QUESTION]] Quel port ?" ;;
  *) sleep 30 ;;
esac
`);
chmodSync(bin, 0o755);
process.env.DB_FILE = ':memory:';
process.env.COPILOT_BIN = bin;
process.env.FACTORY_WORKDIR = dir;
process.env.FACTORY_WORKSPACE = join(dir, 'ws');

const { db } = await import('./db.js');
const { factoryRouter } = await import('./factory.js');
const { parseQuestions } = await import('./interactive.js');
const express = (await import('express')).default;

const app = express();
app.use(express.json());
app.use(factoryRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const until = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('délai'); };

const pid = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);
const mk = (title, status = 'todo') => Number(db.prepare('INSERT INTO tickets (perimeter_id, title, status) VALUES (?,?,?)').run(pid, title, status).lastInsertRowid);
const lastRun = (id) => db.prepare('SELECT * FROM ticket_runs WHERE ticket_id=? ORDER BY id DESC LIMIT 1').get(id);

test('terminal interactif : stdin relayé et CLI lancée sans --no-ask-user', async () => {
  const id = mk('terminal-interaction-control-test');
  await call('POST', `/api/tickets/${id}/run`);
  const run = await until(async () => {
    const row = lastRun(id);
    const detail = await call('GET', `/api/ticket_runs/${row.id}`);
    return detail.body.output.includes('attente de saisie') && row;
  });
  process.env.FACTORY_OPERATORS = 'alice';
  try {
    assert.equal((await call('POST', `/api/ticket_runs/${run.id}/input`, { data: 'réponse opérateur\r' })).status, 403);
    assert.equal((await call('POST', `/api/ticket_runs/${run.id}/input`, { data: 'réponse opérateur\r' }, { 'X-Operator': 'alice' })).status, 200);
  } finally { delete process.env.FACTORY_OPERATORS; }
  await until(() => lastRun(id).status === 'succeeded');
  assert.equal(readFileSync(join(dir, 'input.log'), 'utf8'), 'réponse opérateur');
  const args = readFileSync(join(dir, 'args.log'), 'utf8');
  assert.match(args, /^-i\|--allow-all-tools\|--no-auto-update$/m);
  assert.doesNotMatch(args, /--no-ask-user/);
});

test('assistant de ticket : session interactive puis proposition JSON', async () => {
  const response = await call('POST', '/api/tickets/assist', { perimeter_id: pid, request: 'propose une tâche' });
  assert.equal(response.status, 201);
  const session = await until(async () => {
    const result = await call('GET', `/api/copilot_sessions/${response.body.session_id}`);
    return result.body.status === 'completed' && result.body;
  });
  assert.deepEqual(session.result, {
    title: 'Proposition interactive',
    description: 'Réponse obtenue dans le terminal',
    priority: 'normal',
    subtickets: [],
  });
});

test('parseQuestions : dédoublonne et ignore les marqueurs vides', () => {
  assert.deepEqual(parseQuestions('a\n[[QUESTION]] x\n  - [[QUESTION]] y\n[[QUESTION]] x\n[[QUESTION]] …'), ['x', 'y']);
});

test('interactif : questions, attente, réponses, reprise avec contexte, audit', async () => {
  const id = mk('T1');
  assert.equal((await call('POST', `/api/tickets/${id}/mode`, { interactive: true }, { 'X-Operator': 'alice' })).status, 200);
  await call('POST', `/api/tickets/${id}/run`);
  const run = await until(() => lastRun(id).status === 'waiting' && lastRun(id));
  assert.ok(run);
  const qs = (await call('GET', `/api/ticket_questions?ticket_id=${id}&status=pending`)).body;
  assert.equal(qs.length, 2);
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status, 'doing');
  assert.equal((await call('POST', `/api/tickets/${id}/resume`)).status, 409);
  assert.equal((await call('POST', `/api/tickets/${id}/run`)).status, 409);
  assert.equal((await call('POST', `/api/ticket_questions/${qs[0].id}/answer`, { status: 'answered', answer: '' })).status, 400);
  assert.equal((await call('POST', `/api/ticket_questions/${qs[0].id}/answer`, { status: 'answered', answer: 'PostgreSQL' }, { 'X-Operator': 'alice' })).status, 200);
  assert.equal((await call('POST', `/api/tickets/${id}/resume`)).status, 409);
  assert.equal((await call('POST', `/api/ticket_questions/${qs[1].id}/answer`, { status: 'rejected' })).status, 200);
  assert.equal((await call('POST', `/api/ticket_questions/${qs[1].id}/answer`, { status: 'validated' })).status, 409);
  assert.equal((await call('POST', `/api/tickets/${id}/resume`)).status, 201);
  await until(() => lastRun(id).status === 'succeeded');
  assert.match(lastRun(id).output, /réponse/);
  assert.equal(db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status, 'review');
  const actions = (await call('GET', `/api/ticket_audit?ticket_id=${id}`)).body.map((a) => a.action).sort();
  assert.deepEqual(actions, ['answer', 'answer', 'mode', 'questions', 'resume']);
  const mode = (await call('GET', `/api/ticket_audit?ticket_id=${id}`)).body.find((a) => a.action === 'mode');
  assert.deepEqual([mode.actor, mode.old_value, mode.new_value], ['alice', 'autonome', 'interactif']);
});

test('bascule à chaud : un ticket autonome en cours est suspendu puis relancé en interactif', async () => {
  const id = mk('T2');
  await call('POST', `/api/tickets/${id}/run`);
  await until(() => lastRun(id)?.status === 'running');
  const r = await call('POST', `/api/tickets/${id}/mode`, { interactive: true });
  assert.deepEqual(r.body, { changed: true, restarted: true });
  await until(() => db.prepare("SELECT 1 FROM ticket_runs WHERE ticket_id=? AND status='suspended'").get(id));
  await until(() => db.prepare("SELECT 1 FROM ticket_runs WHERE ticket_id=? AND status='waiting'").get(id));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ticket_questions WHERE ticket_id=? AND status='pending'").get(id).n, 2);
  assert.equal((await call('POST', `/api/tickets/${id}/mode`, { interactive: false })).status, 409);
});

test('droits, états incompatibles et réglage global', async () => {
  process.env.FACTORY_OPERATORS = 'alice';
  assert.equal((await call('POST', `/api/tickets/${mk('T3')}/mode`, { interactive: true }, { 'X-Operator': 'bob' })).status, 403);
  delete process.env.FACTORY_OPERATORS;
  assert.equal((await call('POST', `/api/tickets/${mk('T4', 'done')}/mode`, { interactive: true })).status, 409);
  assert.equal((await call('POST', `/api/tickets/${mk('T5')}/mode`, { interactive: 'oui' })).status, 400);
  assert.equal((await call('PUT', '/api/factory/settings', { interactive_default: true })).status, 200);
  assert.equal((await call('GET', '/api/factory/settings')).body.interactive_default, true);
  assert.ok(db.prepare("SELECT 1 FROM ticket_audit WHERE action='mode_default' AND ticket_id IS NULL").get());
});

test.after(() => { server.close(); setTimeout(() => process.exit(0), 200); });
