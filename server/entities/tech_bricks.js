import { db } from '../db.js';
import { rowsBy } from '../lib.js';

// Brique technique du périmètre : référencée par les briques de ses applications
export default {
  table: 'tech_bricks',
  fields: ['perimeter_id', 'name', 'kind', 'technology', 'notes'],
  required: ['perimeter_id', 'name'],
  enums: { kind: ['', 'app', 'web', 'db', 'cache', 'search', 'queue', 'storage', 'other'] },
  afterPut: (b, id) => {
    const t = db.prepare('SELECT name, kind, technology FROM tech_bricks WHERE id=?').get(id);
    db.prepare('UPDATE components SET name=?, kind=?, technology=? WHERE tech_brick_id=?').run(t.name, t.kind, t.technology, id);
  },
  children: {
    nodes: rowsBy('tech_brick_nodes', 'tech_brick_id'), components: rowsBy('components', 'tech_brick_id') },
};
