import React from 'react';
import { qs, useQuery } from '../../query.js';
import { COLUMNS, PRIORITY } from './factory.js';

// Tickets non terminés liés à une entité du catalogue (lecture seule) ; rien n'est affiché s'il n'y en a pas
export default function LinkedTickets({ type, id }) {
  const links = useQuery(`ticket_links${qs({ entity_type: type, entity_id: id })}`).data ?? [];
  const tickets = useQuery(links.length ? 'tickets' : null).data ?? [];
  const open = tickets.filter((t) => t.status !== 'done' && links.some((l) => l.ticket_id === t.id));
  if (!open.length) return null;
  return (
    <>
      <h4>Tickets</h4>
      <ul className="plain">
        {open.map((t) => (
          <li key={t.id}>
            <a href={`#ia-factory?p=${t.perimeter_id}&t=${t.id}`}>🎫 {t.title}</a> <span className="muted">({COLUMNS.find((c) => c.status === t.status)?.label})</span> <span className={`prio ${t.priority}`}>{PRIORITY[t.priority]}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
