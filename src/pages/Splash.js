import React from 'react';
import logo from '../assets/logo.png';

export default function Splash() {
  return (
    <div className="splash">
      <img src={logo} alt="Yo" className="splash-logo" />
      <div className="splash-name">Yo</div>
    </div>
  );
}
