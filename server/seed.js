import { db } from './db.js';

// Jeu de données de démonstration. Sans effet si la base contient déjà des périmètres (sauf --force).
const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM perimeters').get().n;
if (existing && !force) {
  console.log('Base déjà alimentée, seed ignoré (utiliser --force pour ajouter quand même).');
  process.exit(0);
}

const insert = (table, row) => {
  const cols = Object.keys(row);
  const r = db
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row));
  return Number(r.lastInsertRowid);
};

const perimeters = {};
const apps = {};
const envs = {};
const servers = {};

for (const [name, description, owner, contact] of [
  ['RH', 'Ressources humaines', 'Équipe RH', 'rh-si@example.com'],
  ['Finance', 'Comptabilité et facturation', '', ''],
]) perimeters[name] = insert('perimeters', { name, description, owner, contact });

for (const [perimeter, name, description, criticality, tags, doc_url, notes] of [
  ['RH', 'Paie', 'Calcul et édition des bulletins', 'critical', 'legal,mensuel', 'https://wiki.example.com/paie', 'Clôture mensuelle le 25 : gel des déploiements.'],
  ['RH', 'SIRH', 'Gestion des dossiers salariés', 'high', 'rgpd', 'https://wiki.example.com/sirh', ''],
  ['Finance', 'Compta', 'Comptabilité générale', 'medium', 'legal', '', ''],
]) apps[name] = insert('applications', { name, description, criticality, tags, doc_url, notes, perimeter_id: perimeters[perimeter] });

const perimEnvs = {};
for (const [perimeter, name] of [
  ['RH', 'prod'],
  ['RH', 'recette'],
  ['RH', 'dev'],
  ['Finance', 'prod'],
]) perimEnvs[`${perimeter}/${name}`] = insert('environments', { name, perimeter_id: perimeters[perimeter] });
// Les références « Application/env » du jeu de données pointent vers l'environnement de leur périmètre
for (const [app, perimeter] of [['Paie', 'RH'], ['SIRH', 'RH'], ['Compta', 'Finance']]) {
  for (const name of ['prod', 'recette', 'dev']) if (perimEnvs[`${perimeter}/${name}`]) envs[`${app}/${name}`] = perimEnvs[`${perimeter}/${name}`];
}

for (const [hostname, ip, os, role, location, status, tags] of [
  ['srv-paie-01', '10.0.0.5', 'Ubuntu 22.04', 'web', 'DC Paris', 'up', 'prod'],
  ['srv-bdd-01', '10.0.0.10', 'Debian 12', 'bdd', 'DC Paris', 'up', 'prod,mariadb'],
  ['srv-paie-02', '10.0.0.6', 'Ubuntu 22.04', 'web', 'DC Paris', 'up', 'prod'],
  ['srv-paie-03', '10.0.0.7', 'Ubuntu 22.04', 'web', 'DC Paris', 'degraded', 'prod'],
  ['srv-bdd-02', '10.0.0.11', 'Debian 12', 'bdd', 'DC Paris', 'up', 'prod,galera'],
  ['srv-bdd-03', '10.0.0.12', 'Debian 12', 'bdd', 'DC Lyon', 'up', 'prod,galera'],
  ['srv-recette-01', '10.0.1.5', 'Ubuntu 22.04', 'recette', 'DC Lyon', 'degraded', 'recette'],
]) servers[hostname] = insert('servers', { hostname, ip, os, role, location, status, tags });

for (const [env, server] of [
  ['Paie/prod', 'srv-paie-01'],
  ['Paie/prod', 'srv-bdd-01'],
  ['SIRH/prod', 'srv-bdd-01'],
  ['Compta/prod', 'srv-bdd-01'],
  ['Paie/recette', 'srv-recette-01'],
  ['SIRH/recette', 'srv-recette-01'],
]) db.prepare('INSERT OR IGNORE INTO environment_servers (environment_id, server_id) VALUES (?, ?)').run(envs[env], servers[server]);

const components = {};
for (const [app, name, kind, technology] of [
  ['Paie', 'Web', 'web', 'HAProxy + Nginx'],
  ['Paie', 'Applicatif', 'app', 'Java / Spring'],
  ['Paie', 'BDD', 'db', 'MariaDB Galera'],
  ['SIRH', 'Applicatif', 'app', 'Java'],
  ['Compta', 'Applicatif', 'app', 'PHP-FPM'],
]) {
  components[`${app}/${name}`] = insert('components', { application_id: apps[app], name, kind, technology });
}

const nodes = {};
for (const [component, env, server, role, port, parent] of [
  ['Paie/Web', 'Paie/prod', 'srv-paie-01', 'frontend', '443'],
  ['Paie/Web', 'Paie/prod', 'srv-paie-02', 'node', '8080', 'srv-paie-01'],
  ['Paie/Web', 'Paie/prod', 'srv-paie-03', 'node', '8080', 'srv-paie-01'],
  ['Paie/Web', 'Paie/recette', 'srv-recette-01', 'node', '8080'],
  ['Paie/Applicatif', 'Paie/prod', 'srv-paie-02', 'node', '8000'],
  ['Paie/Applicatif', 'Paie/prod', 'srv-paie-03', 'node', '8000'],
  ['Paie/Applicatif', 'Paie/recette', 'srv-recette-01', 'node', '8000'],
  ['Paie/BDD', 'Paie/prod', 'srv-bdd-01', 'primary', '3306'],
  ['Paie/BDD', 'Paie/prod', 'srv-bdd-02', 'node', '3306'],
  ['Paie/BDD', 'Paie/prod', 'srv-bdd-03', 'node', '3306'],
  ['Paie/BDD', 'Paie/recette', 'srv-recette-01', 'node', '3306'],
  ['SIRH/Applicatif', 'SIRH/prod', 'srv-bdd-01', 'node', ''],
  ['SIRH/Applicatif', 'SIRH/recette', 'srv-recette-01', 'node', ''],
  ['Compta/Applicatif', 'Compta/prod', 'srv-bdd-01', 'node', ''],
]) {
  // le parent est un membre du même environnement, désigné par son serveur
  nodes[`${env}/${server}`] = insert('component_nodes', {
    component_id: components[component], environment_id: envs[env], server_id: servers[server], role, port,
    parent_node_id: parent ? nodes[`${env}/${parent}`] : null,
  });
}

for (const [from, to, description] of [
  ['Paie', 'SIRH', 'API salariés'],
  ['Compta', 'Paie', 'Export des écritures de paie'],
]) insert('dependencies', { from_app_id: apps[from], to_app_id: apps[to], description });

const externals = {};
for (const [name, kind, organization, contact, url, criticality, tags] of [
  ['URSSAF', 'administration', 'URSSAF', 'support@urssaf.example', 'https://www.urssaf.example', 'critical', 'legal'],
  ['Banque SEPA', 'banque', 'Banque Exemple', 'cash@banque.example', '', 'high', 'paiement'],
  ['Portail salarié', 'client', 'Prestataire Mobilité', '', 'https://mobilite.example.com', 'low', ''],
]) externals[name] = insert('external_services', { name, kind, organization, contact, url, criticality, tags });

for (const [app, ext, server, direction, protocol, frequency, description, env, url] of [
  ['Paie', 'URSSAF', 'srv-paie-01', 'out', 'REST', 'mensuelle', 'Déclaration sociale nominative', 'Paie/prod', 'https://api.urssaf.example'],
  ['Paie', 'URSSAF', 'srv-recette-01', 'out', 'REST', 'mensuelle', 'Déclaration sociale nominative', 'Paie/recette', 'https://sandbox.urssaf.example'],
  ['Paie', 'Banque SEPA', 'srv-paie-01', 'out', 'SFTP', 'mensuelle', 'Virements des salaires'],
  ['SIRH', 'Portail salarié', 'srv-bdd-01', 'in', 'REST', 'temps réel', 'Consultation des dossiers'],
  ['Compta', 'Banque SEPA', '', 'in', 'SFTP', 'quotidienne', 'Relevés bancaires'],
]) insert('flows', { environment_id: env ? envs[env] : null, url: url ?? '', application_id: apps[app], external_id: externals[ext], server_id: server ? servers[server] : null, direction, protocol, frequency, description });

console.log('Jeu de test chargé : 2 périmètres, 3 applications, 4 environnements, 7 serveurs, 5 briques, 14 membres, 3 services externes, 5 flux.');
