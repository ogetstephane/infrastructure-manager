import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
const { db } = await import('./db.js');
const { autoStatus, canAutoMove, cascadeTodo } = await import('./entities/tickets.js');

const pid = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);
const mk = (status, parent = null) => Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position, parent_id) VALUES (?, 't', ?, 0, ?)").run(pid, status, parent).lastInsertRowid);
const statusOf = (id) => db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status;
const audit = (id) => db.prepare('SELECT * FROM ticket_audit WHERE ticket_id=? ORDER BY id').all(id);

test('prise en charge puis traitement : statuts changés et historisés (ancien, nouveau, auteur, date)', () => {
  const p = mk('doing'); const s = mk('todo', p);
  assert.ok(autoStatus(s, 'doing', 'pris en charge'));
  assert.ok(autoStatus(s, 'done', 'traité'));
  const h = audit(s);
  assert.deepEqual(h.map((r) => [r.old_value, r.new_value, r.actor]), [['todo', 'doing', 'automatique'], ['doing', 'done', 'automatique']]);
  assert.ok(h[0].at);
});

test('transitions invalides refusées sans réouverture explicite', () => {
  const p = mk('doing'); const s = mk('done', p);
  for (const to of ['backlog', 'todo', 'doing', 'review']) assert.equal(autoStatus(s, to, 'x'), false);
  assert.equal(statusOf(s), 'done');
  assert.equal(audit(s).length, 0);
  assert.equal(canAutoMove('done', 'todo'), false);
  assert.ok(autoStatus(s, 'todo', 'réouverture', { reopen: true }));
});

test('le parent est signalé prêt à clôturer quand tous ses sous-tickets sont terminés', () => {
  const p = mk('doing'); const a = mk('doing', p); const b = mk('doing', p);
  autoStatus(a, 'done', 'ok');
  assert.equal(audit(p).filter((r) => r.action === 'ready_to_close').length, 0);
  autoStatus(b, 'done', 'ok');
  assert.equal(audit(p).filter((r) => r.action === 'ready_to_close').length, 1);
  assert.equal(statusOf(p), 'doing');
});

test('la remise à « À faire » du parent rouvre explicitement les sous-tickets', () => {
  const p = mk('todo'); const s = mk('done', p);
  cascadeTodo(p);
  assert.equal(statusOf(s), 'todo');
});

test('un ticket sans parent n\'est pas soumis à la règle', () => {
  const t = mk('done');
  assert.ok(autoStatus(t, 'todo', 'x'));
});
