export const COLUMNS = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'À faire' },
  { status: 'doing', label: 'En cours' },
  { status: 'review', label: 'En revue' },
  { status: 'done', label: 'Terminé' },
];
export const PRIORITY = { low: 'Basse', normal: 'Normale', high: 'Haute', critical: 'Critique' };
export const DONE_SHOWN = 5;

// Même liste blanche que le serveur (server/entities/tickets.js) ; le réordonnancement dans la même colonne reste libre
export const MANUAL_TRANSITIONS = { backlog: ['todo'], review: ['done'] };
export const canMoveManually = (from, to) => from === to || (MANUAL_TRANSITIONS[from] ?? []).includes(to);

// Raccourcis d'action sur les cartes : une seule flèche par statut (aucune pour « En cours » et « Terminé »)
export const QUICK_TRANSITIONS = {
  backlog: { to: 'todo', label: 'Passer à À faire' },
  todo: { to: 'doing', label: 'Passer à En cours' },
  review: { to: 'done', label: 'Passer à Terminé' },
};
export const quickTransition = (status) => QUICK_TRANSITIONS[status] ?? null;

export const LINK_TYPES = {
  perimeter: 'Périmètre',
  application: 'Application',
  environment: 'Environnement',
  server: 'Serveur',
  component: 'Brique d\'application',
  tech_brick: 'Brique du périmètre',
  external_service: 'Service externe',
  flow: 'Flux',
  dependency: 'Dépendance',
};
export const LINK_ICON = {
  perimeter: 'perimeter', application: 'app', environment: 'environment', server: 'server',
  component: 'component', tech_brick: 'component', external_service: 'external', flow: 'flow', dependency: 'dependency',
};

// Les sous-tickets n'ont pas de colonne : seuls les tickets de premier niveau sont sur le tableau
export const inColumn = (tickets, status) => tickets.filter((t) => t.parent_id == null && t.status === status).sort((a, b) => a.position - b.position || a.id - b.id);

// Même règle que le serveur : le ticket va à `index` dans la colonne cible, les colonnes touchées sont renumérotées 0..n-1
export function applyMove(tickets, id, status, index) {
  const t = tickets.find((x) => x.id === id);
  if (!t) return tickets;
  const target = inColumn(tickets, status).filter((x) => x.id !== id);
  target.splice(index, 0, { ...t, status });
  const renumbered = new Map(target.map((x, i) => [x.id, { ...x, position: i }]));
  if (t.status !== status) inColumn(tickets, t.status).filter((x) => x.id !== id).forEach((x, i) => renumbered.set(x.id, { ...x, position: i }));
  return tickets.map((x) => renumbered.get(x.id) ?? x);
}
