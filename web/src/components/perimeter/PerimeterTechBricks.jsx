import React from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { componentState, nodeTree } from '../../selectors.js';
import { Icon, AddForm, DelButton, EditCell, Empty, TableWrap } from '../common';
import { KINDS, ROLES } from '../application/ComponentsPanel.jsx';

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const TOPO = { none: 'non déployée', single: 'simple', ha: 'HA' };

// Bloc autonome : briques techniques du périmètre, avec leurs serveurs par environnement (/tech_bricks, /tech_brick_nodes, /environments)
export default function PerimeterTechBricks({ perimeterId }) {
  const { save } = useStore();
  const q = qs({ perimeter_id: perimeterId });
  const bricks = useQuery(`tech_bricks${q}`).data ?? [];
  const nodes = useQuery(`tech_brick_nodes${q}`).data ?? [];
  const envs = useQuery(`environments${q}`).data ?? [];
  const servers = useQuery('servers').data ?? [];
  const x = { srv: Object.fromEntries(servers.map((s) => [s.id, s])), component_nodes: nodes };
  const u = (b, key) => (value) => save('PUT', `tech_bricks/${b.id}`, { [key]: value });

  return (
    <>
      {bricks.length === 0 && <Empty>Aucune brique technique (web, BDD, cache…).</Empty>}
      {bricks.map((b) => (
        <div key={b.id} className="component">
          <div className="row">
            <span className="compname">
              <Icon type="component" of={b.kind} />
              <EditCell value={b.name} onSave={u(b, 'name')} />
              <select className="cell" value={b.kind} onChange={(e) => u(b, 'kind')(e.target.value)}>
                {opts(KINDS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <EditCell value={b.technology} onSave={u(b, 'technology')} placeholder="Techno (Galera, HAProxy+Nginx…)" />
            </span>
            <DelButton title="Supprimer la brique" onClick={() => save('DELETE', `tech_bricks/${b.id}`)} />
          </div>
          {envs.length > 0 && (
            <TableWrap>
              <table className="matrix">
                <thead><tr>{envs.map((e) => <th key={e.id}>{e.name}</th>)}</tr></thead>
                <tbody>
                  <tr>
                    {envs.map((e) => {
                      const mine = nodes.filter((n) => n.tech_brick_id === b.id && n.environment_id === e.id);
                      const { topology, status } = componentState(x, mine);
                      return (
                        <td key={e.id} className={`ver topo-${topology}`}>
                          {nodeTree(x, mine).map(({ n, depth }) => (
                            <div key={n.id} className="node-chip" style={{ paddingLeft: depth * 14 }}>
                              {depth > 0 && <span className="muted">↳ </span>}
                              <span className={`dot status-${x.srv[n.server_id]?.status}`}>●</span> <Icon type="server" /> <code>{x.srv[n.server_id]?.hostname}</code>
                              <span className="muted"> {ROLES[n.role]}{n.port && `:${n.port}`}</span>
                              <select className="cell parent" value={n.parent_node_id ?? ''} title="Derrière (proxy, répartiteur…)" onChange={(ev) => save('PUT', `tech_brick_nodes/${n.id}`, { parent_node_id: ev.target.value ? Number(ev.target.value) : null })}>
                                <option value="">sans parent</option>
                                {nodes.filter((p) => p.environment_id === e.id && p.id !== n.id).map((p) => <option key={p.id} value={p.id}>derrière {x.srv[p.server_id]?.hostname} ({bricks.find((t) => t.id === p.tech_brick_id)?.name})</option>)}
                              </select>
                              <DelButton title="Retirer" onClick={() => save('DELETE', `tech_brick_nodes/${n.id}`)} />
                            </div>
                          ))}
                          <div className="muted">{TOPO[topology]}{status && status !== 'up' && ` · ${status}`}</div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </TableWrap>
          )}
          {envs.length > 0 && servers.length > 0 && (
            <AddForm
              fields={[
                { key: 'environment_id', number: true, label: 'Environnement', options: envs.map((e) => ({ value: e.id, label: e.name })) },
                { key: 'server_id', number: true, label: 'Serveur', options: servers.map((s) => ({ value: s.id, label: s.hostname })) },
                { key: 'role', label: 'Rôle', options: opts(ROLES).filter((o) => o.value) },
                { key: 'port', label: 'Port' },
              ]}
              onSubmit={(v) => save('POST', 'tech_brick_nodes', { ...v, tech_brick_id: b.id })}
              label="Ajouter un serveur"
            />
          )}
        </div>
      ))}
      <AddForm
        fields={[{ key: 'name', label: 'Nouvelle brique (Web, BDD…)', required: true }, { key: 'kind', label: 'Type', options: opts(KINDS) }, { key: 'technology', label: 'Technologie' }]}
        onSubmit={(v) => save('POST', 'tech_bricks', { ...v, perimeter_id: perimeterId })}
        label="Ajouter une brique"
      />
    </>
  );
}
