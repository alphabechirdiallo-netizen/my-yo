import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Avatar from '../components/Avatar';
import { formatTime, formatDateLabel } from '../lib/utils';
import { PollCreator, PollCard } from '../components/PollComponents';
import { LocationPicker, LocationCard } from '../components/LocationComponents';
import { useCall } from '../lib/CallContext';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
function formatFileSize(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} Ko`;
  return `${(b/1048576).toFixed(1)} Mo`;
}

export default function GroupChat() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [polls, setPolls] = useState([]);
  const [reactions, setReactions] = useState({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null);
  const [pinnedMsg, setPinnedMsg] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (!groupId || !user) return;
    supabase.from('groups').select('*').eq('id', groupId).single().then(({ data }) => {
      setGroup(data);
      if (data?.pinned_message_content) setPinnedMsg(data.pinned_message_content);
    });
    supabase.from('group_members')
      .select('user_id, role, profiles!group_members_user_id_fkey(id, name, username, avatar_url, is_online)')
      .eq('group_id', groupId)
      .then(({ data }) => setMembers(data || []));
    supabase.from('group_messages')
      .select('id, content, sender_id, created_at, type, media_url, media_name, media_size, reply_to, reply_preview, deleted_for_all, edited')
      .eq('group_id', groupId).order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || []);
        setTimeout(() => scrollToBottom(false), 100);
        loadReactions((data || []).map(m => m.id));
      });
    supabase.from('polls').select('*').eq('group_id', groupId).then(({ data }) => setPolls(data || []));
  }, [groupId, user, scrollToBottom]);

  const loadReactions = async (msgIds) => {
    if (!msgIds.length) return;
    const { data } = await supabase.from('group_message_reactions').select('message_id, emoji, user_id').in('message_id', msgIds);
    const map = {};
    (data || []).forEach(r => { if (!map[r.message_id]) map[r.message_id] = []; map[r.message_id].push(r); });
    setReactions(map);
  };

  useEffect(() => {
    if (!groupId) return;
    const channel = supabase.channel(`group:${groupId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (p) => { setMessages(prev => [...prev, p.new]); setTimeout(() => scrollToBottom(), 50); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        (p) => setMessages(prev => prev.map(m => m.id === p.new.id ? { ...m, ...p.new } : m)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_message_reactions' },
        () => loadReactions(messages.map(m => m.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'polls', filter: `group_id=eq.${groupId}` },
        (p) => setPolls(prev => [...prev, p.new]))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'typing_indicators', filter: `group_id=eq.${groupId}` },
        (p) => {
          if (p.new?.user_id !== user?.id) {
            const m = members.find(m => m.user_id === p.new?.user_id);
            const name = m?.profiles?.name || 'Quelqu\'un';
            setTypingUsers(prev => [...new Set([...prev, name])]);
            setTimeout(() => setTypingUsers(prev => prev.filter(n => n !== name)), 3000);
          }
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [groupId, user, members, scrollToBottom, messages]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    supabase.from('typing_indicators').upsert({ group_id: groupId, user_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'group_id,user_id' }).then(() => {});
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      supabase.from('typing_indicators').delete().eq('group_id', groupId).eq('user_id', user.id).then(() => {});
    }, 2500);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAttachment(file);
    setAttachmentPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setShowAttachMenu(false);
  };

  const uploadFile = async (file) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `groups/${groupId}/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from('media').upload(path, file);
    if (error) { setUploading(false); return null; }
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    setUploading(false);
    return { url: urlData.publicUrl, name: file.name, size: file.size };
  };

  const sendMessage = async (overrideContent, overrideType) => {
    const content = overrideContent || input.trim();
    if ((!content && !attachment) || sending) return;
    setSending(true);
    if (!overrideContent) { setInput(''); setReplyTo(null); }

    let mediaData = null;
    if (attachment && !overrideContent) {
      mediaData = await uploadFile(attachment);
      setAttachment(null); setAttachmentPreview(null);
    }

    const finalType = attachment && !overrideContent
      ? (attachment.type.startsWith('image/') ? 'image' : attachment.type.startsWith('video/') ? 'video' : 'file')
      : (overrideType || 'text');

    await supabase.from('group_messages').insert({
      group_id: groupId, sender_id: user.id,
      content: content || (mediaData ? mediaData.name : ''),
      type: finalType,
      media_url: mediaData?.url || null,
      media_name: mediaData?.name || null,
      media_size: mediaData?.size || null,
      reply_to: replyTo?.id || null,
      reply_preview: replyTo?.content?.slice(0, 60) || null,
      created_at: new Date().toISOString(),
    });

    await supabase.from('groups').update({
      last_message: content || (finalType === 'image' ? '📷 Photo' : finalType === 'video' ? '🎥 Vidéo' : '📎 Fichier'),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', groupId);

    supabase.from('typing_indicators').delete().eq('group_id', groupId).eq('user_id', user.id).then(() => {});
    setSending(false);
    inputRef.current?.focus();
  };

  const addReaction = async (msgId, emoji) => {
    setEmojiPickerMsgId(null);
    const existing = reactions[msgId]?.find(r => r.user_id === user.id);
    if (existing) {
      if (existing.emoji === emoji) await supabase.from('group_message_reactions').delete().eq('message_id', msgId).eq('user_id', user.id);
      else await supabase.from('group_message_reactions').update({ emoji }).eq('message_id', msgId).eq('user_id', user.id);
    } else {
      await supabase.from('group_message_reactions').insert({ message_id: msgId, user_id: user.id, emoji });
    }
    loadReactions(messages.map(m => m.id));
  };

  const deleteMessage = async (msgId) => {
    await supabase.from('group_messages').update({ deleted_for_all: true, content: '' }).eq('id', msgId);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, deleted_for_all: true } : m));
  };

  const pinMessage = async (msg) => {
    await supabase.from('groups').update({ pinned_message_id: msg.id, pinned_message_content: msg.content }).eq('id', groupId);
    setPinnedMsg(msg.content);
  };

  const leaveGroup = async () => {
    await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
    navigate('/groups');
  };

  const getSenderProfile = (senderId) => members.find(m => m.user_id === senderId)?.profiles || null;

  const grouped = [];
  let lastDate = '';
  messages.forEach(msg => {
    const label = formatDateLabel(msg.created_at);
    if (label !== lastDate) { grouped.push({ type: 'date', label }); lastDate = label; }
    grouped.push({ type: 'msg', ...msg });
  });

  const groupedReactions = (msgReactions) => {
    if (!msgReactions?.length) return [];
    const g = {};
    msgReactions.forEach(r => { if (!g[r.emoji]) g[r.emoji] = { emoji: r.emoji, count: 0, mine: false }; g[r.emoji].count++; if (r.user_id === user?.id) g[r.emoji].mine = true; });
    return Object.values(g);
  };

  const myRole = members.find(m => m.user_id === user?.id)?.role;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header */}
      <div className="chat-header">
        <button className="chat-header-back" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer' }} onClick={() => setShowInfo(true)}>
          <div className="group-avatar" style={{ width: 36, height: 36, fontSize: 16 }}>{group?.name?.charAt(0)?.toUpperCase()}</div>
          <div className="chat-header-info">
            <div className="chat-header-name">{group?.name}</div>
            <div className="chat-header-status">
              {typingUsers.length > 0 ? <span style={{ color: 'var(--online)' }}>{typingUsers.join(', ')} écrit...</span> : `${members.length} membres`}
            </div>
          </div>
        </div>
        <button
          className="top-bar-action"
          title="Appel audio de groupe"
          onClick={() => {
            const firstOtherMember = members.find(m => m.user_id !== user?.id);
            if (firstOtherMember?.profiles) initiateCall(firstOtherMember.profiles, 'audio');
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.71 14.56 6.53 12.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 5.44 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L9.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </button>
        <button className="top-bar-action" onClick={() => { setShowMenu(!showMenu); setShowAttachMenu(false); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
      </div>

      {/* Menu */}
      {showMenu && (
        <div style={{ position: 'absolute', right: 12, top: 56, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, zIndex: 30, overflow: 'hidden', minWidth: 200, boxShadow: 'var(--shadow-md)' }}>
          <button onClick={() => { setShowInfo(true); setShowMenu(false); }} style={{ display: 'flex', width: '100%', padding: '13px 16px', fontSize: 14 }}>ℹ️ Infos du groupe</button>
          <button onClick={() => { setShowPollCreator(true); setShowMenu(false); }} style={{ display: 'flex', width: '100%', padding: '13px 16px', fontSize: 14, borderTop: '1px solid var(--border)' }}>📊 Créer un sondage</button>
          <button onClick={() => { leaveGroup(); }} style={{ display: 'flex', width: '100%', padding: '13px 16px', fontSize: 14, color: 'var(--danger)', borderTop: '1px solid var(--border)' }}>🚪 Quitter le groupe</button>
        </div>
      )}

      {/* Pinned */}
      {pinnedMsg && (
        <div className="pinned-message">
          <svg className="pinned-message-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <div><div className="pinned-message-label">Message épinglé</div><div className="pinned-message-text">{pinnedMsg}</div></div>
          <button onClick={() => setPinnedMsg(null)} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Polls */}
      {polls.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          {polls.map(poll => <PollCard key={poll.id} poll={poll} isOut={poll.creator_id === user?.id} />)}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" onClick={() => { setShowMenu(false); setShowAttachMenu(false); setEmojiPickerMsgId(null); }}>
        {grouped.map((item, i) => {
          if (item.type === 'date') return <div key={`d${i}`} className="chat-date-sep">{item.label}</div>;
          const isOut = item.sender_id === user?.id;
          const senderProfile = getSenderProfile(item.sender_id);
          const msgReactions = groupedReactions(reactions[item.id]);

          if (item.deleted_for_all) return (
            <div key={item.id} className={`msg-row ${isOut ? 'out' : 'in'}`}>
              {!isOut && <Avatar profile={senderProfile} size={26} />}
              <div className={`msg-bubble ${isOut ? 'out' : 'in'}`}><span className="msg-deleted">🚫 Message supprimé</span></div>
            </div>
          );

          if (item.type === 'location') {
            const [lat, lng] = (item.content || '').split(',');
            return (
              <div key={item.id}>
                <div className={`msg-row ${isOut ? 'out' : 'in'}`}>
                  {!isOut && <Avatar profile={senderProfile} size={26} />}
                  <div className={`msg-bubble ${isOut ? 'out' : 'in'}`} style={{ padding: 4 }}>
                    {!isOut && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 4, padding: '0 8px' }}>{senderProfile?.name}</div>}
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
                {!isOut && <Avatar profile={senderProfile} size={26} />}
                <div className={`msg-bubble ${isOut ? 'out' : 'in'}`} onContextMenu={e => { e.preventDefault(); setEmojiPickerMsgId(item.id); }}>
                  {!isOut && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 3 }}>{senderProfile?.name}</div>}
                  {item.reply_preview && <div className={`msg-reply-ref ${isOut ? '' : 'in'}`}>↩ {item.reply_preview}</div>}
                  {item.type === 'image' && item.media_url ? (
                    <img src={item.media_url} alt="media" className="msg-image" onClick={() => setLightboxImg(item.media_url)} />
                  ) : item.type === 'file' || item.type === 'video' ? (
                    <a href={item.media_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className={`msg-file ${isOut ? '' : 'in'}`}>
                        <div className="msg-file-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
                        <div className="msg-file-info"><div className="msg-file-name">{item.media_name || item.content}</div><div className="msg-file-size">{formatFileSize(item.media_size)}</div></div>
                      </div>
                    </a>
                  ) : <span>{item.content}</span>}
                  <span className="msg-time">{formatTime(item.created_at)}</span>
                </div>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <button onClick={() => setReplyTo(item)} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }}>↩</button>
                  <button onClick={e => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === item.id ? null : item.id); }} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 13, opacity: 0.7 }}>😊</button>
                  {(isOut || myRole === 'admin') && (
                    <>
                      <button onClick={() => pinMessage(item)} style={{ padding: '4px 6px', color: 'var(--text-muted)', fontSize: 11, opacity: 0.7 }}>📌</button>
                      <button onClick={() => deleteMessage(item.id)} style={{ padding: '4px 6px', color: 'var(--danger)', fontSize: 13, opacity: 0.7 }}>🗑</button>
                    </>
                  )}
                </div>
              </div>

              {emojiPickerMsgId === item.id && (
                <div className="emoji-picker" style={{ [isOut ? 'right' : 'left']: 40, bottom: 8 }}>
                  {EMOJIS.map(emoji => <button key={emoji} className="emoji-btn" onClick={() => addReaction(item.id, emoji)}>{emoji}</button>)}
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
        <div ref={messagesEndRef} />
      </div>

      {replyTo && (
        <div className="reply-preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          <div className="reply-preview-text">
            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent)' }}>{replyTo.sender_id === user?.id ? 'Vous' : getSenderProfile(replyTo.sender_id)?.name}</span>
            <br />{replyTo.content?.slice(0, 80)}
          </div>
          <button className="reply-preview-close" onClick={() => setReplyTo(null)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {attachment && (
        <div className="attachment-preview">
          {attachmentPreview ? <img src={attachmentPreview} alt="preview" className="attachment-thumb" /> : (
            <div className="attachment-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
          )}
          <div className="attachment-info"><div className="attachment-name">{attachment.name}</div><div className="attachment-size">{formatFileSize(attachment.size)}</div></div>
          <button className="attachment-remove" onClick={() => { setAttachment(null); setAttachmentPreview(null); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {showAttachMenu && (
        <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={() => { fileInputRef.current.accept = 'image/*,video/*'; fileInputRef.current?.click(); }} style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>📷 Photo/Vidéo</button>
          <button onClick={() => { fileInputRef.current.accept = '*/*'; fileInputRef.current?.click(); }} style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>📄 Fichier</button>
          <button onClick={() => { setShowLocationPicker(true); setShowAttachMenu(false); }} style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 500 }}>📍 Position</button>
        </div>
      )}

      <div className="chat-input-bar">
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
        <button className="media-btn" onClick={() => { setShowAttachMenu(!showAttachMenu); setShowMenu(false); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <textarea ref={inputRef} className="chat-input" placeholder="Message au groupe..." value={input} onChange={handleInputChange}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} rows={1} />
        <button className="send-btn" onClick={() => sendMessage()} disabled={(!input.trim() && !attachment) || sending || uploading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>

      {lightboxImg && (
        <div className="lightbox-overlay" onClick={() => setLightboxImg(null)}>
          <button className="lightbox-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          <img src={lightboxImg} alt="full" className="lightbox-img" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {showPollCreator && (
        <PollCreator groupId={groupId} onClose={() => setShowPollCreator(false)}
          onCreated={() => { setShowPollCreator(false); supabase.from('polls').select('*').eq('group_id', groupId).then(({ data }) => setPolls(data || [])); }} />
      )}

      {showLocationPicker && (
        <LocationPicker groupId={groupId} onClose={() => setShowLocationPicker(false)}
          onShared={({ latitude, longitude }) => { setShowLocationPicker(false); sendMessage(`${latitude},${longitude}`, 'location'); }} />
      )}

      {/* Group Info Modal */}
      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px 16px' }}>
              <div className="group-avatar" style={{ width: 64, height: 64, fontSize: 28, marginBottom: 10 }}>{group?.name?.charAt(0)?.toUpperCase()}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{group?.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{members.length} membres · Créé {new Date(group?.created_at).toLocaleDateString('fr-FR')}</div>
            </div>
            <div className="section-header">Membres</div>
            <div className="modal-content">
              {members.map(m => (
                <div key={m.user_id} className="contact-row" style={{ padding: '8px 0' }}>
                  <Avatar profile={m.profiles} size={40} showOnline />
                  <div className="contact-info">
                    <div className="contact-name">{m.profiles?.name}{m.user_id === user.id && ' (Vous)'}</div>
                    <div className="contact-sub">{m.role === 'admin' ? '👑 Admin' : 'Membre'}</div>
                  </div>
                  {m.profiles?.is_online && <div className="chip online" style={{ fontSize: 11 }}>En ligne</div>}
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
              <button className="btn-danger" style={{ width: '100%' }} onClick={leaveGroup}>🚪 Quitter le groupe</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
