import React, { createContext, useContext, useEffect, useState } from 'react';

// Mode lecture / édition d'une entité. Par défaut (hors fournisseur) on reste en édition.
const EditModeContext = createContext(true);
export const useEditing = () => useContext(EditModeContext);
export const EditModeProvider = EditModeContext.Provider;

// État de mode d'une entité ; `initial` re-synchronise le mode quand la valeur parente change
export function useEditMode(initial = false) {
  const [edit, setEdit] = useState(initial);
  useEffect(() => setEdit(initial), [initial]);
  return [edit, setEdit];
}

export function ModeToggle({ edit, onChange }) {
  return (
    <button className="icon modetoggle" title={edit ? 'Repasser en lecture' : 'Modifier'} onClick={() => onChange(!edit)}>
      {edit ? '👁 Lecture' : '✏️ Modifier'}
    </button>
  );
}
