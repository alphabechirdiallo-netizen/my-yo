import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';

export default function Contacts() {
  const { user, unreadNotifs, markNotifsRead } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('contacts'); // contacts | requests | find
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const fetchContacts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_contacts')
      .select('contact_id, profiles!user_contacts_contact_id_fkey(id, name, username, avatar_url, bio, is_online, last_seen)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setContacts((data || []).map(d => d.profiles).filter(Boolean));
    setLoading(false);
  }, [user]);

  const fetchRequests = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('contact_requests')
      .select('id, status, message, created_at, sender:profiles!contact_requests_sender_id_fkey(id, name, username, avatar_url, bio)')
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setRequests(data || []);
  }, [user]);

  useEffect(() => {
    fetchContacts();
    fetchRequests();

    const channel = supabase.channel('contacts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_requests', filter: `receiver_id=eq.${user?.id}` }, fetchRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_contacts', filter: `user_id=eq.${user?.id}` }, fetchContacts)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchContacts, fetchRequests, user]);

  const handleSearch = async (q) => {
    setSearch(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const { data } = await supabase
      .from('profiles')
      .select('id, name, username, avatar_url, bio, is_online')
      .neq('id', user.id)
      .or(`name.ilike.%${q}%,username.ilike.%${q}%`)
      .limit(20);
    // Filter out existing contacts
    const contactIds = contacts.map(c => c.id);
    setSearchResults((data || []).filter(p => !contactIds.includes(p.id)));
  };

  const sendRequest = async (receiverId) => {
    const { error } = await supabase.from('contact_requests').insert({
      sender_id: user.id,
      receiver_id: receiverId,
      status: 'pending',
    });
    if (!error) {
      // Create notification
      await supabase.from('notifications').insert({
        user_id: receiverId,
        type: 'contact_request',
        title: 'Nouvelle demande de contact',
        body: `${user.email} vous a envoyé une demande`,
        data: { sender_id: user.id },
      });
      showToast('Demande envoyée ✓');
      setSearchResults(prev => prev.filter(p => p.id !== receiverId));
    } else if (error.code === '23505') {
      showToast('Demande déjà envoyée');
    }
  };

  const acceptRequest = async (requestId, senderId) => {
    await supabase.rpc('accept_contact_request', { request_id: requestId });
    showToast('Contact ajouté ✓');
    fetchRequests();
    fetchContacts();
  };

  const rejectRequest = async (requestId) => {
    await supabase.from('contact_requests').update({ status: 'rejected' }).eq('id', requestId);
    fetchRequests();
  };

  const openChat = async (contactId) => {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_a.eq.${user.id},participant_b.eq.${contactId}),and(participant_a.eq.${contactId},participant_b.eq.${user.id})`)
      .single();

    if (existing) { navigate(`/chat/${existing.id}`); return; }

    const { data: created } = await supabase
      .from('conversations')
      .insert({ participant_a: user.id, participant_b: contactId, unread_a: 0, unread_b: 0, last_message_at: new Date().toISOString() })
      .select('id').single();

    if (created) navigate(`/chat/${created.id}`);
  };

  const filteredContacts = contacts.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase()) || (c.username || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">Contacts</span>
        <button className="top-bar-action" onClick={() => { setTab('find'); markNotifsRead(); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'contacts' ? 'active' : ''}`} onClick={() => setTab('contacts')}>
          Mes contacts ({contacts.length})
        </button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => { setTab('requests'); markNotifsRead(); }}>
          Demandes {requests.length > 0 && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>({requests.length})</span>}
        </button>
        <button className={`tab ${tab === 'find' ? 'active' : ''}`} onClick={() => setTab('find')}>
          Trouver
        </button>
      </div>

      <div className="content">
        {/* CONTACTS TAB */}
        {tab === 'contacts' && (
          <>
            {contacts.length > 0 && (
              <div className="search-bar">
                <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input className="search-input" type="text" placeholder="Rechercher" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            )}
            {filteredContacts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div className="empty-title">Aucun contact</div>
                <div className="empty-sub">Allez dans "Trouver" pour<br />ajouter des contacts</div>
                <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '0 24px' }} onClick={() => setTab('find')}>
                  Trouver des contacts
                </button>
              </div>
            ) : (
              filteredContacts.map(c => (
                <div key={c.id} className="contact-row" onClick={() => openChat(c.id)}>
                  <Avatar profile={c} size={46} showOnline />
                  <div className="contact-info">
                    <div className="contact-name">{c.name}</div>
                    <div className="contact-sub">{c.username ? `@${c.username}` : c.bio || 'Disponible'}</div>
                  </div>
                  {c.is_online && <div className="chip online">En ligne</div>}
                </div>
              ))
            )}
          </>
        )}

        {/* REQUESTS TAB */}
        {tab === 'requests' && (
          <>
            {requests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </div>
                <div className="empty-title">Aucune demande</div>
                <div className="empty-sub">Les demandes de contact<br />apparaîtront ici</div>
              </div>
            ) : (
              requests.map(req => (
                <div key={req.id} className="request-card">
                  <div className="request-card-header">
                    <Avatar profile={req.sender} size={46} />
                    <div className="contact-info">
                      <div className="contact-name">{req.sender?.name}</div>
                      <div className="contact-sub">{req.sender?.username ? `@${req.sender.username}` : ''}</div>
                    </div>
                  </div>
                  {req.message && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 58, marginBottom: 10 }}>{req.message}</p>}
                  <div className="request-card-actions">
                    <button className="btn-accept" onClick={() => acceptRequest(req.id, req.sender.id)}>Accepter</button>
                    <button className="btn-reject" onClick={() => rejectRequest(req.id)}>Refuser</button>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* FIND TAB */}
        {tab === 'find' && (
          <>
            <div className="search-bar" style={{ marginTop: 12 }}>
              <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="search-input"
                type="text"
                placeholder="Nom ou @utilisateur"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                autoFocus
              />
            </div>

            {!search && (
              <div className="empty-state" style={{ height: 'auto', paddingTop: 40 }}>
                <div className="empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </div>
                <div className="empty-title">Trouver des contacts</div>
                <div className="empty-sub">Recherchez par nom ou<br />nom d'utilisateur @</div>
              </div>
            )}

            {searchResults.map(u => (
              <div key={u.id} className="contact-row">
                <Avatar profile={u} size={46} showOnline />
                <div className="contact-info">
                  <div className="contact-name">{u.name}</div>
                  <div className="contact-sub">{u.username ? `@${u.username}` : u.bio || ''}</div>
                </div>
                <button
                  onClick={() => sendRequest(u.id)}
                  style={{ padding: '6px 14px', background: 'var(--accent)', color: 'white', borderRadius: 20, fontSize: 13, fontWeight: 500 }}
                >
                  Ajouter
                </button>
              </div>
            ))}

            {search && searchResults.length === 0 && (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>
                Aucun utilisateur trouvé pour "{search}"
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
