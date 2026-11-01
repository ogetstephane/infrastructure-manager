import { db } from './db.js';

// Périmètre « Brevet » (environnements recette, demo et prod, d'après le wiki Redmine).
// Idempotent : ce qui existe déjà est conservé, seuls les éléments manquants sont ajoutés.
const insert = (table, row) => {
  const cols = Object.keys(row);
  const r = db
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
  return Number(r.lastInsertRowid);
};
const find = (sql, ...args) => db.prepare(sql).get(...args)?.id;

const HC = 'healthcheck /api/health-check · ping /api/ping';
const SERVICES = ['Service transaction', 'Service référentiel', 'Service client', 'Service titre'];

const perimeter =
  find("SELECT id FROM perimeters WHERE name = 'Brevet'") ??
  insert('perimeters', { name: 'Brevet', description: 'Dépôt et gestion des brevets', owner: '', contact: '' });

const apps = {};
for (const [name, description, criticality, tags, notes] of [
  ['Brevet FO', 'Front office', 'high', 'brevet,front', HC],
  ['Brevet BO', 'Back office', 'high', 'brevet,back', HC],
  ['Service transaction', 'Web service de transaction', 'high', 'brevet,service', HC],
  ['Service référentiel', 'Web service référentiel', 'medium', 'brevet,service', HC],
  ['Service client', 'Web service client', 'medium', 'brevet,service', HC],
  ['Service titre', 'Web service titre', 'medium', 'brevet,service', HC],
]) {
  apps[name] =
    find('SELECT id FROM applications WHERE name = ? AND perimeter_id = ?', name, perimeter) ??
    insert('applications', { name, description, criticality, tags, notes, doc_url: '', perimeter_id: perimeter });
}

const components = {};
const addComponent = (app, name, kind, technology) => {
  const key = `${app}/${name}`;
  components[key] = find('SELECT id FROM components WHERE application_id = ? AND name = ?', apps[app], name);
  if (components[key]) return;
  components[key] = insert('components', { application_id: apps[app], name, kind, technology });
};
for (const a of ['Brevet FO', 'Brevet BO', ...SERVICES]) addComponent(a, 'Applicatif', 'app', a.startsWith('Service') ? 'Worker (messenger)' : '');
// Briques techniques du périmètre (anciennes applications « Brevet Outils » et « Brevet Socle »)
for (const [name, kind, technology] of [
  ['Stirling-PDF', 'other', 'Génération de PDF'],
  ['Rundeck', 'other', 'Orchestration'],
  ['Superset', 'other', 'Outil BI'],
  ['Apache HOP', 'other', 'ETL migration'],
  ['HAProxy PostgreSQL', 'other', 'HAProxy · VIP PostgreSQL sur le port 5432'],
  ['PostgreSQL', 'db', 'PostgreSQL'],
  ['ETCD', 'other', 'Consensus ETCD'],
  ['Redis', 'cache', 'Redis'],
  ['SFTP', 'storage', 'SFTP interne'],
  ['ClamAV', 'other', 'Antivirus'],
]) {
  if (!find('SELECT id FROM tech_bricks WHERE perimeter_id = ? AND name = ?', perimeter, name)) insert('tech_bricks', { perimeter_id: perimeter, name, kind, technology });
}
// Ces notions ne sont plus des applications : nettoyage des anciennes installations
db.prepare("DELETE FROM applications WHERE name IN ('Brevet Outils', 'Brevet Socle')").run();

// Une entrée par membre d'application : [application, brique, clé de serveur]
const MEMBERS = [
  ['Brevet FO', 'Applicatif', 'fo1'], ['Brevet FO', 'Applicatif', 'fo2'],
  ['Brevet BO', 'Applicatif', 'bo1'], ['Brevet BO', 'Applicatif', 'bo2'],
  ...SERVICES.flatMap((s) => [[s, 'Applicatif', 'w1'], [s, 'Applicatif', 'w2']]),
];
// Serveurs des briques techniques du périmètre : [brique, clé de serveur, rôle, port, clé du parent]
const BRICK_MEMBERS = [
  ['Stirling-PDF', 'pdf'], ['Rundeck', 'rundeck'], ['Superset', 'superset'], ['Apache HOP', 'hop'],
  ['HAProxy PostgreSQL', 'hap1', 'frontend', '5432'], ['HAProxy PostgreSQL', 'hap2', 'frontend', '5432'],
  ['PostgreSQL', 'pg1', 'node', '5432', 'hap1'], ['PostgreSQL', 'pg2', 'node', '5432', 'hap1'], ['PostgreSQL', 'pg3', 'node', '5432', 'hap1'],
  ['ETCD', 'etcd1', 'node', '2379'], ['ETCD', 'etcd2', 'node', '2379'], ['ETCD', 'etcd3', 'node', '2379'],
  ['Redis', 'redis1', 'node', '6379'], ['Redis', 'redis2', 'node', '6379'], ['Redis', 'redis3', 'node', '6379'],
  ['SFTP', 'sftp1', 'node', '22'], ['SFTP', 'sftp2', 'node', '22'],
  ['ClamAV', 'av1', 'node', '3310'], ['ClamAV', 'av2', 'node', '3310'],
];
const ROLE_OF = { fo: 'web', bo: 'web', w: 'app', pdf: 'app', rundeck: 'app', superset: 'app', hop: 'app', sftp: 'sftp', pg: 'bdd', etcd: 'bdd', hap: 'proxy', av: 'app', redis: 'cache' };

// Serveurs par environnement : clé → [hostname, IP]. Absent = pas de serveur dans cet environnement.
const ENVS = {
  recette: {
    domain: 'co.inpi',
    urls: { 'Brevet FO': 'brevet-recette', 'Brevet BO': 'brevet-bo-recette', 'Service transaction': 'brevet-ws-transaction-recette', 'Service référentiel': 'brevet-ws-referentiel-recette', 'Service client': 'brevet-ws-client-recette', 'Service titre': 'brevet-ws-titre-recette' },
    servers: {
      fo1: ['lnx1085-tacf1', '10.40.121.141'], fo2: ['lnx1085-tacf2', '10.40.121.142'],
      bo1: ['lnx1085-tacb1', '10.40.121.143'], bo2: ['lnx1085-tacb2', '10.40.121.144'],
      w1: ['lnx1085-tacw1', '10.40.121.145'], w2: ['lnx1085-tacw2', '10.40.121.146'],
      pdf: ['lnx1085-tacw3', '10.40.121.65'], rundeck: ['lnx1085-tacw4', '10.40.121.66'],
      superset: ['lnx1085-tacw6', '10.40.121.200'], hop: ['lnx1122-tac1', '10.40.121.64'],
      sftp1: ['lnx1086-tac1', '10.40.121.147'], sftp2: ['lnx1086-tac2', '10.40.121.140'],
      pg1: ['lnx1087-tac1', '10.40.121.148'], pg2: ['lnx1087-tac2', '10.40.121.149'], pg3: ['lnx1087-tac3', '10.40.121.150'],
      etcd1: ['lnx1087-tac4', '10.40.121.151'], etcd2: ['lnx1087-tac5', '10.40.121.152'], etcd3: ['lnx1087-tac6', '10.40.121.153'],
      hap1: ['lnx1087-tac7', '10.40.121.154'], hap2: ['lnx1087-tac8', '10.40.121.155'],
      av1: ['lnx1068-tac1', '10.40.121.157'], av2: ['lnx1068-tac2', '10.40.121.158'],
      redis1: ['lnx1069-tac1', '10.40.121.87'], redis2: ['lnx1069-tac2', '10.40.121.88'], redis3: ['lnx1069-tac3', '10.40.121.89'],
    },
  },
  demo: {
    domain: 'co.inpi',
    urls: { 'Brevet FO': 'brevet-demo', 'Brevet BO': 'brevet-bo-demo', 'Service transaction': 'brevet-ws-transaction-demo', 'Service référentiel': 'brevet-ws-referentiel-demo', 'Service client': 'brevet-ws-client-demo', 'Service titre': 'brevet-ws-titre-demo' },
    servers: {
      fo1: ['lnx1085-tcf1', '10.40.121.158'], fo2: ['lnx1085-tcf2', '10.40.121.160'],
      bo1: ['lnx1085-tcb1', '10.40.121.161'], bo2: ['lnx1085-tcb2', '10.40.121.162'],
      w1: ['lnx1085-tcw1', '10.40.121.163'], w2: ['lnx1085-tcw2', '10.40.121.164'],
      pdf: ['lnx1085-tcw3', '10.40.121.183'], rundeck: ['lnx1085-tcw4', '10.40.121.94'],
      hop: ['lnx1122-tcw1', '10.40.121.182'],
      sftp1: ['lnx1086-tc1', '10.40.121.165'],
      pg1: ['lnx1087-tc1', '10.40.121.166'], pg2: ['lnx1087-tc2', '10.40.121.167'], pg3: ['lnx1087-tc3', '10.40.121.168'],
      etcd1: ['lnx1087-tc4', '10.40.121.169'], etcd2: ['lnx1087-tc5', '10.40.121.170'], etcd3: ['lnx1087-tc6', '10.40.121.171'],
      hap1: ['lnx1087-tc7', '10.40.121.172'], hap2: ['lnx1087-tc8', '10.40.121.173'],
      av1: ['lnx1068-tc1', '10.40.121.175'], av2: ['lnx1068-tc2', '10.40.121.176'],
      redis1: ['lnx1069-tc1', '10.40.121.177'], redis2: ['lnx1069-tc2', '10.40.121.178'], redis3: ['lnx1069-tc3', '10.40.121.179'],
    },
  },
  prod: {
    domain: 'ar.inpi',
    // Services client et titre : « missing ? » dans le wiki, sans URL ni serveur
    missing: ['Service client', 'Service titre'],
    urls: { 'Brevet FO': 'brevet', 'Brevet BO': 'brevet.bo', 'Service transaction': 'brevet-ws-transaction', 'Service référentiel': 'brevet-ws-referentiel' },
    servers: {
      fo1: ['lnx1085-cf1', '10.30.121.159'], fo2: ['lnx1085-cf2', '10.30.121.160'],
      bo1: ['lnx1085-cb1', '10.30.121.161'], bo2: ['lnx1085-cb2', '10.30.121.162'],
      w1: ['lnx1085-cw1', '10.30.121.163'], w2: ['lnx1085-cw2', '10.30.121.164'],
      pdf: ['lnx1085-cw3', '10.30.121.183'], rundeck: ['lnx1085-cw4', '10.30.121.184'],
      hop: ['lnx1122-c1', '10.30.121.182'],
      sftp1: ['lnx1086-c1', '10.30.121.165'],
      pg1: ['lnx1087-c1', '10.30.121.166'], pg2: ['lnx1087-c2', '10.30.121.167'], pg3: ['lnx1087-c3', '10.30.121.168'],
      etcd1: ['lnx1087-c4', '10.30.121.169'], etcd2: ['lnx1087-c5', '10.30.121.170'], etcd3: ['lnx1087-c6', '10.30.121.171'],
      hap1: ['lnx1087-c7', '10.30.121.172'], hap2: ['lnx1087-c8', '10.30.121.173'],
      av1: ['lnx1088-c1', '10.30.121.175'], av2: ['lnx1088-c2', '10.30.121.176'],
      redis1: ['lnx1089-c1', '10.30.121.177'], redis2: ['lnx1089-c2', '10.30.121.178'], redis3: ['lnx1089-c3', '10.30.121.179'],
    },
  },
};

const added = [];
const ldap =
  find("SELECT id FROM external_services WHERE name = 'LDAP INPI'") ??
  insert('external_services', { name: 'LDAP INPI', kind: 'annuaire', organization: 'INPI', contact: '', url: 'ldap://10.30.161.41:389', criticality: 'high', tags: 'auth' });

for (const [envName, cfg] of Object.entries(ENVS)) {
  const existing = find('SELECT id FROM environments WHERE perimeter_id = ? AND name = ?', perimeter, envName);
  const envId = existing ?? insert('environments', { perimeter_id: perimeter, name: envName });

  const servers = {};
  for (const [key, [host, ip]] of Object.entries(cfg.servers)) {
    const hostname = `${host}.${cfg.domain}`;
    servers[key] =
      find('SELECT id FROM servers WHERE hostname = ?', hostname) ??
      insert('servers', { hostname, ip, os: '', role: ROLE_OF[key.replace(/\d+$/, '')], location: 'VLAN BACKEND02', status: 'up', tags: `${envName},brevet` });
  }

  for (const id of Object.values(servers)) db.prepare('INSERT OR IGNORE INTO environment_servers (environment_id, server_id) VALUES (?, ?)').run(envId, id);

  // Serveurs des briques techniques du périmètre (ajoutés aussi sur un environnement déjà présent)
  const brickNodes = {};
  let brickAdded = 0;
  for (const [brick, key, role = 'node', port = '', parent] of BRICK_MEMBERS) {
    const brickId = find('SELECT id FROM tech_bricks WHERE perimeter_id = ? AND name = ?', perimeter, brick);
    if (!servers[key] || !brickId) continue;
    const where = [brickId, envId, servers[key]];
    brickNodes[key] = find('SELECT id FROM tech_brick_nodes WHERE tech_brick_id = ? AND environment_id = ? AND server_id = ?', ...where);
    if (!brickNodes[key]) {
      brickNodes[key] = insert('tech_brick_nodes', { tech_brick_id: brickId, environment_id: envId, server_id: servers[key], role, port, parent_node_id: parent ? brickNodes[parent] ?? null : null });
      brickAdded++;
    }
  }
  if (existing) {
    if (brickAdded) added.push(`${envName} (${brickAdded} serveurs de briques)`);
    continue;
  }
  const envs = Object.fromEntries(Object.keys(apps).map((app) => [app, envId]));

  const nodes = {};
  for (const [app, comp, key, role = 'node', port = '', parent] of MEMBERS) {
    if (!servers[key] || cfg.missing?.includes(app)) continue;
    nodes[key] = insert('component_nodes', {
      component_id: components[`${app}/${comp}`], environment_id: envs[app], server_id: servers[key], role, port,
      parent_node_id: parent ? nodes[parent] : null,
    });
    db.prepare('INSERT OR IGNORE INTO environment_servers (environment_id, server_id) VALUES (?, ?)').run(envs[app], servers[key]);
  }

  insert('flows', { environment_id: envs['Brevet BO'], url: 'ldap://10.30.161.41:389', application_id: apps['Brevet BO'], external_id: ldap, server_id: null, direction: 'out', protocol: 'LDAP', frequency: 'temps réel', description: 'Authentification des agents' });
  added.push(`${envName} (${Object.keys(nodes).length} membres)`);
}

if (!db.prepare("SELECT 1 FROM dependencies WHERE from_app_id = ?").get(apps['Brevet FO'])) {
  for (const [from, to, description] of [
    ...['Brevet FO', 'Brevet BO'].flatMap((a) => SERVICES.map((s) => [a, s, 'Appels API'])),
  ]) insert('dependencies', { from_app_id: apps[from], to_app_id: apps[to], description });
}

console.log(added.length ? `Périmètre Brevet : environnements ajoutés → ${added.join(', ')}.` : 'Périmètre Brevet déjà à jour.');
