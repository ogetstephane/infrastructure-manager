import React, { lazy, Suspense, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { api } from '../../api.js';
import { invalidate } from '../../query.js';
import { useStore } from '../../store.jsx';
import { PRIORITY } from './factory.js';
import { ModeSetting } from './TicketInteractive.jsx';

const CopilotTerminal = lazy(() => import('../common/CopilotTerminal.jsx'));

// Assistant de rédaction : Copilot propose un ticket (et des sous-tickets), rien n'est enregistré avant « Enregistrer ».
// Sans `ticket`, crée un ticket dans la colonne `status` ; avec `ticket`, remplace titre/description et ajoute les sous-tickets.
export default function AssistPanel({ perimeterId, applicationId = null, status = 'backlog', ticket = null, onClose }) {
  const { setError } = useStore();
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setLocalError] = useState('');
  const [p, setP] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => { setLocalError(''); }, [request]);
  const canHaveSubs = !ticket || ticket.parent_id == null;

  const propose = async (e) => {
    e.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const r = await api('POST', 'tickets/assist', { perimeter_id: perimeterId, request, ticket_id: ticket?.id });
      setSessionId(r.session_id);
    } catch (err) {
      setLocalError(err.message);
    }
    setBusy(false);
  };

  const sessionDone = (session) => {
    setSessionId(null);
    if (session.status === 'completed' && session.result) {
      setP({ ...session.result, subtickets: canHaveSubs ? session.result.subtickets : [] });
    } else {
      setLocalError(session.error || 'Copilot n’a pas pu terminer la proposition.');
    }
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
      let id = ticket?.id;
      if (ticket) {
        await api('PUT', `tickets/${id}`, { title: p.title, description: p.description });
      } else {
        ({ id } = await api('POST', 'tickets', {
          perimeter_id: perimeterId, title: p.title, description: p.description, priority: p.priority, status,
          ...(applicationId ? { link_application_id: applicationId } : {}),
        }));
      }
      for (const s of p.subtickets) await api('POST', 'tickets', { perimeter_id: perimeterId, parent_id: id, title: s.title, description: s.description });
      await invalidate();
      onClose();
    } catch (err) {
      setLocalError(err.message);
      setError(err.message);
      await invalidate();
    }
    setBusy(false);
  };

  const setSub = (i, patch) => setP({ ...p, subtickets: p.subtickets.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="assist">
      <div className="row">
        <strong>✨ Assistant{ticket ? ' — affiner ce ticket' : ' — nouveau ticket'}</strong>
        <button className="icon" title="Fermer" onClick={close}>✕</button>
      </div>
      <ModeSetting />
      {sessionId && (
        <Suspense fallback={<p className="muted">Chargement du terminal…</p>}>
          <CopilotTerminal resource="copilot_sessions" id={sessionId} onDone={sessionDone} />
        </Suspense>
      )}
      {!p && !sessionId && (
        <form onSubmit={propose} className="assist-form">
          <textarea rows={3} autoFocus placeholder="Décris ce que tu veux…" value={request} onChange={(e) => setRequest(e.target.value)} />
          <button disabled={busy || !request.trim()}>{busy ? '⏳ Copilot rédige…' : 'Proposer'}</button>
        </form>
      )}
      {p && (
        <div className="assist-form">
          <input value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
          <div className="row">
            <label>Priorité{' '}
              <select value={p.priority} disabled={!!ticket} onChange={(e) => setP({ ...p, priority: e.target.value })}>
                {Object.entries(PRIORITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="icon" onClick={() => setPreview(!preview)}>{preview ? 'Éditer' : 'Aperçu'}</button>
          </div>
          {preview
            ? <div className="md"><Markdown>{p.description}</Markdown></div>
            : <textarea rows={8} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />}
          {ticket && <details><summary className="muted">Description actuelle</summary><pre>{ticket.description || '—'}</pre></details>}
          {canHaveSubs && (
            <div>
              <h4>Sous-tickets proposés ({p.subtickets.length})</h4>
              <ul className="plain">
                {p.subtickets.map((s, i) => (
                  <li key={i} className="row">
                    <input value={s.title} onChange={(e) => setSub(i, { title: e.target.value })} />
                    <button className="icon" title="Retirer" onClick={() => setP({ ...p, subtickets: p.subtickets.filter((_, j) => j !== i) })}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            <button disabled={busy || !p.title.trim() || p.subtickets.some((s) => !s.title.trim())} onClick={commit}>Enregistrer</button>
            <button className="icon" onClick={() => setP(null)}>Reformuler</button>
          </div>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
