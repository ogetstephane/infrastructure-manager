import React from 'react';
import { useStore } from '../store.jsx';
import { qs, useQuery } from '../query.js';
import { useScope } from '../scope.jsx';
import { AddForm, Empty, ListCard } from '../components/common';
import ServerCard from '../components/server/ServerCard.jsx';

export default function Infra() {
  const { save } = useStore();
  const scope = useScope();
  const servers = useQuery(`servers${qs({ perimeter_id: scope.p, application_id: scope.a, environment_id: scope.e })}`).data ?? [];
  const unhosted = useQuery(`environments${qs({ without_server: 1, perimeter_id: scope.p, id: scope.e })}`).data ?? [];

  return (
    <>
      <AddForm
        fields={[{ key: 'hostname', label: 'Hostname', required: true }, { key: 'ip', label: 'IP' }, { key: 'os', label: 'OS' }, { key: 'role', label: 'Rôle (web, bdd…)' }, { key: 'location', label: 'Localisation' }]}
        onSubmit={(v) => save('POST', 'servers', v)}
        label="Ajouter un serveur"
      />
      {servers.length === 0 && <Empty>Aucun serveur.</Empty>}
      <div className="grid">{servers.map((s) => <ServerCard key={s.id} id={s.id} />)}</div>
      {unhosted.length > 0 && (
        <ListCard wide title="Environnements sans serveur" items={unhosted.map((e) => ({ key: e.id, content: e.label }))} />
      )}
    </>
  );
}
