import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { DelButton, EditCell, useEditing } from '../common';
import IncidentAssist from './IncidentAssist.jsx';
import { COLUMNS, SEVERITY, fmtDate } from './incidents.js';

export default function IncidentDetail({ incident, onClose }) {
  const { save } = useStore();
  const editing = useEditing();
  const apps = useQuery(`applications${qs({ perimeter_id: incident.perimeter_id })}`).data ?? [];
  const [assist, setAssist] = useState(false);
  const u = (key) => (value) => save('PUT', `incidents/${incident.id}`, { [key]: value });
  const app = apps.find((a) => a.id === incident.application_id);
  return (
    <div className="ticket-detail">
      <div className="row">
        <strong><EditCell value={incident.title} onSave={u('title')} placeholder="Titre" /></strong>
        <span>
          {editing && <button className="icon" title="Affiner avec Copilot" onClick={() => setAssist(!assist)}>✨ Assister</button>}
          <DelButton title="Supprimer l'incident" onClick={async () => { if (await save('DELETE', `incidents/${incident.id}`)) onClose(); }} />
          <button className="icon" title="Fermer" onClick={onClose}>▴</button>
        </span>
      </div>
      {assist && <IncidentAssist perimeterId={incident.perimeter_id} incident={incident} onClose={() => setAssist(false)} />}
      {editing ? (
        <EditCell multiline value={incident.description} onSave={u('description')} placeholder="Description (Markdown)" />
      ) : incident.description ? (
        <div className="md"><Markdown>{incident.description}</Markdown></div>
      ) : <span className="muted">—</span>}
      <div className="row">
        <label>Sévérité{' '}
          {editing ? (
            <select className="cell" value={incident.severity} onChange={(e) => u('severity')(e.target.value)}>
              {Object.entries(SEVERITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          ) : <span className={`prio ${incident.severity}`}>{SEVERITY[incident.severity]}</span>}
        </label>
        <label>Statut{' '}
          {editing ? (
            <select className="cell" value={incident.status} onChange={(e) => u('status')(e.target.value)}>
              {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
            </select>
          ) : COLUMNS.find((c) => c.status === incident.status)?.label}
        </label>
        <label>Application{' '}
          {editing ? (
            <select className="cell" value={incident.application_id ?? ''} onChange={(e) => u('application_id')(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Aucune —</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (app?.name ?? '—')}
        </label>
      </div>
      <span className="muted">Ouvert le {fmtDate(incident.opened_at)} · Résolu le {fmtDate(incident.resolved_at)}</span>
    </div>
  );
}
