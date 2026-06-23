import React from 'react';

export function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <div className="skeleton skeleton-avatar" />
      <div className="skeleton-content">
        <div className="skeleton skeleton-line" style={{ width: '55%', marginBottom: 8 }} />
        <div className="skeleton skeleton-line short" style={{ width: '35%' }} />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 6 }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonMessage({ isOut = false }) {
  return (
    <div className={`msg-row ${isOut ? 'out' : 'in'}`} style={{ marginBottom: 8 }}>
      {!isOut && <div className="skeleton" style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0 }} />}
      <div className="skeleton" style={{
        height: 40, width: `${Math.random() * 40 + 30}%`,
        borderRadius: isOut ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
      }} />
    </div>
  );
}

export function SkeletonMessages({ count = 8 }) {
  return (
    <div className="chat-messages">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonMessage key={i} isOut={i % 3 === 0} />
      ))}
    </div>
  );
}
