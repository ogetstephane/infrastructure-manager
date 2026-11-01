import React, { useState } from 'react';
import { useScope } from '../scope.jsx';
import { qs, useQuery } from '../query.js';
import { CRITICALITY_OPTIONS, Empty, TagList } from '../components/common';
import PerimeterCard from '../components/perimeter/PerimeterCard.jsx';

export default function Business() {
  const scope = useScope();
  const [q, setQ] = useState('');
  const [crit, setCrit] = useState('');
  const [tag, setTag] = useState('');
  const toggleTag = (t) => setTag(tag === t ? '' : t);
  const filters = { q, criticality: crit, tag };
  const filtering = q || crit || tag;
  const tags = useQuery('tags').data ?? [];
  const { data: perimeters, loading } = useQuery(`perimeters${qs({ id: scope.p, ...filters })}`);

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Rechercher un périmètre, une application, un tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={crit} onChange={(e) => setCrit(e.target.value)} title="Criticité">
          <option value="">Toutes criticités</option>
          {CRITICALITY_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filtering && <button className="icon" onClick={() => (setQ(''), setCrit(''), setTag(''))}>Réinitialiser</button>}
        {tags.length > 0 && <TagList tags={tags} active={tag} onClick={toggleTag} />}
      </div>
      {!loading && perimeters?.length === 0 && <Empty>{filtering ? 'Aucun résultat.' : 'Aucun périmètre. Créez-en dans la vue Dev.'}</Empty>}
      <div className={scope.p ? 'single' : 'grid'}>
        {(perimeters ?? []).map((p) => <PerimeterCard key={p.id} perimeter={p} filters={filters} onTag={toggleTag} />)}
      </div>
    </>
  );
}
