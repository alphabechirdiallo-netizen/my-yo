import React from 'react';
import { supabase } from '../lib/supabase';
import { getInitials } from '../lib/utils';

function getAvatarUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export default function Avatar({ profile, size = 46, showOnline = false }) {
  const url = profile?.avatar_url ? getAvatarUrl(profile.avatar_url) : null;

  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={profile?.name} className="avatar" style={{ width: size, height: size }} />
      ) : (
        <div className="avatar-placeholder" style={{ width: size, height: size, fontSize: size * 0.28 }}>
          {getInitials(profile?.name)}
        </div>
      )}
      {showOnline && profile?.is_online && (
        <div className="online-dot" style={{ width: size * 0.22, height: size * 0.22, bottom: size * 0.01, right: size * 0.01 }} />
      )}
    </div>
  );
}
