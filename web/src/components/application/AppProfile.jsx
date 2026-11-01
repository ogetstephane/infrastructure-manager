import React from 'react';
import { useStore } from '../../store.jsx';
import { CriticalitySelect, EditCell, RepoLink } from '../common';

// Fiche descriptive éditable d'une application : criticité, tags, documentation
export default function AppProfile({ app }) {
  const { save } = useStore();
  const u = (key) => (value) => save('PUT', `applications/${app.id}`, { [key]: value });
  return (
    <div className="fields">
      <label>Criticité<CriticalitySelect value={app.criticality} onChange={u('criticality')} /></label>
      <label>Tags<EditCell value={app.tags} onSave={u('tags')} placeholder="legacy, interne…" /></label>
      <label>Description<EditCell value={app.description} onSave={u('description')} /></label>
      <label>Lien documentation<EditCell value={app.doc_url} onSave={u('doc_url')} placeholder="https://wiki…" /></label>
      <label>Dépôt Git<EditCell value={app.git_repo} onSave={u('git_repo')} placeholder="https://… , git@hôte:org/repo.git ou /chemin/local" /></label>
      <label>Branche de base<EditCell value={app.git_branch} onSave={u('git_branch')} placeholder="par défaut du dépôt" /></label>
      {!app.git_repo && <span className="full muted">Aucun dépôt Git : les tickets liés à cette application ne peuvent pas être lancés. Les accès sont ceux du serveur (clé SSH, credential helper) : aucun identifiant n'est stocké.</span>}
      <label className="full">Notes (architecture, contacts, procédures)<EditCell multiline value={app.notes} onSave={u('notes')} /></label>
      {app.doc_url && <span className="full"><RepoLink url={app.doc_url} /></span>}
    </div>
  );
}
