import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fake-copilot-'));
const bin = join(dir, 'copilot');
writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && exit 0
[ -f "$(dirname "$0")/quick" ] && { echo fini; exit 0; }
sleep 30
`);
chmodSync(bin, 0o755);
process.env.DB_FILE = ':memory:';
process.env.COPILOT_BIN = bin;
process.env.FACTORY_WORKDIR = dir;
process.env.FACTORY_WORKSPACE = join(dir, 'ws');

const { db } = await import('./db.js');
const { factoryRouter } = await import('./factory.js');
const { default: tickets, moveTicket } = await import('./entities/tickets.js');
const { crudRouter } = await import('./lib.js');
const express = (await import('express')).default;

const app = express();
app.use(express.json());
app.use(factoryRouter());
app.post('/api/tickets/:id/move', (req, res) => {
  const { code, error, tickets: rows } = moveTicket(Number(req.params.id), req.body.status, req.body.index, { manual: true, shortcut: req.body.shortcut === true, actor: req.get('x-operator') || null });
  res.status(code).json(error ? { error } : rows);
});
app.use('/api/tickets', crudRouter(tickets, () => ({})));
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const pid = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);
const mk = (status = 'todo') => Number(db.prepare('INSERT INTO tickets (perimeter_id, title, status) VALUES (?,?,?)').run(pid, 't', status).lastInsertRowid);
const statusOf = (id) => db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status;
const runsOf = (id) => db.prepare('SELECT * FROM ticket_runs WHERE ticket_id=?').all(id);
const auditOf = (id, action) => db.prepare('SELECT * FROM ticket_audit WHERE ticket_id=? AND action=?').all(id, action);

// une seule exécution sans application à la fois : on arrête celles des tests précédents
const stopAll = async () => {
  for (const r of db.prepare("SELECT id FROM ticket_runs WHERE status='running'").all()) await call('POST', `/api/ticket_runs/${r.id}/cancel`);
  for (let i = 0; i < 100 && db.prepare("SELECT 1 FROM ticket_runs WHERE status='running'").get(); i++) await new Promise((r) => setTimeout(r, 50));
};
afterEach(stopAll);
after(() => server.close());

test('PUT status=doing lance un traitement (comme Exécuter), historisé', async () => {
  const id = mk();
  assert.equal((await call('PUT', `/api/tickets/${id}`, { status: 'doing' }, { 'x-operator': 'alice' })).status, 200);
  assert.equal(runsOf(id).length, 1);
  assert.equal(statusOf(id), 'doing');
  assert.equal(auditOf(id, 'run')[0].actor, 'alice');
});

test('déplacement (move) vers doing lance un traitement', async () => {
  const id = mk();
  assert.equal((await call('POST', `/api/tickets/${id}/move`, { status: 'doing', index: 0, shortcut: true })).status, 200);
  assert.equal(runsOf(id).length, 1);
});

test('idempotence : retour à En cours, double appel, appels concurrents', async () => {
  const id = mk();
  await Promise.all([1, 2, 3].map(() => call('PUT', `/api/tickets/${id}`, { status: 'doing' })));
  assert.equal(runsOf(id).length, 1);
  await call('PUT', `/api/tickets/${id}`, { status: 'review' });
  await call('PUT', `/api/tickets/${id}`, { status: 'doing' });
  assert.equal(runsOf(id).length, 1);
  assert.equal((await call('POST', `/api/tickets/${id}/run`)).status, 409);
});

test('les autres statuts ne déclenchent rien', async () => {
  for (const s of ['backlog', 'todo', 'review', 'done']) {
    const id = mk('doing');
    await call('PUT', `/api/tickets/${id}`, { status: s });
    assert.equal(runsOf(id).length, 0, s);
  }
});

test('le bouton Exécuter reste fonctionnel', async () => {
  const id = mk();
  const r = await call('POST', `/api/tickets/${id}/run`);
  assert.equal(r.status, 201);
  assert.equal(runsOf(id).length, 1);
  assert.equal(statusOf(id), 'doing');
});

test('échec de lancement : statut rétabli, erreur visible, tracée', async () => {
  const app0 = Number(db.prepare("INSERT INTO applications (perimeter_id, name, git_repo) VALUES (?, 'a', '')").run(pid).lastInsertRowid);
  const id = mk();
  db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id, app0);
  const r = await call('PUT', `/api/tickets/${id}`, { status: 'doing' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /dépôt Git/);
  assert.equal(statusOf(id), 'todo');
  assert.equal(runsOf(id).length, 0);
  assert.equal(auditOf(id, 'run_failed').length, 1);
  const id2 = mk();
  db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id2, app0);
  const m = await call('POST', `/api/tickets/${id2}/move`, { status: 'doing', index: 0, shortcut: true });
  assert.equal(m.status, 409);
  assert.equal(statusOf(id2), 'todo');
});

test('bouton Exécuter en échec : erreur claire, tracée, statut inchangé', async () => {
  const app0 = Number(db.prepare("INSERT INTO applications (perimeter_id, name, git_repo) VALUES (?, 'b', '')").run(pid).lastInsertRowid);
  const id = mk();
  db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id, app0);
  const r = await call('POST', `/api/tickets/${id}/run`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /dépôt Git/);
  assert.equal(statusOf(id), 'todo');
  assert.equal(runsOf(id).length, 0);
  assert.equal(auditOf(id, 'run_failed').length, 1);
});

test('droits : opérateur non autorisé, transition annulée', async () => {
  process.env.FACTORY_OPERATORS = 'alice';
  try {
    const id = mk();
    const r = await call('PUT', `/api/tickets/${id}`, { status: 'doing' }, { 'x-operator': 'mallory' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /non autorisé/);
    assert.equal(statusOf(id), 'todo');
    assert.equal(runsOf(id).length, 0);
    assert.equal((await call('POST', `/api/tickets/${id}/run`, undefined, { 'x-operator': 'mallory' })).status, 403);
    assert.equal((await call('PUT', `/api/tickets/${id}`, { status: 'doing' }, { 'x-operator': 'alice' })).status, 200);
    assert.equal(runsOf(id).length, 1);
  } finally { delete process.env.FACTORY_OPERATORS; }
});

const waitRun = async (id) => {
  for (let i = 0; i < 100 && (!runsOf(id).length || runsOf(id).some((r) => r.status === 'running')); i++) await new Promise((r) => setTimeout(r, 50));
};

test('transition nominale : lancement automatique puis fin en succès → review', async () => {
  writeFileSync(join(dir, 'quick'), '');
  try {
    const id = mk();
    assert.equal((await call('PUT', `/api/tickets/${id}`, { status: 'doing' })).status, 200);
    await waitRun(id);
    assert.equal(runsOf(id)[0].status, 'succeeded');
    assert.match(runsOf(id)[0].output, /fini/);
    assert.equal(statusOf(id), 'review');
  } finally { rmSync(join(dir, 'quick'), { force: true }); }
});

test('équivalence : passage en doing et bouton Exécuter produisent le même résultat', async () => {
  writeFileSync(join(dir, 'quick'), '');
  try {
    const a = mk();
    await call('PUT', `/api/tickets/${a}`, { status: 'doing' }, { 'x-operator': 'alice' });
    await waitRun(a);
    const b = mk();
    await call('POST', `/api/tickets/${b}/run`, undefined, { 'x-operator': 'alice' });
    await waitRun(b);
    const shape = (id) => ({
      status: statusOf(id),
      runs: runsOf(id).map((r) => [r.status, r.exit_code, r.output]),
    });
    assert.deepEqual(shape(a), shape(b));
    assert.equal(auditOf(a, 'run').length, 1);
  } finally { rmSync(join(dir, 'quick'), { force: true }); }
});

test('échec du processus : le ticket reste en doing avec une exécution failed', async () => {
  writeFileSync(join(dir, 'quick'), '');
  const orig = readFileSync(bin, 'utf8');
  writeFileSync(bin, orig.replace('echo fini; exit 0', 'echo boom; exit 3'));
  try {
    const id = mk();
    await call('PUT', `/api/tickets/${id}`, { status: 'doing' });
    await waitRun(id);
    assert.equal(runsOf(id)[0].status, 'failed');
    assert.equal(statusOf(id), 'doing');
  } finally { writeFileSync(bin, orig); rmSync(join(dir, 'quick'), { force: true }); }
});
