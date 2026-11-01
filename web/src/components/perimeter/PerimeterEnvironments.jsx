import React from 'react';
import { useStore } from '../../store.jsx';
import { qs, useQuery } from '../../query.js';
import { AddForm, DelButton, EditCell, EditModeProvider, Icon, ModeToggle, useEditMode } from '../common';

// Bloc autonome : environnements existants d'un périmètre (CRUD sur /environments?perimeter_id=…)
export default function PerimeterEnvironments({ perimeterId, editable: initial = false }) {
  const { save } = useStore();
  const [editable, setEdit] = useEditMode(initial);
  const list = useQuery(`environments${qs({ perimeter_id: perimeterId })}`).data ?? [];
  const upd = (id, key) => (value) => save('PUT', `environments/${id}`, { [key]: value });

  if (!editable && !list.length && !initial) return null;
  return (
    <EditModeProvider value={editable}>
      <div className="row">
        <h4><Icon type="environment" /> Environnements du périmètre</h4>
        <ModeToggle edit={editable} onChange={setEdit} />
      </div>
      {editable ? (
        <>
          {list.map((e) => (
            <div key={e.id} className="row">
              <span>
                <Icon type="environment" of={e.name} /> <EditCell value={e.name} onSave={upd(e.id, 'name')} />
              </span>
              <DelButton title="Supprimer l'environnement" onClick={() => save('DELETE', `environments/${e.id}`)} />
            </div>
          ))}
          <AddForm
            fields={[{ key: 'name', label: 'Nom (dev, recette, prod…)', required: true }]}
            onSubmit={(v) => save('POST', 'environments', { ...v, perimeter_id: perimeterId })}
            label="Ajouter l'environnement"
          />
        </>
      ) : (
        <div className="envs">
          {list.length ? list.map((e) => <span key={e.id} className="tag"><Icon type="environment" of={e.name} /> {e.name}</span>) : <span className="muted">Aucun environnement défini</span>}
        </div>
      )}
    </EditModeProvider>
  );
}
