import React, { useState } from 'react';
import { Slice, useStore } from '../store.jsx';
import { qs } from '../query.js';
import { useScope } from '../scope.jsx';
import { appsOf } from '../selectors.js';
import { EditModeProvider, ModeToggle, Icon, Card, SortTh, TableWrap, useSort } from '../components/common';
import OwnerRow from '../components/perimeter/OwnerRow.jsx';

const SORT_KEYS = { name: (p) => p.name, owner: (p) => p.owner || '\uffff' };

export default function Owners() {
  const scope = useScope();
  return (
    <Slice path={`bundle${qs({ perimeter_id: scope.p, application_id: scope.a })}`}>
      <OwnersTable />
    </Slice>
  );
}

function OwnersTable() {
  const { x } = useStore();
  const [edit, setEdit] = useState(false);
  const scope = useScope();
  const perims = x.perimeters.filter((p) => !scope.p || p.id === scope.p);
  const appsIn = (p) => appsOf(x, p.id).filter((a) => !scope.a || a.id === scope.a);
  const { sorted, sort, toggle } = useSort(perims, SORT_KEYS);
  const missing = [...perims, ...perims.flatMap(appsIn)].filter((r) => !r.owner).length;

  return (
    <Card wide title="Responsables" actions={<ModeToggle edit={edit} onChange={setEdit} />}>
      <EditModeProvider value={edit}>
      {missing > 0 && <p className="impact">{missing} élément(s) sans responsable.</p>}
      <TableWrap>
        <table>
          <thead>
            <tr>
              <SortTh id="name" sort={sort} toggle={toggle}>Élément</SortTh>
              <SortTh id="owner" sort={sort} toggle={toggle}>Responsable</SortTh>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {sorted.flatMap((p) => [
              <OwnerRow key={`p${p.id}`} table="perimeters" record={p} label={<b><Icon type="perimeter" /> {p.name}</b>} />,
              ...appsIn(p).map((a) => <OwnerRow key={`a${a.id}`} table="applications" record={a} label={<span className="indent"><Icon type="app" /> {a.name}</span>} />),
            ])}
          </tbody>
        </table>
      </TableWrap>
      </EditModeProvider>
    </Card>
  );
}
