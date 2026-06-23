import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatTime } from '../lib/utils';

export default function Favorites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('favorites')
      .select(`
        id, conversation_id,
        conversations!favorites_conversation_id_fkey(
          id, last_message, last_message_at, participant_a, participant_b,
          profile_a:profiles!conversations_participant_a_fkey(id, name, avatar_url, is_online),
          profile_b:profiles!conversations_participant_b_fkey(id, name, avatar_url, is_online)
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setFavorites(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const removeFavorite = async (e, favId) => {
    e.stopPropagation();
    await supabase.from('favorites').delete().eq('id', favId);
    setFavorites(prev => prev.filter(f => f.id !== favId));
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">Favoris</span>
      </div>
      <div className="content">
        {favorites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </div>
            <div className="empty-title">Aucun favori</div>
            <div className="empty-sub">Appuyez sur ★ dans une conversation<br />pour l'ajouter ici</div>
          </div>
        ) : (
          <>
            <div className="section-header">{favorites.length} favori{favorites.length > 1 ? 's' : ''}</div>
            {favorites.map(fav => {
              const conv = fav.conversations;
              if (!conv) return null;
              const other = conv.participant_a === user.id ? conv.profile_b : conv.profile_a;
              return (
                <div key={fav.id} className="contact-row" onClick={() => navigate(`/chat/${conv.id}`)}>
                  <Avatar profile={other} size={48} showOnline />
                  <div className="contact-info">
                    <div className="contact-name">{other?.name || 'Inconnu'}</div>
                    <div className="contact-sub">{conv.last_message || 'Aucun message'}</div>
                  </div>
                  <div className="contact-meta">
                    <div className="contact-time">{formatTime(conv.last_message_at)}</div>
                    <button
                      onClick={(e) => removeFavorite(e, fav.id)}
                      className="fav-star active"
                      title="Retirer des favoris"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
