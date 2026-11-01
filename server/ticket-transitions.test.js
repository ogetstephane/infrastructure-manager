import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
const { db } = await import('./db.js');
const { moveTicket, canMoveManually, STATUSES } = await import('./entities/tickets.js');

const perimeterId = db.prepare('SELECT id FROM perimeters LIMIT 1').get()?.id
  ?? Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);

const make = (status) => Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position) VALUES (?, 't', ?, 99)").run(perimeterId, status).lastInsertRowid);
const statusOf = (id) => db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status;

const ALLOWED = new Set(['backlog>todo', 'review>done']);

for (const from of STATUSES) {
  for (const to of STATUSES) {
    const ok = from === to || ALLOWED.has(`${from}>${to}`);
    test(`${from} → ${to} : ${ok ? 'autorisé' : 'refusé'}`, () => {
      assert.equal(canMoveManually(from, to), ok);
      const id = make(from);
      const r = moveTicket(id, to, 0, { manual: true });
      assert.equal(r.code, ok ? 200 : 409);
      assert.equal(statusOf(id), ok ? to : from);
    });
  }
}

test('un déplacement non manuel (agent) reste libre', () => {
  const id = make('todo');
  assert.equal(moveTicket(id, 'doing', 0).code, 200);
  assert.equal(statusOf(id), 'doing');
});

const SHORTCUTS = { backlog: 'todo', todo: 'doing', review: 'done' };

for (const from of STATUSES) {
  for (const to of STATUSES) {
    const ok = SHORTCUTS[from] === to;
    test(`raccourci ${from} → ${to} : ${ok ? 'autorisé' : 'refusé'}`, () => {
      const id = make(from);
      const r = moveTicket(id, to, 0, { manual: true, shortcut: true });
      assert.equal(r.code, ok ? 200 : 409);
      assert.equal(statusOf(id), ok ? to : from);
    });
  }
}

test('la table des raccourcis du front correspond au serveur (label compris)', async () => {
  const { QUICK_TRANSITIONS, quickTransition } = await import('../web/src/components/ia-factory/factory.js');
  assert.deepEqual(Object.fromEntries(Object.entries(QUICK_TRANSITIONS).map(([k, v]) => [k, v.to])), SHORTCUTS);
  assert.equal(quickTransition('backlog').label, 'Passer à À faire');
  assert.equal(quickTransition('todo').label, 'Passer à En cours');
  assert.equal(quickTransition('review').label, 'Passer à Terminé');
  assert.equal(quickTransition('doing'), null);
  assert.equal(quickTransition('done'), null);
});

test('cascade À faire : tous les sous-tickets, quel que soit leur statut, tracée, sans boucle', () => {
  const sub = (parent, status) => Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position, parent_id) VALUES (?, 's', ?, 0, ?)").run(perimeterId, status, parent).lastInsertRowid);
  const p = make('backlog');
  const subs = STATUSES.map((s) => sub(p, s));
  const grandchild = sub(subs[0], 'done');
  assert.equal(moveTicket(p, 'todo', 0, { manual: true }).code, 200);
  for (const id of [...subs, grandchild]) assert.equal(statusOf(id), 'todo');
  assert.equal(statusOf(p), 'todo');
  const audits = db.prepare("SELECT * FROM ticket_audit WHERE ticket_id=? AND action='status'").all(subs[4]);
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].actor, audits[0].old_value, audits[0].new_value], ['automatique', 'done', 'todo']);
  assert.match(audits[0].detail, new RegExp(`#${p}`));
  // sous-ticket déjà « À faire » : aucune trace
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ticket_audit WHERE ticket_id=? AND action='status'").get(subs[1]).n, 0);
});

test('parent vers un autre statut : sous-tickets inchangés ; parent sans sous-ticket : sans effet', () => {
  const p = make('todo');
  const s = Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position, parent_id) VALUES (?, 's', 'done', 0, ?)").run(perimeterId, p).lastInsertRowid);
  for (const to of ['doing', 'review', 'done', 'backlog']) {
    assert.equal(moveTicket(p, to, 0).code, 200);
    assert.equal(statusOf(s), 'done');
  }
  const alone = make('backlog');
  assert.equal(moveTicket(alone, 'todo', 0).code, 200);
  assert.equal(statusOf(alone), 'todo');
  // parent déjà « À faire » : rien ne change
  moveTicket(p, 'todo', 0);
  db.prepare("UPDATE tickets SET status='done' WHERE id=?").run(s);
  moveTicket(p, 'todo', 0);
  assert.equal(statusOf(s), 'done');
});

test('absence de boucle : données cycliques et aucun déclenchement de lancement par la cascade', async () => {
  const { setLaunchHook, cascadeTodo } = await import('./entities/tickets.js');
  const launched = [];
  setLaunchHook((id) => { launched.push(id); return null; });
  try {
    const a = make('backlog');
    const b = Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position, parent_id) VALUES (?, 's', 'doing', 0, ?)").run(perimeterId, a).lastInsertRowid);
    db.prepare('UPDATE tickets SET parent_id=? WHERE id=?').run(b, a);
    assert.doesNotThrow(() => cascadeTodo(a));
    assert.equal(statusOf(b), 'todo');
    assert.deepEqual(launched, []);
    const n = () => db.prepare("SELECT COUNT(*) n FROM ticket_audit WHERE ticket_id=? AND action='status'").get(b).n;
    cascadeTodo(a);
    assert.equal(n(), 1);
  } finally {
    setLaunchHook(null);
  }
});

test('traçabilité : un déplacement manuel ne trace pas de statut automatique pour le parent lui-même', () => {
  const p = make('backlog');
  const s = Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status, position, parent_id) VALUES (?, 's', 'review', 0, ?)").run(perimeterId, p).lastInsertRowid);
  moveTicket(p, 'todo', 0, { manual: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ticket_audit WHERE ticket_id=? AND actor='automatique'").get(p).n, 0);
  const a = db.prepare("SELECT old_value, new_value, actor FROM ticket_audit WHERE ticket_id=? AND action='status'").all(s);
  assert.deepEqual(a.map((r) => ({ ...r })), [{ old_value: 'review', new_value: 'todo', actor: 'automatique' }]);
});
