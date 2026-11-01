import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { GitError, branchName, gitEnv, repoDir, sanitize } from './git.js';

// Limites : durée des commandes, taille lue sur la sortie de git, nombre de fichiers listés, lignes par page de patch
const DIFF_TIMEOUT_MS = Number(process.env.DIFF_TIMEOUT_MS) || 20_000;
export const MAX_FILES = Number(process.env.DIFF_MAX_FILES) || 500;
export const PAGE_LINES = Number(process.env.DIFF_PAGE_LINES) || 1000;
const MAX_BYTES = Number(process.env.DIFF_MAX_BYTES) || 2 * 1024 * 1024;

// Exécution en lecture seule : arguments passés en tableau (pas de shell), options de diff fixées, sortie plafonnée.
// `partial` accepte une sortie coupée au plafond (le stdout reçu est alors renvoyé avec truncated = true).
function run(args, cwd, { partial = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '-c', 'core.quotepath=false', '-c', 'diff.external=', ...args], { cwd, env: gitEnv(), timeout: DIFF_TIMEOUT_MS, maxBuffer: MAX_BYTES, killSignal: 'SIGKILL', encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, truncated: false });
      if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return partial ? resolve({ stdout, truncated: true }) : reject(new GitError('résultat trop volumineux'));
      }
      const why = err.killed ? `délai dépassé (${Math.round(DIFF_TIMEOUT_MS / 1000)} s)` : err.code === 'ENOENT' ? 'git introuvable' : sanitize(stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' | ');
      reject(new GitError(`git ${args[0]} : ${why}`));
    });
  });
}

// Résout les deux références ; erreurs typées (code HTTP) pour dépôt ou branche introuvable
async function resolveRefs(app, ticketId) {
  const base = String(app?.git_branch ?? '').trim();
  if (!String(app?.git_repo ?? '').trim()) throw Object.assign(new GitError("l'application n'a pas de dépôt Git"), { code: 409 });
  if (!base || base.startsWith('-')) throw Object.assign(new GitError('branche de base non renseignée sur l\'application'), { code: 409 });
  const dir = repoDir(app.id);
  if (!existsSync(dir)) throw Object.assign(new GitError("dépôt non cloné : lancez d'abord le ticket pour créer sa branche"), { code: 404 });
  const baseRef = `refs/remotes/origin/${base}`;
  const branch = branchName(ticketId);
  const headRef = `refs/heads/${branch}`;
  const check = (ref) => run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], dir).then(() => true, (e) => (/délai|introuvable/.test(e.message) ? Promise.reject(e) : false));
  try {
    if (!(await check(headRef))) throw Object.assign(new GitError(`branche du ticket introuvable : ${branch}`), { code: 404 });
    if (!(await check(baseRef))) throw Object.assign(new GitError(`branche de base introuvable : ${base}`), { code: 404 });
  } catch (e) {
    throw e.code === 404 ? e : Object.assign(e, { code: 502 });
  }
  return { dir, range: `${baseRef}...${headRef}`, base, branch };
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'renamed', T: 'modified' };

// Liste des fichiers modifiés entre la branche de base et la branche du ticket (équivalent de `git diff base...branche`)
export async function listChanges(app, ticketId) {
  const { dir, range, base, branch } = await resolveRefs(app, ticketId);
  const [stat, names] = await Promise.all([
    run(['diff', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', range, '--'], dir),
    run(['diff', '--name-status', '-z', '-M', '--no-ext-diff', '--no-textconv', range, '--'], dir),
  ]);
  const statuses = [];
  const n = names.stdout.split('\0');
  for (let i = 0; i < n.length && n[i];) {
    const letter = n[i][0];
    const renamed = letter === 'R' || letter === 'C';
    statuses.push(renamed ? { status: STATUS[letter], old_path: n[i + 1], path: n[i + 2] } : { status: STATUS[letter] ?? 'modified', path: n[i + 1] });
    i += renamed ? 3 : 2;
  }
  const s = stat.stdout.split('\0');
  const files = [];
  for (let i = 0, k = 0; i < s.length && s[i]; k++) {
    const [add, del, p] = s[i].split('\t');
    const renamed = p === '';
    i += renamed ? 3 : 1;
    const binary = add === '-';
    files.push({ ...statuses[k], additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary });
  }
  const total = files.length;
  return {
    base, branch, files: files.slice(0, MAX_FILES), total, truncated: total > MAX_FILES,
    additions: files.reduce((a, f) => a + f.additions, 0), deletions: files.reduce((a, f) => a + f.deletions, 0),
  };
}

// Diff unifié d'un fichier, par pages de lignes. Le chemin doit figurer dans la liste des fichiers modifiés.
export async function fileDiff(app, ticketId, filePath, offset = 0) {
  const changes = await listChanges(app, ticketId);
  const file = changes.files.find((f) => f.path === filePath);
  if (!file) throw Object.assign(new GitError(`fichier absent du diff : ${filePath}`), { code: 404 });
  if (file.binary) return { file, binary: true, patch: '', offset: 0, next_offset: null, truncated: false };
  const { dir, range } = await resolveRefs(app, ticketId);
  const paths = file.old_path ? [file.old_path, file.path] : [file.path];
  const { stdout, truncated } = await run(['diff', '--patch', '--no-color', '--no-ext-diff', '--no-textconv', '-M', range, '--', ...paths], dir, { partial: true });
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  // une sortie coupée au plafond finit sur une ligne incomplète : on l'écarte
  if (truncated) lines.pop();
  const start = Math.max(0, Math.floor(Number(offset)) || 0);
  const page = lines.slice(start, start + PAGE_LINES);
  const more = start + PAGE_LINES < lines.length;
  return { file, binary: false, patch: page.join('\n'), offset: start, next_offset: more ? start + PAGE_LINES : null, truncated: truncated && !more };
}
