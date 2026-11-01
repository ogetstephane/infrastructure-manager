import { db } from './db.js';
import { all, num, rowsIn } from './lib.js';

const ids = (rows, k = 'id') => rows.map((r) => r[k]);
const has = (s, q) => (s || '').toLowerCase().includes(q.toLowerCase());

// Applications répondant à une recherche texte, une criticité et/ou un tag (null = pas de filtre)
export function filterApps(apps, { q = '', criticality = '', tag = '' } = {}) {
  if (!q && !criticality && !tag) return apps;
  const perim = Object.fromEntries(all('perimeters').map((p) => [p.id, p.name]));
  const tagged = (r) => (r.tags || '').split(',').includes(tag);
  return apps.filter((a) => {
    const text = !q || has(perim[a.perimeter_id], q) || has(a.name, q) || has(a.tags, q);
    return text && (!criticality || a.criticality === criticality) && (!tag || tagged(a));
  });
}

// Lecture agrégée d'un périmètre de données (le « bundle » d'un bloc d'interface).
// Portée : perimeter_id / application_id / environment_id, ou server_id, ou external (flux), + filtres q, criticality, tag.
// `refs` contient les enregistrements simplement référencés (pour les libellés) qui ne font pas partie de la portée.
export function bundle(s = {}) {
  const f = { q: s.q || '', criticality: s.criticality || '', tag: s.tag || '' };
  const filtering = !!(f.q || f.criticality || f.tag);
  const server = num(s.server_id);
  const p = num(s.perimeter_id);
  const a = num(s.application_id);
  const e = num(s.environment_id);
  const scoped = [p, a, e].some((v) => v != null);

  let perimeters = [], applications = [], environments = [], components = [], tech_bricks = [], tech_brick_nodes = [];
  let component_nodes = [], environment_servers = [], flows = [], dependencies = [], servers = [];

  if (server != null) {
    component_nodes = rowsIn('component_nodes', 'server_id', [server]);
    environment_servers = rowsIn('environment_servers', 'server_id', [server]);
    environments = rowsIn('environments', 'id', [...ids(environment_servers, 'environment_id'), ...ids(component_nodes, 'environment_id'), ...ids(tech_brick_nodes, 'environment_id')]);
    tech_brick_nodes = rowsIn('tech_brick_nodes', 'server_id', [server]);
    tech_bricks = rowsIn('tech_bricks', 'id', ids(tech_brick_nodes, 'tech_brick_id'));
    components = [...rowsIn('components', 'id', ids(component_nodes, 'component_id')), ...rowsIn('components', 'tech_brick_id', ids(tech_bricks))]
      .filter((c, i, arr) => arr.findIndex((y) => y.id === c.id) === i);
    flows = rowsIn('flows', 'server_id', [server]);
    servers = rowsIn('servers', 'id', [server]);
  } else if (s.external) {
    flows = all('flows');
    servers = [];
  } else {
    let apps = all('applications');
    const env = e != null ? db.prepare('SELECT perimeter_id FROM environments WHERE id=?').get(e) : null;
    if (e != null) apps = apps.filter((x) => env && x.perimeter_id === env.perimeter_id);
    if (a != null) apps = apps.filter((x) => x.id === a);
    if (p != null) apps = apps.filter((x) => x.perimeter_id === p);
    applications = filterApps(apps, f);
    const appIds = ids(applications);
    const perimAll = all('perimeters');
    perimeters = p != null ? perimAll.filter((x) => x.id === p) : scoped || filtering ? perimAll.filter((x) => applications.some((ap) => ap.perimeter_id === x.id)) : perimAll;

    const perimIds = ids(perimeters.length ? perimeters : perimAll);
    environments = rowsIn('environments', 'perimeter_id', perimIds).filter((x) => e == null || x.id === e);
    components = rowsIn('components', 'application_id', appIds);
    component_nodes = rowsIn('component_nodes', 'component_id', ids(components)).filter((n) => e == null || n.environment_id === e);
    // briques du périmètre : toutes pour un périmètre ou un environnement, celles référencées par ses briques pour une application
    const referenced = ids(components, 'tech_brick_id');
    tech_bricks = a != null ? rowsIn('tech_bricks', 'id', referenced) : rowsIn('tech_bricks', 'perimeter_id', perimIds);
    tech_brick_nodes = rowsIn('tech_brick_nodes', 'tech_brick_id', ids(tech_bricks)).filter((n) => e == null || n.environment_id === e);
    const nodeServers = new Set([...ids(component_nodes, 'server_id'), ...ids(tech_brick_nodes, 'server_id')]);
    // une application n'est liée qu'aux serveurs qui portent ses briques ; un périmètre ou un environnement, à tous ceux qui l'hébergent
    environment_servers = rowsIn('environment_servers', 'environment_id', ids(environments)).filter((l) => a == null || nodeServers.has(l.server_id));
    flows = rowsIn('flows', 'application_id', appIds);
    dependencies = [...rowsIn('dependencies', 'from_app_id', appIds), ...rowsIn('dependencies', 'to_app_id', appIds)]
      .filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i)
      .sort((x, y) => x.id - y.id);
    servers = scoped ? rowsIn('servers', 'id', [...ids(environment_servers, 'server_id'), ...ids(component_nodes, 'server_id'), ...ids(tech_brick_nodes, 'server_id')]) : all('servers');
  }

  const refOf = (table, wanted, have) => rowsIn(table, 'id', wanted.filter((id) => !have.some((r) => r.id === id)));
  const refApplications = refOf(
    'applications',
    [...ids(flows, 'application_id'), ...ids(components, 'application_id'), ...ids(dependencies, 'from_app_id'), ...ids(dependencies, 'to_app_id')],
    applications,
  );
  const refPerimeters = refOf('perimeters', [...ids([...applications, ...refApplications], 'perimeter_id'), ...ids(environments, 'perimeter_id')], perimeters);
  const refEnvironments = refOf('environments', [...ids(flows, 'environment_id'), ...ids(component_nodes, 'environment_id'), ...ids(tech_brick_nodes, 'environment_id')], environments);
  const refServers = refOf('servers', [...ids(flows, 'server_id'), ...ids(component_nodes, 'server_id'), ...ids(tech_brick_nodes, 'server_id'), ...ids(environment_servers, 'server_id')], servers);

  return {
    perimeters, applications, environments, servers, environment_servers, components, component_nodes, tech_bricks, tech_brick_nodes,
    external_services: all('external_services'), flows, dependencies,
    refs: { perimeters: refPerimeters, applications: refApplications, environments: refEnvironments, servers: refServers },
  };
}
