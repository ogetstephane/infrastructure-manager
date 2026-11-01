import { useMemo } from 'react';

const depDel = (x, d) => ({ label: `${x.app[d.from_app_id].name} → ${x.app[d.to_app_id].name}`, method: 'DELETE', url: `dependencies/${d.id}` });
const flowDel = (x, f) => ({ label: `${x.app[f.application_id]?.name} ${f.direction === 'in' ? '←' : '→'} ${x.external_services.find((s) => s.id === f.external_id)?.name}${f.environment_id ? ` (${x.env[f.environment_id]?.name})` : ''}`, method: 'DELETE', url: `flows/${f.id}` });
const extName = (x, id) => x.external_services.find((s) => s.id === id)?.name ?? '?';

// Construit les nœuds et arêtes selon le niveau de zoom :
// path = [] (périmètres) | [{ t:'perimeter', id }] (applications) | [..., { t:'app', id }] (détail d'une application)
// node : { id, label, kind, color?, enter? }  edge : { id, from, to, kind: 'dep'|'flow'|'link'|'route', title, count?, del? }
// del : actions de suppression du lien [{ label, method, url, body? }] (absent = lien non supprimable)
export function useGraphModel(x, path, envFilter = null) {
  return useMemo(() => {
    const last = path[path.length - 1];
    const nodes = new Map();
    const edges = [];
    const addNode = (n) => nodes.set(n.id, { ...nodes.get(n.id), ...n });
    const addExternals = (appIds, appNodeId = (a) => `a${a}`) => {
      for (const f of x.flows.filter((f) => appIds.has(f.application_id))) {
        addNode({ id: `x${f.external_id}`, label: extName(x, f.external_id), kind: 'ext' });
        const app = appNodeId(f.application_id);
        edges.push({
          id: `f${f.id}`, kind: 'flow',
          from: f.direction === 'in' ? `x${f.external_id}` : app,
          to: f.direction === 'in' ? app : `x${f.external_id}`,
          title: [x.env[f.environment_id]?.name, f.protocol, f.frequency, f.url, f.description].filter(Boolean).join(' · '),
          del: [flowDel(x, f)],
        });
      }
    };

    if (!last) {
      const pOf = (a) => x.app[a].perimeter_id;
      x.perimeters.forEach((p, i) => addNode({ id: `p${p.id}`, label: p.name, kind: 'perimeter', color: i, enter: true }));
      const agg = new Map();
      for (const d of x.dependencies) {
        const a = pOf(d.from_app_id);
        const b = pOf(d.to_app_id);
        if (a === b) continue;
        const k = `${a}>${b}`;
        const e = agg.get(k) ?? { id: `d${k}`, kind: 'dep', from: `p${a}`, to: `p${b}`, count: 0, items: [], del: [] };
        e.count++;
        e.items.push(`${x.app[d.from_app_id].name} → ${x.app[d.to_app_id].name}`);
        e.del.push(depDel(x, d));
        agg.set(k, e);
      }
      for (const e of agg.values()) edges.push({ ...e, title: e.items.join('\n') });
      const ids = new Set(x.applications.map((a) => a.id));
      // un service externe relie les périmètres via les applications qui l'utilisent
      for (const f of x.flows.filter((f) => ids.has(f.application_id))) {
        addNode({ id: `x${f.external_id}`, label: extName(x, f.external_id), kind: 'ext' });
        const p = `p${pOf(f.application_id)}`;
        const [from, to] = f.direction === 'in' ? [`x${f.external_id}`, p] : [p, `x${f.external_id}`];
        {
          const e = edges.find((e) => e.kind === 'flow' && e.from === from && e.to === to);
          if (e) e.del.push(flowDel(x, f));
          else edges.push({ id: `f${from}${to}`, kind: 'flow', from, to, title: '', del: [flowDel(x, f)] });
        }
      }
    } else if (last.t === 'perimeter') {
      const inside = x.applications.filter((a) => a.perimeter_id === last.id);
      const insideIds = new Set(inside.map((a) => a.id));
      inside.forEach((a) => addNode({ id: `a${a.id}`, label: a.name, kind: 'app', color: x.perimeters.findIndex((p) => p.id === a.perimeter_id), enter: true, criticality: a.criticality }));
      for (const d of x.dependencies) {
        if (!insideIds.has(d.from_app_id) && !insideIds.has(d.to_app_id)) continue;
        for (const id of [d.from_app_id, d.to_app_id]) {
          if (!insideIds.has(id)) {
            const a = x.app[id];
            addNode({ id: `a${id}`, label: `${x.perim[a.perimeter_id]?.name} / ${a.name}`, kind: 'app', color: x.perimeters.findIndex((p) => p.id === a.perimeter_id), outside: true, enter: true });
          }
        }
        edges.push({ id: `d${d.id}`, kind: 'dep', from: `a${d.from_app_id}`, to: `a${d.to_app_id}`, title: d.description, del: [depDel(x, d)] });
      }
      addExternals(insideIds);
    } else {
      const a = x.app[last.id];
      const color = x.perimeters.findIndex((p) => p.id === a.perimeter_id);
      addNode({ id: `a${a.id}`, label: a.name, kind: 'app', color, center: true });
      // briques → serveurs ; envFilter restreint les serveurs à un environnement
      const components = x.components.filter((c) => c.application_id === a.id);
      for (const c of components) {
        addNode({ id: `c${c.id}`, label: c.technology ? `${c.name} (${c.technology})` : c.name, kind: 'component', ckind: c.kind, col: 2 });
        edges.push({ id: `ac${c.id}`, kind: 'link', from: `a${a.id}`, to: `c${c.id}` });
        const bySrv = new Map();
        for (const n of x.component_nodes.filter((n) => n.component_id === c.id && (!envFilter || n.environment_id === envFilter))) {
          (bySrv.get(n.server_id) ?? bySrv.set(n.server_id, []).get(n.server_id)).push(n);
        }
        for (const [sid, ns] of bySrv) {
          addNode({ id: `s${sid}`, label: x.srv[sid].hostname, kind: 'server', status: x.srv[sid].status, col: 3 });
          edges.push({ id: `cs${c.id}-${sid}`, kind: 'link', from: `c${c.id}`, to: `s${sid}`, title: ns.map((n) => `${x.env[n.environment_id].name} · ${n.role || 'node'}`).join('\n'),
            del: ns.map((n) => ({ label: `${c.name} sur ${x.srv[sid].hostname} (${x.env[n.environment_id].name})`, method: 'DELETE', url: n.virtual ? `tech_brick_nodes/${n.tech_node_id}` : `component_nodes/${n.id}` })) });
        }
      }
      // hiérarchie proxy → fils entre serveurs
      for (const n of x.component_nodes) {
        const parent = x.component_nodes.find((p) => p.id === n.parent_node_id);
        const c = x.components.find((c) => c.id === n.component_id);
        if (!parent || c?.application_id !== a.id || (envFilter && n.environment_id !== envFilter) || parent.server_id === n.server_id) continue;
        edges.push({ id: `rt${n.id}`, kind: 'route', from: `s${parent.server_id}`, to: `s${n.server_id}`, title: `${x.env[n.environment_id].name} : ${x.srv[parent.server_id].hostname} → ${x.srv[n.server_id].hostname}`,
          del: [{ label: `${x.srv[parent.server_id].hostname} → ${x.srv[n.server_id].hostname} (${x.env[n.environment_id].name})`, method: 'PUT', url: n.virtual ? `tech_brick_nodes/${n.tech_node_id}` : `component_nodes/${n.id}`, body: { parent_node_id: null } }] });
      }
      for (const d of x.dependencies.filter((d) => d.from_app_id === a.id || d.to_app_id === a.id)) {
        const other = d.from_app_id === a.id ? d.to_app_id : d.from_app_id;
        addNode({ id: `a${other}`, label: x.app[other].name, kind: 'app', color: x.perimeters.findIndex((p) => p.id === x.app[other].perimeter_id), col: 0, enter: true });
        edges.push({ id: `d${d.id}`, kind: 'dep', from: `a${d.from_app_id}`, to: `a${d.to_app_id}`, title: d.description, del: [depDel(x, d)] });
      }
      addExternals(new Set([a.id]));
      for (const n of nodes.values()) if (n.kind === 'ext') n.col = 4;
    }
    return { nodes: [...nodes.values()], edges };
  }, [x, path, envFilter]);
}
