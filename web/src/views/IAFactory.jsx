import React, { useState } from 'react';
import { useScope } from '../scope.jsx';
import { Card, Empty, ModeToggle } from '../components/common';
import FactoryBoard from '../components/ia-factory/FactoryBoard.jsx';

// Vue Tickets : un périmètre est obligatoire (fil d'Ariane sans « Tous les périmètres »), l'application filtre
export default function IAFactory() {
  const scope = useScope();
  const [edit, setEdit] = useState(false);
  const openId = Number(new URLSearchParams(location.hash.split('?')[1]).get('t')) || null;
  if (!scope.p) return <Empty>Sélectionne un périmètre pour afficher ses tickets.</Empty>;
  return (
    <Card wide title="🏭 IA factory" actions={<ModeToggle edit={edit} onChange={setEdit} />}>
      <FactoryBoard perimeterId={scope.p} applicationId={scope.a} editable={edit} openId={openId} />
    </Card>
  );
}
