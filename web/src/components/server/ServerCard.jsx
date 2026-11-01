import React, { useState } from 'react';
import { Slice, useStore } from '../../store.jsx';
import { useQuery } from '../../query.js';
import { envLabel, flowsOnServer, nodesOnServer } from '../../selectors.js';
import { ROLES } from '../application/ComponentsPanel.jsx';
import { FlowLabel } from '../external';
import LinkedTickets from '../ia-factory/LinkedTickets.jsx';
import { EditModeProvider, ModeToggle, AddForm, Card, DelButton, EditCell, Icon, StatusSelect } from '../common';

// Bloc serveur autonome : charge /servers/:id/bundle
export default function ServerCard({ id }) {
  return (
    <Slice path={`servers/${id}/bundle`}>
      <Server id={id} />
    </Slice>
  );
}

function Server({ id }) {
  const { x, save } = useStore();
  const server = x.srv[id];
  const [edit, setEdit] = useState(false);
  const environments = useQuery(edit ? 'environments' : null).data ?? []; // pour choisir où héberger
  const links = x.environment_servers.filter((l) => l.server_id === server.id);
  const nodes = nodesOnServer(x, server.id);
  const flows = flowsOnServer(x, server.id);
  const hosted = links.map((l) => ({ l, e: x.env[l.environment_id] })).filter(({ e }) => e);
  const apps = [...new Set(nodes.map((n) => x.app[x.components.find((c) => c.id === n.component_id)?.application_id]?.name).filter(Boolean))];
  const free = environments.filter((e) => !links.some((l) => l.environment_id === e.id));
  const u = (key) => (value) => save('PUT', `servers/${server.id}`, { [key]: value });

  return (
    <Card
      title={<><Icon type="server" /> <EditModeProvider value={edit}><EditCell value={server.hostname} onSave={u('hostname')} /></EditModeProvider></>}
      actions={<><ModeToggle edit={edit} onChange={setEdit} /><EditModeProvider value={edit}><DelButton title="Supprimer le serveur" onClick={() => save('DELETE', `servers/${server.id}`)} /></EditModeProvider></>}
    >
      <EditModeProvider value={edit}>
      <div className="fields">
        <label>IP<EditCell value={server.ip} onSave={u('ip')} /></label>
        <label>OS<EditCell value={server.os} onSave={u('os')} /></label>
        <label>Rôle<EditCell value={server.role} onSave={u('role')} /></label>
        <label>Lieu<EditCell value={server.location} onSave={u('location')} /></label>
        <label>Tags<EditCell value={server.tags} onSave={u('tags')} placeholder="prod, dmz…" /></label>
        <label>Statut<StatusSelect value={server.status} onChange={u('status')} /></label>
      </div>
      <h4>Environnements hébergés</h4>
      <ul className="plain">
        {hosted.map(({ l, e }) => (
          <li key={l.id}>{envLabel(x, e)} <DelButton title="Détacher" onClick={() => save('DELETE', `environment_servers/${l.id}`)} /></li>
        ))}
      </ul>
      {free.length > 0 && (
        <AddForm
          fields={[{ key: 'environment_id', number: true, label: 'Environnement', options: free.map((e) => ({ value: e.id, label: e.label })) }]}
          onSubmit={(v) => save('POST', 'environment_servers', { ...v, server_id: server.id })}
          label="Héberger"
        />
      )}
      {nodes.some((n) => !n.virtual) && (
        <>
          <h4>Briques hébergées</h4>
          <ul className="plain">
            {nodes.filter((n) => !n.virtual).map((n) => {
              const c = x.components.find((c) => c.id === n.component_id);
              return <li key={n.id}><Icon type="component" of={c.kind} /> <b>{c.name}</b> <span className="muted">({ROLES[n.role]}) · {x.app[c.application_id].name} / {x.env[n.environment_id].name}</span></li>;
            })}
          </ul>
        </>
      )}
      {x.tech_brick_nodes.some((n) => n.server_id === server.id) && (
        <>
          <h4>Briques techniques du périmètre</h4>
          <ul className="plain">
            {x.tech_brick_nodes.filter((n) => n.server_id === server.id).map((n) => {
              const t = x.tech_bricks.find((b) => b.id === n.tech_brick_id);
              return <li key={n.id}><Icon type="component" of={t?.kind} /> <b>{t?.name}</b> <span className="muted">({ROLES[n.role]}) · {x.perim[t?.perimeter_id]?.name} / {x.env[n.environment_id]?.name}</span></li>;
            })}
          </ul>
        </>
      )}
      {flows.length > 0 && (
        <>
          <h4>Flux externes</h4>
          <ul className="plain">{flows.map((f) => <li key={f.id}><FlowLabel flow={f} /></li>)}</ul>
        </>
      )}
      <LinkedTickets type="server" id={server.id} />
      {apps.length > 0 && <p className="impact">Impact si arrêt : {apps.join(', ')}</p>}
      </EditModeProvider>
    </Card>
  );
}
