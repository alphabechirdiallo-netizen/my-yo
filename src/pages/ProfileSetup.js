import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { generateUsername } from '../lib/utils';
import logo from '../assets/logo.png';

export default function ProfileSetup() {
  const { user, refreshProfile } = useAuth();
  const [step, setStep] = useState(1); // 1: name/photo, 2: username
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAvatar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Image trop grande (max 5 Mo)'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError('');
  };

  const handleNextStep = () => {
    if (!name.trim()) { setError('Entrez votre prénom.'); return; }
    setUsername(generateUsername(name));
    setStep(2);
    setError('');
  };

  const handleSubmit = async () => {
    if (!username.trim()) { setError('Choisissez un nom d\'utilisateur.'); return; }
    setLoading(true); setError('');

    let avatar_url = null;
    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop();
      const path = `${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, avatarFile, { upsert: true });
      if (upErr) { setError('Erreur upload photo.'); setLoading(false); return; }
      avatar_url = path;
    }

    const { error: profileErr } = await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      name: name.trim(),
      username: username.toLowerCase().trim(),
      bio: bio.trim(),
      avatar_url,
      is_online: true,
      last_seen: new Date().toISOString(),
      privacy_photo: 'contacts',
      privacy_bio: 'contacts',
      privacy_online: 'contacts',
      privacy_add_contact: 'everyone',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (profileErr) { setError(profileErr.message); }
    else { await refreshProfile(); }
    setLoading(false);
  };

  return (
    <div className="setup-page">
      <img src={logo} alt="Yo" style={{ width: 52, height: 52, borderRadius: 14, marginBottom: 20 }} />

      {step === 1 ? (
        <>
          <h1 className="setup-title">Votre profil</h1>
          <p className="setup-subtitle">Ajoutez une photo et votre prénom</p>

          <div className="avatar-upload" style={{ marginBottom: 28 }}>
            <label htmlFor="avatar-input" style={{ cursor: 'pointer' }}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="avatar-upload-img" />
              ) : (
                <div className="avatar-upload-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', borderRadius: '50%', width: 90, height: 90 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
              )}
              <div className="avatar-upload-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
            </label>
            <input id="avatar-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
          </div>

          <div className="input-group-full">
            <label className="input-label">Prénom *</label>
            <input className="input-field" type="text" placeholder="Votre prénom" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
          </div>
          <div className="input-group-full">
            <label className="input-label">Bio</label>
            <input className="input-field" type="text" placeholder="Ex : Disponible" value={bio} onChange={e => setBio(e.target.value)} maxLength={80} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button className="btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={handleNextStep}>
            Continuer →
          </button>
        </>
      ) : (
        <>
          <h1 className="setup-title">Nom d'utilisateur</h1>
          <p className="setup-subtitle">Les autres pourront vous trouver avec @{username}</p>

          <div className="input-group-full">
            <label className="input-label">Nom d'utilisateur</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 15 }}>@</span>
              <input
                className="input-field"
                style={{ paddingLeft: 28 }}
                type="text"
                placeholder="votre_nom"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                maxLength={30}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Lettres minuscules, chiffres et _ uniquement</p>
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button className="btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={handleSubmit} disabled={loading}>
            {loading ? 'Création...' : 'Commencer'}
          </button>
          <button className="btn-secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => setStep(1)}>
            Retour
          </button>
        </>
      )}
    </div>
  );
}
