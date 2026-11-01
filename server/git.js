import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Espace géré : <WORKSPACE>/app-<id>/repo (clone) et <WORKSPACE>/app-<id>/worktrees/ticket-<id>
export const WORKSPACE = path.resolve(process.env.FACTORY_WORKSPACE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'workspace'));
const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS) || 120_000;
const CHECK_TIMEOUT_MS = Number(process.env.GIT_CHECK_TIMEOUT_MS) || 20_000;

// Pas d'invite interactive ni de transport exotique ; les identifiants viennent de la configuration git/ssh du serveur,
// jamais de l'URL (refusée si elle en contient).
export const gitEnv = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ALLOW_PROTOCOL: 'file:git:http:https:ssh',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
  LC_ALL: 'C',
});

export const log = (level, msg) => console[level === 'error' ? 'error' : 'log'](`[git] ${sanitize(msg)}`);

// Masque tout identifiant glissé dans une URL (https://user:secret@host)
export function sanitize(text) {
  return String(text ?? '').replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@');
}

export class GitError extends Error {}

function friendly(stderr) {
  const s = sanitize(stderr).trim();
  if (/no space left on device/i.test(s)) return `espace disque insuffisant (${s.split('\n')[0]})`;
  if (/authentication failed|permission denied|could not read username|terminal prompts disabled/i.test(s)) return `authentification refusée (${s.split('\n')[0]})`;
  return s.split('\n').filter(Boolean).slice(-3).join(' | ') || 'erreur inconnue';
}

export function git(args, { cwd, timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(), timeout, maxBuffer: 10 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const why = err.killed ? `délai dépassé (${Math.round(timeout / 1000)} s)` : err.code === 'ENOENT' ? 'git introuvable' : friendly(stderr || err.message);
      reject(new GitError(`git ${args[0]} : ${why}`));
    });
  });
}

// Validation synchrone du dépôt (URL ou chemin local) et de la branche ; renvoie { error } ou { branch } (branche par défaut résolue si vide)
export function validateRepo(repo, branch = '') {
  const url = String(repo ?? '').trim();
  const br = String(branch ?? '').trim();
  if (!url) return { error: 'dépôt Git vide' };
  if (/[\s\x00-\x1f]/.test(url) || url.startsWith('-')) return { error: 'dépôt Git invalide (caractères non autorisés)' };
  const isUrl = /^(https?|ssh|git|file):\/\/.+/i.test(url);
  const isScp = /^[\w.-]+@[\w.-]+:[^\s]+$/.test(url);
  const isPath = path.isAbsolute(url);
  if (!isUrl && !isScp && !isPath) return { error: 'dépôt Git invalide : URL (https://, ssh://, git@hôte:chemin) ou chemin local absolu attendu' };
  const authority = isUrl ? url.replace(/^[a-z]+:\/\//i, '').split('/')[0] : '';
  if (authority.includes('@') && (/^https?:/i.test(url) || authority.split('@')[0].includes(':'))) {
    return { error: "identifiants interdits dans l'URL : utilisez une clé SSH ou le credential helper git du serveur" };
  }
  if (isPath && !(existsSync(url) && statSync(url).isDirectory())) return { error: `chemin local introuvable : ${url}` };
  if (br && (br.startsWith('-') || spawnSync('git', ['check-ref-format', '--branch', br]).status !== 0)) return { error: `nom de branche invalide : ${br}` };

  const ls = (opts, ...patterns) => spawnSync('git', ['ls-remote', ...opts, '--', url, ...patterns], { env: gitEnv(), timeout: CHECK_TIMEOUT_MS, encoding: 'utf8' });
  const fail = (r) => ({ error: `dépôt inaccessible : ${r.error?.code === 'ETIMEDOUT' ? `délai dépassé (${CHECK_TIMEOUT_MS / 1000} s)` : r.error?.code === 'ENOENT' ? 'git introuvable sur le serveur' : friendly(r.stderr)}` });
  if (br) {
    const r = ls(['--exit-code'], `refs/heads/${br}`);
    if (r.status === 2) return { error: `branche introuvable dans le dépôt : ${br}` };
    return r.status === 0 ? { branch: br } : fail(r);
  }
  const r = ls(['--symref'], 'HEAD');
  if (r.status !== 0) return fail(r);
  const m = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(r.stdout);
  return m ? { branch: m[1] } : { error: 'dépôt vide ou branche par défaut indéterminée : précisez la branche' };
}

// Verrou par application : les opérations git sur le dépôt principal (clone, fetch, worktree add/remove) sont sérialisées
const locks = new Map();
export function withLock(appId, fn) {
  const prev = locks.get(appId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(appId, tail);
  tail.then(() => { if (locks.get(appId) === tail) locks.delete(appId); });
  return next;
}

export const appDir = (appId) => path.join(WORKSPACE, `app-${Number(appId)}`);
export const repoDir = (appId) => path.join(appDir(appId), 'repo');
export const worktreePath = (appId, ticketId) => path.join(appDir(appId), 'worktrees', `ticket-${Number(ticketId)}`);
export const branchName = (ticketId) => `ticket/${Number(ticketId)}`;

async function ensureRepo(app) {
  const dir = repoDir(app.id);
  if (!existsSync(path.join(dir, '.git')) && !existsSync(path.join(dir, 'HEAD'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(appDir(app.id), { recursive: true });
    log('log', `clone de ${app.git_repo} (application ${app.id})`);
    try {
      await git(['clone', '--no-checkout', '--', app.git_repo, dir]);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw new GitError(`clone impossible : ${e.message}`);
    }
  } else if ((await git(['remote', 'get-url', 'origin'], { cwd: dir }).catch(() => '')).trim() !== app.git_repo) {
    await git(['remote', 'set-url', 'origin', app.git_repo], { cwd: dir });
  }
  try {
    await git(['fetch', '--prune', 'origin'], { cwd: dir });
  } catch (e) {
    throw new GitError(`fetch en échec : ${e.message}`);
  }
  return dir;
}

const branchExists = (dir, b) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: dir }).then(() => true, () => false);

// Clone/fetch puis `git worktree add` ; réutilise la branche ticket/<id> si elle existe déjà (relance d'un ticket)
export function createWorktree(app, ticketId) {
  return withLock(app.id, async () => {
    const dir = await ensureRepo(app);
    const base = app.git_branch;
    try {
      await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}^{commit}`], { cwd: dir });
    } catch {
      throw new GitError(`branche de base introuvable : ${base}`);
    }
    const wt = worktreePath(app.id, ticketId);
    const branch = branchName(ticketId);
    await git(['worktree', 'prune'], { cwd: dir });
    if (existsSync(wt)) {
      log('log', `worktree résiduel supprimé : ${wt}`);
      await removeWorktreeDir(dir, wt);
    }
    mkdirSync(path.dirname(wt), { recursive: true });
    const reused = await branchExists(dir, branch);
    try {
      await git(reused ? ['worktree', 'add', '--', wt, branch] : ['worktree', 'add', '--no-track', '-b', branch, '--', wt, `origin/${base}`], { cwd: dir });
    } catch (e) {
      await removeWorktreeDir(dir, wt).catch(() => {});
      if (!reused) await git(['branch', '-D', branch], { cwd: dir }).catch(() => {});
      throw new GitError(`création du worktree impossible : ${e.message}`);
    }
    log('log', `worktree ${wt} (${reused ? 'branche existante' : 'nouvelle branche'} ${branch}, base ${base})`);
    return { path: wt, branch, reused, base };
  });
}

async function removeWorktreeDir(dir, wt) {
  try {
    await git(['worktree', 'remove', '--force', '--', wt], { cwd: dir });
  } catch {
    rmSync(wt, { recursive: true, force: true });
  }
  await git(['worktree', 'prune'], { cwd: dir }).catch(() => {});
}

// Retire le worktree ; `commit` enregistre d'abord les modifications restantes sur la branche, `deleteBranch` supprime ensuite la branche
export function removeWorktree(appId, ticketId, { commit = false, deleteBranch = false } = {}) {
  return withLock(appId, async () => {
    const dir = repoDir(appId);
    const wt = worktreePath(appId, ticketId);
    const branch = branchName(ticketId);
    const problems = [];
    if (existsSync(wt) && commit) {
      try {
        await git(['add', '-A'], { cwd: wt });
        if ((await git(['status', '--porcelain'], { cwd: wt })).trim()) {
          await git(['-c', 'user.name=IA factory', '-c', 'user.email=ia-factory@localhost', 'commit', '-m', `ticket #${ticketId} : modifications non commitées`], { cwd: wt });
        }
      } catch (e) {
        problems.push(`commit final : ${e.message}`);
      }
    }
    if (existsSync(wt)) {
      if (existsSync(dir)) await removeWorktreeDir(dir, wt);
      else rmSync(wt, { recursive: true, force: true });
    }
    if (existsSync(wt)) problems.push(`worktree non supprimé : ${wt}`);
    if (deleteBranch && existsSync(dir)) await git(['branch', '-D', branch], { cwd: dir }).catch((e) => { if (!/not found/i.test(e.message)) problems.push(e.message); });
    problems.forEach((p) => log('error', `nettoyage ticket ${ticketId} : ${p}`));
    return problems;
  });
}

// Purge : worktrees sans exécution active, dossiers d'applications supprimées, branches ticket/* de tickets supprimés ou terminés et fusionnés.
// `lookup` : { app(id) -> bool, ticket(id) -> 'missing' | 'done' | 'open', active(ticketId) -> bool }
export async function purge(lookup) {
  const report = { worktrees: [], branches: [], apps: [] };
  if (!existsSync(WORKSPACE)) return report;
  for (const name of readdirSync(WORKSPACE)) {
    const m = /^app-(\d+)$/.exec(name);
    if (!m) continue;
    const appId = Number(m[1]);
    if (!lookup.app(appId)) {
      rmSync(appDir(appId), { recursive: true, force: true });
      report.apps.push(appId);
      continue;
    }
    const wtRoot = path.join(appDir(appId), 'worktrees');
    for (const w of existsSync(wtRoot) ? readdirSync(wtRoot) : []) {
      const t = /^ticket-(\d+)$/.exec(w);
      const ticketId = t ? Number(t[1]) : null;
      if (ticketId != null && lookup.active(ticketId)) continue;
      if (ticketId == null) { rmSync(path.join(wtRoot, w), { recursive: true, force: true }); report.worktrees.push(w); continue; }
      const problems = await removeWorktree(appId, ticketId, { commit: lookup.ticket(ticketId) !== 'missing' });
      if (!problems.length) report.worktrees.push(`app-${appId}/${w}`);
    }
    const dir = repoDir(appId);
    if (!existsSync(dir)) continue;
    await withLock(appId, async () => {
      await git(['worktree', 'prune'], { cwd: dir }).catch(() => {});
      const branches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/ticket/'], { cwd: dir }).catch(() => '')).split('\n').filter(Boolean);
      for (const b of branches) {
        const id = Number(b.split('/')[1]);
        if (lookup.active(id) || existsSync(worktreePath(appId, id))) continue;
        const state = lookup.ticket(id);
        let drop = state === 'missing';
        if (state === 'done') {
          const merged = (await git(['branch', '-r', '--merged', b], { cwd: dir }).catch(() => '')).split('\n').map((s) => s.trim());
          drop = merged.some((s) => s.startsWith('origin/') && !s.includes('->'));
        }
        if (drop && await git(['branch', '-D', b], { cwd: dir }).then(() => true, () => false)) report.branches.push(`app-${appId}/${b}`);
      }
    });
  }
  if (report.worktrees.length || report.branches.length || report.apps.length) log('log', `purge : ${JSON.stringify(report)}`);
  return report;
}
