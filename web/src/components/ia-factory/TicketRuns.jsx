import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from '../../store.jsx';
import { invalidate, useQuery } from '../../query.js';
import { useEditing } from '../common';

const CopilotTerminal = lazy(() => import('../common/CopilotTerminal.jsx'));

export const RUN_LABEL = { running: '⏳ En cours', succeeded: '✅ Réussie', failed: '❌ Échec', cancelled: '⏹ Arrêtée', waiting: '❓ En attente de réponses', resumed: '↪ Reprise', suspended: '⏸ Suspendue (bascule)' };

// Relit les requêtes affichées chaque seconde tant qu'une exécution tourne (sortie en direct)
export function useRuns() {
  const runs = useQuery('ticket_runs').data ?? [];
  const running = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(invalidate, 1000);
    return () => clearInterval(t);
  }, [running]);
  return runs;
}

const duration = (r) => {
  if (!r.ended_at) return '';
  const s = Math.round((new Date(`${r.ended_at}Z`) - new Date(`${r.started_at}Z`)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};

// Section « Exécution » du détail d'un ticket : lancement, sortie en direct, historique
export default function TicketRuns({ ticket }) {
  const { save } = useStore();
  const editing = useEditing();
  const all = useQuery('ticket_runs').data ?? [];
  const runs = all.filter((r) => r.ticket_id === ticket.id);
  const busy = runs.find((r) => r.status === 'running');
  const [picked, setPicked] = useState(null);
  const shown = runs.find((r) => r.id === picked) ?? runs[0];
  const detail = useQuery(shown ? `ticket_runs/${shown.id}` : null).data;
  if (!editing && !runs.length && !ticket.worktree_branch) return null;

  const launch = async () => {
    if (ticket.status === 'done' && !window.confirm('Ce ticket est terminé. Le relancer ?')) return;
    setPicked(null);
    await save('POST', `tickets/${ticket.id}/run`);
  };

  return (
    <div>
      <h4>Exécution (Copilot)</h4>
      {editing && (
        <p>
          {busy
            ? <button onClick={() => save('POST', `ticket_runs/${busy.id}/cancel`)}>■ Arrêter</button>
            : <button onClick={launch}>▶ Exécuter</button>}
        </p>
      )}
      {(ticket.worktree_path || ticket.worktree_branch) && (
        <p className="muted">
          Branche <code>{ticket.worktree_branch}</code>
          {ticket.worktree_path ? <> · worktree <code>{ticket.worktree_path}</code></> : ' · worktree nettoyé'}
        </p>
      )}
      {shown && detail?.id === shown.id && detail.status === 'running' && (
        <Suspense fallback={<p className="muted">Chargement du terminal…</p>}>
          <CopilotTerminal resource="ticket_runs" id={shown.id} onDone={invalidate} canControl={editing} />
        </Suspense>
      )}
      {shown && detail?.id === shown.id && detail.status !== 'running' && (
        <pre className="run-output">{detail.output || '(aucune sortie)'}</pre>
      )}
      {runs.length > 0 && (
        <ul className="plain">
          {runs.map((r) => (
            <li key={r.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); setPicked(r.id); }}>{new Date(`${r.started_at}Z`).toLocaleString('fr-FR')}</a>{' '}
              {RUN_LABEL[r.status]} <span className="muted">{duration(r)}</span>{r.id === shown?.id && ' ◀'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
