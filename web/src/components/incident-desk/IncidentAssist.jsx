import React, { lazy, Suspense, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../../api.js';
import { invalidate } from '../../query.js';
import { useStore } from '../../store.jsx';
import { SEVERITY } from './incidents.js';

const CopilotTerminal = lazy(() => import('../common/CopilotTerminal.jsx'));

// Assistant de rédaction : Copilot propose un incident, rien n'est enregistré avant « Enregistrer ».
// Sans `incident`, crée un incident dans la colonne `status` ; avec `incident`, remplace titre, description et sévérité.
export default function IncidentAssist({ perimeterId, applicationId = null, status = 'new', incident = null, onClose }) {
  const { setError } = useStore();
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setLocalError] = useState('');
  const [p, setP] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => { setLocalError(''); }, [request]);

  const propose = async (e) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const r = await api('POST', 'incidents/assist', { perimeter_id: perimeterId, application_id: applicationId ?? incident?.application_id, request, incident_id: incident?.id });
      setSessionId(r.session_id);
    } catch (err) {
      setLocalError(err.message);
    }
    setBusy(false);
  };

  const sessionDone = (session) => {
    setSessionId(null);
    if (session.status === 'completed' && session.result) setP(session.result);
    else setLocalError(session.error || 'Copilot n’a pas pu terminer la proposition.');
  };

  const close = async () => {
    if (sessionId) {
      try {
        await api('POST', `copilot_sessions/${sessionId}/cancel`);
      } catch (err) {
        setLocalError(err.message);
        return;
      }
    }
    onClose();
  };

  const commit = async () => {
    setBusy(true);
    try {
      const { title, description, severity } = p;
      if (incident) await api('PUT', `incidents/${incident.id}`, { title, description, severity });
      else await api('POST', 'incidents', { perimeter_id: perimeterId, title, description, severity, status, ...(applicationId ? { application_id: applicationId } : {}) });
      await invalidate();
      onClose();
    } catch (err) {
      setLocalError(err.message);
      setError(err.message);
      await invalidate();
    }
    setBusy(false);
  };

  return (
    <div className="assist">
      <div className="row">
        <strong>✨ Assistant{incident ? ' — affiner cet incident' : ' — nouvel incident'}</strong>
        <button className="icon" title="Fermer" onClick={close}>✕</button>
      </div>
      {sessionId && (
        <Suspense fallback={<p className="muted">Chargement du terminal…</p>}>
          <CopilotTerminal resource="copilot_sessions" id={sessionId} onDone={sessionDone} />
        </Suspense>
      )}
      {!p && !sessionId && (
        <form onSubmit={propose} className="assist-form">
          <textarea rows={3} autoFocus placeholder="Décris ce qui se passe…" value={request} onChange={(e) => setRequest(e.target.value)} />
          <button disabled={busy || !request.trim()}>{busy ? '⏳ Copilot rédige…' : 'Proposer'}</button>
        </form>
      )}
      {p && (
        <div className="assist-form">
          <input value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
          <div className="row">
            <label>Sévérité{' '}
              <select value={p.severity} onChange={(e) => setP({ ...p, severity: e.target.value })}>
                {Object.entries(SEVERITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="icon" onClick={() => setPreview(!preview)}>{preview ? 'Éditer' : 'Aperçu'}</button>
          </div>
          {preview
            ? <div className="md"><Markdown>{p.description}</Markdown></div>
            : <textarea rows={10} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />}
          {incident && <details><summary className="muted">Description actuelle</summary><pre>{incident.description || '—'}</pre></details>}
          <div className="row">
            <button disabled={busy || !p.title.trim()} onClick={commit}>Enregistrer</button>
            <button className="icon" onClick={() => setP(null)}>Reformuler</button>
          </div>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
