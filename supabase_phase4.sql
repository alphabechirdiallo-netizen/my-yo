-- ============================================================
-- YO APP — Phase 4 : Optimisation & Performance
-- ============================================================

-- ─────────────────────────────────────────
-- 1. INDEX DE PERFORMANCE AVANCÉS
-- ─────────────────────────────────────────

-- Messages - tri par conversation + date (le plus utilisé)
CREATE INDEX IF NOT EXISTS messages_conv_date_idx
  ON messages(conversation_id, created_at DESC);

-- Messages non lus
CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON messages(conversation_id, sender_id, read)
  WHERE read = FALSE;

-- Conversations actives
CREATE INDEX IF NOT EXISTS conversations_active_idx
  ON conversations(last_message_at DESC)
  WHERE last_message IS NOT NULL;

-- Conversations par participant
CREATE INDEX IF NOT EXISTS conversations_participant_a_idx ON conversations(participant_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_participant_b_idx ON conversations(participant_b, last_message_at DESC);

-- Profiles - recherche par nom
CREATE INDEX IF NOT EXISTS profiles_name_idx ON profiles USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS profiles_username_lower_idx ON profiles(lower(username));

-- Group messages
CREATE INDEX IF NOT EXISTS group_messages_group_date_idx ON group_messages(group_id, created_at DESC);

-- Stories actives
CREATE INDEX IF NOT EXISTS stories_active_idx ON stories(user_id, expires_at DESC) WHERE expires_at > NOW();

-- Notifications non lues
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(user_id, created_at DESC) WHERE read = FALSE;

-- ─────────────────────────────────────────
-- 2. ANALYTICS & MÉTRIQUES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_analytics (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  event_data    JSONB DEFAULT '{}',
  session_id    TEXT,
  platform      TEXT,
  app_version   TEXT DEFAULT '1.0.0',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_event_idx ON app_analytics(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_user_idx ON app_analytics(user_id, created_at DESC);

ALTER TABLE app_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert analytics" ON app_analytics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 3. MESSAGE DELIVERY RECEIPTS AMÉLIORÉS
-- ─────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivered BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- ─────────────────────────────────────────
-- 4. ARCHIVAGE DE CONVERSATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archived_conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  archived_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, conversation_id),
  UNIQUE(user_id, group_id)
);

ALTER TABLE archived_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their archives"
  ON archived_conversations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 5. PROFILS AMÉLIORÉS
-- ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_sound TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS notification_preview BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS font_size TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS read_receipts BOOLEAN DEFAULT TRUE;

-- ─────────────────────────────────────────
-- 6. MESSAGES ÉPINGLÉS PAR CONVERSATION (plusieurs)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  message_id      UUID NOT NULL,
  pinned_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pinned_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pinned_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants can manage pins"
  ON pinned_messages FOR ALL TO authenticated
  USING (
    (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = pinned_messages.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )) OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_members WHERE group_id = pinned_messages.group_id AND user_id = auth.uid()
    ))
  )
  WITH CHECK (auth.uid() = pinned_by);

-- ─────────────────────────────────────────
-- 7. LIENS PARTAGÉS (preview)
-- ─────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- ─────────────────────────────────────────
-- 8. VUES MATÉRIALISÉES POUR PERFORMANCE
-- ─────────────────────────────────────────

-- Vue: Conversations avec infos complètes (refresh toutes les minutes)
CREATE MATERIALIZED VIEW IF NOT EXISTS conversation_summaries AS
SELECT
  c.id,
  c.participant_a,
  c.participant_b,
  c.last_message,
  c.last_message_at,
  c.unread_a,
  c.unread_b,
  pa.name AS name_a,
  pa.avatar_url AS avatar_a,
  pa.is_online AS online_a,
  pb.name AS name_b,
  pb.avatar_url AS avatar_b,
  pb.is_online AS online_b
FROM conversations c
JOIN profiles pa ON pa.id = c.participant_a
JOIN profiles pb ON pb.id = c.participant_b
WHERE c.last_message_at > NOW() - INTERVAL '30 days';

CREATE UNIQUE INDEX IF NOT EXISTS conv_summaries_id_idx ON conversation_summaries(id);

-- ─────────────────────────────────────────
-- 9. FONCTIONS D'OPTIMISATION
-- ─────────────────────────────────────────

-- Rafraîchir les vues matérialisées
CREATE OR REPLACE FUNCTION refresh_conversation_summaries()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY conversation_summaries;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nettoyer les vieilles données
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Supprimer les stories expirées
  DELETE FROM stories WHERE expires_at < NOW() - INTERVAL '1 hour';
  -- Supprimer les typing indicators vieux
  DELETE FROM typing_indicators WHERE updated_at < NOW() - INTERVAL '10 seconds';
  -- Supprimer les analytics vieux de plus de 90 jours
  DELETE FROM app_analytics WHERE created_at < NOW() - INTERVAL '90 days';
  -- Supprimer les vieilles sessions (30 jours d'inactivité)
  DELETE FROM user_sessions WHERE last_active < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Statistiques utilisateur
CREATE OR REPLACE FUNCTION get_user_stats(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'messages_sent', (SELECT COUNT(*) FROM messages WHERE sender_id = user_uuid),
    'conversations', (SELECT COUNT(*) FROM conversations WHERE participant_a = user_uuid OR participant_b = user_uuid),
    'groups', (SELECT COUNT(*) FROM group_members WHERE user_id = user_uuid),
    'contacts', (SELECT COUNT(*) FROM user_contacts WHERE user_id = user_uuid),
    'stories_posted', (SELECT COUNT(*) FROM stories WHERE user_id = user_uuid),
    'member_since', (SELECT created_at FROM profiles WHERE id = user_uuid)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- 10. TRIGGERS AUTOMATIQUES
-- ─────────────────────────────────────────

-- Auto-marquer comme délivré
CREATE OR REPLACE FUNCTION mark_message_delivered()
RETURNS TRIGGER AS $$
BEGIN
  NEW.delivered := TRUE;
  NEW.delivered_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS groups_updated_at ON groups;
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
