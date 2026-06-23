import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

export function LocationPicker({ convId, groupId, onClose, onShared }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const shareCurrentLocation = () => {
    setLoading(true);
    setError('');
    if (!navigator.geolocation) {
      setError('Géolocalisation non supportée');
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const { error: dbErr } = await supabase.from('location_shares').insert({
          sender_id: user.id,
          conversation_id: convId || null,
          group_id: groupId || null,
          latitude,
          longitude,
          live: false,
          created_at: new Date().toISOString(),
        });
        if (!dbErr) onShared({ latitude, longitude });
        else setError('Erreur lors du partage');
        setLoading(false);
      },
      (err) => {
        setError('Impossible d\'obtenir la localisation');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '50vh' }}>
        <div className="modal-handle" />
        <div className="modal-title">Partager la localisation</div>
        <div className="modal-content">
          <div
            className="menu-row"
            style={{ padding: '16px 0', borderRadius: 10, background: 'var(--bg-secondary)', marginBottom: 10 }}
            onClick={shareCurrentLocation}
          >
            <div className="menu-row-icon" style={{ background: '#dcfce7' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.8">
                <circle cx="12" cy="10" r="3"/>
                <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z"/>
              </svg>
            </div>
            <div>
              <div className="menu-row-text">Position actuelle</div>
              <div className="menu-row-sub">Partager ma position maintenant</div>
            </div>
            {loading && <div className="spinner" style={{ marginLeft: 'auto' }} />}
          </div>
          {error && <p className="error-msg">{error}</p>}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Votre position sera partagée une seule fois dans la conversation.
          </p>
        </div>
      </div>
    </div>
  );
}

// Location message card
export function LocationCard({ latitude, longitude, isOut }) {
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const staticMap = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=220x120&markers=${latitude},${longitude}`;

  return (
    <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="location-card">
        <div className="location-map-preview" style={{ background: isOut ? 'rgba(255,255,255,0.1)' : 'var(--bg-hover)' }}>
          <div style={{ fontSize: 40 }}>📍</div>
          <div style={{
            position: 'absolute', bottom: 6, right: 8,
            background: 'var(--accent)', color: 'white',
            fontSize: 11, fontWeight: 600, padding: '3px 8px',
            borderRadius: 20,
          }}>
            Ouvrir
          </div>
        </div>
        <div className="location-info" style={{ background: isOut ? 'rgba(255,255,255,0.05)' : undefined }}>
          <div className="location-name" style={{ color: isOut ? 'white' : undefined }}>
            📍 Localisation partagée
          </div>
          <div className="location-coords" style={{ color: isOut ? 'rgba(255,255,255,0.6)' : undefined }}>
            {parseFloat(latitude).toFixed(4)}, {parseFloat(longitude).toFixed(4)}
          </div>
        </div>
      </div>
    </a>
  );
}
