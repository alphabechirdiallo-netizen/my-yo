import React, { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';

const BG_COLORS = [
  '#0d0d0d', '#1e3a5f', '#1a472a', '#4a1942',
  '#7c2d12', '#1c1917', '#312e81', '#134e4a',
];

// ─── Story Viewer ───
function StoryViewer({ stories, startIndex = 0, onClose }) {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef(null);
  const DURATION = 5000;

  const current = stories[currentIndex];

  const markViewed = useCallback(async (story) => {
    if (story.user_id === user?.id) return;
    await supabase.from('story_views').upsert({ story_id: story.id, viewer_id: user.id }, { onConflict: 'story_id,viewer_id' });
    await supabase.from('stories').update({ views: (story.views || 0) + 1 }).eq('id', story.id);
  }, [user]);

  useEffect(() => {
    if (!current) return;
    markViewed(current);
    setProgress(0);
    clearInterval(intervalRef.current);
    const step = 100 / (DURATION / 100);
    intervalRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(intervalRef.current);
          if (currentIndex < stories.length - 1) setCurrentIndex(i => i + 1);
          else onClose();
          return 100;
        }
        return p + step;
      });
    }, 100);
    return () => clearInterval(intervalRef.current);
  }, [currentIndex, current, markViewed, onClose, stories.length]);

  const goNext = () => {
    if (currentIndex < stories.length - 1) setCurrentIndex(i => i + 1);
    else onClose();
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
    else onClose();
  };

  if (!current) return null;

  const timeAgo = () => {
    const diff = Date.now() - new Date(current.created_at).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 60) return `il y a ${min} min`;
    return `il y a ${Math.floor(min / 60)}h`;
  };

  return (
    <div className="story-viewer">
      {/* Progress bars */}
      <div className="story-viewer-progress">
        {stories.map((_, i) => (
          <div key={i} className="story-progress-bar">
            <div
              className="story-progress-fill"
              style={{ width: i < currentIndex ? '100%' : i === currentIndex ? `${progress}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="story-viewer-header">
        <Avatar profile={current.profile} size={36} />
        <div>
          <div className="story-viewer-name">{current.profile?.name}</div>
          <div className="story-viewer-time">{timeAgo()}</div>
        </div>
        <button className="story-viewer-close" onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Content */}
      <div
        className="story-viewer-content"
        style={{ background: current.bg_color || '#0d0d0d' }}
      >
        {current.type === 'image' && current.media_url ? (
          <img src={current.media_url} alt="story" className="story-viewer-image" />
        ) : (
          <div className="story-viewer-text" style={{ color: current.text_color || '#ffffff' }}>
            {current.content}
          </div>
        )}

        {/* Views count (own story) */}
        {current.user_id === user?.id && (
          <div style={{ position: 'absolute', bottom: 70, left: 16, display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {current.views || 0} vue{(current.views || 0) !== 1 ? 's' : ''}
          </div>
        )}

        {/* Tap zones */}
        <div className="story-tap-left" onClick={goPrev} />
        <div className="story-tap-right" onClick={goNext} />
      </div>

      {/* Reply bar (not own story) */}
      {current.user_id !== user?.id && (
        <div className="story-viewer-reply">
          <input
            className="story-reply-input"
            placeholder={`Répondre à ${current.profile?.name}...`}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                // Send as message in conversation
                e.target.value = '';
              }
            }}
          />
          <button style={{ color: 'white', padding: '0 4px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Story Creator ───
function StoryCreator({ onClose, onCreated }) {
  const { user } = useAuth();
  const [type, setType] = useState('text');
  const [content, setContent] = useState('');
  const [bgColor, setBgColor] = useState('#0d0d0d');
  const [textColor, setTextColor] = useState('#ffffff');
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const handleMediaSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
    setType(file.type.startsWith('video/') ? 'video' : 'image');
  };

  const handlePost = async () => {
    if (!content.trim() && !mediaFile) return;
    setLoading(true);
    let media_url = null;

    if (mediaFile) {
      const ext = mediaFile.name.split('.').pop();
      const path = `stories/${user.id}/${Date.now()}.${ext}`;
      const { data } = await supabase.storage.from('media').upload(path, mediaFile);
      if (data) {
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
        media_url = urlData.publicUrl;
      }
    }

    await supabase.from('stories').insert({
      user_id: user.id,
      type,
      content: content.trim(),
      media_url,
      bg_color: bgColor,
      text_color: textColor,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    setLoading(false);
    onCreated();
  };

  return (
    <div className="story-creator">
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12 }}>
        <button onClick={onClose} style={{ color: 'white' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <span style={{ color: 'white', fontWeight: 600, flex: 1, fontSize: 16 }}>Nouveau statut</span>
        <button
          onClick={handlePost}
          disabled={loading || (!content.trim() && !mediaFile)}
          style={{
            background: 'white', color: '#0d0d0d', borderRadius: 20,
            padding: '8px 18px', fontWeight: 600, fontSize: 14,
            opacity: (!content.trim() && !mediaFile) ? 0.4 : 1,
          }}
        >
          {loading ? '...' : 'Publier'}
        </button>
      </div>

      {/* Preview area */}
      <div style={{ flex: 1, background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        {mediaPreview ? (
          <img src={mediaPreview} alt="preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <textarea
            className="story-text-input"
            placeholder="Tapez votre statut..."
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ color: textColor }}
            autoFocus
          />
        )}
      </div>

      {/* Controls */}
      <div style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.5)' }}>
        {!mediaFile && (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Couleur de fond</div>
            <div className="story-bg-picker" style={{ padding: 0, marginBottom: 12 }}>
              {BG_COLORS.map(color => (
                <div
                  key={color}
                  className={`story-bg-swatch ${bgColor === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => setBgColor(color)}
                />
              ))}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaSelect} />
          <button
            onClick={() => fileRef.current?.click()}
            style={{ flex: 1, height: 44, background: 'rgba(255,255,255,0.15)', borderRadius: 10, color: 'white', fontSize: 14, fontWeight: 500 }}
          >
            📷 Ajouter une photo
          </button>
          {mediaFile && (
            <button
              onClick={() => { setMediaFile(null); setMediaPreview(null); setType('text'); }}
              style={{ height: 44, padding: '0 14px', background: 'rgba(255,255,255,0.15)', borderRadius: 10, color: 'white', fontSize: 14 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Stories Component ───
export default function Stories({ onClose }) {
  const { user, profile } = useAuth();
  const [storiesGroups, setStoriesGroups] = useState([]);
  const [myStories, setMyStories] = useState([]);
  const [viewerStories, setViewerStories] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [showCreator, setShowCreator] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStories = useCallback(async () => {
    if (!user) return;

    // My stories
    const { data: mine } = await supabase
      .from('stories')
      .select('*, profile:profiles!stories_user_id_fkey(id, name, avatar_url)')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });
    setMyStories(mine || []);

    // Contacts' stories
    const { data: contactIds } = await supabase
      .from('user_contacts')
      .select('contact_id')
      .eq('user_id', user.id);

    if (contactIds?.length) {
      const ids = contactIds.map(c => c.contact_id);
      const { data: contactStories } = await supabase
        .from('stories')
        .select('*, profile:profiles!stories_user_id_fkey(id, name, avatar_url)')
        .in('user_id', ids)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });

      // Group by user
      const grouped = {};
      (contactStories || []).forEach(s => {
        if (!grouped[s.user_id]) grouped[s.user_id] = { profile: s.profile, stories: [] };
        grouped[s.user_id].stories.push(s);
      });
      setStoriesGroups(Object.values(grouped));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  const openStories = (stories, index = 0) => {
    setViewerStories(stories);
    setViewerIndex(index);
  };

  if (showCreator) return (
    <StoryCreator
      onClose={() => setShowCreator(false)}
      onCreated={() => { setShowCreator(false); fetchStories(); }}
    />
  );

  if (viewerStories) return (
    <StoryViewer
      stories={viewerStories}
      startIndex={viewerIndex}
      onClose={() => setViewerStories(null)}
    />
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 12px' }}>
          <span style={{ fontSize: 17, fontWeight: 600, flex: 1 }}>Statuts</span>
          <button className="top-bar-action" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-content">
          {/* My story */}
          <div className="contact-row" onClick={() => myStories.length > 0 ? openStories(myStories) : setShowCreator(true)}>
            <div style={{ position: 'relative' }}>
              <Avatar profile={profile} size={52} />
              <div style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 20, height: 20, background: 'var(--accent)', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid var(--bg)',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
            </div>
            <div className="contact-info">
              <div className="contact-name">Mon statut</div>
              <div className="contact-sub">
                {myStories.length > 0
                  ? `${myStories.length} statut${myStories.length > 1 ? 's' : ''} actif${myStories.length > 1 ? 's' : ''}`
                  : 'Appuyez pour ajouter un statut'}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowCreator(true); }}
              style={{ color: 'var(--text-muted)', padding: 8 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>

          <div className="divider" />

          {loading ? (
            <div style={{ padding: 32, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : storiesGroups.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              Vos contacts n'ont pas encore de statuts
            </div>
          ) : (
            <>
              <div className="section-header">Récents</div>
              {storiesGroups.map(group => (
                <div key={group.profile.id} className="contact-row" onClick={() => openStories(group.stories)}>
                  <div className="story-ring" style={{ width: 52, height: 52, padding: 2 }}>
                    <div className="story-ring-inner">
                      {group.profile.avatar_url ? (
                        <img src={group.profile.avatar_url} alt={group.profile.name} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {group.profile.name?.charAt(0)?.toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="contact-info">
                    <div className="contact-name">{group.profile.name}</div>
                    <div className="contact-sub">{group.stories.length} statut{group.stories.length > 1 ? 's' : ''}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
