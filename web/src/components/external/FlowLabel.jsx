import React from 'react';
import { useStore } from '../../store.jsx';
import { Icon, RepoLink } from '../common';

export const DIRECTIONS = [{ value: 'out', label: 'Sortant (l\'application appelle)' }, { value: 'in', label: 'Entrant (le service consomme)' }];

// Phrase lisible d'un flux : « Paie → URSSAF » ou « Banque → Paie »
export default function FlowLabel({ flow }) {
  const { x } = useStore();
  const app = x.app[flow.application_id]?.name;
  const ext = x.external_services.find((s) => s.id === flow.external_id)?.name;
  const [from, to] = flow.direction === 'in' ? [ext, app] : [app, ext];
  const srv = flow.server_id && x.srv[flow.server_id]?.hostname;
  const env = flow.environment_id && x.env[flow.environment_id]?.name;
  const ext_ = x.external_services.find((s) => s.id === flow.external_id);
  const url = flow.url || ext_?.url;
  const meta = [flow.protocol, flow.frequency].filter(Boolean).join(' · ');
  return (
    <>
      <Icon type="flow" /> {env && <span className="badge maintenance">{env}</span>} <b>{from}</b> → <b>{to}</b>
      {meta && <span className="muted"> ({meta})</span>}
      {srv && <span className="muted"> via <code>{srv}</code></span>}
      {url && <> <RepoLink url={url} /></>}
      {flow.description && <span className="muted"> — {flow.description}</span>}
    </>
  );
}
