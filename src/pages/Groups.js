import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatTime, formatDateLabel } from '../lib/utils';

export default function Groups() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchGroups();
    const channel = supabase.channel('groups-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, fetchGroups)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  const fetchGroups = async () => {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, avatar_url, last_message, last_message_at, created_by)')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false });
    setGroups((data || []).map(d => d.groups).filter(Boolean));
    setLoading(false);
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">Groupes</span>
        <button className="top-bar-action" onClick={() => setShowCreate(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      <div className="content">
        {groups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="empty-title">Aucun groupe</div>
            <div className="empty-sub">Créez un groupe pour discuter<br />avec plusieurs personnes</div>
            <button className="btn-primary" style={{ marginTop: 16, width: 'auto', padding: '0 24px' }} onClick={() => setShowCreate(true)}>
              Créer un groupe
            </button>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.id} className="contact-row" onClick={() => navigate(`/group/${g.id}`)}>
              <div className="group-avatar" style={{ width: 50, height: 50, fontSize: 20 }}>
                {g.name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="contact-info">
                <div className="contact-name">{g.name}</div>
                <div className="contact-sub">{g.last_message || 'Nouveau groupe'}</div>
              </div>
              <div className="contact-meta">
                <div className="contact-time">{formatTime(g.last_message_at)}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {showCreate && <CreateGroupModal onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); navigate(`/group/${id}`); fetchGroups(); }} />}
    </>
  );
}

function CreateGroupModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('user_contacts')
      .select('contact_id, profiles!user_contacts_contact_id_fkey(id, name, avatar_url, username)')
      .eq('user_id', user.id)
      .then(({ data }) => setContacts((data || []).map(d => d.profiles).filter(Boolean)));
  }, [user]);

  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleCreate = async () => {
    if (!name.trim() || selected.length === 0) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('create_group', { group_name: name.trim(), member_ids: selected });
    if (!error && data) onCreated(data);
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-title">Nouveau groupe</div>
        <div className="modal-content">
          <div className="input-group-full" style={{ marginBottom: 16 }}>
            <label className="input-label">Nom du groupe *</label>
            <input className="input-field" placeholder="Ex : Famille, Amis..." value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          {selected.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {selected.map(id => {
                const c = contacts.find(c => c.id === id);
                return (
                  <div key={id} className="member-chip" onClick={() => toggle(id)}>
                    <Avatar profile={c} size={24} />
                    {c?.name}
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>×</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="section-header" style={{ padding: '0 0 8px' }}>Ajouter des membres</div>
          {contacts.map(c => (
            <div key={c.id} className="contact-row" onClick={() => toggle(c.id)} style={{ padding: '8px 0' }}>
              <div style={{ width: 22, height: 22, border: `2px solid ${selected.includes(c.id) ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, background: selected.includes(c.id) ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                {selected.includes(c.id) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <Avatar profile={c} size={40} />
              <div className="contact-info">
                <div className="contact-name">{c.name}</div>
                <div className="contact-sub">{c.username ? `@${c.username}` : ''}</div>
              </div>
            </div>
          ))}
          <button className="btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={handleCreate} disabled={loading || !name.trim() || selected.length === 0}>
            {loading ? 'Création...' : `Créer le groupe (${selected.length + 1} membres)`}
          </button>
        </div>
      </div>
    </div>
  );
}
