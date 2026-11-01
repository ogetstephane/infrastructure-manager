import { one, STATUS_ENUM } from '../lib.js';

// direction : out = l'application appelle le service ; in = le service consomme l'application
export default {
  table: 'flows',
  fields: ['application_id', 'external_id', 'server_id', 'environment_id', 'url', 'direction', 'protocol', 'frequency', 'description', 'status'],
  required: ['application_id', 'external_id', 'direction'],
  enums: { direction: ['out', 'in'], ...STATUS_ENUM },
  check: (b) => {
    if (!b.environment_id) return null;
    const e = one('SELECT perimeter_id FROM environments WHERE id=?', b.environment_id);
    const a = one('SELECT perimeter_id FROM applications WHERE id=?', b.application_id);
    return e && a && e.perimeter_id === a.perimeter_id ? null : "l'environnement n'appartient pas au périmètre de l'application";
  },
};
