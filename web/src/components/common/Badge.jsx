import React from 'react';
import { STATUS } from './status.js';

export default function Badge({ status }) {
  return <span className={`badge ${status}`}>{STATUS[status] || status}</span>;
}
