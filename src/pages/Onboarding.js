import React, { useState } from 'react';
import logo from '../assets/logo.png';

const STEPS = [
  {
    icon: '💬',
    title: 'Messagerie ultra-simple',
    sub: 'Envoyez des messages, photos, fichiers et localisations en un instant. Propre et rapide.',
  },
  {
    icon: '👥',
    title: 'Groupes & Contacts',
    sub: 'Créez des groupes, ajoutez des contacts par @username et restez connecté avec vos proches.',
  },
  {
    icon: '📸',
    title: 'Statuts & Stories',
    sub: 'Partagez vos moments avec des statuts qui disparaissent après 24h. Comme dans la vraie vie.',
  },
  {
    icon: '🔒',
    title: 'Privé par défaut',
    sub: 'Contrôlez qui voit votre profil, votre statut en ligne et qui peut vous ajouter.',
  },
];

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else onDone();
  };

  const current = STEPS[step];

  return (
    <div className="onboarding">
      <img src={logo} alt="Yo" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 24 }} />
      <div className="onboarding-icon">{current.icon}</div>
      <div className="onboarding-title">{current.title}</div>
      <div className="onboarding-sub">{current.sub}</div>

      <div className="onboarding-dots">
        {STEPS.map((_, i) => (
          <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} onClick={() => setStep(i)} />
        ))}
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', maxWidth: 320 }}
        onClick={handleNext}
      >
        {step < STEPS.length - 1 ? 'Suivant' : 'Commencer'}
      </button>

      {step < STEPS.length - 1 && (
        <button
          onClick={onDone}
          style={{ marginTop: 14, fontSize: 14, color: 'var(--text-muted)' }}
        >
          Passer
        </button>
      )}
    </div>
  );
}
