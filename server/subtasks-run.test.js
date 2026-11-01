import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fake-copilot-'));
const bin = join(dir, 'copilot');
const trace = join(dir, 'trace.txt');
// trace l'ordre des tickets exécutés ; un titre contenant BOOM fait échouer l'exécution
writeFileSync(bin, `#!/bin/sh
[ "$1" = "--version" ] && exit 0
echo "$2" | grep '^Ticket :' | head -1 >> ${trace}
echo "$2" > ${dir}/prompt-$(echo "$2" | grep '^Ticket :' | head -1 | tr -c 'A-Za-z0-9\n' '_').txt
echo "sortie de $(echo "$2" | grep '^Ticket :' | head -1)"
case "$2" in *"Ticket : BOOM"*) exit 3;; esac
exit 0
`);
chmodSync(bin, 0o755);
process.env.DB_FILE = ':memory:';
process.env.COPILOT_BIN = bin;
process.env.FACTORY_WORKDIR = dir;
process.env.FACTORY_WORKSPACE = join(dir, 'ws');

const { db } = await import('./db.js');
const { factoryRouter } = await import('./factory.js');
const express = (await import('express')).default;

const app = express();
app.use(express.json());
app.use(factoryRouter());
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const pid = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('p')").run().lastInsertRowid);
const mk = (title, parent = null, status = 'todo') => Number(db.prepare('INSERT INTO tickets (perimeter_id, title, parent_id, status, position) VALUES (?,?,?,?,?)')
  .run(pid, title, parent, status, db.prepare('SELECT COUNT(*) n FROM tickets').get().n).lastInsertRowid);
const statusOf = (id) => db.prepare('SELECT status FROM tickets WHERE id=?').get(id).status;
const lastRun = (id) => db.prepare('SELECT * FROM ticket_runs WHERE ticket_id=? ORDER BY id DESC LIMIT 1').get(id);
const order = () => { try { return readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.replace('Ticket : ', '')); } catch { return []; } };
const reset = () => writeFileSync(trace, '');

const run = async (id) => {
  const r = await fetch(`${base}/api/tickets/${id}/run`, { method: 'POST' });
  assert.equal(r.status, 201);
  for (let i = 0; i < 200 && db.prepare("SELECT 1 FROM ticket_runs WHERE status='running'").get(); i++) await new Promise((x) => setTimeout(x, 50));
};

test('sans sous-ticket : comportement inchangé', async () => {
  reset();
  const p = mk('seul');
  await run(p);
  assert.deepEqual(order(), ['seul']);
  assert.equal(lastRun(p).status, 'succeeded');
  assert.equal(statusOf(p), 'review');
});

test('seuls les sous-tickets sont exécutés, dans l\'ordre, parent en contexte, logs remontés', async () => {
  reset();
  const p = mk('parent');
  const a = mk('A', p);
  const b = mk('B', p);
  await run(p);
  assert.deepEqual(order(), ['A', 'B']);
  for (const id of [a, b]) {
    assert.equal(lastRun(id).status, 'succeeded');
    assert.equal(statusOf(id), 'done');
    const hist = db.prepare("SELECT * FROM ticket_audit WHERE ticket_id=? AND action='status' ORDER BY id").all(id);
    assert.equal(hist[0].new_value, 'doing');
    const au = hist.at(-1);
    assert.equal(au.actor, 'automatique');
    assert.equal(au.new_value, 'done');
    assert.match(au.detail, /sans erreur/);
  }
  const out = lastRun(p).output;
  assert.equal(lastRun(p).status, 'succeeded');
  assert.match(out, /sous-ticket #\d+ « A »/);
  assert.match(out, /sortie de Ticket : B/);
  assert.ok(out.indexOf('sortie de Ticket : A') < out.indexOf('sortie de Ticket : B'));
  assert.equal(statusOf(p), 'review');
  const prompt = readFileSync(join(dir, 'prompt-Ticket___A.txt'), 'utf8');
  assert.match(prompt, /Ticket parent : parent/);
  assert.match(prompt, /tâche à réaliser est UNIQUEMENT celle du sous-ticket/);
  assert.match(prompt, /- \[todo\] B/);
});

test('sous-ticket déjà done ignoré', async () => {
  reset();
  const p = mk('parent2');
  mk('fini', p, 'done');
  mk('restant', p);
  await run(p);
  assert.deepEqual(order(), ['restant']);
});

test('sous-tickets imbriqués : seules les feuilles, chaîne des ancêtres (cycles évités)', async () => {
  reset();
  const p = mk('racine');
  const a = mk('niveau1', p);
  mk('niveau2', a);
  await run(p);
  assert.deepEqual(order(), ['niveau2']);
  const prompt = readFileSync(join(dir, 'prompt-Ticket___niveau2.txt'), 'utf8');
  assert.ok(prompt.indexOf('Ticket parent (niveau 1) : racine') < prompt.indexOf('Ticket parent (niveau 2) : niveau1'));
  assert.equal(statusOf(a), 'review');
  assert.equal(statusOf(p), 'review');
  // cycle : le parent devient sous-ticket de son propre sous-ticket
  reset();
  const x = mk('cycleX');
  const y = mk('cycleY', x);
  db.prepare('UPDATE tickets SET parent_id=? WHERE id=?').run(y, x);
  const r = await fetch(`${base}/api/tickets/${x}/run`, { method: 'POST' });
  assert.equal(r.status, 201);
  for (let i = 0; i < 200 && db.prepare("SELECT 1 FROM ticket_runs WHERE status='running'").get(); i++) await new Promise((z) => setTimeout(z, 50));
  assert.deepEqual(order(), []); // cycle : rien n'est exécuté, sans boucle infinie
});

test('échec d\'un sous-ticket : arrêt, parent failed et non exécuté', async () => {
  reset();
  const p = mk('parent3');
  const a = mk('BOOM', p);
  const b = mk('apres', p);
  await run(p);
  assert.deepEqual(order(), ['BOOM']);
  assert.equal(lastRun(a).status, 'failed');
  assert.equal(statusOf(a), 'doing');
  assert.equal(lastRun(b), undefined);
  assert.equal(lastRun(p).status, 'failed');
  assert.match(lastRun(p).output, /Sous-tickets : .*failed/);
  assert.equal(statusOf(p), 'doing');
});

test('réparation : tickets en revue avec sous-tickets non terminés repassés en cours', async () => {
  const { repairPrematureReviews } = await import('./factory.js');
  const bad = mk('incohérent', null, 'review');
  mk('ouvert', bad, 'todo');
  const partial = mk('partiel', null, 'review');
  mk('ok', partial, 'done');
  mk('ouvert2', partial, 'doing');
  const good = mk('sain', null, 'review');
  mk('ok2', good, 'done');
  const none = mk('sans sous-ticket', null, 'review');
  const fixed = repairPrematureReviews();
  assert.deepEqual(fixed.sort(), [bad, partial].sort());
  assert.equal(statusOf(bad), 'doing');
  assert.equal(statusOf(partial), 'doing');
  assert.equal(statusOf(good), 'review');
  assert.equal(statusOf(none), 'review');
});

test('sous-ticket en erreur : pas Terminé, reste En cours, seule la prise en charge est tracée', async () => {
  reset();
  const p = mk('parent-err');
  const a = mk('BOOM', p);
  await run(p);
  assert.equal(statusOf(a), 'doing');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ticket_audit WHERE ticket_id=? AND action='status' AND new_value='done'").get(a).n, 0);
});

test('reprise d\'un parent en échec : seuls les sous-tickets restants sont relancés', async () => {
  reset();
  const p = mk('parent-reprise');
  const a = mk('BOOM', p);
  const b = mk('suite', p);
  await run(p);
  assert.equal(lastRun(p).status, 'failed');
  db.prepare("UPDATE tickets SET title='corrige' WHERE id=?").run(a);
  reset();
  const r = await fetch(`${base}/api/tickets/${p}/resume`, { method: 'POST' });
  assert.equal(r.status, 201);
  for (let i = 0; i < 200 && db.prepare("SELECT 1 FROM ticket_runs WHERE status='running'").get(); i++) await new Promise((x) => setTimeout(x, 50));
  assert.deepEqual(order(), ['corrige', 'suite']);
  assert.equal(lastRun(p).status, 'succeeded');
  assert.equal(statusOf(p), 'review');
  assert.equal(statusOf(b), 'done');
});
