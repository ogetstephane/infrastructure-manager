import React, { useState } from 'react';
import { Slice, useStore } from '../../store.jsx';
import { flowsOfExternal } from '../../selectors.js';
import { EditModeProvider, ModeToggle, Icon, AddForm, Card, CriticalitySelect, DelButton, EditCell, SortTh, TableWrap, useSort } from '../common';

const KEYS = { name: (s) => s.name, kind: (s) => s.kind, organization: (s) => s.organization, criticality: (s) => s.criticality };

// Tiers avec lesquels le SI échange (banque, administration, SaaS, partenaire, client…)
export default function ExternalServicesCard() {
  return (
    <Slice path="external_services/bundle">
      <ExternalServices />
    </Slice>
  );
}

function ExternalServices() {
  const { x, save } = useStore();
  const [edit, setEdit] = useState(false);
  const { sorted, sort, toggle } = useSort(x.external_services, KEYS);
  const u = (s, key) => (value) => save('PUT', `external_services/${s.id}`, { [key]: value });

  return (
    <Card title={<><Icon type="external" /> Services externes</>} actions={<ModeToggle edit={edit} onChange={setEdit} />}>
      <EditModeProvider value={edit}>
      {sorted.length > 0 && (
        <TableWrap>
          <table>
            <thead>
              <tr>
                <SortTh id="name" sort={sort} toggle={toggle}>Nom</SortTh>
                <SortTh id="kind" sort={sort} toggle={toggle}>Type</SortTh>
                <SortTh id="organization" sort={sort} toggle={toggle}>Organisation</SortTh>
                <th>Contact</th>
                <th>URL par défaut</th>
                <SortTh id="criticality" sort={sort} toggle={toggle}>Criticité</SortTh>
                <th>Flux</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td><Icon type="external" /> <EditCell value={s.name} onSave={u(s, 'name')} /></td>
                  <td><EditCell value={s.kind} onSave={u(s, 'kind')} placeholder="SaaS, banque…" /></td>
                  <td><EditCell value={s.organization} onSave={u(s, 'organization')} /></td>
                  <td><EditCell value={s.contact} onSave={u(s, 'contact')} /></td>
                  <td><EditCell value={s.url} onSave={u(s, 'url')} /></td>
                  <td><CriticalitySelect value={s.criticality} onChange={u(s, 'criticality')} /></td>
                  <td>{flowsOfExternal(x, s.id).length}</td>
                  <td><DelButton title="Supprimer le service" onClick={() => save('DELETE', `external_services/${s.id}`)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <AddForm
        fields={[{ key: 'name', label: 'Nom', required: true }, { key: 'kind', label: 'Type (banque, SaaS…)' }, { key: 'organization', label: 'Organisation' }]}
        onSubmit={(v) => save('POST', 'external_services', v)}
        label="Ajouter un service externe"
      />
      </EditModeProvider>
    </Card>
  );
}
