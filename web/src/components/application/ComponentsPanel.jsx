import React from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { componentState, componentsOfApp, nodeTree, nodesOf } from '../../selectors.js';
import { Icon, AddForm, DelButton, EditCell, Empty, TableWrap } from '../common';

export const KINDS = { '': '—', app: 'Applicatif', web: 'Web / proxy', db: 'Base de données', cache: 'Cache', search: 'Recherche', queue: 'File de messages', storage: 'Stockage', other: 'Autre' };
export const ROLES = { node: 'nœud', frontend: 'frontal', primary: 'primaire', replica: 'réplica', arbiter: 'arbitre', '': 'nœud' };
const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const TOPO = { none: 'non déployée', single: 'simple', ha: 'HA' };

// Briques techniques d'une application : définition commune, serveurs par environnement
export default function ComponentsPanel({ appId, envs }) {
  const { x, save } = useStore();
  const servers = useQuery('servers').data ?? []; // tous les serveurs, pour les listes de choix
  const components = componentsOfApp(x, appId);
  const catalog = useQuery(`tech_bricks${qs({ perimeter_id: x.app[appId]?.perimeter_id })}`).data ?? [];
  const u = (c, key) => (value) => save('PUT', `components/${c.id}`, { [key]: value });

  return (
    <>
      {components.length === 0 && <Empty>Aucune brique technique (web, BDD, cache…).</Empty>}
      {components.map((c) => {
        return (
          <div key={c.id} className="component">
            <div className="row">
              <span className="compname">
                <Icon type="component" of={c.kind} />
                {c.tech_brick_id ? (
                  <>
                    <b>{c.name}</b> <span className="muted">{KINDS[c.kind]} {c.technology}</span>
                  </>
                ) : (
                  <>
                    <EditCell value={c.name} onSave={u(c, 'name')} />
                    <select className="cell" value={c.kind} onChange={(e) => u(c, 'kind')(e.target.value)}>
                      {opts(KINDS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <EditCell value={c.technology} onSave={u(c, 'technology')} placeholder="Techno (Galera, HAProxy+Nginx…)" />
                  </>
                )}
                <select className="cell" value={c.tech_brick_id ?? ''} title="Brique technique du périmètre" onChange={(e) => u(c, 'tech_brick_id')(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">propre à l'application</option>
                  {catalog.map((t) => <option key={t.id} value={t.id}>périmètre : {t.name}</option>)}
                </select>
              </span>
              <DelButton title="Supprimer la brique" onClick={() => save('DELETE', `components/${c.id}`)} />
            </div>
            {envs.length > 0 && (
              <TableWrap>
                <table className="matrix">
                  <thead><tr>{envs.map((e) => <th key={e.id}>{e.name}</th>)}</tr></thead>
                  <tbody>
                    <tr>
                      {envs.map((e) => {
                        const nodes = nodesOf(x, c.id, e.id);
                        const { topology, status } = componentState(x, nodes);
                        return (
                          <td key={e.id} className={`ver topo-${topology}`}>
                            {nodeTree(x, nodes).map(({ n, depth }) => {
                              const candidates = x.component_nodes.filter((p) => p.environment_id === e.id && p.id !== n.id);
                              return (
                                <div key={n.id} className="node-chip" style={{ paddingLeft: depth * 14 }}>
                                  {depth > 0 && <span className="muted">↳ </span>}
                                  <span className={`dot status-${x.srv[n.server_id]?.status}`}>●</span> <Icon type="server" /> <code>{x.srv[n.server_id]?.hostname}</code>
                                  <span className="muted"> {ROLES[n.role]}{n.port && `:${n.port}`}</span>
                                  {!n.virtual && <select className="cell parent" value={n.parent_node_id ?? ''} title="Derrière (proxy, répartiteur…)" onChange={(ev) => save('PUT', `component_nodes/${n.id}`, { parent_node_id: ev.target.value ? Number(ev.target.value) : null })}>
                                    <option value="">sans parent</option>
                                    {candidates.map((p) => <option key={p.id} value={p.id}>derrière {x.srv[p.server_id]?.hostname} ({x.components.find((c) => c.id === p.component_id)?.name})</option>)}
                                  </select>}
                                  {n.virtual ? <span className="muted" title="Hérité de la brique du périmètre"> ⚙️ périmètre</span> : <DelButton title="Retirer" onClick={() => save('DELETE', `component_nodes/${n.id}`)} />}
                                </div>
                              );
                            })}
                            <div className="muted">{TOPO[topology]}{status && status !== 'up' && ` · ${status}`}</div>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </TableWrap>
            )}
            {!c.tech_brick_id && envs.length > 0 && servers.length > 0 && (
              <AddForm
                fields={[
                  { key: 'environment_id', number: true, label: 'Environnement', options: envs.map((e) => ({ value: e.id, label: e.name })) },
                  { key: 'server_id', number: true, label: 'Serveur', options: servers.map((s) => ({ value: s.id, label: s.hostname })) },
                  { key: 'role', label: 'Rôle', options: opts(ROLES).filter((o) => o.value) },
                  { key: 'port', label: 'Port' },
                ]}
                onSubmit={(v) => save('POST', 'component_nodes', { ...v, component_id: c.id })}
                label="Ajouter un serveur"
              />
            )}
          </div>
        );
      })}
      <AddForm
        fields={[
          { key: 'tech_brick_id', number: true, label: 'Brique du périmètre', options: [{ value: '', label: '— brique du périmètre —' }, ...catalog.map((t) => ({ value: t.id, label: t.name }))] },
          { key: 'name', label: 'Ou nouvelle brique (Web, BDD…)' },
          { key: 'kind', label: 'Type', options: opts(KINDS) },
          { key: 'technology', label: 'Technologie' },
        ]}
        onSubmit={(v) => save('POST', 'components', { ...v, application_id: appId })}
        label="Ajouter une brique"
      />
    </>
  );
}
