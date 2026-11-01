import React from 'react';
import { useQuery } from '../../query.js';
import { useScope, hashFor } from '../../scope.jsx';
import Icon from './Icon.jsx';

// Fil d'Ariane hiérarchique commun à toutes les vues : chaque niveau est une liste déroulante de ses fils,
// chargée à la demande (/perimeters, /perimeters/:id/applications, /perimeters/:id/environments).
// L'environnement est un environnement du périmètre : il se choisit avec ou sans application.
// depth : 1 = périmètre, 2 = + application, 3 = + environnement
export default function Breadcrumb({ depth = 2, requirePerimeter = false }) {
  const s = useScope();
  const perimeters = useQuery('perimeters').data ?? [];
  const apps = useQuery(s.p && depth >= 2 ? `perimeters/${s.p}/applications` : null).data ?? [];
  const envs = useQuery(s.p && depth >= 3 ? `perimeters/${s.p}/environments` : null).data ?? [];
  const levels = [
    { key: 'p', type: 'perimeter', all: requirePerimeter ? 'Sélectionner un périmètre' : 'Tous les périmètres', value: s.p, items: perimeters, show: true },
    { key: 'a', type: 'app', all: 'Toutes les applications', value: s.a, items: apps, show: depth >= 2 && s.p },
    { key: 'e', type: 'environment', all: 'Tous les environnements', value: s.e, items: envs, show: depth >= 3 && s.p },
  ].filter((l) => l.show);
  const choose = (key, id) => {
    const v = id ? Number(id) : null;
    if (key === 'p') s.setScope({ p: v });
    if (key === 'a') s.setScope({ p: s.p, a: v, e: s.e });
    if (key === 'e') s.setScope({ p: s.p, a: s.a, e: v });
  };

  return (
    <nav className="breadcrumb" aria-label="Fil d'Ariane">
      {!requirePerimeter && <><a href={hashFor(s.view, {})} title="Tout afficher">🏠 Tout</a></>}
      {levels.map((l, i) => (
        <React.Fragment key={l.key}>
          {(i > 0 || !requirePerimeter) && <span className="muted">›</span>}
          <span className="crumbsel">
            <Icon type={l.type} of={l.key === 'e' ? l.items.find((i) => i.id === l.value)?.name : undefined} />
            <select value={l.value ?? ''} onChange={(e) => choose(l.key, e.target.value)} title={l.all}>
              <option value="" disabled={requirePerimeter && l.key === 'p'}>{l.all}</option>
              {l.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}
