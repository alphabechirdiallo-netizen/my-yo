import { supabase } from './supabase';

let sessionId = null;

function getSessionId() {
  if (!sessionId) {
    sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  return sessionId;
}

function getPlatform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

export async function trackEvent(userId, eventType, eventData = {}) {
  if (!userId) return;
  try {
    await supabase.from('app_analytics').insert({
      user_id: userId,
      event_type: eventType,
      event_data: eventData,
      session_id: getSessionId(),
      platform: getPlatform(),
      app_version: '1.0.0',
    });
  } catch {}
}

// Pre-built events
export const Analytics = {
  messagesSent: (userId, type = 'text') => trackEvent(userId, 'message_sent', { type }),
  conversationOpened: (userId, convId) => trackEvent(userId, 'conversation_opened', { conv_id: convId }),
  groupCreated: (userId) => trackEvent(userId, 'group_created'),
  storyPosted: (userId, type) => trackEvent(userId, 'story_posted', { type }),
  contactAdded: (userId) => trackEvent(userId, 'contact_added'),
  searchPerformed: (userId, query) => trackEvent(userId, 'search', { query_length: query?.length }),
  appOpened: (userId) => trackEvent(userId, 'app_opened', { timestamp: new Date().toISOString() }),
};
