import React, { useEffect, useState } from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { EditModeProvider, Icon } from '../common';
import { useScope } from '../../scope.jsx';
import AssistPanel from './AssistPanel.jsx';
import QuickAction from './QuickAction.jsx';
import TicketDetail from './TicketDetail.jsx';
import { useRuns } from './TicketRuns.jsx';
import { COLUMNS, DONE_SHOWN, PRIORITY, applyMove, canMoveManually, inColumn } from './factory.js';

function NewTicket({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const close = () => { setOpen(false); setTitle(''); setPriority('normal'); };
  if (!open) return <button className="icon" title="Nouveau ticket" onClick={() => setOpen(true)}>＋</button>;
  return (
    <form
      className="newticket"
      onSubmit={async (e) => {
        e.preventDefault();
        if (title.trim() && (await onCreate({ title: title.trim(), priority }))) close();
      }}
    >
      <input autoFocus placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && close()} />
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        {Object.entries(PRIORITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </form>
  );
}

// Tableau factory d'un périmètre, éventuellement filtré sur une application (lien direct).
// Lit /tickets?perimeter_id= et /ticket_links ; déplacement par glisser-déposer en mode édition.
export default function FactoryBoard({ perimeterId, applicationId = null, editable, openId = null }) {
  const { save } = useStore();
  const scope = useScope();
  const [selected, setSelected] = useState(null);
  const [local, setLocal] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [assist, setAssist] = useState(null);
  const waitingIds = new Set((useQuery('ticket_questions?status=pending').data ?? []).map((q) => q.ticket_id));
  const allRuns = useRuns();
  const runningIds = new Set(allRuns.filter((r) => r.status === 'running').map((r) => r.ticket_id));
  const lastRun = new Map();
  for (const r of allRuns) if (!lastRun.has(r.ticket_id) || r.id > lastRun.get(r.ticket_id).id) lastRun.set(r.ticket_id, r);
  const failedIds = new Set([...lastRun.values()].filter((r) => r.status === 'failed').map((r) => r.ticket_id));
  const links = useQuery('ticket_links').data ?? [];
  const remote = useQuery(`tickets${qs({ perimeter_id: perimeterId })}`).data ?? [];
  const app = useQuery(applicationId ? `applications/${applicationId}` : null).data;
  useEffect(() => { setSelected(null); setLocal(null); setShowAllDone(false); setAssist(null); }, [perimeterId, applicationId]);
  useEffect(() => { if (openId) setSelected(openId); }, [openId, perimeterId]);

  const all = local ?? remote;
  const linkedToApp = new Set(links.filter((l) => l.entity_type === 'application' && l.entity_id === applicationId).map((l) => l.ticket_id));
  const top = all.filter((t) => t.parent_id == null);
  const subsOf = (id) => all.filter((t) => t.parent_id === id);
  const visible = applicationId ? top.filter((t) => linkedToApp.has(t.id) || subsOf(t.id).some((s) => linkedToApp.has(s.id))) : top;
  const linkCount = (id) => links.filter((l) => l.ticket_id === id).length;
  const current = all.find((t) => t.id === selected);

  const dragFrom = dragging != null ? all.find((t) => t.id === dragging)?.status : null;
  const allowed = (status) => dragFrom == null || canMoveManually(dragFrom, status);

  const drop = async (e, status, shown) => {
    e.preventDefault();
    const id = dragging;
    setDragging(null);
    if (id == null) return;
    if (!allowed(status)) {
      const from = COLUMNS.find((c) => c.status === dragFrom)?.label;
      setRefusal(`Déplacement refusé : ${from} → ${COLUMNS.find((c) => c.status === status)?.label} n'est pas autorisé.`);
      return;
    }
    setRefusal(null);
    const visibleCol = inColumn(visible, status).filter((t) => t.id !== id);
    const hiddenBefore = visibleCol.length - shown.filter((t) => t.id !== id).length;
    const cards = [...e.currentTarget.querySelectorAll('.ticket')].filter((el) => Number(el.dataset.id) !== id);
    const passed = cards.filter((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2;
    }).length;
    // la position envoyée au serveur se compte dans la colonne complète, tickets masqués par le filtre compris
    const next = visibleCol[hiddenBefore + passed];
    const fullCol = inColumn(all, status).filter((t) => t.id !== id);
    const index = next ? fullCol.findIndex((t) => t.id === next.id) : fullCol.length;
    setLocal(applyMove(all, id, status, index));
    await save('POST', `tickets/${id}/move`, { status, index });
    setLocal(null);
  };

  // Raccourci : le ticket passe en fin de colonne cible ; en cas d'échec le statut initial est conservé et l'erreur affichée
  const quickMove = async (id, status) => {
    setRefusal(null);
    const index = inColumn(all, status).filter((x) => x.id !== id).length;
    setLocal(applyMove(all, id, status, index));
    const ok = await save('POST', `tickets/${id}/move`, { status, index, shortcut: true });
    setLocal(null);
    if (!ok) setRefusal('Transition impossible : le statut du ticket est inchangé.');
  };

  return (
    <EditModeProvider value={editable}>
      <div className="factory">
        {applicationId && (
          <p className="factory-filter">
            Filtré sur <Icon type="app" /> <b>{app?.name ?? '…'}</b> — {visible.length} ticket{visible.length > 1 ? 's' : ''} sur {top.length}{' '}
            <button className="icon" onClick={() => scope.setScope({ p: perimeterId })}>Tout le périmètre</button>
          </p>
        )}
        {assist && <AssistPanel perimeterId={perimeterId} applicationId={applicationId} status={assist} onClose={() => setAssist(null)} />}
        {refusal && <p className="error" role="alert">{refusal} <button className="icon" onClick={() => setRefusal(null)}>✕</button></p>}
        <div className="factory-cols">
          {COLUMNS.map(({ status, label }) => {
            const col = inColumn(visible, status);
            const hidden = status === 'done' && !showAllDone ? Math.max(0, col.length - DONE_SHOWN) : 0;
            const shown = col.slice(hidden);
            return (
              <div
                key={status}
                className={`factory-col ${dragging != null && !allowed(status) ? 'forbidden' : ''}`}
                onDragOver={(e) => editable && dragging != null && (allowed(status) ? e.preventDefault() : (e.dataTransfer.dropEffect = 'none'))}
                onDrop={(e) => editable && drop(e, status, shown)}
              >
                <div className="row">
                  <h4>{label} <span className="muted">{col.length}</span></h4>
                  {editable && (
                    <span>
                    <button className="icon" title="Nouveau ticket avec Copilot" onClick={() => setAssist(status)}>✨</button>
                    <NewTicket onCreate={(v) => save('POST', 'tickets', { ...v, perimeter_id: perimeterId, status, ...(applicationId ? { link_application_id: applicationId } : {}) })} />
                    </span>
                  )}
                </div>
                {hidden > 0 && <button className="icon" onClick={() => setShowAllDone(true)}>Tout afficher ({col.length})</button>}
                {shown.length === 0 && <span className="muted">Aucun ticket</span>}
                {shown.map((t) => (
                  <div
                    key={t.id}
                    data-id={t.id}
                    className={`ticket prio-${t.priority} ${selected === t.id ? 'selected' : ''}`}
                    draggable={editable}
                    onDragStart={() => setDragging(t.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setSelected(selected === t.id ? null : t.id)}
                  >
                    <span className="ticket-title">
                      <span>{t.title}</span>
                      {editable && <QuickAction status={t.status} onMove={(to) => quickMove(t.id, to)} />}
                    </span>
                    <span className="ticket-meta">
                      <span className={`prio ${t.priority}`}>{PRIORITY[t.priority]}</span>
                      {runningIds.has(t.id) && <span title="Exécution en cours">⏳</span>}
                      {failedIds.has(t.id) && t.status === 'doing' && <span title="Dernière exécution en échec">❌</span>}
                      {waitingIds.has(t.id) && <span title="Questions de l'IA en attente de validation">❓</span>}
                      {subsOf(t.id).length > 0 && <span title="Sous-tickets terminés">☑ {subsOf(t.id).filter((s) => s.status === 'done').length}/{subsOf(t.id).length}</span>}
                      {linkCount(t.id) > 0 && <span title="Liens">🔗 {linkCount(t.id)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {current && <TicketDetail key={current.id} ticket={current} subs={subsOf(current.id)} parent={all.find((t) => t.id === current.parent_id)} onSelect={setSelected} onClose={() => setSelected(null)} />}
      </div>
    </EditModeProvider>
  );
}
