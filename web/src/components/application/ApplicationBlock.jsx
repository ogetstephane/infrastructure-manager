import React from 'react';
import { Slice, useStore } from '../../store.jsx';
import { envsOfPerimeter, flowsOfApp } from '../../selectors.js';
import { CriticalityBadge, Icon, ModeToggle, useEditMode, DelButton, RepoLink, Section, TagList } from '../common';
import AppProfile from './AppProfile.jsx';
import ComponentsPanel from './ComponentsPanel.jsx';
import { FlowsPanel } from '../external';
import LinkedTickets from '../ia-factory/LinkedTickets.jsx';

// Bloc application autonome, commun aux vues Métier (lecture seule) et Dev (éditable) : charge /applications/:id/bundle
export default function ApplicationBlock({ id, ...props }) {
  return (
    <Slice path={`applications/${id}/bundle`}>
      <Application id={id} {...props} />
    </Slice>
  );
}

function Application({ id, editable: initial = false, onTag }) {
  const { x, save } = useStore();
  const app = x.app[id];
  const [editable, setEdit] = useEditMode(initial);
  const envs = envsOfPerimeter(x, app.perimeter_id);
  const hasFlows = flowsOfApp(x, app.id).length > 0;

  return (
    <div className="app">
      <div className="row">
        <h3>
          <Icon type="app" /> {app.name} <CriticalityBadge value={app.criticality} /> {!editable && <TagList tags={app.tags} onClick={onTag} />}
        </h3>
        <span><ModeToggle edit={editable} onChange={setEdit} />{editable && <DelButton title="Supprimer l'application" onClick={() => save('DELETE', `applications/${app.id}`)} />}</span>
      </div>

      {editable && (
        <Section title="Fiche">
          <AppProfile app={app} />
        </Section>
      )}
      {!editable && app.doc_url && <p className="doc">📄 <RepoLink url={app.doc_url} /></p>}

      {(editable || hasFlows) && (
        <Section title="Échanges externes">
          <FlowsPanel appId={app.id} editable={editable} />
        </Section>
      )}

      {editable && (
        <Section title="Briques techniques">
          <ComponentsPanel appId={app.id} envs={envs} />
        </Section>
      )}

      {!editable && app.notes && (
        <details>
          <summary>Notes</summary>
          <p className="notes">{app.notes}</p>
        </details>
      )}
      <LinkedTickets type="application" id={app.id} />
    </div>
  );
}
