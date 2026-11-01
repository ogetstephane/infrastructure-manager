import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'wt-test-'));
const fake = path.join(tmp, 'fake-copilot.sh');
// Faux Copilot : écrit un fichier dans son dossier de travail puis attend un peu (pour chevaucher les exécutions)
writeFileSync(fake, '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\necho "work from $(basename "$PWD")" > work.txt\nsleep 1\necho done\n');
chmodSync(fake, 0o755);
process.env.DB_FILE = ':memory:';
process.env.FACTORY_WORKSPACE = path.join(tmp, 'ws');
process.env.COPILOT_BIN = fake;

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const origin = path.join(tmp, 'origin');
sh(tmp, 'init', '-q', '-b', 'main', origin);
writeFileSync(path.join(origin, 'a.txt'), 'a');
sh(origin, 'add', '.');
sh(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

const { validateRepo, createWorktree, removeWorktree, repoDir, sanitize } = await import('./git.js');
const { db } = await import('./db.js');
const { crudRouter } = await import('./lib.js');
const applications = (await import('./entities/applications.js')).default;
const { factoryRouter } = await import('./factory.js');
const express = (await import('express')).default;

const server = express();
server.use(express.json());
server.use(factoryRouter());
server.use('/api/applications', crudRouter(applications, () => ({})));
const listener = server.listen(0);
const base = `http://127.0.0.1:${listener.address().port}/api`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };

test.after(() => listener.close());

test('validation du dépôt : refus clairs', () => {
  assert.match(validateRepo('').error, /vide/);
  assert.match(validateRepo('-evil').error, /invalide/);
  assert.match(validateRepo('ftp://x/y').error, /invalide/);
  assert.match(validateRepo('https://user:secret@example.com/r.git').error, /identifiants interdits/);
  assert.match(validateRepo(path.join(tmp, 'nope')).error, /introuvable/);
  assert.match(validateRepo(tmp).error, /inaccessible/);
  assert.match(validateRepo(origin, 'absente').error, /branche introuvable/);
  assert.deepEqual(validateRepo(origin, 'main'), { branch: 'main' });
  assert.deepEqual(validateRepo(origin), { branch: 'main' });
  assert.equal(sanitize('fatal: https://u:p@host/x'), 'fatal: https://***@host/x');
});

test("API application : repo invalide refusé, valide accepté et branche par défaut résolue", async () => {
  const p = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('P')").run().lastInsertRowid);
  const bad = await call('POST', '/applications', { name: 'A', perimeter_id: p, git_repo: path.join(tmp, 'nope') });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /introuvable/);
  const ok = await call('POST', '/applications', { name: 'A', perimeter_id: p, git_repo: origin });
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT git_repo, git_branch FROM applications WHERE id=?').get(ok.body.id);
  assert.deepEqual({ ...row }, { git_repo: origin, git_branch: 'main' });
  const put = await call('PUT', `/applications/${ok.body.id}`, { git_branch: 'absente' });
  assert.equal(put.status, 400);
  assert.equal((await call('PUT', `/applications/${ok.body.id}`, { git_repo: '' })).status, 200);
  assert.equal(db.prepare('SELECT git_branch FROM applications WHERE id=?').get(ok.body.id).git_branch, '');
});

test('worktrees : parallèle sans collision, nettoyage, réutilisation de branche, purge', async () => {
  const app = { id: 90, git_repo: origin, git_branch: 'main' };
  const [w1, w2] = await Promise.all([createWorktree(app, 1), createWorktree(app, 2)]);
  assert.notEqual(w1.path, w2.path);
  assert.ok(existsSync(path.join(w1.path, 'a.txt')) && existsSync(path.join(w2.path, 'a.txt')));
  writeFileSync(path.join(w1.path, 'new.txt'), 'x');
  assert.deepEqual(await removeWorktree(90, 1, { commit: true }), []);
  assert.ok(!existsSync(w1.path));
  assert.match(sh(repoDir(90), 'branch', '--list', 'ticket/1'), /ticket\/1/);
  assert.equal(sh(repoDir(90), 'show', 'ticket/1:new.txt'), 'x');
  const again = await createWorktree(app, 1);
  assert.equal(again.reused, true);
  assert.ok(existsSync(path.join(again.path, 'new.txt')));
  await removeWorktree(90, 1, { deleteBranch: true });
  await removeWorktree(90, 2, { deleteBranch: true });
  assert.equal(sh(repoDir(90), 'branch', '--list', 'ticket/*').trim(), '');
  assert.ok(!existsSync(w2.path));
});

test('fetch/clone en échec : erreur claire, pas de résidu', async () => {
  await assert.rejects(createWorktree({ id: 91, git_repo: path.join(tmp, 'absent'), git_branch: 'main' }, 1), /clone impossible/);
  assert.ok(!existsSync(repoDir(91)));
  await assert.rejects(createWorktree({ id: 92, git_repo: origin, git_branch: 'nope' }, 1), /branche de base introuvable/);
  await removeWorktree(92, 1, { deleteBranch: true });
});

test('tickets lancés en parallèle : worktrees distincts, nettoyés à la fin, branche conservée', async () => {
  const p = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('Q')").run().lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO applications (name, perimeter_id, git_repo, git_branch) VALUES ('Q', ?, ?, 'main')").run(p, origin).lastInsertRowid);
  const noRepo = Number(db.prepare("INSERT INTO applications (name, perimeter_id) VALUES ('Vide', ?)").run(p).lastInsertRowid);
  const mk = (title, appId) => {
    const t = Number(db.prepare('INSERT INTO tickets (perimeter_id, title) VALUES (?, ?)').run(p, title).lastInsertRowid);
    db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(t, appId);
    return t;
  };
  const t1 = mk('un', a);
  const t2 = mk('deux', a);
  const t3 = mk('sans repo', noRepo);

  const refused = await call('POST', `/tickets/${t3}/run`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /pas de dépôt Git/);

  const [r1, r2] = await Promise.all([call('POST', `/tickets/${t1}/run`), call('POST', `/tickets/${t2}/run`)]);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal((await call('POST', `/tickets/${t1}/run`)).status, 409);
  const wt = await waitFor(() => { const rows = db.prepare('SELECT worktree_path FROM tickets WHERE id IN (?,?)').all(t1, t2); return rows.every((r) => r.worktree_path) && rows.map((r) => r.worktree_path); });
  assert.notEqual(wt[0], wt[1]);

  for (const id of [r1.body.id, r2.body.id]) {
    const run = await waitFor(() => { const r = db.prepare('SELECT * FROM ticket_runs WHERE id=?').get(id); return r.status !== 'running' && r; });
    assert.equal(run.status, 'succeeded', run.output);
  }
  for (const [t, dir] of [[t1, wt[0]], [t2, wt[1]]]) {
    assert.ok(!existsSync(dir));
    const row = db.prepare('SELECT worktree_path, worktree_branch FROM tickets WHERE id=?').get(t);
    assert.equal(row.worktree_path, null);
    assert.equal(row.worktree_branch, `ticket/${t}`);
    assert.match(readFileSync(path.join(repoDir(a), '.git', 'refs', 'heads', 'ticket', String(t)), 'utf8'), /^[0-9a-f]{40}/);
    assert.match(sh(repoDir(a), 'show', `ticket/${t}:work.txt`), new RegExp(`ticket-${t}`));
  }

  // un ticket supprimé laisse une branche orpheline : la purge la retire
  db.prepare('DELETE FROM tickets WHERE id=?').run(t1);
  const rep = await call('POST', '/worktrees/purge');
  assert.deepEqual(rep.body.branches, [`app-${a}/ticket/${t1}`]);
});
