import React, { useState } from 'react';
import { useStore } from '../../store.jsx';
import { useQuery } from '../../query.js';

const DECISION = { answered: '💬 Répondu', validated: '✅ Validé', rejected: '⛔ Rejeté', pending: '❓ En attente' };
const ACTION = { mode: 'Changement de mode', mode_default: 'Mode par défaut', questions: 'Questions de l\'IA', answer: 'Décision', resume: 'Reprise' };

const useSettings = () => useQuery('factory/settings').data;

// Opérateur courant (en-tête X-Operator, tracé dans l'audit)
function OperatorName() {
  const [name, setName] = useState(localStorage.getItem('operator') ?? '');
  return (
    <label className="muted">Opérateur{' '}
      <input value={name} placeholder="opérateur" size={12} onChange={(e) => { setName(e.target.value); localStorage.setItem('operator', e.target.value.trim()); }} />
    </label>
  );
}

// Réglage global du mode (dans l'assistant) : nouveaux tickets et, au choix, tickets en cours
export function ModeSetting() {
  const { save } = useStore();
  const settings = useSettings();
  const [apply, setApply] = useState(false);
  if (!settings) return null;
  return (
    <div className="row">
      <label title="S'applique aux tickets qui n'ont pas de mode propre">
        <input type="checkbox" checked={settings.interactive_default} onChange={(e) => save('PUT', 'factory/settings', { interactive_default: e.target.checked, apply_to_doing: apply })} />{' '}
        Mode interactif par défaut
      </label>
      <label className="muted" title="Bascule aussi les tickets « En cours » (suspendus puis relancés sur leur branche)">
        <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> y compris tickets en cours
      </label>
      <OperatorName />
    </div>
  );
}

function Question({ q }) {
  const { save } = useStore();
  const [text, setText] = useState('');
  const act = (status) => save('POST', `ticket_questions/${q.id}/answer`, { status, answer: text });
  return (
    <div className={`question ${q.status}`}>
      <div>{DECISION[q.status]} — {q.question}</div>
      {q.status === 'pending' ? (
        <>
          <textarea rows={2} placeholder="Réponse ou commentaire…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button disabled={!text.trim()} onClick={() => act('answered')}>Répondre</button>
            <button onClick={() => act('validated')}>✅ Valider</button>
            <button onClick={() => act('rejected')}>⛔ Rejeter</button>
          </div>
        </>
      ) : (
        <span className="muted">{q.answer && <>« {q.answer} » · </>}{q.answered_by} · {q.answered_at && new Date(`${q.answered_at}Z`).toLocaleString('fr-FR')}</span>
      )}
    </div>
  );
}

// Mode autonome/interactif d'un ticket, questions de l'IA à traiter, reprise et historique d'audit.
// Accessible sans passer en mode édition : c'est l'écran de validation ciblé par les notifications.
export default function TicketInteractive({ ticket }) {
  const { save } = useStore();
  const settings = useSettings();
  const questions = useQuery(`ticket_questions?ticket_id=${ticket.id}`).data ?? [];
  const audit = useQuery(`ticket_audit?ticket_id=${ticket.id}`).data ?? [];
  const runs = (useQuery('ticket_runs').data ?? []).filter((r) => r.ticket_id === ticket.id);
  if (!settings) return null;
  const interactive = ticket.interactive == null ? settings.interactive_default : ticket.interactive === 1;
  const pending = questions.filter((q) => q.status === 'pending');
  const waiting = runs[0]?.status === 'waiting';
  const set = (value) => save('POST', `tickets/${ticket.id}/mode`, { interactive: value });
  const locked = ticket.status === 'done';

  return (
    <div className="interactive">
      <h4>Mode d'exécution</h4>
      <div className="row">
        <span>
          <strong>{interactive ? '🙋 Interactif' : '🤖 Autonome'}</strong>
          {ticket.interactive == null && <span className="muted"> (par défaut)</span>}
        </span>
        <span>
          <button disabled={locked} onClick={() => set(!interactive)}>
            {interactive ? 'Passer en autonome' : 'Passer en interactif'}
          </button>
          {ticket.interactive != null && <button className="icon" disabled={locked} title="Revenir au réglage global" onClick={() => set(null)}>↺ Défaut</button>}
        </span>
      </div>
      {!interactive && runs[0]?.status === 'running' && <p className="muted">Passer en interactif suspend l'exécution en cours (travail conservé sur la branche) puis la relance aussitôt.</p>}
      {questions.length > 0 && (
        <>
          <h4>Questions de l'IA{pending.length > 0 && <span className="muted"> — {pending.length} en attente</span>}</h4>
          <OperatorName />
          {questions.map((q) => <Question key={q.id} q={q} />)}
        </>
      )}
      {waiting && (
        <p>
          <button disabled={pending.length > 0} onClick={() => save('POST', `tickets/${ticket.id}/resume`)}>▶ Reprendre l'exécution</button>
          {pending.length > 0
            ? <span className="muted"> Traitez les {pending.length} question(s) restantes pour reprendre. Sans réponse, le ticket reste en attente.</span>
            : <span className="muted"> Toutes les questions sont traitées.</span>}
        </p>
      )}
      {audit.length > 0 && (
        <details>
          <summary className="muted">Historique ({audit.length})</summary>
          <ul className="plain">
            {audit.map((a) => (
              <li key={a.id} className="muted">
                {new Date(`${a.at}Z`).toLocaleString('fr-FR')} · {a.actor} · {ACTION[a.action] ?? a.action}
                {a.old_value || a.new_value ? ` : ${a.old_value ?? '—'} → ${a.new_value ?? '—'}` : ''}{a.detail ? ` (${a.detail})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
