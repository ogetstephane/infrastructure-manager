import React from 'react';
import { useStore } from '../store.jsx';
import { qs, useQuery } from '../query.js';
import { AddForm } from '../components/common';
import { useScope } from '../scope.jsx';
import PerimeterCard from '../components/perimeter/PerimeterCard.jsx';

export default function Dev() {
  const { save } = useStore();
  const scope = useScope();
  const perimeters = useQuery(`perimeters${qs({ id: scope.p })}`).data ?? [];
  return (
    <>
      <AddForm
        fields={[{ key: 'name', label: 'Nouveau périmètre', required: true }, { key: 'description', label: 'Description' }]}
        onSubmit={(v) => save('POST', 'perimeters', v)}
        label="Créer le périmètre"
      />
      {perimeters.map((p) => <PerimeterCard key={p.id} perimeter={p} editable />)}
    </>
  );
}
