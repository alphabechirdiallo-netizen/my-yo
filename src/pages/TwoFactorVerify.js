import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function TwoFactorVerify({ userId, userEmail, purpose = 'login', onVerified, onCancel }) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef([]);

  useEffect(() => {
    // Send initial code on mount
    sendCode();
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const t = setTimeout(() => setCooldown(c => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cooldown]);

  const sendCode = async () => {
    setResending(true);
    setError('');

    const { data: generatedCode, error: genErr } = await supabase.rpc('generate_2fa_code', {
      target_user_id: userId,
      code_purpose: purpose,
    });

    if (genErr) {
      setError('Erreur lors de la génération du code.');
      setResending(false);
      return;
    }

    // Send the code via the Edge Function (uses Gmail SMTP already configured)
    try {
      const { error: fnError } = await supabase.functions.invoke('send-2fa-email', {
        body: { email: userEmail, code: generatedCode },
      });
      if (fnError) {
        setError('Impossible d\'envoyer l\'email. Vérifiez que la fonction send-2fa-email est déployée.');
      }
    } catch (e) {
      setError('Service d\'envoi indisponible pour le moment.');
    }

    setCooldown(30);
    setResending(false);
  };

  const handleChange = (i, val) => {
    if (!/^\d?$/.test(val)) return;
    const newCode = [...code];
    newCode[i] = val;
    setCode(newCode);
    if (val && i < 5) inputRefs.current[i + 1]?.focus();
    if (newCode.every(c => c) && newCode.join('').length === 6) {
      handleVerify(newCode.join(''));
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  const handleVerify = async (fullCode) => {
    setLoading(true);
    setError('');
    const { data: isValid } = await supabase.rpc('verify_2fa_code', {
      target_user_id: userId,
      input_code: fullCode,
    });

    if (isValid) {
      onVerified();
    } else {
      setError('Code incorrect ou expiré.');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 28 }}>
        🔐
      </div>
      <h1 className="auth-title">Vérification</h1>
      <p className="auth-subtitle">
        Entrez le code à 6 chiffres envoyé à<br />
        <strong>{userEmail}</strong>
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={el => inputRefs.current[i] = el}
            className="input-field"
            style={{ width: 44, height: 52, textAlign: 'center', fontSize: 20, fontWeight: 600, padding: 0 }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            autoFocus={i === 0}
          />
        ))}
      </div>

      {error && <p className="error-msg">{error}</p>}
      {loading && <div className="spinner" style={{ margin: '8px auto' }} />}

      <button
        className="btn-secondary"
        style={{ marginTop: 8, width: '100%' }}
        onClick={sendCode}
        disabled={resending || cooldown > 0}
      >
        {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : resending ? 'Envoi...' : 'Renvoyer le code'}
      </button>

      {onCancel && (
        <button onClick={onCancel} style={{ marginTop: 14, fontSize: 14, color: 'var(--text-muted)' }}>
          Annuler
        </button>
      )}
    </div>
  );
}
