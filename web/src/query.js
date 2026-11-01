import { useEffect, useReducer, useRef } from 'react';
import { api } from './api.js';

// Cache de requêtes REST : une entrée par URL, gardée uniquement tant qu'un bloc l'affiche.
// Après une modification, toutes les requêtes affichées sont relues (les données restent visibles pendant la relecture).
const entries = new Map();

const entry = (path) => {
  if (!entries.has(path)) entries.set(path, { data: undefined, error: null, subs: new Set(), seq: 0 });
  return entries.get(path);
};

const load = async (path) => {
  const e = entry(path);
  const seq = ++e.seq;
  try {
    const data = await api('GET', path);
    if (seq === e.seq) Object.assign(e, { data, error: null });
  } catch (err) {
    if (seq === e.seq) Object.assign(e, { data: err.status === 404 ? null : e.data, error: err });
  }
  if (seq === e.seq) e.subs.forEach((f) => f());
};

export const invalidate = () => Promise.all([...entries].filter(([, e]) => e.subs.size).map(([path]) => load(path)));

export function useQuery(path) {
  const [, tick] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!path) return undefined;
    const e = entry(path);
    e.subs.add(tick);
    load(path);
    return () => {
      e.subs.delete(tick);
      if (!e.subs.size) entries.delete(path);
    };
  }, [path]);
  const e = path ? entry(path) : null;
  // pendant le chargement d'une nouvelle URL (filtre modifié…), on garde l'affichage précédent
  const prev = useRef();
  if (e?.data !== undefined) prev.current = e.data;
  if (!path) prev.current = undefined;
  return { data: e?.data !== undefined ? e.data : prev.current, loading: !!e && e.data === undefined, error: e?.error ?? null };
}

export const qs = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};
