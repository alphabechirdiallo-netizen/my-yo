import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatTime, formatDateLabel, formatLastSeen } from '../lib/utils';
import { fetchProfileWithPrivacy } from '../lib/presence';
import { useCall } from '../lib/CallContext';
import { ensureUserKeys, getRecipientPublicKey, encryptMessage, decryptMessage } from '../lib/e2ee';
import { PollCreator, PollCard } from '../components/PollComponents';
import { LocationPicker, LocationCard } from '../components/LocationComponents';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function Chat() {
  const { convId } = useParams();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const navigate = useNavigate();
  const [conv, setConv] = useState(null);
  const [otherProfile, setOtherProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [polls, setPolls] = useState([]);
  const [reactions, setReactions] = useState({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [favId, setFavId] = useState(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [pinnedMsg, setPinnedMsg] = useState(null);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [e2eeEnabled, setE2eeEnabled] = useState(false);
  const [myPrivateKey, setMyPrivateKey] = useState(null);
  const [recipientPublicKey, setRecipientPublicKey] = useState(null);
  const [decryptedCache, setDecryptedCache] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (!convId || !user) return;
    supabase.from('conversations').select(`
      id, participant_a, participant_b, unread_a, unread_b,
      pinned_message_id, pinned_message_content, e2ee_enabled,
      profile_a:profiles!conversations_participant_a_fkey(id, name, username, avatar_url, is_online, last_seen, privacy_online),
      profile_b:profiles!conversations_participant_b_fkey(id, name, username, avatar_url, is_online, last_seen, privacy_online)
    `).eq('id', convId).single().then(async ({ data }) => {
      if (!data) return;
      setConv(data);
      setE2eeEnabled(!!data.e2ee_enabled);
      const basicOther = data.participant_a === user.id ? data.profile_b : data.profile_a;
      // Re-fetch is_online/last_seen through the server-enforced privacy view
      // rather than trusting the raw profiles join (defense in depth).
      const securedOther = await fetchProfileWithPrivacy(basicOther?.id);
      setOtherProfile(securedOther || basicOther);
      if (data.pinned_message_content) setPinnedMsg(data.pinned_message_content);

      // Prepare my keys (generates on first use, otherwise loads from IndexedDB)
      const { privateKey } = await ensureUserKeys(user.id, supabase);
      setMyPrivateKey(privateKey);
      if (basicOther?.id) {
        const pubKey = await getRecipientPublicKey(basicOther.id, supabase);
        setRecipientPublicKey(pubKey);
      }
    });
    supabase.from('favorites').select('id').eq('user_id', user.id).eq('conversation_id', convId).single()
      .then(({ data }) => { if (data) { setIsFav(true); setFavId(data.id); } });
    supabase.from('blocked_users').select('id').eq('blocker_id', user.id).single()
      .then(({ data }) => { if (data) setIsBlocked(true); });
    supabase.from('polls').select('*').eq('conversation_id', convId).then(({ data }) => setPolls(data || []));
  }, [convId, user]);

  useEffect(() => {
    if (!convId) return;
    supabase.from('messages')
      .select('id, content, sender_id, created_at, read, type, media_url, media_name, media_size, reply_to, reply_preview, deleted_for_all, edited, is_encrypted, encrypted_content, encrypted_content_sender')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || []);
        setTimeout(() => scrollToBottom(false), 100);
        loadReactions((data || []).map(m => m.id));
      });
  }, [convId, scrollToBottom]);

  // Decrypt encrypted messages as soon as our private key is ready.
  // Sender stores their own copy in encrypted_content_sender so they can re-read it too.
  useEffect(() => {
    if (!myPrivateKey) return;
    const toDecrypt = messages.filter(m => m.is_encrypted && decryptedCache[m.id] === undefined);
    if (!toDecrypt.length) return;

    (async () => {
      const updates = {};
      for (const msg of toDecrypt) {
        const isMine = msg.sender_id === user?.id;
        const payload = isMine ? msg.encrypted_content_sender : msg.encrypted_content;
        if (!payload) { updates[msg.id] = '⚠️ Non déchiffrable'; continue; }
        const isHybrid = payload.startsWith('{');
        const plain = await decryptMessage(payload, myPrivateKey, isHybrid);
        updates[msg.id] = plain ?? '⚠️ Erreur de déchiffrement';
      }
      setDecryptedCache(prev => ({ ...prev, ...updates }));
    })();
  }, [messages, myPrivateKey, user?.id, decryptedCache]);

  const loadReactions = async (msgIds) => {
    if (!msgIds.length) return;
    const { data } = await supabase.from('message_reactions').select('message_id, emoji, user_id').in('message_id', msgIds);
    const map = {};
    (data || []).forEach(r => {
      if (!map[r.message_id]) map[r.message_id] = [];
      map[r.message_id].push(r);
    });
    setReactions(map);
  };

  useEffect(() => {
    if (!user || !conv || !convId) return;
    const field = conv.participant_a === user.id ? 'unread_a' : 'unread_b';
    supabase.from('conversations').update({ [field]: 0 }).eq('id', convId).then(() => {});
    supabase.from('messages').update({ read: true }).eq('conversation_id', convId).neq('sender_id', user.id).then(() => {});
  }, [conv, convId, user]);

  useEffect(() => {
    if (!convId) return;
    const channel = supabase.channel(`chat:${convId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          setMessages(prev => [...prev, payload.new]);
          setTimeout(() => scrollToBottom(), 50);
          if (payload.new.sender_id !== user?.id && conv) {
            const field = conv.participant_a === user.id ? 'unread_a' : 'unread_b';
            supabase.from('conversations').update({ [field]: 0 }).eq('id', convId).then(() => {});
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' },
        () => loadReactions(messages.map(m => m.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'polls', filter: `conversation_id=eq.${convId}` },
        (payload) => setPolls(prev => [...prev, payload.new]))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [convId, user, conv, scrollToBottom, messages]);

  useEffect(() => {
    if (!otherProfile?.id || !convId) return;
    const channel = supabase.channel(`typing:${convId}:${otherProfile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${otherProfile.id}` },
        async () => {
          // Don't trust the raw realtime payload for is_online/last_seen — it bypasses
          // the privacy view entirely. Re-fetch through the server-enforced view instead.
          const secured = await fetchProfileWithPrivacy(otherProfile.id);
          if (secured) setOtherProfile(prev => ({ ...prev, ...secured }));
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'typing_indicators', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          if (payload.new?.user_id !== user?.id) {
            setIsTyping(true);
            setTimeout(() => setIsTyping(false), 3000);
          }
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [otherProfile?.id, convId, user?.id]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (!convId || !user) return;
    supabase.from('typing_indicators').upsert({ conversation_id: convId, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' }).then(() => {});
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      supabase.from('typing_indicators').delete().eq('conversation_id', convId).eq('user_id', user.id).then(() => {});
    }, 2500);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('Fichier trop grand (max 50 Mo)'); return; }
    setAttachment(file);
    setAttachmentPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setShowAttachMenu(false);
  };

  const uploadFile = async (file) => {
    const ext = file.name.split('.').pop();
    const path = `${user.id}/${Date.now()}.${ext}`;
    setUploading(true); setUploadProgress(20);
    const { data, error } = await supabase.storage.from('media').upload(path, file, { upsert: false });
    setUploadProgress(90);
    if (error) { setUploading(false); return null; }
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    setUploading(false); setUploadProgress(0);
    return { url: urlData.publicUrl, name: file.name, size: file.size };
  };

  const sendMessage = async (overrideContent, overrideType) => {
    const content = overrideContent || input.trim();
    const msgType = overrideType || 'text';
    if ((!content && !attachment) || sending || isBlocked) return;
    setSending(true);
    if (!overrideContent) setInput('');
    setReplyTo(null);

    let mediaData = null;
    if (attachment && !overrideContent) {
      mediaData = await uploadFile(attachment);
      setAttachment(null); setAttachmentPreview(null);
    }

    const finalType = attachment && !overrideContent
      ? (attachment.type.startsWith('image/') ? 'image' : attachment.type.startsWith('video/') ? 'video' : 'file')
      : msgType;

    // E2EE only covers plain text messages for now — media/location/polls
    // are sent unencrypted (encrypting media is a separate, larger lift).
    let insertPayload = {
      conversation_id: convId,
      sender_id: user.id,
      content: content || (mediaData ? mediaData.name : ''),
      type: finalType,
      media_url: mediaData?.url || null,
      media_name: mediaData?.name || null,
      media_size: mediaData?.size || null,
      reply_to: replyTo?.id || null,
      reply_preview: replyTo?.content?.slice(0, 60) || null,
      created_at: new Date().toISOString(),
      read: false,
      is_encrypted: false,
    };

    if (e2eeEnabled && finalType === 'text' && recipientPublicKey && myPrivateKey && content) {
      // Encrypt for the recipient with their public key, and keep a copy
      // encrypted with our own public key so we can still read our sent messages.
      const myPublicKeyObj = await window.crypto.subtle.exportKey('jwk', myPrivateKey).catch(() => null);
      const encryptedForRecipient = await encryptMessage(content, recipientPublicKey);
      // Re-derive our own public key from storage to encrypt our copy
      const { publicKeyBase64 } = await ensureUserKeys(user.id, supabase);
      const myPubKeyObj = await window.crypto.subtle.importKey(
        'spki',
        Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0)),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
      );
      const encryptedForSender = await encryptMessage(content, myPubKeyObj);

      insertPayload = {
        ...insertPayload,
        content: '🔒 Message chiffré',
        is_encrypted: true,
        encrypted_content: encryptedForRecipient,
        encrypted_content_sender: encryptedForSender,
      };
    }

    await supabase.from('messages').insert(insertPayload);

    const otherField = conv?.participant_a === user.id ? 'unread_b' : 'unread_a';
    const currentUnread = conv?.participant_a === user.id ? (conv.unread_b || 0) : (conv.unread_a || 0);
    await supabase.from('conversations').update({
      last_message: insertPayload.is_encrypted ? '🔒 Message chiffré' : (content || (finalType === 'image' ? '📷 Photo' : finalType === 'video' ? '🎥 Vidéo' : '📎 Fichier')),
      last_message_at: new Date().toISOString(),
      [otherField]: currentUnread + 1,
    }).eq('id', convId);

    supabase.from('typing_indicators').delete().eq('conversation_id', convId).eq('user_id', user.id).then(() => {});
    setSending(false);
    inputRef.current?.focus();
  };

  const addReaction = async (msgId, emoji) => {
    setEmojiPickerMsgId(null);
    const existing = reactions[msgId]?.find(r => r.user_id === user.id);
    if (existing) {
      if (existing.emoji === emoji) await supabase.from('message_reactions').delete().eq('message_id', msgId).eq('user_id', user.id);
      else await supabase.from('message_reactions').update({ emoji }).eq('message_id', msgId).eq('user_id', user.id);
    } else {
      await supabase.from('message_reactions').insert({ message_id: msgId, user_id: user.id, emoji });
    }
    loadReactions(messages.map(m => m.id));
  };

  const deleteMessage = async (msgId) => {
    await supabase.from('messages').update({ deleted_for_all: true, content: '' }).eq('id', msgId);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, deleted_for_all: true, content: '' } : m));
  };

  const pinMessage = async (msg) => {
    await supabase.from('conversations').update({ pinned_message_id: msg.id, pinned_message_content: msg.content }).eq('id', convId);
    setPinnedMsg(msg.content);
    setShowMenu(false);
  };

  const toggleFav = async () => {
    if (isFav && favId) {
      await supabase.from('favorites').delete().eq('id', favId);
      setIsFav(false); setFavId(null);
    } else {
      const { data } = await supabase.from('favorites').insert({ user_id: user.id, conversation_id: convId }).select('id').single();
      setIsFav(true); setFavId(data?.id);
    }
  };

  const blockUser = async () => {
    await supabase.from('blocked_users').insert({ blocker_id: user.id, blocked_id: otherProfile.id });
    setIsBlocked(true); setShowMenu(false);
  };
  const unblockUser = async () => {
    await supabase.from('blocked_users').delete().eq('blocker_id', user.id).eq('blocked_id', otherProfile.id);
    setIsBlocked(false);
  };

  const grouped = [];
  let lastDate = '';
  messages.forEach(msg => {
    if (msg.deleted_for_sender && msg.sender_id === user?.id) return;
    const label = formatDateLabel(msg.created_at);
    if (label !== lastDate) { grouped.push({ type: 'date', label }); lastDate = label; }
    grouped.push({ type: 'msg', ...msg });
  });

  // is_online/last_seen are already nulled server-side by profiles_with_privacy
  // when the viewer isn't allowed to see them — no client-side privacy_online
  // check needed here anymore, just check if the data is present.
  const showOnlineStatus = otherProfile?.is_online !== null && otherProfile?.is_online !== undefined;
  const statusText = showOnlineStatus
    ? (otherProfile?.is_online ? 'En ligne' : otherProfile?.last_seen ? `Vu ${formatLastSeen(otherProfile.last_seen)}` : '') : '';

  const groupedReactions = (msgReactions) => {
    if (!msgReactions?.length) return [];
    const g = {};
    msgReactions.forEach(r => {
      if (!g[r.emoji]) g[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
      g[r.emoji].count++;
      if (r.user_id === user?.id) g[r.emoji].mine = true;
    });
    return Object.values(g);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header */}
      <div className="chat-header">
        <button className="chat-header-back" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div onClick={() => navigate(`/user/${otherProfile?.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minWidth: 0 }}>
          <Avatar profile={otherProfile} size={36} showOnline={showOnlineStatus} />
          <div className="chat-header-info">
            <div className="chat-header-name">{otherProfile?.name || '...'}</div>
            {isTyping ? (
              <div className="chat-header-status online">En train d'écrire...</div>
            ) : statusText ? (
              <div className={`chat-header-status ${otherProfile?.is_online ? 'online' : ''}`}>{statusText}</div>
            ) : null}
          </div>
        </div>
        <button className="top-bar-action" onClick={() => initiateCall(otherProfile, 'audio')} title="Appel audio">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.71 14.56 6.53 12.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 5.44 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </button>
        <button className="top-bar-action" onClick={() => initiateCall(otherProfile, 'video')} title="Appel vidéo">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>
        <button onClick={toggleFav} className={`fav-star ${isFav ? 'active' : ''}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button className="top-bar-action" onClick={() => { setShowMenu(!showMenu); setShowAttachMenu(false); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {showMenu && (
        <div style={{ position: 'absolute', right: 12, top: 56, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, zIndex: 30, overflow: 'hidden', minWidth: 200, boxShadow: 'var(--shadow-md)' }}>
          <button onClick={() => navigate(`/user/${otherProfile?.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 16px', fontSize: 14 }}>
            👤 Voir le profil
          </button>
          <button onClick={() => { setShowPollCreator(true); setShowMenu(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 16px', fontSize: 14, borderTop: '1px solid var(--border)' }}>
            📊 Créer un sondage
          </button>
          <button
            onClick={async () => {
              const newVal = !e2eeEnabled;
              setE2eeEnabled(newVal);
              await supabase.from('conversations').update({ e2ee_enabled: newVal }).eq('id', convId);
              setShowMenu(false);
              // If enabling, ensure keys are ready
              if (newVal && !recipientPublicKey && otherProfile?.id) {
                const pubKey = await getRecipientPublicKey(otherProfile.id, supabase);
                setRecipientPublicKey(pubKey);
                if (!pubKey) {
                  alert('⚠️ ' + otherProfile.name + ' n\'a pas encore de clé de chiffrement. Ils doivent ouvrir l\'app au moins une fois pour en générer une.');
                  setE2eeEnabled(false);
                  await supabase.from('conversations').update({ e2ee_enabled: false }).eq('id', convId);
                }
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '13px 16px', fontSize: 14, borderTop: '1px solid var(--border)', color: e2eeEnabled ? 'var(--success)' : undefined }}
          >
            {e2eeEnabled ? '🔒 Chiffrement actif — Désactiver' : '🔓 Activer le chiffrement E2EE'}
          </button>
          {!isBlocked ? (
            <button onClick={blockUser} style={{ display: 'block', width: '100%', padding: '13px 16px', textAlign: 'left', fontSize: 14, color: 'var(--danger)', borderTop: '1px solid var(--border)' }}>
              🚫 Bloquer {otherProfile?.name}
            </button>
          ) : (
            <button onClick={unblockUser} style={{ display: 'block', width: '100%', padding: '13px 16px', textAlign: 'left', fontSize: 14, borderTop: '1px solid var(--border)' }}>
              ✅ Débloquer {otherProfile?.name}
            </button>
          )}
        </div>
      )}

      {/* E2EE active banner */}
      {e2eeEnabled && (
        <div style={{ padding: '6px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>🔒 Chiffrement de bout en bout actif</span>
          {!recipientPublicKey && <span style={{ fontSize: 12, color: '#dc2626' }}>— clé destinataire manquante</span>}
        </div>
      )}

      {/* Pinned message */}
      {pinnedMsg && (
        <div className="pinned-message">
          <svg className="pinned-message-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <div>
            <div className="pinned-message-label">Message épinglé</div>
            <div className="pinned-message-text">{pinnedMsg}</div>
          </div>
          <button onClick={() => setPinnedMsg(null)} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Polls */}
      {polls.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {polls.map(poll => (
            <PollCard key={poll.id} poll={poll} isOut={poll.creator_id === user?.id} />
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" onClick={() => { setShowMenu(false); setShowAttachMenu(false); setEmojiPickerMsgId(null); }}>
        {grouped.map((item, i) => {
          if (item.type === 'date') return <div key={`d${i}`} className="chat-date-sep">{item.label}</div>;
          const isOut = item.sender_id === user?.id;
          const msgReactions = groupedReactions(reactions[item.id]);

          if (item.deleted_for_all) return (
            <div key={item.id} className={`msg-row ${isOut ? 'out' : 'in'}`}>
              {!isOut && <Avatar profile={otherProfile} size={26} />}
              <div className={`msg-bubble ${isOut ? 'out' : 'in'}`}>
                <span className="msg-deleted">🚫 Message supprimé</span>
              </div>
            </div>
          );

          // Location message
          if (item.type === 'location') {
            const [lat, lng] = (item.content || '').split(',');
            return (
              <div key={item.id}>
                <div className={`msg-row ${isOut ? 'out' : 'in'}`}>
                  {!isOut && <Avatar profile={otherProfile} size={26} />}
                  <div className={`msg-bubble ${isOut ? 'out' : 'in'}`} style={{ padding: 4 }}>
                    <LocationCard latitude={lat} longitude={lng} isOut={isOut} />
                    <span className="msg-time">{formatTime(item.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={item.id} style={{ position: 'relative' }}>
              <div className={`msg-row ${isOut ? 'out' : 'in'}`} onDoubleClick={() => setReplyTo(item)}>
                {!isOut && <Avatar profile={otherProfile} size={26} />}
                <div
                  className={`msg-bubble ${isOut ? 'out' : 'in'}`}
                  onContextMenu={e => { e.preventDefault(); setEmojiPickerMsgId(item.id); }}
                >
                  {item.reply_preview && (
                    <div className={`msg-reply-ref ${isOut ? '' : 'in'}`}>↩ {item.reply_preview}</div>
                  )}
                  {item.is_encrypted ? (
                    <span>
                      {decryptedCache[item.id] !== undefined
                        ? <>{decryptedCache[item.id]}<span style={{ fontSize: 10, opacity: 0.5, marginLeft: 5 }}>🔒</span></>
                        : <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Déchiffrement...</span>
                      }
                    </span>
                  ) : item.type === 'image' && item.media_url ? (
                    <div>
                      <img src={item.media_url} alt="media" className="msg-image" onClick={() => setLightboxImg(item.media_url)} />
                      {item.content && item.content !== item.media_name && <div style={{ marginTop: 4, fontSize: 13 }}>{item.content}</div>}
                    </div>
                  ) : item.type === 'file' || item.type === 'video' ? (
                    <a href={item.media_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className={`msg-file ${isOut ? '' : 'in'}`}>
                        <div className="msg-file-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <div className="msg-file-info">
                          <div className="msg-file-name">{item.media_name || item.content}</div>
                          <div className="msg-file-size">{formatFileSize(item.media_size)}</div>
                        </div>
                      </div>
                    </a>
                  ) : (
                    <span>{item.content}</span>
                  )}
                  {item.edited && <span className="msg-edited">(modifié)</span>}
                  <span className="msg-time">
                    {formatTime(item.created_at)}
                    {isOut && (
                      <span className="msg-ticks">
                        {item.read ? (
                          <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
                            <path d="M1 5l3 3 5-7" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6 5l3 3 5-7" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                            <path d="M1 5l3 3 7-7" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                    )}
                  </span>
                </div>

                {/* Action buttons on hover */}
                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <button onClick={() => setReplyTo(item)} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }} title="Répondre">↩</button>
                  <button onClick={e => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === item.id ? null : item.id); }} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }}>😊</button>
                  {isOut && (
                    <>
                      <button onClick={() => pinMessage(item)} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 11, opacity: 0.7 }}>📌</button>
                      <button onClick={() => deleteMessage(item.id)} style={{ padding: '4px 6px', color: 'var(--danger)', fontSize: 13, opacity: 0.7 }}>🗑</button>
                    </>
                  )}
                </div>
              </div>

              {emojiPickerMsgId === item.id && (
                <div className="emoji-picker" style={{ [isOut ? 'right' : 'left']: 40, bottom: 8 }}>
                  {EMOJIS.map(emoji => (
                    <button key={emoji} className="emoji-btn" onClick={() => addReaction(item.id, emoji)}>{emoji}</button>
                  ))}
                </div>
              )}

              {msgReactions.length > 0 && (
                <div className="reactions-bar" style={{ justifyContent: isOut ? 'flex-end' : 'flex-start', paddingLeft: isOut ? 0 : 36, marginTop: 2, marginBottom: 4 }}>
                  {msgReactions.map(r => (
                    <button key={r.emoji} className={`reaction-chip ${r.mine ? 'mine' : ''}`} onClick={() => addReaction(item.id, r.emoji)}>
                      <span>{r.emoji}</span><span className="reaction-count">{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isTyping && (
          <div className="msg-row in">
            <Avatar profile={otherProfile} size={26} />
            <div className="msg-bubble in" style={{ padding: '10px 14px' }}>
              <div className="typing-indicator">
                <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {isBlocked && (
        <div style={{ padding: '10px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', textAlign: 'center', fontSize: 13, color: 'var(--danger)' }}>
          Vous avez bloqué {otherProfile?.name}.{' '}
          <button onClick={unblockUser} style={{ color: 'var(--danger)', fontWeight: 600 }}>Débloquer</button>
        </div>
      )}

      {replyTo && (
        <div className="reply-preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          <div className="reply-preview-text">
            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{replyTo.sender_id === user?.id ? 'Vous' : otherProfile?.name}</span>
            <br />{replyTo.content?.slice(0, 80)}
          </div>
          <button className="reply-preview-close" onClick={() => setReplyTo(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {attachment && (
        <div className="attachment-preview">
          {attachmentPreview ? (
            <img src={attachmentPreview} alt="preview" className="attachment-thumb" />
          ) : (
            <div className="attachment-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
          )}
          <div className="attachment-info">
            <div className="attachment-name">{attachment.name}</div>
            <div className="attachment-size">{formatFileSize(attachment.size)}</div>
            {uploading && <div className="upload-progress"><div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} /></div>}
          </div>
          <button className="attachment-remove" onClick={() => { setAttachment(null); setAttachmentPreview(null); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Attachment menu */}
      {showAttachMenu && (
        <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
          {[
            { label: '📷 Photo/Vidéo', accept: 'image/*,video/*' },
            { label: '📄 Fichier', accept: '*/*' },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => { fileInputRef.current.accept = item.accept; fileInputRef.current?.click(); }}
              style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500 }}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => { setShowLocationPicker(true); setShowAttachMenu(false); }}
            style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500 }}
          >
            📍 Position
          </button>
        </div>
      )}

      {!isBlocked && (
        <div className="chat-input-bar">
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button
            className="media-btn"
            onClick={() => { setShowAttachMenu(!showAttachMenu); setShowMenu(false); }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Message..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            rows={1}
          />
          <button className="send-btn" onClick={() => sendMessage()} disabled={(!input.trim() && !attachment) || sending || uploading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      )}

      {lightboxImg && (
        <div className="lightbox-overlay" onClick={() => setLightboxImg(null)}>
          <button className="lightbox-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          <img src={lightboxImg} alt="full" className="lightbox-img" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {showPollCreator && (
        <PollCreator
          conversationId={convId}
          onClose={() => setShowPollCreator(false)}
          onCreated={() => { setShowPollCreator(false); supabase.from('polls').select('*').eq('conversation_id', convId).then(({ data }) => setPolls(data || [])); }}
        />
      )}

      {showLocationPicker && (
        <LocationPicker
          convId={convId}
          onClose={() => setShowLocationPicker(false)}
          onShared={({ latitude, longitude }) => {
            setShowLocationPicker(false);
            sendMessage(`${latitude},${longitude}`, 'location');
          }}
        />
      )}
    </div>
  );
}
