import React from 'react';
import { isHttp } from './status.js';

export default function RepoLink({ url }) {
  if (!url) return <span className="muted">—</span>;
  return isHttp(url) ? (
    <a href={url} target="_blank" rel="noreferrer noopener">{url.replace(/^https?:\/\//i, '')}</a>
  ) : (
    <code>{url}</code>
  );
}
