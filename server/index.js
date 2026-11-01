import express from 'express';
import cors from 'cors';

import { db } from './db.js';
import { bundle } from './bundle.js';
import { crudRouter, num } from './lib.js';
import perimeters from './entities/perimeters.js';
import applications from './entities/applications.js';
import environments from './entities/environments.js';
import servers from './entities/servers.js';
import environment_servers from './entities/environment_servers.js';
import tech_bricks from './entities/tech_bricks.js';
import tech_brick_nodes from './entities/tech_brick_nodes.js';
import components from './entities/components.js';
import component_nodes from './entities/component_nodes.js';
import external_services from './entities/external_services.js';
import flows from './entities/flows.js';
import dependencies from './entities/dependencies.js';
import tickets, { moveTicket } from './entities/tickets.js';
import ticket_links from './entities/ticket_links.js';
import incidents, { moveIncident } from './entities/incidents.js';
import { factoryRouter } from './factory.js';
import { contactRouter } from './contact.js';

const app = express();
app.use(cors());
app.use(express.json());

// Une ressource REST par entité : /api/<entité>, /api/<entité>/:id, /api/<entité>/:id/<sous-ressource>
const ENTITIES = [perimeters, applications, environments, tech_bricks, tech_brick_nodes, servers, environment_servers, components, component_nodes, external_services, flows, dependencies, tickets, ticket_links, incidents];
app.use(factoryRouter());
app.use('/api/contact', contactRouter());
app.post('/api/tickets/:id/move', (req, res) => {
  const { code, error, tickets: rows } = moveTicket(Number(req.params.id), req.body.status, req.body.index, { manual: true, shortcut: req.body.shortcut === true, actor: req.get('x-operator') || null });
  res.status(code).json(error ? { error } : rows);
});
app.post('/api/incidents/:id/move', (req, res) => {
  const { code, error, incidents: rows } = moveIncident(Number(req.params.id), req.body.status, req.body.index);
  res.status(code).json(error ? { error } : rows);
});
for (const def of ENTITIES) app.use(`/api/${def.table}`, crudRouter(def, bundle));

// Lecture agrégée d'une portée : ?perimeter_id= &application_id= &environment_id= (+ q, criticality, tag)
app.get('/api/bundle', (req, res) => res.json(bundle(req.query)));

// Périmètre de navigation normalisé : écarte les identifiants inconnus ou incohérents
app.get('/api/scope', (req, res) => {
  const row = (sql, id) => (id == null ? null : db.prepare(sql).get(id));
  const env = row('SELECT id, perimeter_id FROM environments WHERE id=?', num(req.query.environment_id));
  const app0 = row('SELECT id, perimeter_id FROM applications WHERE id=?', num(req.query.application_id));
  const p0 = row('SELECT id FROM perimeters WHERE id=?', num(req.query.perimeter_id));
  const perimeter = p0?.id ?? app0?.perimeter_id ?? env?.perimeter_id ?? null;
  const application = app0 && app0.perimeter_id === perimeter ? app0.id : null;
  const environment = env && env.perimeter_id === perimeter ? env.id : null;
  res.json({ perimeter_id: perimeter, application_id: application, environment_id: environment });
});

app.get('/api/tags', (_req, res) => {
  const rows = db.prepare('SELECT tags FROM applications').all();
  res.json([...new Set(rows.flatMap((r) => (r.tags ? r.tags.split(',') : [])))].sort());
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API sur http://localhost:${port}`));
