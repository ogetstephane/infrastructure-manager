import { db } from '../db.js';
import { one } from '../lib.js';

const parentError = (parentId, envId, selfId) => {
  if (!parentId) return null;
  const p = one('SELECT id, environment_id, parent_node_id FROM component_nodes WHERE id=?', parentId);
  if (!p || p.environment_id !== Number(envId)) return 'le parent doit être un membre du même environnement';
  for (let n = p, hops = 0; n && selfId && hops < 100; n = n.parent_node_id && one('SELECT id, parent_node_id FROM component_nodes WHERE id=?', n.parent_node_id), hops++) {
    if (n.id === selfId) return 'boucle dans la hiérarchie des membres';
  }
  return null;
};

// Un membre = un serveur qui porte une brique dans un environnement
export default {
  table: 'component_nodes',
  fields: ['component_id', 'environment_id', 'server_id', 'role', 'port', 'version', 'parent_node_id'],
  required: ['component_id', 'environment_id', 'server_id'],
  enums: { role: ['', 'frontend', 'node', 'primary', 'replica', 'arbiter'] },
  check: (b) => {
    const c = one('SELECT a.perimeter_id FROM components c JOIN applications a ON a.id = c.application_id WHERE c.id=?', b.component_id);
    const e = one('SELECT perimeter_id FROM environments WHERE id=?', b.environment_id);
    if (!(c && e && c.perimeter_id === e.perimeter_id)) return "l'environnement n'appartient pas au périmètre de l'application de la brique";
    return parentError(b.parent_node_id, b.environment_id, null);
  },
  // Le parent (ex. le proxy) doit être dans le même environnement, sans boucle
  checkPut: (b, id) => {
    if (!('parent_node_id' in b)) return null;
    const self = one('SELECT environment_id FROM component_nodes WHERE id=?', id);
    return self ? parentError(b.parent_node_id, self.environment_id, Number(id)) : null;
  },
  after: (b) => db.prepare('INSERT OR IGNORE INTO environment_servers (environment_id, server_id) VALUES (?, ?)').run(b.environment_id, b.server_id),
};
