import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

// Alimente la base depuis specs/ : un ticket par feature (description = contenu complet du .md, sous-tickets = critères d'acceptation), dans le périmètre
// « Exploit ». Idempotent : un ticket déjà présent (même titre, préfixé de son contexte `[contexte]`) est ignoré.
const SPECS = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs');
const PERIMETER = 'Exploit';

// Statut des features implémentées (défaut : done) ; exception par fichier, ex. { 'fichier.md': 'review' }
const STATUS = {};
// Travail annoncé « À venir » dans les specs
const UPCOMING = [
];

if (!existsSync(SPECS)) {
  console.log('Répertoire specs/ introuvable, seed ignoré.');
  process.exit(0);
}

const one = (sql, ...p) => db.prepare(sql).get(...p);
const insert = (table, row) => {
  const cols = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
};

const perimeterId = one('SELECT id FROM perimeters WHERE name=?', PERIMETER)?.id
  ?? insert('perimeters', { name: PERIMETER, description: "Application d'exploitation du SI et fabrique de tickets", owner: '', contact: '' });
const applicationId = one('SELECT id FROM applications WHERE perimeter_id=? AND name=?', perimeterId, PERIMETER)?.id
  ?? insert('applications', { perimeter_id: perimeterId, name: PERIMETER, description: 'API Express + SQLite, interface React/Vite', criticality: 'medium', tags: 'interne', doc_url: '', notes: '' });

const clip = (s) => s.trim().slice(0, 200);
const section = (md, title) => md.match(new RegExp(`^## ${title}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1].trim() ?? '';

// `legacy` : titre sans préfixe d'un seed précédent, renommé au passage
// `sync` : la description est réalignée sur la spec à chaque exécution (la spec fait foi)
function addTicket({ title, legacy = title, description, status, parentId = null, sync = false }) {
  const old = one('SELECT id FROM tickets WHERE perimeter_id=? AND title=? AND parent_id IS ?', perimeterId, legacy, parentId);
  if (old && legacy !== title && !one('SELECT id FROM tickets WHERE perimeter_id=? AND title=? AND parent_id IS ?', perimeterId, title, parentId)) {
    db.prepare('UPDATE tickets SET title=? WHERE id=?').run(title, old.id);
  }
  const existing = one('SELECT id FROM tickets WHERE perimeter_id=? AND title=? AND parent_id IS ?', perimeterId, title, parentId);
  if (existing) {
    if (sync) db.prepare('UPDATE tickets SET description=? WHERE id=?').run(description, existing.id);
    return { id: existing.id, created: false };
  }
  const position = one('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tickets WHERE perimeter_id=? AND status=? AND parent_id IS NULL', perimeterId, status).n;
  const id = insert('tickets', { perimeter_id: perimeterId, title, description, priority: 'normal', status, position, parent_id: parentId });
  if (parentId == null) db.prepare("INSERT INTO ticket_links (ticket_id, entity_type, entity_id) VALUES (?, 'application', ?)").run(id, applicationId);
  return { id, created: true };
}

let created = 0;
let subs = 0;
for (const context of readdirSync(SPECS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const dir = join(SPECS, context);
  const readme = existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : '';
  // ordre du tableau « Features » du README, puis les fichiers restants
  const ordered = [...readme.matchAll(/\]\(\.\/([\w-]+\.md)\)/g)].map((m) => m[1]);
  const files = [...new Set([...ordered, ...readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')])].filter((f) => f !== 'README.md' && existsSync(join(dir, f)));
  for (const file of files) {
    const md = readFileSync(join(dir, file), 'utf8');
    const base = clip(md.match(/^# Feature : (.+)$/m)?.[1] ?? file);
    const title = `[${context}] ${base}`;
    const status = STATUS[file] ?? 'done';
    const t = addTicket({ title, legacy: base, status, description: md.trim(), sync: true });
    created += t.created;
    for (const m of section(md, "Critères d'acceptation").matchAll(/^- \[[ xX]\] (.+)$/gm)) {
      subs += addTicket({ title: clip(m[1]), description: '', status, parentId: t.id }).created;
    }
  }
}
for (const [context, base, description] of UPCOMING) created += addTicket({ title: `[${context}] ${base}`, legacy: base, description, status: 'backlog' }).created;

console.log(`Tickets issus de specs/ : ${created} ticket(s) et ${subs} sous-ticket(s) ajouté(s) (périmètre « ${PERIMETER} »).`);
