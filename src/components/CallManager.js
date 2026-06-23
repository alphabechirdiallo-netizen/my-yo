import React, { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Note: for production behind strict NATs/firewalls, add a TURN server here
    // e.g. a free tier from Metered.ca or Twilio's TURN service:
    // { urls: 'turn:your-turn-server', username: 'xxx', credential: 'xxx' },
  ],
};

export function useCallManager() {
  const { user, profile } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const peerRef = useRef(null);
  const callIdRef = useRef(null);
  const signalChannelRef = useRef(null);
  const localStreamRef = useRef(null);

  const cleanupCall = useCallback(() => {
    if (peerRef.current) { peerRef.current.close(); peerRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); }
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    callIdRef.current = null;
    if (signalChannelRef.current) { supabase.removeChannel(signalChannelRef.current); signalChannelRef.current = null; }
  }, []);

  const createPeerConnection = useCallback((callId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        supabase.channel(`call_signal:${callId}`).send({
          type: 'broadcast', event: 'ice_candidate',
          payload: { candidate: e.candidate, from: user.id },
        });
      }
    };

    pc.ontrack = (e) => setRemoteStream(e.streams[0]);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
      }
    };

    return pc;
  }, [user]);

  // Listen for incoming calls on my personal channel
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`calls:${user.id}`)
      .on('broadcast', { event: 'incoming_call' }, ({ payload }) => setIncomingCall(payload))
      .on('broadcast', { event: 'call_ended' }, () => {
        setIncomingCall(null);
        setActiveCall(null);
        cleanupCall();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, cleanupCall]);

  const setupSignaling = useCallback((callId, pc) => {
    const channel = supabase.channel(`call_signal:${callId}`)
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.from === user.id) return;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({ type: 'broadcast', event: 'answer', payload: { answer, from: user.id } });
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.from === user.id) return;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
        setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
      })
      .on('broadcast', { event: 'ice_candidate' }, async ({ payload }) => {
        if (payload.from === user.id) return;
        try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) {}
      })
      .subscribe();
    signalChannelRef.current = channel;
    return channel;
  }, [user]);

  const initiateCall = async (otherProfile, type = 'audio') => {
    const constraints = type === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      alert('Impossible d\'accéder au micro/caméra. Vérifiez les permissions.');
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    const { data: session } = await supabase.from('call_sessions').insert({
      caller_id: user.id, receiver_id: otherProfile.id, type, status: 'ringing',
    }).select('id').single();

    const callId = session.id;
    callIdRef.current = callId;

    const pc = createPeerConnection(callId);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    peerRef.current = pc;

    const channel = setupSignaling(callId, pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await supabase.channel(`calls:${otherProfile.id}`).send({
      type: 'broadcast', event: 'incoming_call',
      payload: { callId, callerId: user.id, callerName: profile?.name, type, receiverId: otherProfile.id },
    });

    setTimeout(() => {
      channel.send({ type: 'broadcast', event: 'offer', payload: { offer, from: user.id } });
    }, 600);

    await supabase.from('call_logs').insert({
      caller_id: user.id, receiver_id: otherProfile.id, type, status: 'pending', started_at: new Date().toISOString(),
    });

    setActiveCall({ callId, callerId: user.id, type, otherProfile, status: 'calling' });
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    const constraints = incomingCall.type === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      alert('Impossible d\'accéder au micro/caméra.');
      declineCall();
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    const pc = createPeerConnection(incomingCall.callId);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    peerRef.current = pc;
    callIdRef.current = incomingCall.callId;

    setupSignaling(incomingCall.callId, pc);

    await supabase.from('call_sessions').update({ status: 'accepted' }).eq('id', incomingCall.callId);

    setActiveCall({
      callId: incomingCall.callId,
      callerId: incomingCall.callerId,
      type: incomingCall.type,
      otherProfile: { id: incomingCall.callerId, name: incomingCall.callerName },
      status: 'connecting',
    });
    setIncomingCall(null);
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    await supabase.from('call_sessions').update({ status: 'declined' }).eq('id', incomingCall.callId);
    await supabase.channel(`calls:${incomingCall.callerId}`).send({ type: 'broadcast', event: 'call_ended', payload: {} });
    setIncomingCall(null);
  };

  const endCall = async () => {
    if (!activeCall) return;
    const targetId = activeCall.callerId !== user.id ? activeCall.callerId : activeCall.otherProfile?.id;
    if (targetId) {
      await supabase.channel(`calls:${targetId}`).send({ type: 'broadcast', event: 'call_ended', payload: {} });
    }
    if (activeCall.callId) {
      await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', activeCall.callId);
    }
    cleanupCall();
    setActiveCall(null);
  };

  return { incomingCall, activeCall, localStream, remoteStream, initiateCall, acceptCall, declineCall, endCall };
}

// ─── Incoming Call Banner ───
export function IncomingCallBanner({ call, onAccept, onDecline }) {
  if (!call) return null;
  return (
    <div className="incoming-call">
      <div className="avatar-placeholder" style={{ width: 44, height: 44, fontSize: 16, borderRadius: '50%', flexShrink: 0 }}>
        {call.callerName?.charAt(0)?.toUpperCase()}
      </div>
      <div className="incoming-call-info">
        <div className="incoming-call-name">{call.callerName}</div>
        <div className="incoming-call-type">{call.type === 'video' ? '📹 Appel vidéo entrant' : '📞 Appel audio entrant'}</div>
      </div>
      <div className="incoming-call-actions">
        <button className="incoming-call-btn decline" onClick={onDecline}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.71 14.56 6.53 12.5"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        </button>
        <button className="incoming-call-btn accept" onClick={onAccept}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.71 14.56 6.53 12.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 5.44 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Active Call Screen (with real video elements) ───
export function CallScreen({ call, otherProfile, localStream, remoteStream, onEnd }) {
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const intervalRef = useRef(null);

  const isVideo = call.type === 'video';

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (call.status === 'connected') intervalRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(intervalRef.current);
  }, [call.status]);

  const formatDuration = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const toggleMute = () => {
    if (localStream) { localStream.getAudioTracks().forEach(t => t.enabled = muted); setMuted(!muted); }
  };
  const toggleVideo = () => {
    if (localStream) { localStream.getVideoTracks().forEach(t => t.enabled = videoOff); setVideoOff(!videoOff); }
  };

  return (
    <div className="call-screen" style={{ background: isVideo ? '#000' : undefined }}>
      {isVideo && remoteStream ? (
        <video ref={remoteVideoRef} autoPlay playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}

      {isVideo && localStream && (
        <video
          ref={localVideoRef} autoPlay playsInline muted
          style={{ position: 'absolute', top: 20, right: 16, width: 100, height: 140, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)', zIndex: 5 }}
        />
      )}

      {(!isVideo || !remoteStream) && (
        <div className="call-avatar-ring" style={{ position: 'relative', zIndex: 2 }}>
          <Avatar profile={otherProfile || { name: call.callerName }} size={108} />
        </div>
      )}

      <div className="call-name" style={{ position: 'relative', zIndex: 2, textShadow: isVideo ? '0 2px 8px rgba(0,0,0,0.6)' : 'none' }}>
        {otherProfile?.name || call.callerName}
      </div>
      <div className="call-status" style={{ position: 'relative', zIndex: 2, textShadow: isVideo ? '0 2px 8px rgba(0,0,0,0.6)' : 'none' }}>
        {call.status === 'calling' ? 'Appel en cours...' :
         call.status === 'connecting' ? 'Connexion...' :
         call.status === 'connected' ? <span className="call-duration">{formatDuration(duration)}</span> :
         'Connexion...'}
      </div>

      <div className="call-controls" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button className={`call-btn ${muted ? 'muted' : 'default'}`} onClick={toggleMute}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              {muted ? (
                <><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>
              ) : (
                <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>
              )}
            </svg>
          </button>
          <span className="call-btn-label" style={{ color: 'rgba(255,255,255,0.7)' }}>{muted ? 'Activer' : 'Muet'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <button className="call-btn end" onClick={onEnd}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.71 14.56 6.53 12.5"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
          <span className="call-btn-label" style={{ color: 'rgba(255,255,255,0.7)' }}>Raccrocher</span>
        </div>

        {isVideo && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button className={`call-btn ${videoOff ? 'muted' : 'default'}`} onClick={toggleVideo}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                {videoOff ? (
                  <><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M21 21L3 3"/><path d="M21 7l-5 4V8a2 2 0 0 0-2-2h-1"/></>
                ) : (
                  <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>
                )}
              </svg>
            </button>
            <span className="call-btn-label" style={{ color: 'rgba(255,255,255,0.7)' }}>{videoOff ? 'Activer' : 'Caméra'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
