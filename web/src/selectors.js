// Accès aux relations du modèle, partagés par les vues et les composants
export const appsOf = (x, perimeterId) => x.applications.filter((a) => a.perimeter_id === perimeterId);
export const envsOfPerimeter = (x, perimeterId) => x.environments.filter((e) => e.perimeter_id === perimeterId);
export const serversOfEnv = (x, envId) => x.environment_servers.filter((l) => l.environment_id === envId);

export const envLabel = (x, e) => `${x.perim[e.perimeter_id]?.name ?? '?'} / ${e.name}`;

export const hasServer = (x, env) => x.environment_servers.some((l) => l.environment_id === env.id);

export const componentsOfApp = (x, appId) => x.components.filter((c) => c.application_id === appId);
export const nodesOf = (x, componentId, envId) => x.component_nodes.filter((n) => n.component_id === componentId && n.environment_id === envId);
export const nodesOnServer = (x, serverId) => x.component_nodes.filter((n) => n.server_id === serverId);

// Un membre est injoignable si son serveur ou celui d'un de ses parents (proxy…) est en panne
const nodeStatus = (x, node) => {
  const seen = new Set();
  let own = x.srv[node.server_id]?.status;
  for (let n = node; n && !seen.has(n.id); n = x.component_nodes.find((p) => p.id === n.parent_node_id)) {
    seen.add(n.id);
    if (x.srv[n.server_id]?.status === 'down') return 'down';
  }
  return own;
};

// État d'une brique dans un environnement : none (0 membre) | single (1) | ha (≥ 2), et statut agrégé
export const componentState = (x, nodes) => {
  if (!nodes.length) return { topology: 'none', status: null };
  const st = nodes.map((n) => nodeStatus(x, n));
  const down = st.filter((s) => s === 'down').length;
  const bad = st.filter((s) => s !== 'up').length;
  return { topology: nodes.length > 1 ? 'ha' : 'single', status: down === nodes.length ? 'down' : bad ? 'degraded' : 'up' };
};

// Membres d'un environnement rangés en arbre (parent avant fils) avec leur profondeur
export const nodeTree = (x, nodes, allNodes = x.component_nodes) => {
  const ids = new Set(nodes.map((n) => n.id));
  const out = [];
  const walk = (n, depth, seen) => {
    out.push({ n, depth });
    for (const c of nodes.filter((c) => c.parent_node_id === n.id && !seen.has(c.id))) walk(c, depth + 1, new Set([...seen, c.id]));
  };
  const roots = nodes.filter((n) => !ids.has(n.parent_node_id));
  roots.forEach((n) => walk(n, 0, new Set([n.id])));
  return out;
};
export const parentOf = (x, node) => x.component_nodes.find((p) => p.id === node.parent_node_id);

// Tags distincts présents sur une liste d'enregistrements
export const allTags = (...lists) => [...new Set(lists.flat().flatMap((r) => (r.tags ? r.tags.split(',') : [])))].sort();

export const flowsOfApp = (x, appId) => x.flows.filter((f) => f.application_id === appId);
export const flowsOnServer = (x, serverId) => x.flows.filter((f) => f.server_id === serverId);
export const flowsOfExternal = (x, extId) => x.flows.filter((f) => f.external_id === extId);

// Éléments couverts par le périmètre de navigation { p, a, e } (fil d'Ariane)
export const scopeApps = (x, s) => x.applications.filter((a) => (!s.p || a.perimeter_id === s.p) && (!s.a || a.id === s.a));
export const scopeEnvs = (x, s) => {
  const perims = new Set(scopeApps(x, s).map((a) => a.perimeter_id));
  if (s.p) perims.add(s.p);
  return x.environments.filter((e) => perims.has(e.perimeter_id) && (!s.e || e.id === s.e));
};
export const scopeServers = (x, s) => {
  if (!s.p && !s.a && !s.e) return x.servers;
  if (s.a) {
    const comps = new Set(x.components.filter((c) => c.application_id === s.a).map((c) => c.id));
    const ids = new Set(x.component_nodes.filter((n) => comps.has(n.component_id) && (!s.e || n.environment_id === s.e)).map((n) => n.server_id));
    return x.servers.filter((sv) => ids.has(sv.id));
  }
  const envs = new Set(scopeEnvs(x, s).map((e) => e.id));
  const ids = new Set(x.environment_servers.filter((l) => envs.has(l.environment_id)).map((l) => l.server_id));
  return x.servers.filter((sv) => ids.has(sv.id));
};
