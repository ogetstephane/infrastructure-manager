import { Router } from 'express';

import { db } from './db.js';

export const MAX_EMAIL = 254;
export const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

db.exec(`
CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL);`);

// Retourne { email, message } nettoyés, ou { errors: { champ: message } }
export function validateContact(body = {}) {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const errors = {};
  if (!email) errors.email = "L'email est obligatoire.";
  else if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) errors.email = "Le format de l'email est invalide.";
  if (!message) errors.message = 'La description de la demande est obligatoire.';
  else if (message.length > MAX_MESSAGE) errors.message = `La description ne doit pas dépasser ${MAX_MESSAGE} caractères.`;
  if (body.consent !== true) errors.consent = "Vous devez accepter l'usage de votre email pour être recontacté.";
  return Object.keys(errors).length ? { errors } : { email, message };
}

// Limitation de débit en mémoire : `max` demandes par `windowMs` et par IP
export function rateLimiter({ max = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export function contactRouter({ limiter = rateLimiter() } = {}) {
  const router = Router();
  router.post('/', (req, res) => {
    // Honeypot : un bot remplit le champ caché ; on répond comme un succès sans rien enregistrer
    if (req.body?.website) return res.status(201).json({ ok: true });
    if (!limiter(req.ip)) {
      res.set('Retry-After', '600');
      return res.status(429).json({ error: 'Trop de demandes, réessayez dans quelques minutes.' });
    }
    const { errors, email, message } = validateContact(req.body);
    if (errors) return res.status(400).json({ error: 'Saisie invalide.', errors });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO contact_requests (email, message, consent, created_at) VALUES (?, ?, 1, ?)')
      .run(email, message, new Date().toISOString());
    res.status(201).json({ ok: true, id: Number(lastInsertRowid) });
  });
  return router;
}
