import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatTime } from '../lib/utils';

export default function Chats({ onNewChat, onStoriesClick, onSearchClick }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [storiesPreviews, setStoriesPreviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('conversations')
      .select(`
        id, participant_a, participant_b,
        last_message, last_message_at, unread_a, unread_b,
        profile_a:profiles!conversations_participant_a_fkey(id, name, username, avatar_url, is_online, last_seen),
        profile_b:profiles!conversations_participant_b_fkey(id, name, username, avatar_url, is_online, last_seen)
      `)
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .order('last_message_at', { ascending: false });
    setConversations(data || []);
    setLoading(false);
  }, [user]);

  const fetchStoriesPreviews = useCallback(async () => {
    if (!user) return;
    // My stories
    const { data: mine } = await supabase.from('stories').select('id, user_id').eq('user_id', user.id).gt('expires_at', new Date().toISOString()).limit(1);
    // Contacts stories
    const { data: contactIds } = await supabase.from('user_contacts').select('contact_id').eq('user_id', user.id);
    let contactStories = [];
    if (contactIds?.length) {
      const ids = contactIds.map(c => c.contact_id);
      const { data } = await supabase.from('stories')
        .select('user_id, profiles!stories_user_id_fkey(id, name, avatar_url)')
        .in('user_id', ids)
        .gt('expires_at', new Date().toISOString())
        .limit(8);
      // Unique users
      const seen = new Set();
      contactStories = (data || []).filter(s => { if (seen.has(s.user_id)) return false; seen.add(s.user_id); return true; });
    }
    setStoriesPreviews({ mine: mine?.length > 0, contacts: contactStories });
  }, [user]);

  useEffect(() => {
    fetchConversations();
    fetchStoriesPreviews();
    const channel = supabase.channel('conversations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, fetchConversations)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchConversations, fetchStoriesPreviews]);

  const getOther = (conv) => conv.participant_a === user.id ? conv.profile_b : conv.profile_a;
  const getUnread = (conv) => conv.participant_a === user.id ? (conv.unread_a || 0) : (conv.unread_b || 0);
  const totalUnread = conversations.reduce((acc, c) => acc + getUnread(c), 0);
  const filtered = conversations.filter(c => {
    const p = getOther(c);
    return !search || (p?.name || '').toLowerCase().includes(search.toLowerCase());
  });

  const hasStories = storiesPreviews.mine || storiesPreviews.contacts?.length > 0;

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">
          Messages {totalUnread > 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>({totalUnread})</span>}
        </span>
        <button className="top-bar-action" onClick={onSearchClick} title="Rechercher">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button className="top-bar-action" onClick={onNewChat} title="Nouveau message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
        </button>
      </div>

      <div className="content">
        {/* Stories bar */}
        {(hasStories || true) && (
          <div className="stories-bar">
            {/* My story */}
            <div className="story-item" onClick={onStoriesClick}>
              <div className={`story-ring ${storiesPreviews.mine ? '' : 'add'}`} style={{ width: 58, height: 58 }}>
                {storiesPreviews.mine ? (
                  <div className="story-ring-inner">
                    <Avatar profile={profile} size={53} />
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
                    <Avatar profile={profile} size={38} />
                    <div style={{ position: 'relative', width: 18, height: 18, background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: -10, marginLeft: 20, border: '2px solid var(--bg)' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </div>
                  </div>
                )}
              </div>
              <span className="story-username">Mon statut</span>
            </div>

            {/* Contacts stories */}
            {(storiesPreviews.contacts || []).map(s => (
              <div key={s.user_id} className="story-item" onClick={onStoriesClick}>
                <div className="story-ring" style={{ width: 58, height: 58, padding: 2 }}>
                  <div className="story-ring-inner">
                    {s.profiles?.avatar_url ? (
                      <img src={`https://${process.env.REACT_APP_SUPABASE_URL?.split('//')[1]}/storage/v1/object/public/avatars/${s.profiles.avatar_url}`} alt="" />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {s.profiles?.name?.charAt(0)?.toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
                <span className="story-username">{s.profiles?.name?.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Search bar */}
        {conversations.length > 0 && (
          <div className="search-bar">
            <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input className="search-input" type="text" placeholder="Rechercher" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}

        {filtered.length === 0 && !search ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div className="empty-title">Aucune conversation</div>
            <div className="empty-sub">Ajoutez des contacts puis<br />démarrez une discussion</div>
            <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '0 24px' }} onClick={onNewChat}>
              Nouveau message
            </button>
          </div>
        ) : (
          filtered.map(conv => {
            const other = getOther(conv);
            const unread = getUnread(conv);
            return (
              <div key={conv.id} className="contact-row" onClick={() => navigate(`/chat/${conv.id}`)}>
                <Avatar profile={other} size={50} showOnline />
                <div className="contact-info">
                  <div className="contact-name">{other?.name || 'Inconnu'}</div>
                  <div className="contact-sub" style={{ fontWeight: unread > 0 ? 600 : 400, color: unread > 0 ? 'var(--text-primary)' : undefined }}>
                    {conv.last_message || 'Nouvelle conversation'}
                  </div>
                </div>
                <div className="contact-meta">
                  <div className="contact-time" style={{ color: unread > 0 ? 'var(--accent)' : undefined }}>
                    {formatTime(conv.last_message_at)}
                  </div>
                  {unread > 0 && <div className="unread-badge">{unread}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
