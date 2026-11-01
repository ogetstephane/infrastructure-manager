import { db } from '../db.js';
import { all } from '../lib.js';
import { filterApps } from '../bundle.js';

const filters = (q) => ({ q: q.q, criticality: q.criticality, tag: q.tag });
const applicationsOf = (id, q) => {
  const apps = db.prepare('SELECT * FROM applications WHERE perimeter_id=? ORDER BY id').all(id);
  return filterApps(q.id ? apps.filter((a) => a.id === Number(q.id)) : apps, filters(q));
};

export default {
  table: 'perimeters',
  fields: ['name', 'description', 'owner', 'contact'],
  required: ['name'],
  // ?id= restreint à un périmètre ; avec q / criticality / tag, ne garde que ceux qui ont des applications correspondantes
  list: (q) => {
    const rows = q.id ? all('perimeters').filter((p) => p.id === Number(q.id)) : all('perimeters');
    return q.q || q.criticality || q.tag ? rows.filter((p) => applicationsOf(p.id, { q: q.q, criticality: q.criticality, tag: q.tag }).length) : rows;
  },
  scope: (id, q) => ({ ...q, perimeter_id: id }),
  children: {
    applications: applicationsOf,
    tech_bricks: (id) => db.prepare('SELECT * FROM tech_bricks WHERE perimeter_id=? ORDER BY id').all(id),
    tickets: (id) => db.prepare('SELECT * FROM tickets WHERE perimeter_id=? ORDER BY id').all(id),
    environments: (id) => db.prepare('SELECT * FROM environments WHERE perimeter_id=? ORDER BY id').all(id),
  },
};
