import React, { useMemo, useState } from 'react';
import { Slice, useStore } from '../store.jsx';
import { Card, Empty } from '../components/common';
import DependencyGraph from '../components/deps/DependencyGraph.jsx';
import DependencyList from '../components/deps/DependencyList.jsx';
import { ExternalServicesCard } from '../components/external';
import { useImpact } from '../components/deps/useImpact.js';
import { useGraphModel } from '../components/deps/useGraphModel.js';
import { useScope } from '../scope.jsx';

const EMPTY = new Set();

// Le graphe a besoin de tout le SI : il charge l'ensemble (/bundle) une fois affiché, pas avant
export default function Deps() {
  return (
    <>
      <Slice path="bundle" fallback={<p className="muted">Chargement…</p>}>
        <DepsGraph />
      </Slice>
      <ExternalServicesCard />
    </>
  );
}

function DepsGraph() {
  const { x, save } = useStore();
  const scope = useScope();
  // le niveau de zoom du graphe suit le fil d'Ariane : tout → périmètre → application
  const path = useMemo(() => [...(scope.p ? [{ t: 'perimeter', id: scope.p }] : []), ...(scope.a ? [{ t: 'app', id: scope.a }] : [])], [scope.p, scope.a]);
  const [sel, setSel] = useState(null);
  const envId = scope.e;
  const [selEdge, setSelEdge] = useState(null);
  const model = useGraphModel(x, path, path[1] ? envId : null);
  const level = path.length; // 0 périmètres, 1 applications, 2 détail d'une application
  const selApp = sel?.startsWith('a') ? Number(sel.slice(1)) : null;

  const appImpact = useImpact(x.dependencies, level ? selApp : null);
  const perimImpact = useImpact(
    useMemo(() => model.edges.filter((e) => e.kind === 'dep').map((e) => ({ from_app_id: e.from, to_app_id: e.to })), [model]),
    level === 0 ? sel : null,
  );
  const { impacted, uses } = useMemo(() => {
    if (level === 0) return perimImpact;
    const ids = (s) => new Set([...s].map((i) => `a${i}`));
    return { impacted: ids(appImpact.impacted), uses: ids(appImpact.uses) };
  }, [level, perimImpact, appImpact]);

  const apps = useMemo(() => [...x.applications].sort((a, b) => a.perimeter_id - b.perimeter_id || a.id - b.id), [x.applications]);

  const go = (p) => {
    setSel(null);
    setSelEdge(null);
    scope.setScope({ p: p[0]?.id ?? null, a: p[1]?.id ?? null });
  };
  const pickNode = (id) => (setSel(id), id && setSelEdge(null));
  const pickEdge = (id) => (setSelEdge(id), id && setSel(null));
  const enter = (n) => {
    if (n.kind === 'perimeter') go([{ t: 'perimeter', id: Number(n.id.slice(1)) }]);
    else if (n.kind === 'app') {
      const id = Number(n.id.slice(1));
      go([{ t: 'perimeter', id: x.app[id].perimeter_id }, { t: 'app', id }]);
    }
  };
  const edge = model.edges.find((e) => e.id === selEdge);
  const removeLink = async (action) => {
    if (!window.confirm(`Supprimer le lien « ${action.label} » ?`)) return;
    await save(action.method, action.url, action.body);
    setSelEdge(null);
  };
  const selNode = model.nodes.find((n) => n.id === sel);
  const hint = ['Double-cliquez un périmètre pour voir ses applications.', 'Double-cliquez une application pour voir ses briques techniques, serveurs et flux.', 'Vue détaillée : application → briques → serveurs (filtrable par environnement).'][level];

  if (!x.perimeters.length) return <Empty>Créez des périmètres et des applications (vue Dev) pour décrire leurs dépendances.</Empty>;

  return (
    <>
      <div className="split">
        <Card className="graph">
          <div className="crumbs">
            {level > 0 && <button className="icon" onClick={() => go(path.slice(0, -1))}>↑ Remonter</button>}
            {selNode?.enter && <button onClick={() => enter(selNode)}>Entrer dans {selNode.label} ↓</button>}
          </div>
          {model.nodes.length ? (
            <DependencyGraph model={model} mode={level === 2 ? 'detail' : 'circle'} layoutKey={`${path.map((s) => s.t[0] + s.id).join('/')}|${path[1] ? envId ?? '' : ''}`} selected={sel} onSelect={pickNode} selectedEdge={selEdge} onSelectEdge={pickEdge} onEnter={enter} impacted={impacted} uses={uses} />
          ) : (
            <Empty>Rien à afficher à ce niveau.</Empty>
          )}
          <p className="muted">
            {hint} Une flèche A → B signifie « A dépend de B ». Carrés gris : serveurs ou services externes (flux en pointillés). Cliquez un nœud : en rouge, ce qui est impacté s'il tombe ; en bleu, ce dont il dépend.
          </p>
        </Card>
        {edge?.del?.length ? (
          <Card title="🔗 Lien sélectionné">
            <ul className="plain">
              {edge.del.map((a) => (
                <li key={a.url}>{a.label} <button className="danger" onClick={() => removeLink(a)}>{a.method === 'PUT' ? 'Détacher' : 'Supprimer'}</button></li>
              ))}
            </ul>
            <p className="muted">Cliquez un lien du graphe pour le sélectionner.</p>
          </Card>
        ) : level === 0 && sel ? (
          <Card title="Impact">
            <p className="impact">
              {selNode?.label} : {impacted.size} périmètre(s) impacté(s) en cas de panne
              {impacted.size > 0 && ` (${[...impacted].map((i) => x.perim[Number(i.slice(1))]?.name).join(', ')})`}.
            </p>
          </Card>
        ) : (
          <DependencyList apps={apps} selected={level ? selApp : null} impacted={new Set([...appImpact.impacted])} />
        )}
      </div>
    </>
  );
}
