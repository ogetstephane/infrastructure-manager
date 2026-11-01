import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
process.env.FACTORY_ADMINS = 'chef';
process.env.FACTORY_WORKDIR = process.cwd();

const { db } = await import('./db.js');
const { factoryRouter } = await import('./factory.js');
const express = (await import('express')).default;

const app = express();
app.use(express.json());
app.use(factoryRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const call = async (method, path, who) => {
  const r = await fetch(base + path, { method, headers: who ? { 'X-Operator': who } : {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

const pid = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);
const mk = (title, parent = null) => Number(db.prepare('INSERT INTO tickets (perimeter_id, title, parent_id) VALUES (?,?,?)').run(pid, title, parent).lastInsertRowid);
const count = (sql, ...a) => db.prepare(sql).get(...a).n;

test('sans droit : 403 et ticket conservé ; réglage can_delete', async () => {
  const id = mk('secret');
  assert.equal((await call('DELETE', `/api/tickets/${id}`, 'intrus')).status, 403);
  assert.equal((await call('DELETE', `/api/tickets/${id}`)).status, 403);
  assert.equal(count('SELECT COUNT(*) n FROM tickets WHERE id=?', id), 1);
  assert.equal((await call('GET', '/api/factory/settings', 'intrus')).body.can_delete, false);
  assert.equal((await call('GET', '/api/factory/settings', 'chef')).body.can_delete, true);
});

test('suppression complète, audit sans contenu, puis 404', async () => {
  const id = mk('à supprimer');
  const app = Number(db.prepare("INSERT INTO applications (perimeter_id, name) VALUES (?, 'a')").run(pid).lastInsertRowid);
  db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id, app);
  db.prepare("INSERT INTO ticket_runs (ticket_id, started_at, output) VALUES (?, 'now', 'sortie')").run(id);
  db.prepare("INSERT INTO ticket_audit (ticket_id, actor, action) VALUES (?, 'x', 'mode')").run(id);
  const r = await call('DELETE', `/api/tickets/${id}`, 'chef');
  assert.equal(r.status, 200);
  for (const t of ['tickets WHERE id', 'ticket_links WHERE ticket_id', 'ticket_runs WHERE ticket_id', 'ticket_audit WHERE ticket_id']) {
    assert.equal(count(`SELECT COUNT(*) n FROM ${t}=?`, id), 0, t);
  }
  assert.equal(count('SELECT COUNT(*) n FROM applications WHERE id=?', app), 1);
  const row = db.prepare('SELECT * FROM ticket_deletions WHERE ticket_id=?').get(id);
  assert.equal(row.actor, 'chef');
  assert.deepEqual(Object.keys(row).sort(), ['actor', 'deleted_at', 'id', 'ticket_id']);
  assert.equal((await call('DELETE', `/api/tickets/${id}`, 'chef')).status, 404);
});

test('ticket avec sous-tickets : 409 ; un sous-ticket se supprime sans toucher le parent', async () => {
  const parent = mk('parent');
  const child = mk('enfant', parent);
  const before = count('SELECT COUNT(*) n FROM ticket_deletions');
  const r = await call('DELETE', `/api/tickets/${parent}`, 'chef');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /sous-ticket/);
  assert.equal(count('SELECT COUNT(*) n FROM tickets WHERE id IN (?,?)', parent, child), 2);
  assert.equal(count('SELECT COUNT(*) n FROM ticket_deletions'), before);
  assert.equal((await call('DELETE', `/api/tickets/${child}`, 'chef')).status, 200);
  assert.equal((await call('DELETE', `/api/tickets/${parent}`, 'chef')).status, 200);
});
