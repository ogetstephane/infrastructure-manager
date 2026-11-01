import React from 'react';

// Titre de sous-section : n'apparaît qu'en mode édition pour garder les vues lecture seule compactes
export default function Section({ title, children }) {
  return (
    <>
      {title && <h4>{title}</h4>}
      {children}
    </>
  );
}
