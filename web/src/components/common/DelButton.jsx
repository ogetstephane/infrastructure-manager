import React from 'react';
import { useEditing } from './EditMode.jsx';

export default function DelButton({ onClick, title = 'Supprimer' }) {
  if (!useEditing()) return null;
  return <button className="icon" title={title} onClick={() => confirm('Supprimer ?') && onClick()}>✕</button>;
}
