-- ============================================================
-- YO APP — Phase 2 : Messagerie Avancée
-- Exécutez après supabase_phase1.sql
-- ============================================================

-- ─────────────────────────────────────────
-- 1. COLONNES SUPPLÉMENTAIRES sur messages
-- ─────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text', -- text | image | video | file | audio
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_name TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER,
  ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_preview TEXT,
  ADD COLUMN IF NOT EXISTS deleted_for_all BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_for_sender BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ─────────────────────────────────────────
-- 2. RÉACTIONS AUX MESSAGES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS reactions_message_idx ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see reactions in their conversations"
  ON message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = message_reactions.message_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )
  );

CREATE POLICY "Users can add reactions"
  ON message_reactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their reactions"
  ON message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 3. GROUPES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  avatar_url      TEXT,
  created_by      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_message    TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT DEFAULT 'member', -- admin | member
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content     TEXT,
  type        TEXT DEFAULT 'text',
  media_url   TEXT,
  media_name  TEXT,
  media_size  INTEGER,
  reply_to    UUID REFERENCES group_messages(id) ON DELETE SET NULL,
  reply_preview TEXT,
  deleted_for_all BOOLEAN DEFAULT FALSE,
  edited      BOOLEAN DEFAULT FALSE,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);

-- RLS Groups
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can see groups"
  ON groups FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM group_members WHERE group_id = groups.id AND user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can update groups"
  ON groups FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM group_members WHERE group_id = groups.id AND user_id = auth.uid() AND role = 'admin')
  );

-- RLS Group Members
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can see group members"
  ON group_members FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid())
  );

CREATE POLICY "Admins can manage members"
  ON group_members FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM group_members WHERE group_id = group_members.group_id AND user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Members can leave groups"
  ON group_members FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- RLS Group Messages
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can see messages"
  ON group_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM group_members WHERE group_id = group_messages.group_id AND user_id = auth.uid())
  );

CREATE POLICY "Group members can send messages"
  ON group_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM group_members WHERE group_id = group_messages.group_id AND user_id = auth.uid())
  );

CREATE POLICY "Senders can update their messages"
  ON group_messages FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id);

-- ─────────────────────────────────────────
-- 4. TYPING INDICATORS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS typing_indicators (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS typing_conv_idx ON typing_indicators(conversation_id);

ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage typing indicators"
  ON typing_indicators FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can see typing indicators in their convs"
  ON typing_indicators FOR SELECT TO authenticated
  USING (
    (conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = typing_indicators.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )) OR
    (group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM group_members WHERE group_id = typing_indicators.group_id AND user_id = auth.uid()
    ))
  );

-- ─────────────────────────────────────────
-- 5. STORAGE BUCKET POUR MÉDIAS
-- ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true, 52428800,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/ogg','application/pdf']
)
ON CONFLICT DO NOTHING;

CREATE POLICY "Authenticated users can upload media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Anyone can view media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "Users can delete their media"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media');

-- ─────────────────────────────────────────
-- 6. REALTIME POUR NOUVELLES TABLES
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE groups;
ALTER PUBLICATION supabase_realtime ADD TABLE typing_indicators;

-- ─────────────────────────────────────────
-- 7. FONCTION CRÉER UN GROUPE
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_group(
  group_name TEXT,
  member_ids UUID[]
)
RETURNS UUID AS $$
DECLARE
  new_group_id UUID;
  member_id UUID;
BEGIN
  INSERT INTO groups (name, created_by) VALUES (group_name, auth.uid())
  RETURNING id INTO new_group_id;

  INSERT INTO group_members (group_id, user_id, role) VALUES (new_group_id, auth.uid(), 'admin');

  FOREACH member_id IN ARRAY member_ids LOOP
    INSERT INTO group_members (group_id, user_id, role)
    VALUES (new_group_id, member_id, 'member')
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN new_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
