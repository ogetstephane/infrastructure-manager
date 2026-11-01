import { rowsBy } from '../lib.js';

export default {
  table: 'external_services',
  fields: ['name', 'kind', 'organization', 'contact', 'url', 'criticality', 'tags', 'notes'],
  required: ['name'],
  enums: { criticality: ['', 'low', 'medium', 'high', 'critical'] },
  scope: () => ({ external: true }),
  children: { flows: rowsBy('flows', 'external_id') },
};
