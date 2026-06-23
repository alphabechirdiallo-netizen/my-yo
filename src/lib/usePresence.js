import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

export function usePresence(userId) {
  const channelRef = useRef(null);

  useEffect(() => {
    if (!userId) return;

    const updatePresence = (isOnline) => {
      supabase.from('profiles').update({
        is_online: isOnline,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', userId).then(() => {});
    };

    // Register session
    const deviceType = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    const deviceName = /iPhone/i.test(navigator.userAgent) ? 'iPhone' :
                       /Android/i.test(navigator.userAgent) ? 'Android' :
                       /Mac/i.test(navigator.userAgent) ? 'Mac' : 'PC';

    supabase.from('user_sessions').insert({
      user_id: userId,
      device_name: deviceName,
      device_type: deviceType,
      last_active: new Date().toISOString(),
    }).then(() => {});

    updatePresence(true);

    channelRef.current = supabase.channel(`presence:${userId}`);
    channelRef.current.subscribe();

    const handleUnload = () => updatePresence(false);
    window.addEventListener('beforeunload', handleUnload);
    const interval = setInterval(() => updatePresence(true), 30000);

    return () => {
      updatePresence(false);
      window.removeEventListener('beforeunload', handleUnload);
      clearInterval(interval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [userId]);
}
