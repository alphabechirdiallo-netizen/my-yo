import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        console.log('SW registered');
        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          setTimeout(() => {
            Notification.requestPermission();
          }, 5000);
        }
      })
      .catch(err => console.log('SW error:', err));
  });
}
