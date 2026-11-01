import React from 'react';
import { Slice, useStore } from '../store.jsx';
import { qs } from '../query.js';
import { componentState, envLabel, hasServer, nodesOf, scopeApps, scopeEnvs, scopeServers } from '../selectors.js';
import { useScope } from '../scope.jsx';
import { Badge, Kpi, ListCard } from '../components/common';

export default function Ops() {
  const scope = useScope();
  return (
    <Slice path={`bundle${qs({ perimeter_id: scope.p, application_id: scope.a, environment_id: scope.e })}`}>
      <OpsBoard />
    </Slice>
  );
}

function OpsBoard() {
  const { x } = useStore();
  const scope = useScope();
  const envs = scopeEnvs(x, scope);
  const appIds = new Set(scopeApps(x, scope).map((a) => a.id));

  const badServers = scopeServers(x, scope).filter((s) => s.status !== 'up');
  const noServer = envs.filter((e) => !hasServer(x, e));
  const compIssues = [];
  for (const c of x.components.filter((c) => appIds.has(c.application_id))) {
    for (const e of envs.filter((e) => e.perimeter_id === x.app[c.application_id].perimeter_id)) {
      const nodes = nodesOf(x, c.id, e.id);
      const { topology, status } = componentState(x, nodes);
      const label = `${x.app[c.application_id].name} / ${c.name} @ ${e.name}`;
      if (topology === 'none') compIssues.push({ key: `c0${c.id}:${e.id}`, content: `${label} : aucun serveur` });
      else if (topology === 'single' && /prod/i.test(e.name)) compIssues.push({ key: `c1${c.id}:${e.id}`, content: `${label} : brique non redondante` });
      if (status && status !== 'up') compIssues.push({ key: `cs${c.id}:${e.id}`, content: <>{label} : <Badge status={status} /></> });
    }
  }
  // briques du périmètre non référencées par une brique d'application (les autres sont couvertes ci-dessus)
  for (const t of x.tech_bricks.filter((t) => !x.components.some((c) => c.tech_brick_id === t.id))) {
    for (const e of envs.filter((e) => e.perimeter_id === t.perimeter_id)) {
      const nodes = x.tech_brick_nodes.filter((n) => n.tech_brick_id === t.id && n.environment_id === e.id);
      const { topology, status } = componentState({ ...x, component_nodes: x.tech_brick_nodes }, nodes);
      const label = `${x.perim[t.perimeter_id]?.name} / ${t.name} @ ${e.name}`;
      if (topology === 'none') compIssues.push({ key: `t0${t.id}:${e.id}`, content: `${label} : aucun serveur` });
      else if (topology === 'single' && /prod/i.test(e.name)) compIssues.push({ key: `t1${t.id}:${e.id}`, content: `${label} : brique non redondante` });
      if (status && status !== 'up') compIssues.push({ key: `ts${t.id}:${e.id}`, content: <>{label} : <Badge status={status} /></> });
    }
  }
  const hygiene = [
    ...noServer.map((e) => ({ key: `s${e.id}`, content: `${envLabel(x, e)} : aucun serveur associé` })),
  ];

  return (
    <>
      <div className="kpis">
        <Kpi tone="up" value={envs.length} label="environnement(s)" />
        <Kpi tone={badServers.length ? 'down' : 'up'} value={badServers.length} label="serveur(s) en anomalie" />
      </div>
      <div className="grid">
        <ListCard title="Serveurs en anomalie" items={badServers.map((s) => ({ key: s.id, content: <>{s.hostname} <Badge status={s.status} /></> }))} />
        <ListCard title="Briques techniques" empty="RAS." items={compIssues} />
        <ListCard title="Hygiène des données" empty="RAS." items={hygiene} />
      </div>
    </>
  );
}
