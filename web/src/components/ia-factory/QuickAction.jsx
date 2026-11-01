import React from 'react';
import { quickTransition } from './factory.js';

// Flèche d'action rapide : label au survol et au focus clavier (CSS), aria-label pour les lecteurs d'écran
export default function QuickAction({ status, onMove }) {
  const q = quickTransition(status);
  if (!q) return null;
  return (
    <button
      type="button"
      className="icon quick-action"
      data-label={q.label}
      aria-label={q.label}
      draggable={false}
      onClick={(e) => { e.stopPropagation(); onMove(q.to); }}
    >
      →
    </button>
  );
}
