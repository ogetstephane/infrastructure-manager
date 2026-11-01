import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
const { validateContact, rateLimiter, contactRouter, MAX_MESSAGE } = await import('./contact.js');
const express = (await import('express')).default;

const ok = { email: 'a@b.fr', message: 'Bonjour', consent: true };

test('validation : cas valide', () => {
  assert.deepEqual(validateContact({ ...ok, email: ' a@b.fr ' }), { email: 'a@b.fr', message: 'Bonjour' });
});

test('validation : champs obligatoires, format et longueur', () => {
  assert.ok(validateContact({}).errors.email);
  assert.ok(validateContact({}).errors.message);
  assert.ok(validateContact({ ...ok, email: 'pas-un-email' }).errors.email);
  assert.ok(validateContact({ ...ok, email: 'a@b' }).errors.email);
  assert.ok(validateContact({ ...ok, message: 'x'.repeat(MAX_MESSAGE + 1) }).errors.message);
  assert.ok(validateContact({ ...ok, consent: false }).errors.consent);
});

test('limitation de débit', () => {
  const l = rateLimiter({ max: 2, windowMs: 1000 });
  assert.ok(l('ip', 0) && l('ip', 1));
  assert.equal(l('ip', 2), false);
  assert.ok(l('ip', 2000));
});

test('endpoint : succès, erreur, honeypot, limite', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/contact', contactRouter({ limiter: rateLimiter({ max: 3 }) }));
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/contact`;
  const post = (b) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  try {
    assert.equal((await post(ok)).status, 201);
    const bad = await post({ ...ok, email: 'x' });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).errors.email);
    assert.equal((await post({ ...ok, website: 'http://spam' })).status, 201);
    assert.equal((await post(ok)).status, 201);
    assert.equal((await post(ok)).status, 429);
  } finally {
    server.close();
  }
});
