import React from 'react';
import { STATUS_OPTIONS } from './status.js';
import Badge from './Badge.jsx';
import { useEditing } from './EditMode.jsx';

export default function StatusSelect({ value, onChange }) {
  if (!useEditing()) return <Badge status={value} />;
  return (
    <select className={`cell status-${value}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
