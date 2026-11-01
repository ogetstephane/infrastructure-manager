import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { DelButton, EditCell, Icon, useEditing } from '../common';
import AssistPanel from './AssistPanel.jsx';
import TicketDiff from './TicketDiff.jsx';
import TicketInteractive from './TicketInteractive.jsx';
import TicketRuns from './TicketRuns.jsx';
import { COLUMNS, LINK_ICON, LINK_TYPES, PRIORITY } from './factory.js';

// Libellés des entités liables d'un périmètre, indexés par type puis par id
function useEntityLabels(perimeterId) {
  const b = useQuery(`bundle${qs({ perimeter_id: perimeterId })}`).data;
  const servers = useQuery('servers').data ?? [];
  return useMemo(() => {
    if (!b) return null;
    const apps = [...b.applications, ...(b.refs?.applications ?? [])];
    const appName = Object.fromEntries(apps.map((a) => [a.id, a.name]));
    const ext = Object.fromEntries(b.external_services.map((s) => [s.id, s.name]));
    const named = (rows, key) => Object.fromEntries(rows.map((r) => [r.id, r[key]]));
    return {
      perimeter: Object.fromEntries(b.perimeters.map((p) => [p.id, p.name])),
      application: named(b.applications, 'name'),
      environment: named(b.environments, 'name'),
      server: named(servers, 'hostname'),
      component: Object.fromEntries(b.components.map((c) => [c.id, `${appName[c.application_id] ?? '?'} · ${c.name}`])),
      tech_brick: named(b.tech_bricks, 'name'),
      external_service: named(b.external_services, 'name'),
      flow: Object.fromEntries(b.flows.map((f) => [f.id, `${appName[f.application_id] ?? '?'} ⇄ ${ext[f.external_id] ?? '?'}`])),
      dependency: Object.fromEntries(b.dependencies.map((d) => [d.id, `${appName[d.from_app_id] ?? '?'} → ${appName[d.to_app_id] ?? '?'}`])),
    };
  }, [b, servers]);
}

function Links({ ticket }) {
  const { save } = useStore();
  const editing = useEditing();
  const links = useQuery(`ticket_links${qs({ ticket_id: ticket.id })}`).data ?? [];
  const labels = useEntityLabels(ticket.perimeter_id);
  const [type, setType] = useState('application');
  const [entity, setEntity] = useState('');
  const options = Object.entries(labels?.[type] ?? {}).filter(([id]) => !links.some((l) => l.entity_type === type && l.entity_id === Number(id)));

  const add = async (e) => {
    e.preventDefault();
    if (entity && (await save('POST', 'ticket_links', { ticket_id: ticket.id, entity_type: type, entity_id: Number(entity) }))) setEntity('');
  };

  return (
    <div className="ticket-links">
      <h4>Liens</h4>
      {links.length === 0 && <span className="muted">Aucun lien.</span>}
      {links.map((l) => (
        <div key={l.id} className="row">
          <span><Icon type={LINK_ICON[l.entity_type]} /> {labels?.[l.entity_type]?.[l.entity_id] ?? `#${l.entity_id}`} <span className="muted">({LINK_TYPES[l.entity_type]})</span></span>
          <DelButton title="Retirer le lien" onClick={() => save('DELETE', `ticket_links/${l.id}`)} />
        </div>
      ))}
      {editing && (
        <form className="addform" onSubmit={add}>
          <select value={type} onChange={(e) => { setType(e.target.value); setEntity(''); }}>
            {Object.entries(LINK_TYPES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">— choisir —</option>
            {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button disabled={!entity}>Lier</button>
        </form>
      )}
    </div>
  );
}

// Détail d'un ticket : champs éditables (en mode édition) et liens vers le catalogue
function SubTickets({ ticket, subs, onSelect }) {
  const { save } = useStore();
  const editing = useEditing();
  const [title, setTitle] = useState('');
  if (!editing && !subs.length) return null;
  return (
    <div>
      <h4>Sous-tickets{subs.length > 0 && <span className="muted"> {subs.filter((s) => s.status === 'done').length}/{subs.length}</span>}</h4>
      <ul className="plain">
        {subs.map((s) => (
          <li key={s.id} className="row">
            <a href="#" onClick={(e) => { e.preventDefault(); onSelect(s.id); }}>{s.title}</a>
            <span>
              {editing ? (
                <select className="cell" value={s.status} onChange={(e) => save('PUT', `tickets/${s.id}`, { status: e.target.value })}>
                  {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                </select>
              ) : <span className="muted">{COLUMNS.find((c) => c.status === s.status)?.label}</span>}{' '}
              <span className={`prio ${s.priority}`}>{PRIORITY[s.priority]}</span>
            </span>
          </li>
        ))}
      </ul>
      {editing && (
        <form className="newticket" onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim() && (await save('POST', 'tickets', { perimeter_id: ticket.perimeter_id, parent_id: ticket.id, title: title.trim() }))) setTitle('');
        }}>
          <input placeholder="Nouveau sous-ticket" value={title} onChange={(e) => setTitle(e.target.value)} />
        </form>
      )}
    </div>
  );
}

// Confirmation de suppression définitive : saisie de l'identifiant (#id) ou du titre du ticket
function DeleteModal({ ticket, subs, onCancel, onDone }) {
  const { save } = useStore();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = subs.length > 0;
  const matches = [String(ticket.id), `#${ticket.id}`, ticket.title.trim()].includes(typed.trim());
  const confirm = async () => {
    setBusy(true);
    const ok = await save('DELETE', `tickets/${ticket.id}`);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Supprimer définitivement ce ticket ?</h3>
        {blocked ? (
          <p>Ce ticket a {subs.length} sous-ticket(s) : supprimez-les d'abord.</p>
        ) : (
          <>
            <p><strong>Action irréversible.</strong> Le ticket, ses liens, ses exécutions, ses questions et son historique seront supprimés. Seule une trace (qui, quand, identifiant) est conservée.</p>
            <label>Saisissez <code>{ticket.id}</code> ou le titre « {ticket.title} » pour confirmer
              <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          </>
        )}
        <div className="row">
          <button onClick={onCancel}>Annuler</button>
          {!blocked && <button className="danger" disabled={!matches || busy} onClick={confirm}>Supprimer définitivement</button>}
        </div>
      </div>
    </div>
  );
}

export default function TicketDetail({ ticket, subs = [], parent, onSelect, onClose }) {
  const { save } = useStore();
  const editing = useEditing();
  const u = (key) => (value) => save('PUT', `tickets/${ticket.id}`, { [key]: value });
  const [assist, setAssist] = useState(false);
  const [diff, setDiff] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = useQuery('factory/settings').data?.can_delete === true;
  const inReview = ticket.status === 'review';
  // sortie automatique du mode diff dès que le ticket quitte « En revue » (ou qu'on change de ticket)
  useEffect(() => { if (!inReview) setDiff(false); }, [inReview]);
  useEffect(() => { setDiff(false); }, [ticket.id]);
  return (
    <div className="ticket-detail">
      {parent && <a href="#" onClick={(e) => { e.preventDefault(); onSelect(parent.id); }}>↑ Sous-ticket de « {parent.title} »</a>}
      <div className="row">
        <strong><EditCell value={ticket.title} onSave={u('title')} placeholder="Titre" /></strong>
        <span>
          {inReview && !diff && <button className="icon" title="Voir les sources modifiées (git diff)" onClick={() => setDiff(true)}>🔀 Diff git</button>}
          {editing && <button className="icon" title="Affiner avec Copilot" onClick={() => setAssist(!assist)}>✨ Assister</button>}
          {editing && canDelete && <button className="icon danger" title="Supprimer définitivement le ticket" onClick={() => setConfirmDelete(true)}>🗑 Supprimer définitivement</button>}
          <button className="icon" title="Fermer" onClick={onClose}>▴</button>
        </span>
      </div>
      {confirmDelete && (
        <DeleteModal ticket={ticket} subs={subs} onCancel={() => setConfirmDelete(false)}
          onDone={() => { setConfirmDelete(false); if (parent) onSelect(parent.id); else onClose(); }} />
      )}
      {inReview && diff && <TicketDiff ticket={ticket} onClose={() => setDiff(false)} />}
      {assist && <AssistPanel perimeterId={ticket.perimeter_id} ticket={ticket} onClose={() => setAssist(false)} />}
      {editing ? (
        <EditCell multiline value={ticket.description} onSave={u('description')} placeholder="Description (Markdown)" />
      ) : ticket.description ? (
        <div className="md"><Markdown>{ticket.description}</Markdown></div>
      ) : <span className="muted">—</span>}
      <div className="row">
        <label>Priorité{' '}
          {editing ? (
            <select className="cell" value={ticket.priority} onChange={(e) => u('priority')(e.target.value)}>
              {Object.entries(PRIORITY).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          ) : <span className={`prio ${ticket.priority}`}>{PRIORITY[ticket.priority]}</span>}
        </label>
        <label>Statut{' '}
          {editing ? (
            <select className="cell" value={ticket.status} onChange={(e) => u('status')(e.target.value)}>
              {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
            </select>
          ) : COLUMNS.find((c) => c.status === ticket.status)?.label}
        </label>
      </div>
      {!parent && <SubTickets ticket={ticket} subs={subs} onSelect={onSelect} />}
      {!parent && <TicketInteractive ticket={ticket} />}
      <TicketRuns ticket={ticket} />
      <Links ticket={ticket} />
    </div>
  );
}
