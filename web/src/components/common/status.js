export const STATUS = { up: 'Opérationnel', degraded: 'Dégradé', down: 'Hors service', maintenance: 'Maintenance' };
export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, label]) => ({ value, label }));
export const isHttp = (u) => /^https?:\/\//i.test(u || '');
