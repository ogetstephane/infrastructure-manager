import { useMemo } from 'react';

// Parcours transitif (adj: id -> ids)
const reach = (start, adj) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    for (const n of adj[stack.pop()] ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
  }
  return seen;
};

// Pour une application sélectionnée : ce qui est impacté si elle tombe, et ce dont elle dépend
export function useImpact(dependencies, selected) {
  return useMemo(() => {
    const out = {};
    const inn = {};
    for (const d of dependencies) {
      (out[d.from_app_id] ??= []).push(d.to_app_id);
      (inn[d.to_app_id] ??= []).push(d.from_app_id);
    }
    return selected
      ? { impacted: reach(selected, inn), uses: reach(selected, out) }
      : { impacted: new Set(), uses: new Set() };
  }, [dependencies, selected]);
}
