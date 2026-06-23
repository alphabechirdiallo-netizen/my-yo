import React, { useState } from 'react';
import logo from '../assets/logo.png';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    const emailToUse = email.trim();
    if (!emailToUse || !emailToUse.includes('@')) {
      setError('Entrez une adresse email valide.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: emailToUse,
      options: { emailRedirectTo: window.location.origin },
    });
    if (err) setError(err.message);
    else setSent(true);
    setLoading(false);
  };

  if (sent) return (
    <div className="auth-page">
      <img src={logo} alt="Yo" className="auth-logo" />
      <h1 className="auth-title">Vérifiez votre email</h1>
      <p className="auth-subtitle">
        Un lien de connexion a été envoyé à<br />
        <strong>{email}</strong>.<br /><br />
        Cliquez sur le lien pour vous connecter.
      </p>
      <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setSent(false)}>
        Modifier l'adresse
      </button>
    </div>
  );

  return (
    <div className="auth-page">
      <img src={logo} alt="Yo" className="auth-logo" />
      <h1 className="auth-title">Bienvenue sur Yo</h1>
      <p className="auth-subtitle">
        Entrez votre email pour recevoir un lien de connexion.<br />Pas besoin de mot de passe.
      </p>
      <div className="input-group" style={{ width: '100%' }}>
        <label className="input-label">Email</label>
        <input
          className="input-field"
          type="email"
          placeholder="votre@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          autoComplete="email"
          autoFocus
        />
      </div>
      {error && <p className="error-msg" style={{ width: '100%' }}>{error}</p>}
      <button className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={handleSubmit} disabled={loading}>
        {loading ? 'Envoi...' : 'Continuer'}
      </button>
    </div>
  );
}
