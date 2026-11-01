import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { qs, useQuery } from './query.js';

// Périmètre de navigation commun à toutes les vues : #vue?p=<périmètre>&a=<application>&e=<environnement>
export const parseHash = () => {
  const [path, query = ''] = location.hash.slice(1).split('?');
  const [view, legacy] = path.split('/'); // ancien format #metier/<périmètre>
  const q = new URLSearchParams(query);
  const num = (k) => Number(q.get(k)) || null;
  return { view: view || 'metier', raw: { p: num('p') ?? (Number(legacy) || null), a: num('a'), e: num('e') } };
};

export const hashFor = (view, s) => {
  const q = new URLSearchParams();
  for (const k of ['p', 'a', 'e']) if (s[k]) q.set(k, s[k]);
  const str = q.toString();
  return `#${view}${str ? `?${str}` : ''}`;
};

const ScopeContext = createContext(null);

export function ScopeProvider({ children }) {
  const [h, setH] = useState(parseHash);
  useEffect(() => {
    const on = () => setH(parseHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  // Le serveur écarte les identifiants inconnus ou incohérents (application hors du périmètre choisi…)
  const { data } = useQuery(`scope${qs({ perimeter_id: h.raw.p, application_id: h.raw.a, environment_id: h.raw.e })}`);
  const last = useRef(null);
  if (data) last.current = { p: data.perimeter_id, a: data.application_id, e: data.environment_id };
  const scope = last.current;

  // next = { p, a, e } complet : choisir un niveau efface les niveaux inférieurs
  const setScope = useCallback((next) => { location.hash = hashFor(h.view, next); }, [h.view]);

  const value = useMemo(() => scope && { ...scope, view: h.view, setScope }, [scope, h.view, setScope]);
  return value ? <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider> : null;
}

export const useScope = () => useContext(ScopeContext);
