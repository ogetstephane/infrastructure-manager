import React, { useState } from 'react';
import { useEditing } from './EditMode.jsx';

// fields: [{ key, label, required?, number?, options?: [{value,label}] }]
export default function AddForm({ fields, onSubmit, label = 'Ajouter' }) {
  const editing = useEditing();
  const [v, setV] = useState({});
  const get = (f) => v[f.key] ?? (f.options ? f.options[0]?.value ?? '' : '');
  const submit = (e) => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const val = get(f);
      out[f.key] = f.number && val !== '' ? Number(val) : val;
    }
    Promise.resolve(onSubmit(out)).then(() => setV({}));
  };
  if (!editing) return null;
  return (
    <form className="addform" onSubmit={submit}>
      {fields.map((f) =>
        f.options ? (
          <select key={f.key} value={get(f)} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} title={f.label}>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input key={f.key} placeholder={f.label} required={f.required} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
        ),
      )}
      <button disabled={fields.some((f) => f.options && f.options.length === 0)}>{label}</button>
    </form>
  );
}
