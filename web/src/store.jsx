import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from './api.js';
import { invalidate, useQuery } from './query.js';

const ActionsCtx = createContext(null);
const SliceCtx = createContext(null);

// Écritures et erreurs : communes à toute l'application (aucune donnée métier n'est conservée ici)
export function StoreProvider({ children }) {
  const [error, setError] = useState('');
  const save = useCallback(async (method, path, body) => {
    let ok = true;
    try {
      await api(method, path, body);
      setError('');
    } catch (e) {
      setError(e.message);
      ok = false;
    }
    await invalidate();
    return ok;
  }, []);
  const value = useMemo(() => ({ save, error, setError }), [save, error]);
  return <ActionsCtx.Provider value={value}>{children}</ActionsCtx.Provider>;
}

const by = (...lists) => Object.fromEntries(lists.flat().map((r) => [r.id, r]));

// Un « bundle » est la lecture agrégée d'une ressource ; x en reprend le format avec des index par id
// Une brique d'application rattachée à une brique du périmètre hérite de ses membres (nœuds « virtuels », en lecture seule)
const withInheritedNodes = (data) => {
  const tnodes = data.tech_brick_nodes ?? [];
  const virtual = [];
  for (const c of data.components) {
    if (!c.tech_brick_id) continue;
    for (const n of tnodes.filter((t) => t.tech_brick_id === c.tech_brick_id)) {
      virtual.push({ ...n, id: `t${n.id}`, tech_node_id: n.id, component_id: c.id, parent_node_id: n.parent_node_id ? `t${n.parent_node_id}` : null, virtual: true });
    }
  }
  return [...data.component_nodes, ...virtual];
};

const buildX = (data) => {
  const refs = data.refs ?? {};
  return {
    ...data,
    tech_bricks: data.tech_bricks ?? [],
    tech_brick_nodes: data.tech_brick_nodes ?? [],
    component_nodes: withInheritedNodes(data),
    perim: by(data.perimeters, refs.perimeters ?? []),
    app: by(data.applications, refs.applications ?? []),
    env: by(data.environments, refs.environments ?? []),
    srv: by(data.servers, refs.servers ?? []),
  };
};

// Bloc autonome : charge la ressource `path` (ex. applications/3/bundle) et la fournit à ses enfants
export function Slice({ path, children, fallback = null }) {
  const { data } = useQuery(path);
  const x = useMemo(() => (data ? buildX(data) : null), [data]);
  return x ? <SliceCtx.Provider value={x}>{children}</SliceCtx.Provider> : fallback;
}

export const useStore = () => ({ ...useContext(ActionsCtx), x: useContext(SliceCtx) });
