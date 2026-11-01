import React from 'react';
import { useStore } from '../../store.jsx';
import { Icon, AddForm, Card, DelButton } from '../common';

export default function DependencyList({ apps, selected, impacted }) {
  const { x, save } = useStore();
  const opts = apps.map((a) => ({ value: a.id, label: `${x.perim[a.perimeter_id]?.name} / ${a.name}` }));

  return (
    <Card title="Dépendances">
      {selected && (
        <p className="impact">
          {x.app[selected].name} : {impacted.size} application(s) impactée(s) en cas de panne
          {impacted.size > 0 && ` (${[...impacted].map((i) => x.app[i].name).join(', ')})`}.
        </p>
      )}
      {selected && (() => {
        const hit = [...new Set([selected, ...impacted].flatMap((a) => x.flows.filter((f) => f.application_id === a && f.direction === 'in').map((f) => x.external_services.find((e) => e.id === f.external_id)?.name)))].filter(Boolean);
        return hit.length > 0 && <p className="impact">Services externes touchés : {hit.join(', ')}.</p>;
      })()}
      <ul className="plain">
        {x.dependencies.map((d) => (
          <li key={d.id}>
            <Icon type="dependency" />{' '}
            <b>{x.app[d.from_app_id].name}</b> → <b>{x.app[d.to_app_id].name}</b>
            {d.description && <span className="muted"> — {d.description}</span>}{' '}
            <DelButton onClick={() => save('DELETE', `dependencies/${d.id}`)} />
          </li>
        ))}
      </ul>
      {apps.length > 1 && (
        <AddForm
          fields={[
            { key: 'from_app_id', number: true, label: 'Application', options: opts },
            { key: 'to_app_id', number: true, label: 'dépend de', options: opts.slice().reverse() },
            { key: 'description', label: 'Nature (API, base, fichiers…)' },
          ]}
          onSubmit={(v) => save('POST', 'dependencies', v)}
          label="Ajouter"
        />
      )}
    </Card>
  );
}
