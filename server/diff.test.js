import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'diff-test-'));
process.env.DB_FILE = ':memory:';
process.env.FACTORY_WORKSPACE = path.join(tmp, 'ws');
process.env.DIFF_PAGE_LINES = '50';
process.env.DIFF_MAX_BYTES = '200000';

const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const origin = path.join(tmp, 'origin');
sh(tmp, 'init', '-q', '-b', 'main', origin);
const put = (dir, name, content) => writeFileSync(path.join(dir, name), content);
put(origin, 'mod.txt', 'un\ndeux\ntrois\n');
put(origin, 'del.txt', 'à supprimer\n');
put(origin, 'old name.txt', 'contenu renommé\nligne 2\nligne 3\nligne 4\n');
sh(origin, 'add', '.');
sh(origin, 'commit', '-qm', 'init');

const { createWorktree, removeWorktree, repoDir } = await import('./git.js');
const { db } = await import('./db.js');
const { factoryRouter } = await import('./factory.js');
const express = (await import('express')).default;

const server = express();
server.use(express.json());
server.use(factoryRouter());
const listener = server.listen(0);
const base = `http://127.0.0.1:${listener.address().port}/api`;
const get = async (url) => {
  const r = await fetch(base + url);
  return { status: r.status, body: await r.json() };
};
test.after(() => listener.close());

const p = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('P')").run().lastInsertRowid);
const app = Number(db.prepare("INSERT INTO applications (name, perimeter_id, git_repo, git_branch) VALUES ('A', ?, ?, 'main')").run(p, origin).lastInsertRowid);
const mk = (title, appId, status = 'review') => {
  const t = Number(db.prepare('INSERT INTO tickets (perimeter_id, title, status) VALUES (?, ?, ?)').run(p, title, status).lastInsertRowid);
  if (appId) db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(t, appId);
  return t;
};

test('diff : fichiers ajoutés, modifiés, supprimés, renommés, binaires', async () => {
  const t = mk('ticket', app);
  const wt = await createWorktree({ id: app, git_repo: origin, git_branch: 'main' }, t);
  put(wt.path, 'mod.txt', 'un\nDEUX\ntrois\nquatre\n');
  put(wt.path, 'new.js', 'const a = 1;\n');
  put(wt.path, 'img.bin', Buffer.from([0, 1, 2, 0, 255, 0]));
  rmSync(path.join(wt.path, 'del.txt'));
  renameSync(path.join(wt.path, 'old name.txt'), path.join(wt.path, 'new name.txt'));
  await removeWorktree(app, t, { commit: true });
  // la base avance : le diff est calculé depuis le merge-base (git diff base...branche)
  put(origin, 'later.txt', 'après\n');
  sh(origin, 'add', '.');
  sh(origin, 'commit', '-qm', 'later');
  sh(repoDir(app), 'fetch', 'origin');

  const { status, body } = await get(`/tickets/${t}/diff`);
  assert.equal(status, 200);
  assert.equal(body.branch, `ticket/${t}`);
  const by = Object.fromEntries(body.files.map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), ['del.txt', 'img.bin', 'mod.txt', 'new name.txt', 'new.js']);
  const deleted = body.files.find((f) => f.status === 'deleted');
  assert.equal(deleted.path, 'del.txt');
  assert.equal(by['mod.txt'].status, 'modified');
  assert.equal(by['mod.txt'].additions, 2);
  assert.equal(by['mod.txt'].deletions, 1);
  assert.equal(by['new.js'].status, 'added');
  assert.equal(by['new name.txt'].status, 'renamed');
  assert.equal(by['new name.txt'].old_path, 'old name.txt');
  assert.equal(by['img.bin'].binary, true);
  assert.equal(body.additions, 3);
  assert.equal(body.deletions, 2);

  const expected = sh(repoDir(app), 'diff', '--numstat', `origin/main...ticket/${t}`).trim().split('\n').length;
  assert.equal(body.files.length, expected);

  const f = await get(`/tickets/${t}/diff/file?path=${encodeURIComponent('mod.txt')}`);
  assert.equal(f.status, 200);
  assert.match(f.body.patch, /^diff --git a\/mod.txt b\/mod.txt/);
  assert.match(f.body.patch, /\n-deux\n\+DEUX\n/);
  assert.equal(f.body.next_offset, null);
  const bin = await get(`/tickets/${t}/diff/file?path=img.bin`);
  assert.equal(bin.body.binary, true);
  const ren = await get(`/tickets/${t}/diff/file?path=${encodeURIComponent('new name.txt')}`);
  assert.match(ren.body.patch, /rename from old name.txt/);
  assert.equal((await get(`/tickets/${t}/diff/file?path=${encodeURIComponent('later.txt')}`)).status, 404);
  assert.equal((await get(`/tickets/${t}/diff/file?path=--output%3Dx`)).status, 404);
  assert.equal((await get(`/tickets/${t}/diff/file`)).status, 404);

  db.prepare("UPDATE tickets SET status='doing' WHERE id=?").run(t);
  const closed = await get(`/tickets/${t}/diff`);
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /en revue/);
  assert.equal((await get(`/tickets/${t}/diff/file?path=mod.txt`)).status, 409);
});

test('gros diff : pagination par lignes', async () => {
  const t = mk('gros', app);
  const wt = await createWorktree({ id: app, git_repo: origin, git_branch: 'main' }, t);
  put(wt.path, 'big.txt', Array.from({ length: 120 }, (_, i) => `ligne ${i}`).join('\n') + '\n');
  await removeWorktree(app, t, { commit: true });
  const first = (await get(`/tickets/${t}/diff/file?path=big.txt`)).body;
  assert.equal(first.patch.split('\n').length, 50);
  assert.equal(first.next_offset, 50);
  const last = (await get(`/tickets/${t}/diff/file?path=big.txt&offset=100`)).body;
  assert.equal(last.next_offset, null);
  assert.match(last.patch, /\+ligne 119$/);
});

test('très gros diff : sortie plafonnée sans plantage', async () => {
  const t = mk('énorme', app);
  const wt = await createWorktree({ id: app, git_repo: origin, git_branch: 'main' }, t);
  put(wt.path, 'huge.txt', 'x'.repeat(100) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(5000));
  await removeWorktree(app, t, { commit: true });
  const r = await get(`/tickets/${t}/diff/file?path=huge.txt`);
  assert.equal(r.status, 200);
  assert.equal(r.body.next_offset, 50);
});

test('aucun changement, branche introuvable, dépôt absent, ticket sans application', async () => {
  const empty = mk('vide', app);
  sh(repoDir(app), 'branch', `ticket/${empty}`, 'origin/main');
  const none = await get(`/tickets/${empty}/diff`);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.files, []);

  const nobranch = await get(`/tickets/${mk('sans branche', app)}/diff`);
  assert.equal(nobranch.status, 404);
  assert.match(nobranch.body.error, /branche du ticket introuvable/);

  const badBase = Number(db.prepare("INSERT INTO applications (name, perimeter_id, git_repo, git_branch) VALUES ('B', ?, ?, 'absente')").run(p, origin).lastInsertRowid);
  sh(tmp, 'clone', '-q', '--no-checkout', origin, repoDir(badBase).replace(/\/repo$/, '') + '/repo');
  const tb = mk('base absente', badBase);
  sh(repoDir(badBase), 'branch', `ticket/${tb}`, 'origin/main');
  assert.match((await get(`/tickets/${tb}/diff`)).body.error, /branche de base introuvable/);

  const norepo = Number(db.prepare("INSERT INTO applications (name, perimeter_id, git_repo, git_branch) VALUES ('C', ?, ?, 'main')").run(p, origin).lastInsertRowid);
  const nr = await get(`/tickets/${mk('non cloné', norepo)}/diff`);
  assert.equal(nr.status, 404);
  assert.match(nr.body.error, /dépôt non cloné/);

  assert.equal((await get(`/tickets/${mk('libre', null)}/diff`)).status, 409);
  assert.equal((await get('/tickets/99999/diff')).status, 404);
});
