import React, { useState, useEffect } from 'react';
import { useNetworkStatus } from '../lib/useNetworkStatus';

export default function NetworkBanner() {
  const { isOnline } = useNetworkStatus();
  const [show, setShow] = useState(false);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setShow(true);
      setReconnected(false);
    } else if (show) {
      setReconnected(true);
      setTimeout(() => {
        setShow(false);
        setReconnected(false);
      }, 2000);
    }
  }, [isOnline, show]);

  if (!show) return null;

  return (
    <div className={`network-banner ${reconnected ? 'reconnected' : 'offline'}`}>
      {reconnected ? '✅ Connexion rétablie' : '⚠️ Pas de connexion internet'}
    </div>
  );
}
