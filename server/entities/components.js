import { db } from '../db.js';
import { one, rowsBy } from '../lib.js';

// Une brique rattachée à une brique du périmètre en reprend nom, type et technologie
const link = (b, appId) => {
  if (b.tech_brick_id == null) return null;
  const t = one('SELECT * FROM tech_bricks WHERE id=?', b.tech_brick_id);
  const a = one('SELECT perimeter_id FROM applications WHERE id=?', appId);
  if (!t || !a || t.perimeter_id !== a.perimeter_id) return "la brique du périmètre n'appartient pas au périmètre de l'application";
  Object.assign(b, { name: t.name, kind: t.kind, technology: t.technology });
  return null;
};

export default {
  table: 'components',
  fields: ['application_id', 'tech_brick_id', 'name', 'kind', 'technology', 'notes'],
  required: ['application_id'],
  enums: { kind: ['', 'app', 'web', 'db', 'cache', 'search', 'queue', 'storage', 'other'] },
  check: (b) => link(b, b.application_id) || (b.name ? null : 'champs obligatoires : name'),
  checkPut: (b, id) => ('tech_brick_id' in b ? link(b, db.prepare('SELECT application_id FROM components WHERE id=?').get(id)?.application_id) : null),
  children: {
    nodes: rowsBy('component_nodes', 'component_id'),
  },
};
