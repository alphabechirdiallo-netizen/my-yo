import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

export default function Settings({ onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const [stats, setStats] = useState(null);
  const [section, setSection] = useState('main');
  const [toast, setToast] = useState('');
  const [prefs, setPrefs] = useState({
    notification_sound: profile?.notification_sound || 'default',
    notification_preview: profile?.notification_preview !== false,
    read_receipts: profile?.read_receipts !== false,
    font_size: profile?.font_size || 'medium',
    language: profile?.language || 'fr',
    theme: localStorage.getItem('yo_theme') || 'light',
  });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    if (!user) return;
    supabase.rpc('get_user_stats', { user_uuid: user.id }).then(({ data }) => setStats(data));
  }, [user]);

  const savePrefs = async (updates) => {
    const newPrefs = { ...prefs, ...updates };
    setPrefs(newPrefs);
    await supabase.from('profiles').update({
      notification_sound: newPrefs.notification_sound,
      notification_preview: newPrefs.notification_preview,
      read_receipts: newPrefs.read_receipts,
      font_size: newPrefs.font_size,
      language: newPrefs.language,
      theme: newPrefs.theme,
    }).eq('id', user.id);
    await refreshProfile();
    showToast('Sauvegardé ✓');
  };

  const applyTheme = (theme) => {
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('yo_theme', theme);
    savePrefs({ theme });
  };

  // Notification settings
  if (section === 'notifications') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Notifications</span>
      </div>
      <div className="profile-page">
        <div className="section-header">Général</div>
        <div className="toggle-row">
          <div className="toggle-label">
            <div className="toggle-label-text">Aperçu des messages</div>
            <div className="toggle-label-sub">Afficher le contenu dans la notif</div>
          </div>
          <div className={`toggle ${prefs.notification_preview ? 'on' : ''}`} onClick={() => savePrefs({ notification_preview: !prefs.notification_preview })}>
            <div className="toggle-thumb" />
          </div>
        </div>
        <div className="divider" />
        <div className="section-header">Son</div>
        {['default', 'soft', 'none'].map(sound => (
          <div key={sound} className="menu-row" onClick={() => savePrefs({ notification_sound: sound })}>
            <div className="menu-row-icon">
              {sound === 'default' ? '🔔' : sound === 'soft' ? '🔕' : '🔇'}
            </div>
            <div className="menu-row-text">
              {sound === 'default' ? 'Son par défaut' : sound === 'soft' ? 'Son discret' : 'Silencieux'}
            </div>
            {prefs.notification_sound === sound && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </div>
        ))}
        <div className="section-header">Aperçu</div>
        <div className="notif-preview" style={{ margin: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>👤</div>
            <div>
              <div className="notif-preview-title">Yo</div>
              <div className="notif-preview-body">{prefs.notification_preview ? 'Marie : Bonjour, comment tu vas ?' : 'Nouveau message'}</div>
            </div>
          </div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // Appearance settings
  if (section === 'appearance') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Apparence</span>
      </div>
      <div className="profile-page">
        <div className="section-header">Thème</div>
        {[
          { value: 'light', label: '☀️ Mode clair', sub: 'Interface blanche et minimaliste' },
          { value: 'dark', label: '🌙 Mode sombre', sub: 'Interface noire pour les yeux' },
        ].map(t => (
          <div key={t.value} className="menu-row" onClick={() => applyTheme(t.value)}>
            <div><div className="menu-row-text">{t.label}</div><div className="menu-row-sub">{t.sub}</div></div>
            {prefs.theme === t.value && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </div>
        ))}
        <div className="divider-full" />
        <div className="section-header">Taille du texte</div>
        {[
          { value: 'small', label: 'Petit', size: 13 },
          { value: 'medium', label: 'Moyen', size: 15 },
          { value: 'large', label: 'Grand', size: 17 },
        ].map(f => (
          <div key={f.value} className="menu-row" onClick={() => {
            document.documentElement.style.fontSize = `${f.size}px`;
            savePrefs({ font_size: f.value });
          }}>
            <div className="menu-row-text" style={{ fontSize: f.size }}>{f.label}</div>
            {prefs.font_size === f.value && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            )}
          </div>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // Privacy settings
  if (section === 'privacy') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Confidentialité</span>
      </div>
      <div className="profile-page">
        <div className="section-header">Sécurité</div>
        <div className="toggle-row">
          <div className="toggle-label">
            <div className="toggle-label-text">Vérification en deux étapes</div>
            <div className="toggle-label-sub">Code envoyé par email à chaque connexion</div>
          </div>
          <div
            className={`toggle ${profile?.two_factor_enabled ? 'on' : ''}`}
            onClick={async () => {
              const newVal = !profile?.two_factor_enabled;
              await supabase.from('profiles').update({ two_factor_enabled: newVal }).eq('id', user.id);
              await refreshProfile();
              showToast(newVal ? '2FA activée ✓' : '2FA désactivée');
            }}
          >
            <div className="toggle-thumb" />
          </div>
        </div>
        <div className="divider" />
        <div className="section-header">Messages</div>
        <div className="toggle-row">
          <div className="toggle-label">
            <div className="toggle-label-text">Confirmations de lecture</div>
            <div className="toggle-label-sub">Les autres voient quand vous lisez</div>
          </div>
          <div className={`toggle ${prefs.read_receipts ? 'on' : ''}`} onClick={() => savePrefs({ read_receipts: !prefs.read_receipts })}>
            <div className="toggle-thumb" />
          </div>
        </div>
        <div className="divider" />
        <div className="section-header">Compte</div>
        <div className="menu-row" onClick={async () => {
          await supabase.from('stories').delete().eq('user_id', user.id);
          showToast('Statuts supprimés ✓');
        }}>
          <div className="menu-row-icon" style={{ background: '#fef2f2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </div>
          <div><div className="menu-row-text" style={{ color: 'var(--danger)' }}>Supprimer tous mes statuts</div></div>
        </div>
        <div className="menu-row" onClick={async () => {
          await supabase.from('user_contacts').delete().eq('user_id', user.id);
          showToast('Contacts supprimés ✓');
        }}>
          <div className="menu-row-icon" style={{ background: '#fef2f2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div><div className="menu-row-text" style={{ color: 'var(--danger)' }}>Supprimer tous mes contacts</div></div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // Stats section
  if (section === 'stats') return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => setSection('main')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Statistiques</span>
      </div>
      <div className="profile-page">
        <div className="stats-grid">
          {[
            { value: stats?.messages_sent || 0, label: 'Messages envoyés' },
            { value: stats?.conversations || 0, label: 'Conversations' },
            { value: stats?.contacts || 0, label: 'Contacts' },
            { value: stats?.groups || 0, label: 'Groupes' },
            { value: stats?.stories_posted || 0, label: 'Statuts postés' },
            { value: stats ? Math.floor((Date.now() - new Date(stats.member_since)) / (1000 * 60 * 60 * 24)) : 0, label: 'Jours sur Yo' },
          ].map((s, i) => (
            <div key={i} className="stat-card">
              <div className="stat-value">{s.value.toLocaleString()}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  // Main settings
  return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="top-bar-title">Paramètres</span>
      </div>
      <div className="profile-page">
        {[
          { id: 'notifications', icon: '🔔', label: 'Notifications', sub: 'Sons, aperçus' },
          { id: 'appearance', icon: '🎨', label: 'Apparence', sub: 'Thème, taille du texte' },
          { id: 'privacy', icon: '🔒', label: 'Confidentialité', sub: 'Lectures, contacts, données' },
          { id: 'stats', icon: '📊', label: 'Mes statistiques', sub: 'Messages, contacts, activité' },
        ].map(item => (
          <React.Fragment key={item.id}>
            <div className="menu-row" onClick={() => setSection(item.id)}>
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

        <div className="section-header" style={{ marginTop: 8 }}>À propos</div>
        <div className="menu-row" onClick={() => {
          if (navigator.share) navigator.share({ title: 'Yo', url: window.location.origin });
          else { navigator.clipboard.writeText(window.location.origin); showToast('Lien copié !'); }
        }}>
          <div className="menu-row-icon" style={{ fontSize: 18 }}>🔗</div>
          <div><div className="menu-row-text">Partager Yo</div><div className="menu-row-sub">{window.location.origin}</div></div>
        </div>
        <div className="divider" />
        <div className="menu-row">
          <div className="menu-row-icon" style={{ fontSize: 18 }}>ℹ️</div>
          <div><div className="menu-row-text">Version</div><div className="menu-row-sub">Yo v1.0.0 · Phase 4</div></div>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
