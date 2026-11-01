import { db } from '../db.js';
import { one } from '../lib.js';

const parentError = (parentId, envId, selfId) => {
  if (!parentId) return null;
  const p = one('SELECT id, environment_id FROM tech_brick_nodes WHERE id=?', parentId);
  if (!p || p.environment_id !== Number(envId)) return 'le parent doit être un membre du même environnement';
  for (let n = p, hops = 0; n && selfId && hops < 100; n = n.parent_node_id && one('SELECT id, parent_node_id FROM tech_brick_nodes WHERE id=?', n.parent_node_id), hops++) {
    if (n.id === selfId) return 'boucle dans la hiérarchie des membres';
  }
  return null;
};

// Membre d'une brique technique du périmètre : un serveur qui la porte dans un environnement du périmètre
export default {
  table: 'tech_brick_nodes',
  fields: ['tech_brick_id', 'environment_id', 'server_id', 'role', 'port', 'parent_node_id'],
  required: ['tech_brick_id', 'environment_id', 'server_id'],
  enums: { role: ['', 'frontend', 'node', 'primary', 'replica', 'arbiter'] },
  // ?perimeter_id= : tous les membres des briques du périmètre
  list: (q) => (q.perimeter_id
    ? db.prepare('SELECT n.* FROM tech_brick_nodes n JOIN tech_bricks t ON t.id = n.tech_brick_id WHERE t.perimeter_id=? ORDER BY n.id').all(q.perimeter_id)
    : db.prepare('SELECT * FROM tech_brick_nodes ORDER BY id').all()),
  check: (b) => {
    const t = one('SELECT perimeter_id FROM tech_bricks WHERE id=?', b.tech_brick_id);
    const e = one('SELECT perimeter_id FROM environments WHERE id=?', b.environment_id);
    if (!(t && e && t.perimeter_id === e.perimeter_id)) return "l'environnement n'appartient pas au périmètre de la brique";
    return parentError(b.parent_node_id, b.environment_id, null);
  },
  checkPut: (b, id) => {
    if (!('parent_node_id' in b)) return null;
    const self = one('SELECT environment_id FROM tech_brick_nodes WHERE id=?', id);
    return self ? parentError(b.parent_node_id, self.environment_id, Number(id)) : null;
  },
  after: (b) => db.prepare('INSERT OR IGNORE INTO environment_servers (environment_id, server_id) VALUES (?, ?)').run(b.environment_id, b.server_id),
};
