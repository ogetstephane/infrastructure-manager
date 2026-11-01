import React from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { useScope } from '../../scope.jsx';
import { AddForm, Card, DelButton, EditCell, Empty, Icon, ModeToggle, Section, useEditMode } from '../common';
import EnvironmentPills from './EnvironmentPills.jsx';
import PerimeterTechBricks from './PerimeterTechBricks.jsx';
import ApplicationBlock from '../application/ApplicationBlock.jsx';

// Carte périmètre commune aux vues Métier (lecture seule) et Dev (éditable).
// Bloc autonome : charge lui-même ses applications (/perimeters/:id/applications), éventuellement filtrées (recherche, criticité, tag).
export default function PerimeterCard({ perimeter, filters = {}, editable: initial = false, onTag }) {
  const { save } = useStore();
  const scope = useScope();
  const [editable, setEdit] = useEditMode(initial);
  const list = useQuery(`perimeters/${perimeter.id}/applications${qs({ id: scope.a, ...filters })}`).data ?? [];

  return (
    <Card
      wide={editable}
      title={<><Icon type="perimeter" /> {editable ? <EditCell value={perimeter.name} onSave={(v) => save('PUT', `perimeters/${perimeter.id}`, { name: v })} /> : perimeter.name} <EnvironmentPills perimeterId={perimeter.id} /></>}
      actions={<><ModeToggle edit={editable} onChange={setEdit} />{editable && <DelButton title="Supprimer le périmètre" onClick={() => save('DELETE', `perimeters/${perimeter.id}`)} />}</>}
    >
      {editable ? <EditCell value={perimeter.description} placeholder="Description" onSave={(v) => save('PUT', `perimeters/${perimeter.id}`, { description: v })} /> : perimeter.description && <p className="muted">{perimeter.description}</p>}
      {editable && (
        <Section title="Briques techniques du périmètre">
          <PerimeterTechBricks perimeterId={perimeter.id} />
        </Section>
      )}
      {list.map((a) => <ApplicationBlock key={a.id} id={a.id} editable={editable} onTag={onTag} />)}
      {!editable && !list.length && <Empty>Aucune application.</Empty>}
      {editable && (
        <AddForm
          fields={[{ key: 'name', label: 'Nouvelle application', required: true }, { key: 'description', label: 'Description' }]}
          onSubmit={(v) => save('POST', 'applications', { ...v, perimeter_id: perimeter.id })}
          label="Ajouter l'application"
        />
      )}
    </Card>
  );
}
