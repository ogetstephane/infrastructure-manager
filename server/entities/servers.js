import { db } from '../db.js';
import { STATUS_ENUM, all, rowsBy } from '../lib.js';
import { bundle } from '../bundle.js';

export default {
  table: 'servers',
  fields: ['hostname', 'ip', 'os', 'role', 'location', 'status', 'tags'],
  required: ['hostname'],
  enums: STATUS_ENUM,
  // ?perimeter_id= ?application_id= ?environment_id= : serveurs qui hébergent ce périmètre
  list: (q) => (q.perimeter_id || q.application_id || q.environment_id ? bundle(q).servers : all('servers')),
  scope: (id) => ({ server_id: id }),
  children: {
    nodes: rowsBy('component_nodes', 'server_id'),
    flows: rowsBy('flows', 'server_id'),
    environments: (id) => db.prepare('SELECT e.* FROM environments e JOIN environment_servers l ON l.environment_id = e.id WHERE l.server_id=? ORDER BY e.id').all(id),
  },
};
