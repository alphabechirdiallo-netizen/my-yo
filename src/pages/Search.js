import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { formatTime } from '../lib/utils';

export default function Search({ onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ messages: [], contacts: [], groups: [] });
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const timeoutRef = useRef(null);

  const handleSearch = (q) => {
    setQuery(q);
    clearTimeout(timeoutRef.current);
    if (!q.trim()) { setResults({ messages: [], contacts: [], groups: [] }); return; }
    timeoutRef.current = setTimeout(() => doSearch(q), 300);
  };

  const doSearch = async (q) => {
    setLoading(true);
    const [msgRes, contactRes, groupRes] = await Promise.all([
      // Search messages
      supabase.rpc('search_messages', { query: q, user_uuid: user.id }),
      // Search contacts
      supabase.from('user_contacts')
        .select('contact_id, profiles!user_contacts_contact_id_fkey(id, name, username, avatar_url, bio)')
        .eq('user_id', user.id)
        .or(`profiles.name.ilike.%${q}%,profiles.username.ilike.%${q}%`),
      // Search groups
      supabase.from('group_members')
        .select('group_id, groups!group_members_group_id_fkey(id, name, last_message)')
        .eq('user_id', user.id)
        .ilike('groups.name', `%${q}%`),
    ]);

    setResults({
      messages: msgRes.data || [],
      contacts: (contactRes.data || []).map(d => d.profiles).filter(p => p && (p.name?.toLowerCase().includes(q.toLowerCase()) || p.username?.toLowerCase().includes(q.toLowerCase()))),
      groups: (groupRes.data || []).map(d => d.groups).filter(g => g && g.name?.toLowerCase().includes(q.toLowerCase())),
    });
    setLoading(false);
  };

  const highlight = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i}>{part}</mark>
        : part
    );
  };

  const openConversationWithContact = async (contactId) => {
    const { data: existing } = await supabase
      .from('conversations').select('id')
      .or(`and(participant_a.eq.${user.id},participant_b.eq.${contactId}),and(participant_a.eq.${contactId},participant_b.eq.${user.id})`)
      .single();
    if (existing) { navigate(`/chat/${existing.id}`); onClose(); }
  };

  const allEmpty = results.messages.length === 0 && results.contacts.length === 0 && results.groups.length === 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 100, display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <div className="top-bar">
        <button className="top-bar-action" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="search-bar" style={{ flex: 1, margin: '0 8px' }}>
          <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Rechercher..."
            value={query}
            onChange={e => handleSearch(e.target.value)}
            autoFocus
            style={{ height: 40 }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults({ messages: [], contacts: [], groups: [] }); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {query && !allEmpty && (
        <div className="tabs">
          {['all', 'contacts', 'messages', 'groups'].map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}
              style={{ fontSize: 13 }}>
              {t === 'all' ? 'Tout' : t === 'contacts' ? `Contacts (${results.contacts.length})` : t === 'messages' ? `Messages (${results.messages.length})` : `Groupes (${results.groups.length})`}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="search-results">
        {!query && (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div className="empty-title">Rechercher</div>
            <div className="empty-sub">Contacts, messages, groupes</div>
          </div>
        )}

        {loading && <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}

        {query && !loading && allEmpty && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Aucun résultat pour "{query}"
          </div>
        )}

        {/* Contacts */}
        {(tab === 'all' || tab === 'contacts') && results.contacts.length > 0 && (
          <>
            <div className="section-header">Contacts</div>
            {results.contacts.map(c => (
              <div key={c.id} className="contact-row" onClick={() => openConversationWithContact(c.id)}>
                <div className="avatar-placeholder" style={{ width: 44, height: 44, fontSize: 16 }}>
                  {c.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="contact-info">
                  <div className="contact-name">{highlight(c.name, query)}</div>
                  <div className="contact-sub">{c.username ? `@${highlight(c.username, query)}` : c.bio || ''}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Groups */}
        {(tab === 'all' || tab === 'groups') && results.groups.length > 0 && (
          <>
            <div className="section-header">Groupes</div>
            {results.groups.map(g => (
              <div key={g.id} className="contact-row" onClick={() => { navigate(`/group/${g.id}`); onClose(); }}>
                <div className="group-avatar" style={{ width: 44, height: 44, fontSize: 18 }}>
                  {g.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="contact-info">
                  <div className="contact-name">{highlight(g.name, query)}</div>
                  <div className="contact-sub">{g.last_message || 'Groupe'}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Messages */}
        {(tab === 'all' || tab === 'messages') && results.messages.length > 0 && (
          <>
            <div className="section-header">Messages</div>
            {results.messages.map(m => (
              <div key={m.message_id} className="search-result-item"
                onClick={() => { navigate(`/chat/${m.conversation_id}`); onClose(); }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 3 }}>{m.sender_name}</div>
                <div className="search-result-text">{highlight(m.content, query)}</div>
                <div className="search-result-meta">{formatTime(m.created_at)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
