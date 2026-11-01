import React, { useState } from 'react';
import { api } from '../api.js';
import { Card } from '../components/common';

const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validate({ email, message, consent }) {
  const errors = {};
  if (!email.trim()) errors.email = "L'email est obligatoire.";
  else if (!EMAIL_RE.test(email.trim())) errors.email = "Le format de l'email est invalide.";
  if (!message.trim()) errors.message = 'La description de la demande est obligatoire.';
  else if (message.trim().length > MAX_MESSAGE) errors.message = `La description ne doit pas dépasser ${MAX_MESSAGE} caractères.`;
  if (!consent) errors.consent = "Vous devez accepter l'usage de votre email pour être recontacté.";
  return errors;
}

export default function Contact() {
  const [form, setForm] = useState({ email: '', message: '', consent: false, website: '' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | sent | failed
  const [failure, setFailure] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`contact-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setStatus('sending');
    try {
      await api('POST', 'contact', { ...form, email: form.email.trim(), message: form.message.trim() });
      setForm({ email: '', message: '', consent: false, website: '' });
      setStatus('sent');
    } catch (err) {
      // la saisie est conservée ; les erreurs serveur par champ sont affichées sous les champs
      setErrors(err.fields ?? {});
      setFailure(err.message || "L'envoi a échoué, réessayez plus tard.");
      setStatus('failed');
    }
  };

  const field = (k) => ({
    id: `contact-${k}`,
    'aria-invalid': errors[k] ? 'true' : undefined,
    'aria-describedby': errors[k] ? `contact-${k}-err` : undefined,
  });
  const err = (k) => errors[k] && <span className="field-error" id={`contact-${k}-err`}>{errors[k]}</span>;

  return (
    <Card title="Contact">
      <form className="contact-form" onSubmit={submit} noValidate>
        <p className="notes">Décrivez votre demande, nous vous répondrons par email. Tous les champs sont obligatoires.</p>
        <div role="status" aria-live="polite">
          {status === 'sent' && <p className="success">Merci, votre demande a bien été envoyée.</p>}
        </div>
        {status === 'failed' && <p className="form-error" role="alert">{failure}</p>}
        <label htmlFor="contact-email">Email</label>
        <input type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={set('email')} {...field('email')} />
        {err('email')}
        <label htmlFor="contact-message">Description de la demande</label>
        <textarea rows={6} maxLength={MAX_MESSAGE} required value={form.message} onChange={set('message')} {...field('message')} />
        <span className="notes">{form.message.length}/{MAX_MESSAGE}</span>
        {err('message')}
        <div className="hp" aria-hidden="true">
          <label htmlFor="contact-website">Ne pas remplir</label>
          <input id="contact-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </div>
        <label className="consent" htmlFor="contact-consent">
          <input type="checkbox" checked={form.consent} onChange={set('consent')} {...field('consent')} />
          <span>J'accepte que mon email soit utilisé uniquement pour répondre à ma demande. Il est conservé le temps de son traitement ; vous pouvez demander sa suppression en nous écrivant (RGPD).</span>
        </label>
        {err('consent')}
        <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Envoi…' : 'Envoyer'}</button>
      </form>
    </Card>
  );
}
