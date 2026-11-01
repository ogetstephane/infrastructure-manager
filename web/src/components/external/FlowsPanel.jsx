import React from 'react';
import { useStore } from '../../store.jsx';
import { useQuery } from '../../query.js';
import { envsOfPerimeter, flowsOfApp } from '../../selectors.js';
import { AddForm, DelButton, Empty } from '../common';
import FlowLabel, { DIRECTIONS } from './FlowLabel.jsx';

// Échanges d'une application avec les services externes
export default function FlowsPanel({ appId, editable = false }) {
  const { x, save } = useStore();
  const servers = useQuery('servers').data ?? []; // tous les serveurs, pour les listes de choix
  const flows = flowsOfApp(x, appId);
  const envs = envsOfPerimeter(x, x.app[appId].perimeter_id);
  const none = [{ value: '', label: '— serveur (optionnel) —' }];

  return (
    <>
      {flows.length ? (
        <ul className="plain">
          {flows.map((f) => (
            <li key={f.id}>
              <FlowLabel flow={f} /> {editable && <DelButton title="Supprimer le flux" onClick={() => save('DELETE', `flows/${f.id}`)} />}
            </li>
          ))}
        </ul>
      ) : (
        editable && <Empty>Aucun flux externe.</Empty>
      )}
      {editable &&
        (x.external_services.length ? (
          <AddForm
            fields={[
              { key: 'external_id', number: true, label: 'Service externe', options: x.external_services.map((s) => ({ value: s.id, label: s.name })) },
              { key: 'environment_id', label: 'Environnement', options: [{ value: '', label: '— tous environnements —' }, ...envs.map((e) => ({ value: e.id, label: e.name }))] },
              { key: 'direction', label: 'Sens', options: DIRECTIONS },
              { key: 'server_id', label: 'Serveur', options: [...none, ...servers.map((s) => ({ value: s.id, label: s.hostname }))] },
              { key: 'url', label: 'URL du service pour cet environnement' },
              { key: 'protocol', label: 'Protocole (REST, SFTP…)' },
              { key: 'frequency', label: 'Fréquence' },
              { key: 'description', label: 'Description' },
            ]}
            onSubmit={(v) => save('POST', 'flows', { ...v, application_id: appId })}
            label="Ajouter un flux"
          />
        ) : (
          <Empty>Créez d'abord un service externe (vue Dépendances).</Empty>
        ))}
    </>
  );
}
