import React, { useEffect, useRef, useState } from 'react';
import { useEditing } from './EditMode.jsx';
import { isHttp } from './status.js';

// Champ éditable en ligne. Si onSave renvoie une promesse de booléen, la cellule
// clignote en vert (enregistré) ou en rouge (refusé, la valeur précédente est restaurée).
export default function EditCell({ value, onSave, placeholder, multiline }) {
  const editing = useEditing();
  const [v, setV] = useState(value ?? '');
  const [flash, setFlash] = useState('');
  const timer = useRef();
  useEffect(() => setV(value ?? ''), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = async () => {
    if (v === (value ?? '')) return;
    const ok = await onSave(v);
    if (ok === false) setV(value ?? '');
    setFlash(ok === false ? 'error' : 'saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(''), 1200);
  };

  if (!editing) {
    if (!value) return <span className="muted">—</span>;
    return isHttp(value) ? <a href={value} target="_blank" rel="noreferrer noopener">{value}</a> : <span className="ro">{value}</span>;
  }

  const props = {
    className: `cell ${flash}`,
    value: v,
    placeholder,
    onChange: (e) => setV(e.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea rows={3} {...props} />
  ) : (
    <input {...props} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
  );
}
