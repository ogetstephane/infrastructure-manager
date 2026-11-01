import { db, LINK_TABLES } from '../db.js';

// Périmètre auquel appartient une entité (null = entité transversale, liable depuis n'importe quel périmètre)
const PERIMETER_OF = {
  perimeter: 'SELECT id AS p FROM perimeters WHERE id=?',
  application: 'SELECT perimeter_id AS p FROM applications WHERE id=?',
  environment: 'SELECT perimeter_id AS p FROM environments WHERE id=?',
  tech_brick: 'SELECT perimeter_id AS p FROM tech_bricks WHERE id=?',
  component: 'SELECT a.perimeter_id AS p FROM components c JOIN applications a ON a.id=c.application_id WHERE c.id=?',
  flow: 'SELECT a.perimeter_id AS p FROM flows f JOIN applications a ON a.id=f.application_id WHERE f.id=?',
  dependency: 'SELECT a.perimeter_id AS p FROM dependencies d JOIN applications a ON a.id=d.from_app_id WHERE d.id=?',
};

export default {
  table: 'ticket_links',
  fields: ['ticket_id', 'entity_type', 'entity_id'],
  required: ['ticket_id', 'entity_type', 'entity_id'],
  enums: { entity_type: Object.keys(LINK_TABLES) },
  check: (b) => {
    const ticket = db.prepare('SELECT perimeter_id FROM tickets WHERE id=?').get(b.ticket_id);
    if (!ticket) return 'ticket introuvable';
    if (!db.prepare(`SELECT 1 FROM ${LINK_TABLES[b.entity_type]} WHERE id=?`).get(b.entity_id)) return 'entité introuvable';
    const owner = PERIMETER_OF[b.entity_type] && db.prepare(PERIMETER_OF[b.entity_type]).get(b.entity_id);
    if (owner && owner.p !== ticket.perimeter_id) return "l'entité n'appartient pas au périmètre du ticket";
    if (db.prepare('SELECT 1 FROM ticket_links WHERE ticket_id=? AND entity_type=? AND entity_id=?').get(b.ticket_id, b.entity_type, b.entity_id)) return 'lien déjà existant';
    return null;
  },
};
