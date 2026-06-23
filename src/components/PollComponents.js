import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// Poll Creator Modal
export function PollCreator({ groupId, conversationId, onClose, onCreated }) {
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [loading, setLoading] = useState(false);

  const addOption = () => {
    if (options.length < 6) setOptions([...options, '']);
  };

  const updateOption = (i, val) => {
    const updated = [...options];
    updated[i] = val;
    setOptions(updated);
  };

  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  };

  const handleCreate = async () => {
    if (!question.trim()) return;
    const validOptions = options.filter(o => o.trim());
    if (validOptions.length < 2) return;
    setLoading(true);

    const optionsData = validOptions.map((text, i) => ({
      id: `opt_${i}`,
      text: text.trim(),
      voters: [],
    }));

    const { error } = await supabase.from('polls').insert({
      group_id: groupId || null,
      conversation_id: conversationId || null,
      creator_id: user.id,
      question: question.trim(),
      options: optionsData,
      multiple,
    });

    if (!error) onCreated();
    else { console.error(error); setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-title">Nouveau sondage</div>
        <div className="modal-content">
          <div className="input-group-full">
            <label className="input-label">Question</label>
            <input
              className="input-field"
              placeholder="Posez votre question..."
              value={question}
              onChange={e => setQuestion(e.target.value)}
              autoFocus
            />
          </div>

          <label className="input-label" style={{ marginBottom: 8 }}>Options</label>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                className="input-field"
                style={{ flex: 1 }}
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={e => updateOption(i, e.target.value)}
              />
              {options.length > 2 && (
                <button onClick={() => removeOption(i)} style={{ color: 'var(--text-muted)', padding: '0 6px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
          ))}

          {options.length < 6 && (
            <button
              onClick={addOption}
              style={{ width: '100%', height: 44, border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}
            >
              + Ajouter une option
            </button>
          )}

          <div className="toggle-row" style={{ padding: 0, marginBottom: 16 }}>
            <div className="toggle-label">
              <div className="toggle-label-text">Choix multiple</div>
              <div className="toggle-label-sub">Autoriser plusieurs réponses</div>
            </div>
            <div className={`toggle ${multiple ? 'on' : ''}`} onClick={() => setMultiple(!multiple)}>
              <div className="toggle-thumb" />
            </div>
          </div>

          <button
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={handleCreate}
            disabled={loading || !question.trim() || options.filter(o => o.trim()).length < 2}
          >
            {loading ? 'Création...' : 'Créer le sondage'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Poll Card (display in chat)
export function PollCard({ poll, isOut }) {
  const { user } = useAuth();
  const [localPoll, setLocalPoll] = useState(poll);
  const [myVote, setMyVote] = useState(null);
  const [loading, setLoading] = useState(false);

  const totalVotes = (localPoll.options || []).reduce((acc, o) => acc + (o.voters?.length || 0), 0);

  const handleVote = async (optionId) => {
    if (loading) return;
    setLoading(true);

    // Check existing vote
    const { data: existing } = await supabase
      .from('poll_votes')
      .select('id, option_ids')
      .eq('poll_id', localPoll.id)
      .eq('user_id', user.id)
      .single();

    let newOptions = [...(localPoll.options || [])];

    if (existing) {
      // Update vote
      const prevOptionId = existing.option_ids[0];
      newOptions = newOptions.map(o => ({
        ...o,
        voters: o.id === prevOptionId
          ? (o.voters || []).filter(v => v !== user.id)
          : o.id === optionId
          ? [...(o.voters || []), user.id]
          : o.voters || [],
      }));
      await supabase.from('poll_votes').update({ option_ids: [optionId] }).eq('id', existing.id);
    } else {
      // New vote
      newOptions = newOptions.map(o => ({
        ...o,
        voters: o.id === optionId ? [...(o.voters || []), user.id] : o.voters || [],
      }));
      await supabase.from('poll_votes').insert({ poll_id: localPoll.id, user_id: user.id, option_ids: [optionId] });
    }

    // Update poll options in DB
    await supabase.from('polls').update({ options: newOptions }).eq('id', localPoll.id);
    setLocalPoll(prev => ({ ...prev, options: newOptions }));
    setMyVote(optionId);
    setLoading(false);
  };

  return (
    <div className="poll-card" style={{ background: isOut ? 'rgba(255,255,255,0.1)' : undefined }}>
      <div className="poll-question" style={{ color: isOut ? 'white' : undefined }}>
        📊 {localPoll.question}
      </div>
      {(localPoll.options || []).map(opt => {
        const votes = opt.voters?.length || 0;
        const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
        const voted = opt.voters?.includes(user.id);
        return (
          <div
            key={opt.id}
            className={`poll-option ${voted ? 'voted' : ''}`}
            onClick={() => handleVote(opt.id)}
            style={{ color: isOut ? 'white' : undefined, borderColor: isOut ? 'rgba(255,255,255,0.3)' : undefined }}
          >
            <div className="poll-option-fill" style={{ width: `${pct}%` }} />
            <span className="poll-option-text">
              {voted && '✓ '}{opt.text}
            </span>
            <span className="poll-option-pct" style={{ color: isOut ? 'rgba(255,255,255,0.7)' : undefined }}>
              {pct}%
            </span>
          </div>
        );
      })}
      <div className="poll-footer" style={{ color: isOut ? 'rgba(255,255,255,0.6)' : undefined }}>
        {totalVotes} vote{totalVotes !== 1 ? 's' : ''} · {localPoll.multiple ? 'Choix multiple' : 'Choix unique'}
      </div>
    </div>
  );
}
