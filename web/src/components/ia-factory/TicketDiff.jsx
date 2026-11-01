import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { qs, useQuery } from '../../query.js';

const STATUS = { added: ['A', 'Ajouté'], modified: ['M', 'Modifié'], deleted: ['D', 'Supprimé'], renamed: ['R', 'Renommé'] };

const KEYWORDS = new Set(('abstract as async await break case catch class const continue def default delete do elif else enum except export extends final finally for from function if implements import in interface is lambda let new null nil none package private protected public return self static struct super switch this throw throws true false try type var void while with yield fn pub use mod impl func go defer select chan range').split(' '));
const TOKEN = /(\/\/.*|#.*|--\s.*|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;

// Coloration syntaxique légère, indépendante du langage (commentaires, chaînes, nombres, mots-clés)
function highlight(text) {
  const out = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    const cls = m[1] ? 'tok-c' : m[2] ? 'tok-s' : m[3] ? 'tok-n' : KEYWORDS.has(m[4]) ? 'tok-k' : null;
    if (!cls) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Transforme un patch unifié en lignes { kind: 'hunk' | 'ctx' | 'add' | 'del' | 'meta', text, a, b } (numéros ancien/nouveau)
export function parsePatch(patch) {
  const rows = [];
  let a = 0;
  let b = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (h) { a = Number(h[1]); b = Number(h[2]); inHunk = true; rows.push({ kind: 'hunk', text: line }); continue; }
    if (!inHunk) { if (/^(rename|copy|similarity|new file|deleted file|old mode|new mode)/.test(line)) rows.push({ kind: 'meta', text: line }); continue; }
    if (line.startsWith('\\')) rows.push({ kind: 'meta', text: line });
    else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), b: b++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), a: a++ });
    else rows.push({ kind: 'ctx', text: line.slice(1), a: a++, b: b++ });
  }
  return rows;
}

// Vue côte à côte : les blocs de suppressions/ajouts consécutifs sont mis en regard
function toSplit(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind === 'del' || rows[i].kind === 'add') {
      const dels = [];
      const adds = [];
      while (rows[i]?.kind === 'del') dels.push(rows[i++]);
      while (rows[i]?.kind === 'add') adds.push(rows[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: 'pair', left: dels[k], right: adds[k] });
    } else out.push(rows[i++]);
  }
  return out;
}

function Patch({ patch, split }) {
  const rows = useMemo(() => (split ? toSplit(parsePatch(patch)) : parsePatch(patch)), [patch, split]);
  const cell = (r, side) => (
    <td className={`code ${r ? r.kind : 'blank'}`}>{r && <>{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}{highlight(r.text)}</>}</td>
  );
  return (
    <table className="diff-table">
      <tbody>
        {rows.map((r, i) => {
          if (r.kind === 'hunk' || r.kind === 'meta') return <tr key={i} className={r.kind}><td colSpan={split ? 4 : 3}>{r.text}</td></tr>;
          if (r.kind === 'pair') {
            return (
              <tr key={i}>
                <td className="no">{r.left?.a}</td>{cell(r.left)}<td className="no">{r.right?.b}</td>{cell(r.right)}
              </tr>
            );
          }
          if (split) return <tr key={i}><td className="no">{r.a}</td>{cell(r)}<td className="no">{r.b}</td>{cell(r)}</tr>;
          return <tr key={i}><td className="no">{r.a}</td><td className="no">{r.b}</td>{cell(r)}</tr>;
        })}
      </tbody>
    </table>
  );
}

// Diff d'un fichier, chargé page par page (gros diffs)
function FileDiff({ ticketId, file, split }) {
  const [state, setState] = useState({ patch: '', next: 0, binary: false, truncated: false, loading: true, error: null });
  const load = async (offset, reset) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const d = await api('GET', `tickets/${ticketId}/diff/file${qs({ path: file.path, offset })}`);
      setState((s) => ({ patch: reset ? d.patch : `${s.patch}\n${d.patch}`, next: d.next_offset, binary: d.binary, truncated: d.truncated, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  };
  useEffect(() => { load(0, true); }, [ticketId, file.path]);

  if (state.error) return <p className="error">⚠ {state.error}</p>;
  if (state.binary) return <p className="muted">Fichier binaire : contenu non affiché.</p>;
  if (state.loading && !state.patch) return <p className="muted">Chargement du diff…</p>;
  if (!state.patch) return <p className="muted">Aucune modification de contenu (renommage ou changement de mode).</p>;
  return (
    <div className="diff-file">
      <div className="diff-scroll"><Patch patch={state.patch} split={split} /></div>
      {state.next != null && <button disabled={state.loading} onClick={() => load(state.next, false)}>{state.loading ? 'Chargement…' : 'Charger la suite'}</button>}
      {state.truncated && <p className="muted">Diff tronqué : trop volumineux pour être affiché en entier.</p>}
    </div>
  );
}

// Mode « Diff git » (lecture seule) : fichiers modifiés par rapport à la branche de base (git diff base...branche)
export default function TicketDiff({ ticket, onClose }) {
  const q = useQuery(`tickets/${ticket.id}/diff`);
  const [picked, setPicked] = useState(null);
  const [split, setSplit] = useState(false);
  const data = q.data;
  const file = data?.files.find((f) => f.path === picked) ?? data?.files[0];

  return (
    <div className="ticket-diff">
      <div className="row">
        <h4>Diff git{data && <span className="muted"> {data.base}...{data.branch}</span>}</h4>
        <span>
          <label><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Côte à côte</label>{' '}
          <button className="icon" onClick={onClose}>↩ Affichage normal</button>
        </span>
      </div>
      {q.error && <p className="error">⚠ {q.error.message}</p>}
      {!q.error && q.loading && <p className="muted">Calcul du diff…</p>}
      {data && data.files.length === 0 && <p className="muted">Aucun changement par rapport à la branche de base.</p>}
      {data && data.files.length > 0 && (
        <>
          <p className="muted">
            {data.total} fichier{data.total > 1 ? 's' : ''} · <span className="add">+{data.additions}</span> <span className="del">−{data.deletions}</span>
            {data.truncated && ` · liste tronquée aux ${data.files.length} premiers fichiers`}
          </p>
          <ul className="plain diff-files">
            {data.files.map((f) => (
              <li key={f.path} className={f === file ? 'active' : ''}>
                <a href="#" onClick={(e) => { e.preventDefault(); setPicked(f.path); }}>
                  <span className={`diff-status ${f.status}`} title={STATUS[f.status][1]}>{STATUS[f.status][0]}</span>{' '}
                  {f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                </a>{' '}
                {f.binary ? <span className="muted">binaire</span> : <><span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span></>}
              </li>
            ))}
          </ul>
          {file && <FileDiff key={file.path} ticketId={ticket.id} file={file} split={split} />}
        </>
      )}
    </div>
  );
}
