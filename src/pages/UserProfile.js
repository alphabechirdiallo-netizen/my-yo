import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatLastSeen } from '../lib/utils';
import { fetchProfileWithPrivacy } from '../lib/presence';

export default function UserProfile() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [isContact, setIsContact] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    if (!userId || !user) return;

    // Fetch full profile for bio/photo (still client-checked) but get
    // is_online/last_seen exclusively through the server-enforced privacy view.
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      fetchProfileWithPrivacy(userId),
    ]).then(([{ data: fullProfile }, securedPresence]) => {
      setProfile({
        ...fullProfile,
        is_online: securedPresence?.is_online ?? null,
        last_seen: securedPresence?.last_seen ?? null,
      });
      setLoading(false);
    });

    supabase.from('user_contacts').select('id').eq('user_id', user.id).eq('contact_id', userId).single()
      .then(({ data }) => setIsContact(!!data));

    supabase.from('contact_requests').select('id').eq('sender_id', user.id).eq('receiver_id', userId).eq('status', 'pending').single()
      .then(({ data }) => setRequestSent(!!data));

    supabase.from('blocked_users').select('id').eq('blocker_id', user.id).eq('blocked_id', userId).single()
      .then(({ data }) => setIsBlocked(!!data));
  }, [userId, user]);

  const sendRequest = async () => {
    await supabase.from('contact_requests').insert({ sender_id: user.id, receiver_id: userId, status: 'pending' });
    await supabase.from('notifications').insert({
      user_id: userId, type: 'contact_request',
      title: 'Nouvelle demande de contact',
      body: `${profile?.name} vous a envoyé une demande`,
      data: { sender_id: user.id },
    });
    setRequestSent(true);
    showToast('Demande envoyée ✓');
  };

  const openChat = async () => {
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_a.eq.${user.id},participant_b.eq.${userId}),and(participant_a.eq.${userId},participant_b.eq.${user.id})`)
      .single();

    if (existing) { navigate(`/chat/${existing.id}`); return; }

    const { data: created } = await supabase.from('conversations')
      .insert({ participant_a: user.id, participant_b: userId, unread_a: 0, unread_b: 0, last_message_at: new Date().toISOString() })
      .select('id').single();

    if (created) navigate(`/chat/${created.id}`);
  };

  const toggleBlock = async () => {
    if (isBlocked) {
      await supabase.from('blocked_users').delete().eq('blocker_id', user.id).eq('blocked_id', userId);
      setIsBlocked(false);
      showToast('Utilisateur débloqué');
    } else {
      await supabase.from('blocked_users').insert({ blocker_id: user.id, blocked_id: userId });
      setIsBlocked(true);
      showToast('Utilisateur bloqué');
    }
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  // is_online is already nulled server-side when not allowed to view
  const canShowOnline = profile?.is_online !== null && profile?.is_online !== undefined;
  const canShowBio = profile?.privacy_bio === 'everyone' || (isContact && profile?.privacy_bio === 'contacts');

  return (
    <>
      <div className="top-bar">
        <button className="top-bar-action" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="top-bar-title">Profil</span>
      </div>

      <div className="user-profile-page">
        {/* Header */}
        <div style={{ padding: '32px 24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <Avatar profile={profile} size={90} showOnline={canShowOnline} />
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px' }}>{profile?.name}</div>
          {profile?.username && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>@{profile.username}</div>}
          {canShowBio && profile?.bio && <div style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>{profile.bio}</div>}
          {canShowOnline && !profile?.is_online && profile?.last_seen && (
            <div className="chip">Vu {formatLastSeen(profile.last_seen)}</div>
          )}
          {canShowOnline && profile?.is_online && <div className="chip online">En ligne</div>}
        </div>

        {/* Actions */}
        {userId !== user?.id && (
          <div style={{ padding: '16px', display: 'flex', gap: 8 }}>
            {isContact ? (
              <button className="btn-primary" style={{ flex: 1 }} onClick={openChat}>
                Envoyer un message
              </button>
            ) : requestSent ? (
              <button className="btn-secondary" style={{ flex: 1 }} disabled>
                Demande envoyée
              </button>
            ) : (
              <button className="btn-primary" style={{ flex: 1 }} onClick={sendRequest}>
                Ajouter aux contacts
              </button>
            )}
          </div>
        )}

        <div className="divider-full" />

        {userId !== user?.id && (
          <div className="menu-row" onClick={toggleBlock} style={{ color: isBlocked ? 'var(--text-primary)' : 'var(--danger)' }}>
            <div className="menu-row-icon" style={{ background: isBlocked ? 'var(--bg-secondary)' : '#fef2f2' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isBlocked ? 'var(--text-primary)' : 'var(--danger)'} strokeWidth="1.8">
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </div>
            <div className="menu-row-text" style={{ color: isBlocked ? 'var(--text-primary)' : 'var(--danger)' }}>
              {isBlocked ? `Débloquer ${profile?.name}` : `Bloquer ${profile?.name}`}
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
