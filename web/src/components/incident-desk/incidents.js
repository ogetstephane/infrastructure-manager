export const COLUMNS = [
  { status: 'new', label: 'Nouveau' },
  { status: 'in_progress', label: 'En cours' },
  { status: 'resolved', label: 'Résolu' },
];
export const SEVERITY = { low: 'Faible', minor: 'Mineur', major: 'Majeur', critical: 'Critique' };
export const RESOLVED_SHOWN = 5;

export const inColumn = (incidents, status) => incidents.filter((i) => i.status === status).sort((a, b) => a.position - b.position || a.id - b.id);

// Même règle que le serveur : l'incident va à `index` dans la colonne cible, les colonnes touchées sont renumérotées 0..n-1
export function applyMove(incidents, id, status, index) {
  const t = incidents.find((x) => x.id === id);
  if (!t) return incidents;
  const target = inColumn(incidents, status).filter((x) => x.id !== id);
  target.splice(index, 0, { ...t, status });
  const renumbered = new Map(target.map((x, i) => [x.id, { ...x, position: i }]));
  if (t.status !== status) inColumn(incidents, t.status).filter((x) => x.id !== id).forEach((x, i) => renumbered.set(x.id, { ...x, position: i }));
  return incidents.map((x) => renumbered.get(x.id) ?? x);
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
