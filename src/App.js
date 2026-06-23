import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { usePresence } from './lib/usePresence';
import { Analytics } from './lib/analytics';
import Splash from './pages/Splash';
import Auth from './pages/Auth';
import ProfileSetup from './pages/ProfileSetup';
import Onboarding from './pages/Onboarding';
import Chats from './pages/Chats';
import Contacts from './pages/Contacts';
import Favorites from './pages/Favorites';
import Profile from './pages/Profile';
import Chat from './pages/Chat';
import UserProfile from './pages/UserProfile';
import Groups from './pages/Groups';
import GroupChat from './pages/GroupChat';
import Stories from './pages/Stories';
import Search from './pages/Search';
import TwoFactorVerify from './pages/TwoFactorVerify';
import BottomNav from './components/BottomNav';
import NewChatModal from './components/NewChatModal';
import NetworkBanner from './components/NetworkBanner';
import { IncomingCallBanner, CallScreen, useCallManager } from './components/CallManager';
import { CallContext } from './lib/CallContext';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._installPrompt = e;
});

// Apply saved theme
const savedTheme = localStorage.getItem('yo_theme') || 'light';
document.body.classList.toggle('dark', savedTheme === 'dark');

// Apply saved font size
const savedFont = localStorage.getItem('yo_font') || 'medium';
const fontSizes = { small: '13px', medium: '15px', large: '17px' };
document.documentElement.style.fontSize = fontSizes[savedFont] || '15px';

function AppShell() {
  const { user, profile, loading, unreadNotifs } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState('chats');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showStories, setShowStories] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [twoFaVerified, setTwoFaVerified] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { incomingCall, activeCall, localStream, remoteStream, initiateCall, acceptCall, declineCall, endCall } = useCallManager();

  usePresence(user?.id);

  // Splash
  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 1600);
    return () => clearTimeout(t);
  }, []);

  // Onboarding for new users
  useEffect(() => {
    if (user && profile && !localStorage.getItem('yo_onboarded')) {
      setShowOnboarding(true);
    }
  }, [user, profile]);

  // Reset 2FA check when user changes; check if already verified this session
  useEffect(() => {
    if (user) {
      const verifiedKey = `yo_2fa_verified_${user.id}`;
      setTwoFaVerified(sessionStorage.getItem(verifiedKey) === '1');
    }
  }, [user]);

  // Track app open
  useEffect(() => {
    if (user) Analytics.appOpened(user.id);
  }, [user]);

  // Service worker update detection
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setUpdateAvailable(true);
      });
    }
  }, []);

  // Sync active tab
  useEffect(() => {
    const path = location.pathname;
    if (path === '/') setActiveTab('chats');
    else if (path.startsWith('/contacts')) setActiveTab('contacts');
    else if (path.startsWith('/favorites')) setActiveTab('favorites');
    else if (path.startsWith('/profile')) setActiveTab('profile');
    else if (path.startsWith('/groups')) setActiveTab('groups');
  }, [location.pathname]);

  // Unread count
  const fetchUnread = useCallback(async () => {
    if (!user) return;
    const { supabase } = await import('./lib/supabase');
    const { data } = await supabase.from('conversations')
      .select('unread_a, unread_b, participant_a')
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`);
    if (data) {
      const total = data.reduce((acc, c) => acc + (c.participant_a === user.id ? (c.unread_a || 0) : (c.unread_b || 0)), 0);
      setUnreadMessages(total);
    }
  }, [user]);

  useEffect(() => { fetchUnread(); }, [fetchUnread]);

  // Reconnect refresh
  useEffect(() => {
    const handleReconnect = () => { fetchUnread(); };
    window.addEventListener('yo:reconnected', handleReconnect);
    return () => window.removeEventListener('yo:reconnected', handleReconnect);
  }, [fetchUnread]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const routes = { chats: '/', contacts: '/contacts', favorites: '/favorites', profile: '/profile', groups: '/groups' };
    navigate(routes[tab] || '/');
  };

  const inSubPage = location.pathname.startsWith('/chat/') ||
    location.pathname.startsWith('/group/') ||
    location.pathname.startsWith('/user/');

  if (showSplash || loading) return <div className="app-shell"><Splash /></div>;
  if (!user) return <div className="app-shell"><Auth /></div>;
  if (!profile || !profile.name) return <div className="app-shell"><ProfileSetup /></div>;

  // 2FA gate: if enabled and not yet verified this session, block access
  if (profile.two_factor_enabled && !twoFaVerified) {
    return (
      <div className="app-shell">
        <TwoFactorVerify
          userId={user.id}
          userEmail={user.email}
          purpose="login"
          onVerified={() => {
            sessionStorage.setItem(`yo_2fa_verified_${user.id}`, '1');
            setTwoFaVerified(true);
          }}
        />
      </div>
    );
  }

  if (activeCall) return (
    <div className="app-shell">
      <CallScreen call={activeCall} otherProfile={activeCall.otherProfile} localStream={localStream} remoteStream={remoteStream} onEnd={endCall} />
    </div>
  );

  return (
    <div className="app-shell">
      <NetworkBanner />

      {incomingCall && (
        <IncomingCallBanner call={incomingCall} onAccept={acceptCall} onDecline={declineCall} />
      )}

      {updateAvailable && (
        <div className="update-banner">
          <div className="update-banner-text">🚀 Nouvelle version disponible</div>
          <button className="update-banner-btn" onClick={() => window.location.reload()}>
            Mettre à jour
          </button>
        </div>
      )}

      {showOnboarding && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 200, maxWidth: 480, margin: '0 auto' }}>
          <Onboarding onDone={() => {
            localStorage.setItem('yo_onboarded', '1');
            setShowOnboarding(false);
          }} />
        </div>
      )}

      <CallContext.Provider value={{ initiateCall }}>
        <Routes>
          <Route path="/" element={
            <Chats
              onNewChat={() => setShowNewChat(true)}
              onStoriesClick={() => setShowStories(true)}
              onSearchClick={() => setShowSearch(true)}
            />
          } />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/chat/:convId" element={<Chat />} />
          <Route path="/group/:groupId" element={<GroupChat />} />
          <Route path="/user/:userId" element={<UserProfile />} />
        </Routes>
      </CallContext.Provider>

      {!inSubPage && (
        <BottomNav
          active={activeTab}
          onChange={handleTabChange}
          unreadNotifs={unreadNotifs}
          unreadMessages={unreadMessages}
        />
      )}

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      {showStories && <Stories onClose={() => setShowStories(false)} />}
      {showSearch && <Search onClose={() => setShowSearch(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  );
}
