import React, { useState } from 'react';
import { useScope } from '../scope.jsx';
import { Card, Empty, ModeToggle } from '../components/common';
import IncidentBoard from '../components/incident-desk/IncidentBoard.jsx';

// Vue Incidents : un périmètre est obligatoire, l'application filtre
export default function IncidentDesk() {
  const scope = useScope();
  const [edit, setEdit] = useState(false);
  if (!scope.p) return <Empty>Sélectionne un périmètre pour afficher ses incidents.</Empty>;
  return (
    <Card wide title="🆘 IncidentDesk" actions={<ModeToggle edit={edit} onChange={setEdit} />}>
      <IncidentBoard perimeterId={scope.p} applicationId={scope.a} editable={edit} />
    </Card>
  );
}
