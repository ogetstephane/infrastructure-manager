import { rowsBy } from '../lib.js';
import { db } from '../db.js';
import { validateRepo } from '../git.js';

// Valide l'accessibilité du dépôt (ls-remote) ; la branche par défaut du dépôt est résolue si elle est vide (b est complété)
function repoError(b, current = {}) {
  if (!('git_repo' in b) && !('git_branch' in b)) return null;
  const repo = String('git_repo' in b ? b.git_repo : current.git_repo ?? '').trim();
  b.git_repo = repo;
  if ('git_branch' in b) b.git_branch = String(b.git_branch ?? '').trim();
  if (!repo) {
    if (b.git_branch) return 'renseignez le dépôt Git avant la branche';
    b.git_branch = '';
    return null;
  }
  const r = validateRepo(repo, 'git_branch' in b ? b.git_branch : current.git_branch);
  if (r.error) return r.error;
  b.git_branch = r.branch;
  return null;
}

export default {
  table: 'applications',
  fields: ['name', 'description', 'perimeter_id', 'owner', 'contact', 'criticality', 'tags', 'doc_url', 'notes', 'git_repo', 'git_branch'],
  required: ['name', 'perimeter_id'],
  enums: { criticality: ['', 'low', 'medium', 'high', 'critical'] },
  check: (b) => repoError(b),
  checkPut: (b, id) => repoError(b, db.prepare('SELECT git_repo, git_branch FROM applications WHERE id=?').get(id)),
  scope: (id, q) => ({ ...q, application_id: id }),
  children: {
    components: rowsBy('components', 'application_id'),
    flows: rowsBy('flows', 'application_id'),
    dependencies: (id) => db.prepare('SELECT * FROM dependencies WHERE from_app_id=? OR to_app_id=? ORDER BY id').all(id, id),
  },
};
