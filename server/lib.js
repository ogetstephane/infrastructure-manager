import { Router } from 'express';
import { db } from './db.js';

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
export const STATUS_ENUM = { status: ['up', 'degraded', 'down', 'maintenance'] };

export const all = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
// Lignes dont `col` est dans `values` (les valeurs sont toujours liées, jamais concaténées)
export const rowsIn = (table, col, values) => {
  const v = [...new Set(values.filter((x) => x != null))];
  return v.length ? db.prepare(`SELECT * FROM ${table} WHERE ${col} IN (${v.map(() => '?').join(',')}) ORDER BY id`).all(...v) : [];
};
export const rowsBy = (table, col) => (id) => db.prepare(`SELECT * FROM ${table} WHERE ${col}=? ORDER BY id`).all(id);

const isSafeUrl = (v) => !v || /^(https?:\/\/|git@|ssh:\/\/)/i.test(v);
const normalizeTags = (v) => [...new Set(String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean))].join(',');
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Routeur REST d'une entité :
//   GET /            liste (filtres : ?champ=valeur, ou def.list)
//   GET /bundle      lecture agrégée de la collection (def.scope)
//   GET /:id         une ressource
//   GET /:id/bundle  la ressource et tout ce qui l'entoure, pour un bloc d'interface autonome
//   GET /:id/<enfant> sous-ressources (def.children)
//   POST /, PUT /:id, DELETE /:id
export function crudRouter(def, bundle) {
  const { table, fields, required, check, checkPut, enums = {}, after, afterPut, children = {}, list, scope, prepareBody } = def;
  const r = Router();
  const pick = (body) => fields.filter((f) => body[f] !== undefined);
  const urlError = (b) => (['repo_url', 'url', 'doc_url'].every((k) => isSafeUrl(b[k] ?? '')) ? null : 'invalid url');
  const enumError = (b) => {
    const bad = Object.entries(enums).find(([k, vals]) => k in b && !vals.includes(b[k]));
    return bad ? `valeur invalide pour ${bad[0]}` : null;
  };
  const prepare = (b) => {
    const out = { ...b };
    if ('tags' in out) out.tags = normalizeTags(out.tags);
    for (const k of Object.keys(out)) if (k.endsWith('_id') && blank(out[k])) out[k] = null;
    return out;
  };
  const blankError = (b) => (required.some((k) => k in b && blank(b[k])) ? 'champ obligatoire vide' : null);

  const genericList = (q) => {
    const cols = Object.keys(q).filter((k) => k === 'id' || fields.includes(k));
    const sql = `SELECT * FROM ${table}${cols.length ? ` WHERE ${cols.map((c) => `${c}=?`).join(' AND ')}` : ''} ORDER BY id`;
    return db.prepare(sql).all(...cols.map((c) => q[c]));
  };

  r.get('/', (req, res) => res.json((list ?? genericList)(req.query)));
  if (scope) r.get('/bundle', (req, res) => res.json(bundle(scope(null, req.query))));

  const find = (id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  r.get('/:id', (req, res) => {
    const row = find(req.params.id);
    return row ? res.json(row) : res.status(404).json({ error: 'introuvable' });
  });
  if (scope) {
    r.get('/:id/bundle', (req, res) => {
      if (!find(req.params.id)) return res.status(404).json({ error: 'introuvable' });
      res.json(bundle(scope(Number(req.params.id), req.query)));
    });
  }
  for (const [name, fn] of Object.entries(children)) {
    r.get(`/:id/${name}`, (req, res) => (find(req.params.id) ? res.json(fn(Number(req.params.id), req.query)) : res.status(404).json({ error: 'introuvable' })));
  }

  r.post('/', (req, res) => {
    let b = prepare(req.body);
    if (prepareBody) b = prepareBody(b);
    const err = required.some((k) => blank(b[k])) ? `champs obligatoires : ${required.join(', ')}` : urlError(b) || enumError(b) || (check && check(b));
    if (err) return res.status(400).json({ error: err });
    const cols = pick(b);
    try {
      const run = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => b[c]));
      after?.(b, Number(run.lastInsertRowid));
      res.status(201).json({ id: Number(run.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.put('/:id', (req, res) => {
    let b = prepare(req.body);
    const err = blankError(b) || urlError(b) || enumError(b) || (checkPut && checkPut(b, req.params.id));
    if (err) return res.status(400).json({ error: err });
    if (prepareBody) b = prepareBody(b, req.params.id);
    const cols = pick(b);
    if (!cols.length) return res.status(400).json({ error: 'nothing to update' });
    try {
      const run = db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map((c) => b[c]), req.params.id);
      const late = run.changes ? afterPut?.(b, req.params.id, req) : null;
      if (late) return res.status(409).json({ ok: false, error: `lancement impossible, statut précédent rétabli : ${late}` });
      res.status(run.changes ? 200 : 404).json({ ok: !!run.changes });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.delete('/:id', (req, res) => {
    const run = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.status(run.changes ? 200 : 404).json({ ok: !!run.changes });
  });

  return r;
}
