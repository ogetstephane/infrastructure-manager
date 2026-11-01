import React from 'react';

export default function Card({ title, actions, wide, className = '', children }) {
  return (
    <section className={`card ${wide ? 'wide' : ''} ${className}`}>
      {(title || actions) && (
        <div className="row">
          <h2>{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
