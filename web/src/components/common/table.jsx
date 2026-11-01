import React, { useMemo, useState } from 'react';

// Tri d'une liste d'objets. keys: { colonne: (row) => valeur }
export function useSort(rows, keys, initial) {
  const [sort, setSort] = useState(initial ?? null);
  const sorted = useMemo(() => {
    if (!sort || !keys[sort.key]) return rows;
    const get = keys[sort.key];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => dir * String(get(a) ?? '').localeCompare(String(get(b) ?? ''), 'fr', { numeric: true, sensitivity: 'base' }));
  }, [rows, sort, keys]);
  const toggle = (key) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sorted, sort, toggle };
}

export function SortTh({ id, sort, toggle, children }) {
  const active = sort?.key === id;
  return (
    <th className="sortable" onClick={() => toggle(id)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {children}
      <span className="arrow-sort">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </th>
  );
}

// Fait défiler horizontalement les tables larges sur mobile
export function TableWrap({ children }) {
  return <div className="tablewrap">{children}</div>;
}
