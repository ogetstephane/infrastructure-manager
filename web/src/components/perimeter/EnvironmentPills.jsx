import React, { useEffect, useRef, useState } from 'react';
import { qs, useQuery } from '../../query.js';
import { Icon } from '../common';
import PerimeterEnvironments from './PerimeterEnvironments.jsx';

// Bloc autonome : environnements du périmètre en pastilles ; au survol, un bouton ouvre la vue d'édition (qui ne persiste que les environnements)
export default function EnvironmentPills({ perimeterId }) {
  const list = useQuery(`environments${qs({ perimeter_id: perimeterId })}`).data ?? [];
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  return (
    <span className="envpills">
      {list.map((e) => <span key={e.id} className="tag"><Icon type="environment" of={e.name} /> {e.name}</span>)}
      <button type="button" className="editbtn" onClick={() => setOpen(true)}>✎ Éditer environnements</button>
      {open && (
        <dialog ref={dialog} className="envdialog" onClose={() => setOpen(false)} onClick={(ev) => ev.target === dialog.current && setOpen(false)}>
          <PerimeterEnvironments perimeterId={perimeterId} editable />
          <button type="button" onClick={() => setOpen(false)}>Fermer</button>
        </dialog>
      )}
    </span>
  );
}
