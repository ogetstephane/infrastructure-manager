import React, { useEffect, useMemo, useRef, useState } from 'react';
import { iconFor } from '../common';

const COLORS = ['#4f8cff', '#b06bff', '#ff7a59', '#2ec4b6', '#ffd166', '#ef476f', '#06d6a0'];
const KIND_COLOR = { component: '#ffd166', server: '#8892b0' };
const STATUS_COLOR = { up: '#3ddc84', degraded: '#ffb300', down: '#ff4d4f', maintenance: '#8892b0' };

// Anneau intérieur : nœuds internes regroupés par périmètre (même couleur côte à côte) ; anneau extérieur : services externes
const layoutCircle = (nodes, size) => {
  const place = (list, R) =>
    list.map((n, i) => {
      const t = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      return [n.id, { x: size / 2 + Math.cos(t) * R, y: size / 2 + Math.sin(t) * R }];
    });
  const inner = nodes.filter((n) => n.kind !== 'ext').sort((a, b) => (a.outside ? 1 : 0) - (b.outside ? 1 : 0) || (a.color ?? 0) - (b.color ?? 0));
  const outer = nodes.filter((n) => n.kind === 'ext');
  const R = Math.max(120, inner.length * 30);
  return Object.fromEntries([...place(inner, R), ...place(outer, R + (outer.length ? 110 : 0))]);
};

// Vue détail : colonnes (apps liées, briques, serveurs, externes), application au centre-gauche
const layoutColumns = (nodes, width, height) => {
  const cols = {};
  for (const n of nodes) (cols[n.center ? 0.5 : n.col ?? 0] ??= []).push(n);
  const keys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const pos = {};
  keys.forEach((k, ci) => {
    const list = cols[k];
    list.forEach((n, i) => (pos[n.id] = { x: 70 + (ci * (width - 140)) / Math.max(1, keys.length - 1), y: ((i + 1) * height) / (list.length + 1) }));
  });
  return pos;
};

const ICON_OF = (n) => (n.kind === 'perimeter' ? iconFor('perimeter') : n.kind === 'app' ? iconFor('app') : n.kind === 'component' ? iconFor('component', n.ckind) : n.kind === 'server' ? iconFor('server') : n.kind === 'ext' ? iconFor('external') : '');

export default function DependencyGraph({ model, mode, layoutKey, selected, onSelect, selectedEdge, onSelectEdge, onEnter, impacted, uses }) {
  const { nodes, edges } = model;
  const detail = mode === 'detail';
  const size = Math.max(520, nodes.length * 60 + 360);
  const [W, H] = detail ? [900, Math.max(360, Math.max(...Object.values(nodes.reduce((c, n) => ((c[n.col ?? 0] = (c[n.col ?? 0] || 0) + 1), c), {})), 1) * 70)] : [size, size];
  const auto = useMemo(() => (detail ? layoutColumns(nodes, W, H) : layoutCircle(nodes, size)), [nodes, detail, W, H, size]);

  // Positions déplacées à la main, mémorisées par niveau de zoom
  const storeKey = `si3d.layout.${layoutKey}`;
  const [moved, setMoved] = useState({});
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => {
    try { setMoved(JSON.parse(localStorage.getItem(storeKey)) ?? {}); } catch { setMoved({}); }
    setView({ k: 1, x: 0, y: 0 });
  }, [storeKey]);
  const persist = (m) => {
    setMoved(m);
    if (Object.keys(m).length) localStorage.setItem(storeKey, JSON.stringify(m));
    else localStorage.removeItem(storeKey);
  };
  const pos = useMemo(() => ({ ...auto, ...Object.fromEntries(Object.entries(moved).filter(([id]) => auto[id])) }), [auto, moved]);

  const svgRef = useRef();
  const drag = useRef(null);
  const d_pointer = useRef(null);
  const toSvg = (ev) => {
    const r = svgRef.current.getBoundingClientRect();
    const sx = W / r.width;
    const sy = H / r.height;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy, sx, sy };
  };
  const down = (ev, node) => {
    ev.stopPropagation();
    const p = toSvg(ev);
    drag.current = { node, start: p, origin: node ? pos[node.id] : { x: view.x, y: view.y }, moved: false };
    d_pointer.current = ev.pointerId;
  };
  const move = (ev) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(ev);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) svgRef.current.setPointerCapture(d_pointer.current); // capture seulement en vrai glissement, sinon le clic/double-clic des nœuds est perdu
    d.moved = true;
    if (d.node) setMoved((m) => ({ ...m, [d.node.id]: { x: d.origin.x + dx / view.k, y: d.origin.y + dy / view.k } }));
    else setView((v) => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy }));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && d.node) persist(moved);
    lastDrag.current = !!d?.moved;
  };
  const lastDrag = useRef(false);
  const zoom = (factor, cx = W / 2, cy = H / 2) =>
    setView((v) => {
      const k = Math.min(4, Math.max(0.3, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (ev) => {
      ev.preventDefault();
      const p = toSvg(ev);
      zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const nodeState = (id) => (id === selected ? 'sel' : impacted.has(id) ? 'impacted' : uses.has(id) ? 'uses' : selected ? 'dim' : '');
  const edgeState = (e) => {
    if (!selected || e.kind !== 'dep') return selected && e.kind === 'dep' ? 'dim' : '';
    const a = e.from;
    const b = e.to;
    if ((impacted.has(a) || a === selected) && (impacted.has(b) || b === selected)) return 'impacted';
    if ((uses.has(b) || b === selected) && (uses.has(a) || a === selected)) return 'uses';
    return 'dim';
  };

  return (
    <div className="graphbox">
      <div className="graphtools">
        <button className="icon" title="Zoom +" onClick={() => zoom(1.25)}>＋</button>
        <button className="icon" title="Zoom −" onClick={() => zoom(0.8)}>－</button>
        <button className="icon" title="Recentrer" onClick={() => setView({ k: 1, x: 0, y: 0 })}>⤢</button>
        {Object.keys(moved).length > 0 && <button className="icon" title="Remettre la disposition automatique" onClick={() => persist({})}>↺ disposition</button>}
      </div>
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerDown={(ev) => down(ev, null)} onPointerMove={move} onPointerUp={up} onClick={() => (lastDrag.current ? (lastDrag.current = false) : (onSelect(null), onSelectEdge(null)))}>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
      <defs>
        {['', 'impacted', 'uses', 'dim'].map((s) => (
          <marker key={s} id={`arr${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className={`arrow ${s}`} />
          </marker>
        ))}
      </defs>
      {edges.map((e) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const s = edgeState(e);
        const arrow = e.kind !== 'link';
        const cls = `edge ${e.kind === 'flow' ? 'flow' : ''} ${e.kind === 'link' ? 'link' : ''} ${e.kind === 'route' ? 'route' : ''} ${s}`;
        return (
          <g key={e.id} className={`edgegrp ${e.del?.length ? 'removable' : ''} ${selectedEdge === e.id ? 'chosen' : ''}`} onPointerDown={(ev) => e.del?.length && ev.stopPropagation()} onClick={(ev) => e.del?.length && (ev.stopPropagation(), onSelectEdge(selectedEdge === e.id ? null : e.id))}>
            {e.kind === 'route' ? (
              // même colonne : on courbe le trait pour ne pas traverser les nœuds intermédiaires
              <path className={cls} fill="none" markerEnd={`url(#arr${s})`} d={`M${a.x + 14} ${a.y + 4}Q${Math.max(a.x, b.x) + 55} ${(a.y + b.y) / 2} ${b.x + 14} ${b.y - 4}`}>
                <title>{e.title}</title>
              </path>
            ) : (
              <line className={cls} markerEnd={arrow ? `url(#arr${s})` : undefined} x1={a.x + ux * 20} y1={a.y + uy * 20} x2={b.x - ux * 22} y2={b.y - uy * 22}>
                <title>{e.title}</title>
              </line>
            )}
            {e.del?.length > 0 && (e.kind === 'route'
              ? <path className="hit" fill="none" d={`M${a.x + 14} ${a.y + 4}Q${Math.max(a.x, b.x) + 55} ${(a.y + b.y) / 2} ${b.x + 14} ${b.y - 4}`} />
              : <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
            {e.count > 1 && <text className="edgecount" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} textAnchor="middle">{e.count}</text>}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos[n.id];
        const fill = n.kind === 'ext' ? null : STATUS_COLOR[n.status] ?? KIND_COLOR[n.kind] ?? COLORS[(n.color ?? 0) % COLORS.length];
        return (
          <g
            key={n.id}
            className={`node ${n.kind === 'ext' ? 'ext' : ''} ${n.outside ? 'outside' : ''} ${n.enter ? 'enterable' : ''} ${nodeState(n.id)}`}
            transform={`translate(${p.x},${p.y})`}
            onPointerDown={(ev) => down(ev, n)}
            onClick={(ev) => (ev.stopPropagation(), lastDrag.current ? (lastDrag.current = false) : onSelect(selected === n.id ? null : n.id))}
            onDoubleClick={(ev) => (ev.stopPropagation(), n.enter && onEnter(n))}
          >
            {n.kind === 'ext' || n.kind === 'server' ? <rect x="-15" y="-15" width="30" height="30" rx="4" fill={fill ?? undefined} /> : <circle r={n.center ? 24 : 18} fill={fill} />}
            <text className="nicon" y="5" textAnchor="middle">{ICON_OF(n)}</text>
            <text y="34" textAnchor="middle">{n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}</text>
            <title>{n.label}</title>
            {n.enter && <title>Double-clic pour entrer</title>}
          </g>
        );
      })}
      </g>
    </svg>
    </div>
  );
}
