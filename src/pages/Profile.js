import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import Settings from './Settings';

const PrivacySelector = ({ value, onChange }) => {
  const options = [
    { value: 'everyone', label: 'Tous' },
    { value: 'contacts', label: 'Contacts' },
    { value: 'nobody', label: 'Personne' },
  ];
  return (
    <div className="privacy-selector">
      {options.map(o => (
        <button key={o.value} className={`privacy-option ${value === o.value ? 'selected' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
};

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth();
  const [section, setSection] = useState('main');
  const [name, setName] = useState(profile?.name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [sessions, setSessions] = useState([]);
  const [privacy, setPrivacy] = useState({
    photo: profile?.privacy_photo || 'contacts',
    bio: profile?.privacy_bio || 'contacts',
    online: profile?.privacy_online || 'contacts',
    add_contact: profile?.privacy_add_contact || 'everyone',
  });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const handleAvatar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setLoading(true);
    let avatar_url = profile?.avatar_url;
    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop();
      const path = `${user.id}.${ext}`;
      await supabase.storage.from('avatars').upload(path, avatarFile, { upsert: true });
      avatar_url = path;
    }
    await supabase.from('profiles').update({
      name, bio, username: username.toLowerCase(), avatar_url,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    await refreshProfile();
    setSection('main');
    setAvatarFile(null); setAvatarPreview(null);
    showToast('Profil mis à jour ✓');
    setLoading(false);
  };

  const savePrivacy = async () => {
    await supabase.from('profiles').update({
      privacy_photo: privacy.photo,
      privacy_bio: privacy.bio,
      privacy_online: privacy.online,
      privacy_add_contact: privacy.add_contact,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    await refreshProfile();
    showToast('Confidentialité mise à jour ✓');
  };

  const loadSessions = async () => {
    const { data } = await supabase.from('user_sessions').select('*').eq('user_id', user.id).order('last_active', { ascending: false });
    setSessions(data || []);
  };

  const revokeSession = async (sessionId) => {
    await supabase.from('user_sessions').delete().eq('id', sessionId);
    loadSessions();
    showToast('Session révoquée ✓');
  };

  const handleLogout = async () => {
    await supabase.from('profiles').update({ is_online: false }).eq('id', user.id);
    await supabase.auth.signOut();
  };

  const handleShare = () => {
    const url = window.location.origin;
    if (navigator.share) navigator.share({ title: 'Yo', text: `Rejoins-moi sur Yo ! @${profile?.username}`, url });
    else { navigator.clipboard.writeText(url); showToast('Lien copié !'); }
  };

  // SETTINGS
  if (section === 'settings') return (
    <Settings onClose={() => setSection('main')} />
  );

  // EDIT
  if (section === 'edit') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Modifier le profil</span>
        <button className="top-bar-action" onClick={handleSave} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
      <div className="setup-page">
        <div className="avatar-upload" style={{ marginBottom: 24 }}>
          <label htmlFor="edit-avatar" style={{ cursor: 'pointer' }}>
            {avatarPreview ? (
              <img src={avatarPreview} alt="preview" className="avatar-upload-img" />
            ) : (
              <Avatar profile={profile} size={90} />
            )}
            <div className="avatar-upload-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          </label>
          <input id="edit-avatar" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
        </div>
        <div className="input-group-full">
          <label className="input-label">Prénom</label>
          <input className="input-field" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
        </div>
        <div className="input-group-full">
          <label className="input-label">Nom d'utilisateur</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>@</span>
            <input className="input-field" style={{ paddingLeft: 28 }} value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={30} />
          </div>
        </div>
        <div className="input-group-full">
          <label className="input-label">Bio</label>
          <input className="input-field" value={bio} onChange={e => setBio(e.target.value)} placeholder="Bio" maxLength={80} />
        </div>
        <button className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={handleSave} disabled={loading}>
          {loading ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // PRIVACY
  if (section === 'privacy') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Confidentialité</span>
      </div>
      <div className="profile-page">
        <div className="section-header">Qui peut voir...</div>
        {[
          { key: 'photo', label: 'Photo de profil' },
          { key: 'bio', label: 'Bio' },
          { key: 'online', label: 'Statut en ligne' },
          { key: 'add_contact', label: 'M\'ajouter comme contact' },
        ].map(item => (
          <div key={item.key} style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>{item.label}</div>
            <PrivacySelector value={privacy[item.key]} onChange={v => setPrivacy(p => ({ ...p, [item.key]: v }))} />
          </div>
        ))}
        <div style={{ padding: 16 }}>
          <button className="btn-primary" style={{ width: '100%' }} onClick={savePrivacy}>Enregistrer</button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // SESSIONS
  if (section === 'sessions') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Sessions actives</span>
      </div>
      <div className="profile-page">
        <div className="section-header">Appareils connectés</div>
        {sessions.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>Chargement...</div>
        )}
        {sessions.map((s, i) => (
          <div key={s.id} className="session-card">
            <div className="menu-row-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                {s.device_type === 'mobile' ? (
                  <><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></>
                ) : (
                  <><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>
                )}
              </svg>
            </div>
            <div className="session-info">
              <div className="session-device">{s.device_name || 'Appareil inconnu'}</div>
              <div className="session-meta">Dernière activité : {new Date(s.last_active).toLocaleString('fr-FR')}</div>
              {i === 0 && <div className="session-current">Session actuelle</div>}
            </div>
            {i !== 0 && (
              <button className="btn-danger" onClick={() => revokeSession(s.id)}>Révoquer</button>
            )}
          </div>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // MAIN
  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">Profil</span>
        <button className="top-bar-action" onClick={() => { setSection('settings'); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button className="top-bar-action" onClick={() => { setName(profile?.name || ''); setBio(profile?.bio || ''); setUsername(profile?.username || ''); setSection('edit'); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>

      <div className="profile-page">
        <div className="profile-header">
          <Avatar profile={profile} size={84} showOnline />
          <div className="profile-name-large">{profile?.name || '—'}</div>
          {profile?.username && <div className="profile-sub">@{profile.username}</div>}
          <div className="profile-sub">{profile?.bio || 'Disponible'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user?.email}</div>
        </div>

        <div className="divider-full" />
        <div className="section-header">Compte</div>

        {[
          { label: 'Modifier le profil', sub: 'Nom, photo, bio', icon: '👤', action: () => { setName(profile?.name || ''); setBio(profile?.bio || ''); setUsername(profile?.username || ''); setSection('edit'); } },
          { label: 'Confidentialité', sub: 'Photo, statut, contacts', icon: '🔒', action: () => setSection('privacy') },
          { label: 'Sessions actives', sub: 'Gérer les appareils', icon: '📱', action: () => { loadSessions(); setSection('sessions'); } },
          { label: 'Paramètres', sub: 'Notifications, apparence', icon: '⚙️', action: () => setSection('settings') },
        ].map(item => (
          <React.Fragment key={item.label}>
            <div className="menu-row" onClick={item.action}>
              <div className="menu-row-icon" style={{ fontSize: 18 }}>{item.icon}</div>
              <div>
                <div className="menu-row-text">{item.label}</div>
                <div className="menu-row-sub">{item.sub}</div>
              </div>
              <div className="menu-row-chevron">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
            <div className="divider" />
          </React.Fragment>
        ))}

        <div className="section-header" style={{ marginTop: 8 }}>Application</div>

        <div className="menu-row" onClick={handleShare}>
          <div className="menu-row-icon" style={{ fontSize: 18 }}>🔗</div>
          <div className="menu-row-text">Partager Yo</div>
          <div className="menu-row-chevron">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        <div className="toggle-row" style={{ padding: '14px 16px' }}>
          <div className="menu-row-icon" style={{ flexShrink: 0, marginRight: 14, fontSize: 18 }}>🌙</div>
          <div className="toggle-label">
            <div className="toggle-label-text">Mode sombre</div>
          </div>
          <div
            className={`toggle ${localStorage.getItem('yo_theme') === 'dark' ? 'on' : ''}`}
            onClick={() => {
              const cur = localStorage.getItem('yo_theme') || 'light';
              const next = cur === 'light' ? 'dark' : 'light';
              localStorage.setItem('yo_theme', next);
              document.body.classList.toggle('dark', next === 'dark');
              showToast(next === 'dark' ? '🌙 Mode sombre' : '☀️ Mode clair');
            }}
          >
            <div className="toggle-thumb" />
          </div>
        </div>

        <div className="divider-full" style={{ marginTop: 8 }} />

        <div className="menu-row" onClick={handleLogout} style={{ marginTop: 4 }}>
          <div className="menu-row-icon" style={{ background: '#fef2f2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <div className="menu-row-text" style={{ color: '#ef4444' }}>Se déconnecter</div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
