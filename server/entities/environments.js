import { db } from '../db.js';
import { rowsBy } from '../lib.js';

// Environnement existant d'un périmètre (recette, demo, prod…). ?perimeter_id= ?without_server=1 ?id=
export default {
  table: 'environments',
  fields: ['perimeter_id', 'name'],
  required: ['perimeter_id', 'name'],
  list: (q) => {
    const hosted = new Set(db.prepare('SELECT environment_id FROM environment_servers').all().map((l) => l.environment_id));
    return db.prepare(`SELECT e.*, p.name || ' / ' || e.name AS label FROM environments e JOIN perimeters p ON p.id = e.perimeter_id ORDER BY e.id`).all()
      .filter((e) => !q.perimeter_id || e.perimeter_id === Number(q.perimeter_id))
      .filter((e) => !q.id || e.id === Number(q.id))
      .filter((e) => !q.without_server || !hosted.has(e.id));
  },
  scope: (id, q) => ({ ...q, environment_id: id }),
  children: {
    nodes: rowsBy('component_nodes', 'environment_id'),
    flows: rowsBy('flows', 'environment_id'),
    servers: (id) => db.prepare('SELECT s.* FROM servers s JOIN environment_servers l ON l.server_id = s.id WHERE l.environment_id=? ORDER BY s.id').all(id),
  },
};
