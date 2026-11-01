import { DatabaseSync } from 'node:sqlite';

import { statSync } from 'node:fs';

const FILE = process.env.DB_FILE || 'si.db';
const inodeOf = () => { try { return statSync(FILE).ino; } catch { return null; } };

let conn = new DatabaseSync(FILE);
let ino = inodeOf();

// Si le fichier est remplacé (reset-db, restauration, copie), la connexion garderait l'ancien fichier supprimé et SQLite
// refuserait toute écriture (« readonly database ») : on rouvre alors la base sur le nouveau fichier.
function current() {
  const now = inodeOf();
  if (now !== null && now !== ino) {
    try { conn.close(); } catch { /* déjà fermée */ }
    conn = new DatabaseSync(FILE);
    conn.exec('PRAGMA foreign_keys = ON');
    ino = now;
    console.warn(`${FILE} remplacé : base rouverte`);
  }
  return conn;
}

export const db = new Proxy({}, {
  get: (_, prop) => {
    const c = current();
    const v = c[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  },
});
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS perimeters (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (perimeter_id, name));
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY, hostname TEXT NOT NULL, ip TEXT DEFAULT '', os TEXT DEFAULT '',
  role TEXT DEFAULT '', location TEXT DEFAULT '', status TEXT DEFAULT 'up');
CREATE TABLE IF NOT EXISTS environment_servers (
  id INTEGER PRIMARY KEY,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  UNIQUE (environment_id, server_id));
CREATE TABLE IF NOT EXISTS tech_bricks (
  id INTEGER PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT DEFAULT '', technology TEXT DEFAULT '', notes TEXT DEFAULT '',
  UNIQUE (perimeter_id, name));
CREATE TABLE IF NOT EXISTS tech_brick_nodes (
  id INTEGER PRIMARY KEY,
  tech_brick_id INTEGER NOT NULL REFERENCES tech_bricks(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'node',
  port TEXT DEFAULT '',
  parent_node_id INTEGER REFERENCES tech_brick_nodes(id) ON DELETE SET NULL,
  UNIQUE (tech_brick_id, environment_id, server_id));
CREATE TABLE IF NOT EXISTS components (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT DEFAULT '',
  technology TEXT DEFAULT '',
  notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS component_nodes (
  id INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'node',
  port TEXT DEFAULT '',
  version TEXT DEFAULT '',
  parent_node_id INTEGER REFERENCES component_nodes(id) ON DELETE SET NULL,
  UNIQUE (component_id, environment_id, server_id));
CREATE TABLE IF NOT EXISTS external_services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT '',
  organization TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  url TEXT DEFAULT '',
  criticality TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  external_id INTEGER NOT NULL REFERENCES external_services(id) ON DELETE CASCADE,
  server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  environment_id INTEGER REFERENCES environments(id) ON DELETE CASCADE,
  url TEXT DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'out',
  protocol TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'up');
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY,
  from_app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  to_app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  description TEXT DEFAULT '',
  UNIQUE (from_app_id, to_app_id));
`);

// Migration des bases créées avec la version précédente
db.exec('DROP TABLE IF EXISTS deployments');
const addColumn = (table, col, def) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
for (const t of ['perimeters', 'applications']) {
  addColumn(t, 'owner', "TEXT DEFAULT ''");
  addColumn(t, 'contact', "TEXT DEFAULT ''");
}
addColumn('flows', 'environment_id', 'INTEGER REFERENCES environments(id) ON DELETE CASCADE');
addColumn('flows', 'url', "TEXT DEFAULT ''");
addColumn('component_nodes', 'parent_node_id', 'INTEGER REFERENCES component_nodes(id) ON DELETE SET NULL');
addColumn('applications', 'tags', "TEXT DEFAULT ''");
addColumn('applications', 'criticality', "TEXT DEFAULT ''");
addColumn('applications', 'doc_url', "TEXT DEFAULT ''");
addColumn('applications', 'notes', "TEXT DEFAULT ''");
addColumn('servers', 'tags', "TEXT DEFAULT ''");
// Dépôt Git de l'application (les applications existantes gardent '' : lancement refusé avec un message explicite)
addColumn('applications', 'git_repo', "TEXT DEFAULT ''");
addColumn('applications', 'git_branch', "TEXT DEFAULT ''");

db.exec('DROP TABLE IF EXISTS instances');
db.exec('DROP TABLE IF EXISTS component_projects');
db.exec('DROP TABLE IF EXISTS projects');

// Migration : les environnements portés par les applications deviennent ceux de leur périmètre (url et statut abandonnés)
const envCols = db.prepare('PRAGMA table_info(environments)').all().map((c) => c.name);
if (envCols.includes('application_id')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  db.exec(`
CREATE TABLE environments_new (
  id INTEGER PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT DEFAULT '',
  UNIQUE (perimeter_id, name));
CREATE TEMP TABLE envmap (old_id INTEGER PRIMARY KEY, new_id INTEGER);`);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='perimeter_environments'").get()) {
    db.exec('INSERT INTO environments_new (perimeter_id, name, description) SELECT perimeter_id, name, description FROM perimeter_environments');
  }
  db.exec(`
INSERT OR IGNORE INTO environments_new (perimeter_id, name)
  SELECT DISTINCT a.perimeter_id, e.name FROM environments e JOIN applications a ON a.id = e.application_id;
INSERT INTO envmap SELECT e.id, n.id FROM environments e JOIN applications a ON a.id = e.application_id
  JOIN environments_new n ON n.perimeter_id = a.perimeter_id AND n.name = e.name;
UPDATE OR IGNORE environment_servers SET environment_id = -(SELECT new_id FROM envmap WHERE old_id = environment_id);
DELETE FROM environment_servers WHERE environment_id > 0;
UPDATE environment_servers SET environment_id = -environment_id;
UPDATE OR IGNORE component_nodes SET environment_id = -(SELECT new_id FROM envmap WHERE old_id = environment_id);
DELETE FROM component_nodes WHERE environment_id > 0;
UPDATE component_nodes SET environment_id = -environment_id;
UPDATE flows SET environment_id = -(SELECT new_id FROM envmap WHERE old_id = environment_id) WHERE environment_id IS NOT NULL;
UPDATE flows SET environment_id = -environment_id WHERE environment_id IS NOT NULL;
DROP TABLE environments;
ALTER TABLE environments_new RENAME TO environments;
DROP TABLE IF EXISTS perimeter_environments;`);
  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON');
}

if (!db.prepare('PRAGMA table_info(components)').all().some((c) => c.name === 'tech_brick_id')) {
  db.exec('ALTER TABLE components ADD COLUMN tech_brick_id INTEGER REFERENCES tech_bricks(id) ON DELETE SET NULL');
}

if (db.prepare('PRAGMA table_info(environments)').all().some((c) => c.name === 'description')) {
  db.exec('ALTER TABLE environments DROP COLUMN description');
}

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'backlog',
  position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ticket_runs (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  output TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS ticket_links (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  UNIQUE (ticket_id, entity_type, entity_id));
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'minor',
  status TEXT NOT NULL DEFAULT 'new',
  position INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  resolved_at TEXT);
`);

if (!db.prepare('PRAGMA table_info(tickets)').all().some((c) => c.name === 'parent_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN parent_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE');
}
addColumn('tickets', 'worktree_path', 'TEXT');
addColumn('tickets', 'worktree_branch', 'TEXT');
// NULL : hérite du réglage global (factory_settings.interactive_default) ; 1 : interactif ; 0 : autonome
addColumn('tickets', 'interactive', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS ticket_questions (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES ticket_runs(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  answer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  answered_at TEXT,
  answered_by TEXT);
CREATE TABLE IF NOT EXISTS ticket_audit (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detail TEXT NOT NULL DEFAULT '');
-- Trace minimale des suppressions définitives : volontairement sans clé étrangère ni contenu du ticket
CREATE TABLE IF NOT EXISTS ticket_deletions (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  actor TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS factory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Les liens sont polymorphes (pas de clé étrangère) : un trigger par table retire les liens orphelins,
// y compris lors des suppressions en cascade.
export const LINK_TABLES = {
  perimeter: 'perimeters', application: 'applications', environment: 'environments', server: 'servers',
  component: 'components', tech_brick: 'tech_bricks', external_service: 'external_services', flow: 'flows', dependency: 'dependencies',
};
for (const [type, table] of Object.entries(LINK_TABLES)) {
  db.exec(`CREATE TRIGGER IF NOT EXISTS ticket_links_${table}_del AFTER DELETE ON ${table}
    BEGIN DELETE FROM ticket_links WHERE entity_type='${type}' AND entity_id=OLD.id; END`);
}
