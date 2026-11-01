import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store.jsx';
import Business from './views/Business.jsx';
import Dev from './views/Dev.jsx';
import Infra from './views/Infra.jsx';
import Deps from './views/Deps.jsx';
import Ops from './views/Ops.jsx';
import Owners from './views/Owners.jsx';
import IAFactory from './views/IAFactory.jsx';
import IncidentDesk from './views/IncidentDesk.jsx';
import Contact from './views/Contact.jsx';
import { Breadcrumb, ThemeToggle } from './components/common';
import { ScopeProvider, hashFor, useScope } from './scope.jsx';
import './style.css';

const VIEWS = [
  { id: 'metier', icon: '🏢', label: 'Métier', C: Business, depth: 2 },
  { id: 'dev', icon: '🛠️', label: 'Dev', C: Dev, depth: 2 },
  { id: 'systeme', icon: '🖥️', label: 'Système', C: Infra, depth: 3 },
  { id: 'dependances', icon: '🔗', label: 'Dépendances', C: Deps, depth: 3 },
  { id: 'ops', icon: '🚨', label: 'Ops', C: Ops, depth: 3 },
  { id: 'responsables', icon: '👤', label: 'Responsables', C: Owners, depth: 2 },
  { id: 'ia-factory', icon: '🏭', label: 'IA factory', C: IAFactory, depth: 2, requirePerimeter: true },
  { id: 'incident-desk', icon: '🆘', label: 'IncidentDesk', C: IncidentDesk, depth: 2, requirePerimeter: true },
  { id: 'contact', icon: '✉️', label: 'Contact', C: Contact, depth: 0 },
];

// #metier?p=3&a=5 : le périmètre de navigation (périmètre, application, environnement) est commun à toutes les vues
const viewOf = () => location.hash.slice(1).split(/[/?]/)[0] || 'metier';

function Nav({ current }) {
  const s = useScope();
  return (
    <nav>
      {VIEWS.map((v) => (
        <a key={v.id} href={hashFor(v.id, s)} className={v.id === current.id ? 'active' : ''}>{v.icon} {v.label}</a>
      ))}
    </nav>
  );
}

function Shell() {
  const { error, setError } = useStore();
  const [view, setView] = useState(() => viewOf());
  useEffect(() => {
    const on = () => setView(viewOf());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <>
      <header>
        <h1>Exploit</h1>
        <Nav current={current} />
        <ThemeToggle />
      </header>
      {error && <div className="error" onClick={() => setError('')}>{error} (cliquer pour fermer)</div>}
      <main>
        {current.depth > 0 && <Breadcrumb depth={current.depth} requirePerimeter={current.requirePerimeter} />}
        <current.C />
      </main>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ScopeProvider><Shell /></ScopeProvider>
    </StoreProvider>
  );
}
