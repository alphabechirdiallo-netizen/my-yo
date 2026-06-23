-- ============================================================
-- YO APP — Phase 3 : Fonctionnalités Avancées & Écosystème
-- Exécutez après supabase_phase2.sql
-- ============================================================

-- ─────────────────────────────────────────
-- 1. STATUTS / STORIES (éphémères 24h)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT DEFAULT 'text', -- text | image | video
  content       TEXT,
  media_url     TEXT,
  bg_color      TEXT DEFAULT '#0d0d0d',
  text_color    TEXT DEFAULT '#ffffff',
  views         INTEGER DEFAULT 0,
  expires_at    TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_views (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS stories_user_idx ON stories(user_id, expires_at);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories(expires_at);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see stories from contacts"
  ON stories FOR SELECT TO authenticated
  USING (
    expires_at > NOW() AND (
      user_id = auth.uid() OR
      EXISTS (SELECT 1 FROM user_contacts WHERE user_id = auth.uid() AND contact_id = stories.user_id)
    )
  );

CREATE POLICY "Users can create their stories"
  ON stories FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their stories"
  ON stories FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view stories"
  ON story_views FOR ALL TO authenticated
  USING (auth.uid() = viewer_id)
  WITH CHECK (auth.uid() = viewer_id);

-- ─────────────────────────────────────────
-- 2. SONDAGES (dans les groupes)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS polls (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id      UUID REFERENCES groups(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  creator_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  options       JSONB NOT NULL, -- [{id, text, votes: []}]
  multiple      BOOLEAN DEFAULT FALSE,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option_ids  TEXT[] NOT NULL,
  voted_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS polls_group_idx ON polls(group_id);
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can see polls"
  ON polls FOR SELECT TO authenticated
  USING (
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_members WHERE group_id = polls.group_id AND user_id = auth.uid()
    )) OR
    (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = polls.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    ))
  );

CREATE POLICY "Group members can create polls"
  ON polls FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users manage their votes"
  ON poll_votes FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 3. PARTAGE DE LOCALISATION
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS location_shares (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  latitude        DECIMAL(10, 8) NOT NULL,
  longitude       DECIMAL(11, 8) NOT NULL,
  address         TEXT,
  live            BOOLEAN DEFAULT FALSE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE location_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can see location shares"
  ON location_shares FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid() OR
    (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = location_shares.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )) OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_members WHERE group_id = location_shares.group_id AND user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can share location"
  ON location_shares FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can delete their location shares"
  ON location_shares FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- ─────────────────────────────────────────
-- 4. RECHERCHE FULL-TEXT dans les messages
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS messages_content_search_idx
  ON messages USING gin(to_tsvector('french', content));

CREATE INDEX IF NOT EXISTS group_messages_content_search_idx
  ON group_messages USING gin(to_tsvector('french', content));

-- ─────────────────────────────────────────
-- 5. MESSAGES ÉPINGLÉS
-- ─────────────────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_content TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES group_messages(id) ON DELETE SET NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS pinned_message_content TEXT;

-- ─────────────────────────────────────────
-- 6. RÉACTIONS aux messages de groupe
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_message_reactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

ALTER TABLE group_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can manage reactions"
  ON group_message_reactions FOR ALL TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM group_messages gm
      JOIN group_members gmem ON gmem.group_id = gm.group_id
      WHERE gm.id = group_message_reactions.message_id AND gmem.user_id = auth.uid()
    )
  )
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 7. APPELS (logs)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caller_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  type            TEXT NOT NULL, -- audio | video
  status          TEXT DEFAULT 'missed', -- missed | answered | declined | ended
  duration        INTEGER DEFAULT 0, -- seconds
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their call logs"
  ON call_logs FOR ALL TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- ─────────────────────────────────────────
-- 8. REALTIME nouvelles tables
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE stories;
ALTER PUBLICATION supabase_realtime ADD TABLE polls;
ALTER PUBLICATION supabase_realtime ADD TABLE poll_votes;
ALTER PUBLICATION supabase_realtime ADD TABLE location_shares;
ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE group_message_reactions;

-- ─────────────────────────────────────────
-- 9. FONCTION : Nettoyer les stories expirées
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_stories()
RETURNS void AS $$
BEGIN
  DELETE FROM stories WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- 10. FONCTION : Recherche globale
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_messages(query TEXT, user_uuid UUID)
RETURNS TABLE(
  message_id UUID,
  conversation_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  sender_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.conversation_id,
    m.content,
    m.created_at,
    p.name
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  JOIN profiles p ON p.id = m.sender_id
  WHERE
    (c.participant_a = user_uuid OR c.participant_b = user_uuid)
    AND to_tsvector('french', m.content) @@ plainto_tsquery('french', query)
    AND m.deleted_for_all = FALSE
  ORDER BY m.created_at DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
