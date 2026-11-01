import React from 'react';
import { useEditing } from './EditMode.jsx';

export const CRITICALITY = { '': 'Non définie', low: 'Faible', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
export const CRITICALITY_OPTIONS = Object.entries(CRITICALITY).map(([value, label]) => ({ value, label }));

export const parseTags = (s) => (s ? s.split(',').filter(Boolean) : []);

export function CriticalityBadge({ value }) {
  if (!value) return null;
  return <span className={`crit ${value}`}>{CRITICALITY[value]}</span>;
}

export function CriticalitySelect({ value, onChange }) {
  if (!useEditing()) return value ? <CriticalityBadge value={value} /> : <span className="muted">—</span>;
  return (
    <select className={`cell crit-${value}`} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {CRITICALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function TagList({ tags, onClick, active }) {
  const list = Array.isArray(tags) ? tags : parseTags(tags);
  if (!list.length) return null;
  return (
    <span className="tags">
      {list.map((t) => (
        <span key={t} className={`tag ${active === t ? 'active' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick && (() => onClick(t))}>{t}</span>
      ))}
    </span>
  );
}
