import React from 'react';

export const ICONS = {
  perimeter: '🏢',
  app: '📦',
  environment: '🌍',
  server: '🖥️',
  component: '⚙️',
  external: '🌐',
  flow: '🔀',
  dependency: '🔗',
  owner: '👤',
};

const KIND_ICONS = { app: '⚙️', web: '🕸️', db: '🗄️', cache: '⚡', search: '🔎', queue: '📨', storage: '💾', other: '🔧' };
const ENV_ICONS = { prod: '🚀', production: '🚀', recette: '🧪', demo: '🎬', dev: '🛠️', preprod: '🧭', test: '🧪' };

export const iconFor = (type, key) => {
  if (type === 'component') return KIND_ICONS[key] ?? ICONS.component;
  if (type === 'environment') return ENV_ICONS[String(key ?? '').toLowerCase()] ?? ICONS.environment;
  return ICONS[type] ?? '';
};

// Icône d'une entité ; `of` précise la brique (kind) ou l'environnement (nom)
export default function Icon({ type, of: key }) {
  return <span className="ico" aria-hidden="true">{iconFor(type, key)}</span>;
}
