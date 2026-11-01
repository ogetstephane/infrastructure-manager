import React from 'react';

export default function Kpi({ value, label, tone = 'up' }) {
  return (
    <div className={`kpi ${tone}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
