import React from 'react';
import Card from './Card.jsx';
import Empty from './Empty.jsx';

// Carte contenant une liste d'éléments, ou un message si elle est vide
export default function ListCard({ title, items, empty = 'Aucun.', wide }) {
  return (
    <Card title={title} wide={wide}>
      {items.length ? (
        <ul className="plain">{items.map(({ key, content }) => <li key={key}>{content}</li>)}</ul>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </Card>
  );
}
