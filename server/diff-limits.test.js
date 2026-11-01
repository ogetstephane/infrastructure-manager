import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(tmpdir(), 'diff-limits-'));
process.env.DB_FILE = ':memory:';
process.env.FACTORY_WORKSPACE = path.join(tmp, 'ws');
process.env.DIFF_MAX_FILES = '3';
process.env.DIFF_PAGE_LINES = '10';
process.env.DIFF_MAX_BYTES = '5000';

const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const origin = path.join(tmp, 'origin');
sh(tmp, 'init', '-q', '-b', 'main', origin);
writeFileSync(path.join(origin, 'a.txt'), 'a\n');
sh(origin, 'add', '.');
sh(origin, 'commit', '-qm', 'init');

const { createWorktree, removeWorktree } = await import('./git.js');
const { listChanges, fileDiff } = await import('./diff.js');
const { db } = await import('./db.js');

const p = Number(db.prepare("INSERT INTO perimeters (name) VALUES ('P')").run().lastInsertRowid);
const appId = Number(db.prepare("INSERT INTO applications (name, perimeter_id, git_repo, git_branch) VALUES ('A', ?, ?, 'main')").run(p, origin).lastInsertRowid);
const app = { id: appId, git_repo: origin, git_branch: 'main' };
const ticket = () => Number(db.prepare("INSERT INTO tickets (perimeter_id, title, status) VALUES (?, 't', 'review')").run(p).lastInsertRowid);

test('liste tronquée au-delà de DIFF_MAX_FILES, totaux conservés', async () => {
  const t = ticket();
  const wt = await createWorktree(app, t);
  for (let i = 0; i < 5; i++) writeFileSync(path.join(wt.path, `f${i}.txt`), `x${i}\n`);
  await removeWorktree(appId, t, { commit: true });
  const r = await listChanges(app, t);
  assert.equal(r.files.length, 3);
  assert.equal(r.total, 5);
  assert.equal(r.truncated, true);
  assert.equal(r.additions, 5);
});

test('binaire : aucun contenu, noms accentués et espaces conservés', async () => {
  const t = ticket();
  const wt = await createWorktree(app, t);
  writeFileSync(path.join(wt.path, 'données é.bin'), Buffer.from([0, 255, 0, 1]));
  await removeWorktree(appId, t, { commit: true });
  const r = await listChanges(app, t);
  assert.equal(r.files[0].path, 'données é.bin');
  assert.equal(r.files[0].binary, true);
  const d = await fileDiff(app, t, 'données é.bin');
  assert.deepEqual([d.binary, d.patch, d.next_offset], [true, '', null]);
});

test('sortie plafonnée : drapeau truncated sur la dernière page', async () => {
  const t = ticket();
  const wt = await createWorktree(app, t);
  writeFileSync(path.join(wt.path, 'huge.txt'), ('z'.repeat(99) + '\n').repeat(2000));
  await removeWorktree(appId, t, { commit: true });
  let off = 0;
  let last;
  do {
    last = await fileDiff(app, t, 'huge.txt', off);
    off = last.next_offset;
  } while (off !== null);
  assert.equal(last.truncated, true);
});

test('branche de base vide ou commençant par « - » refusée (409)', async () => {
  for (const git_branch of ['', '--output=x']) {
    await assert.rejects(listChanges({ ...app, git_branch }, ticket()), (e) => e.code === 409);
  }
  await assert.rejects(listChanges({ ...app, git_repo: '' }, ticket()), (e) => e.code === 409);
});
