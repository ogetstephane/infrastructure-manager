import React, { useEffect, useState } from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { EditModeProvider, Icon } from '../common';
import { useScope } from '../../scope.jsx';
import IncidentAssist from './IncidentAssist.jsx';
import IncidentDetail from './IncidentDetail.jsx';
import { COLUMNS, RESOLVED_SHOWN, SEVERITY, applyMove, inColumn } from './incidents.js';

function NewIncident({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('minor');
  const close = () => { setOpen(false); setTitle(''); setSeverity('minor'); };
  if (!open) return <button className="icon" title="Nouvel incident" onClick={() => setOpen(true)}>＋</button>;
  return (
    <form
      className="newticket"
      onSubmit={async (e) => {
        e.preventDefault();
        if (title.trim() && (await onCreate({ title: title.trim(), severity }))) close();
      }}
    >
      <input autoFocus placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && close()} />
      <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
        {Object.entries(SEVERITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </form>
  );
}

// Kanban des incidents d'un périmètre, éventuellement filtré sur une application ; déplacement par glisser-déposer en mode édition
export default function IncidentBoard({ perimeterId, applicationId = null, editable }) {
  const { save } = useStore();
  const scope = useScope();
  const [selected, setSelected] = useState(null);
  const [local, setLocal] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [showAllResolved, setShowAllResolved] = useState(false);
  const [assist, setAssist] = useState(null);
  const remote = useQuery(`incidents${qs({ perimeter_id: perimeterId })}`).data ?? [];
  const apps = useQuery(`applications${qs({ perimeter_id: perimeterId })}`).data ?? [];
  useEffect(() => { setSelected(null); setLocal(null); setShowAllResolved(false); setAssist(null); }, [perimeterId, applicationId]);

  const all = local ?? remote;
  const visible = applicationId ? all.filter((i) => i.application_id === applicationId) : all;
  const current = all.find((i) => i.id === selected);
  const appName = (id) => apps.find((a) => a.id === id)?.name;

  const drop = async (e, status, shown) => {
    e.preventDefault();
    const id = dragging;
    setDragging(null);
    if (id == null) return;
    const visibleCol = inColumn(visible, status).filter((i) => i.id !== id);
    const hiddenBefore = visibleCol.length - shown.filter((i) => i.id !== id).length;
    const cards = [...e.currentTarget.querySelectorAll('.ticket')].filter((el) => Number(el.dataset.id) !== id);
    const passed = cards.filter((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2;
    }).length;
    // la position envoyée au serveur se compte dans la colonne complète, incidents masqués par le filtre compris
    const next = visibleCol[hiddenBefore + passed];
    const fullCol = inColumn(all, status).filter((i) => i.id !== id);
    const index = next ? fullCol.findIndex((i) => i.id === next.id) : fullCol.length;
    setLocal(applyMove(all, id, status, index));
    await save('POST', `incidents/${id}/move`, { status, index });
    setLocal(null);
  };

  return (
    <EditModeProvider value={editable}>
      <div className="factory">
        {applicationId && (
          <p className="factory-filter">
            Filtré sur <Icon type="app" /> <b>{appName(applicationId) ?? '…'}</b> — {visible.length} incident{visible.length > 1 ? 's' : ''} sur {all.length}{' '}
            <button className="icon" onClick={() => scope.setScope({ p: perimeterId })}>Tout le périmètre</button>
          </p>
        )}
        {assist && <IncidentAssist perimeterId={perimeterId} applicationId={applicationId} status={assist} onClose={() => setAssist(null)} />}
        <div className="factory-cols cols-3">
          {COLUMNS.map(({ status, label }) => {
            const col = inColumn(visible, status);
            const hidden = status === 'resolved' && !showAllResolved ? Math.max(0, col.length - RESOLVED_SHOWN) : 0;
            const shown = col.slice(hidden);
            return (
              <div key={status} className="factory-col" onDragOver={(e) => editable && dragging != null && e.preventDefault()} onDrop={(e) => editable && drop(e, status, shown)}>
                <div className="row">
                  <h4>{label} <span className="muted">{col.length}</span></h4>
                  {editable && (
                    <span>
                      <button className="icon" title="Nouvel incident avec Copilot" onClick={() => setAssist(status)}>✨</button>
                      <NewIncident onCreate={(v) => save('POST', 'incidents', { ...v, perimeter_id: perimeterId, status, ...(applicationId ? { application_id: applicationId } : {}) })} />
                    </span>
                  )}
                </div>
                {hidden > 0 && <button className="icon" onClick={() => setShowAllResolved(true)}>Tout afficher ({col.length})</button>}
                {shown.length === 0 && <span className="muted">Aucun incident</span>}
                {shown.map((i) => (
                  <div
                    key={i.id}
                    data-id={i.id}
                    className={`ticket prio-${i.severity} ${selected === i.id ? 'selected' : ''}`}
                    draggable={editable}
                    onDragStart={() => setDragging(i.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setSelected(selected === i.id ? null : i.id)}
                  >
                    <span>{i.title}</span>
                    <span className="ticket-meta">
                      <span className={`prio ${i.severity}`}>{SEVERITY[i.severity]}</span>
                      {!applicationId && i.application_id && <span title="Application"><Icon type="app" /> {appName(i.application_id)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {current && <IncidentDetail key={current.id} incident={current} onClose={() => setSelected(null)} />}
      </div>
    </EditModeProvider>
  );
}
