import { supabase } from './supabase';

// Fetches online/last_seen through the server-enforced privacy view
// instead of trusting client-side privacy_online checks.
// The 'profiles_with_privacy' view nulls out is_online/last_seen
// server-side via the can_see_online_status() RLS function.
export async function fetchProfileWithPrivacy(profileId) {
  const { data, error } = await supabase
    .from('profiles_with_privacy')
    .select('id, name, username, bio, avatar_url, is_online, last_seen, privacy_online, two_factor_enabled')
    .eq('id', profileId)
    .single();
  if (error) return null;
  return data;
}

export async function fetchProfilesWithPrivacy(profileIds) {
  if (!profileIds?.length) return [];
  const { data, error } = await supabase
    .from('profiles_with_privacy')
    .select('id, name, username, bio, avatar_url, is_online, last_seen, privacy_online')
    .in('id', profileIds);
  if (error) return [];
  return data || [];
}
