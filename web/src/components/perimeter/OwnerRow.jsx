import React from 'react';
import { useStore } from '../../store.jsx';
import { EditCell } from '../common';

// Ligne responsable/contact pour un périmètre ou une application
export default function OwnerRow({ table, record, label }) {
  const { save } = useStore();
  const u = (key) => (value) => save('PUT', `${table}/${record.id}`, { [key]: value });
  return (
    <tr className={!record.owner ? 'missing' : ''}>
      <td>{label}</td>
      <td><EditCell value={record.owner} placeholder="Équipe / responsable" onSave={u('owner')} /></td>
      <td><EditCell value={record.contact} placeholder="email ou canal" onSave={u('contact')} /></td>
    </tr>
  );
}
