-- ============================================================
-- YO APP — Phase 1 : Renforcement Fondations & Confidentialité
-- Exécutez ce SQL dans Supabase SQL Editor après le schema initial
-- ============================================================

-- ─────────────────────────────────────────
-- 1. COLONNES DE CONFIDENTIALITÉ sur profiles
-- ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS privacy_photo TEXT DEFAULT 'contacts',
  ADD COLUMN IF NOT EXISTS privacy_bio TEXT DEFAULT 'contacts',
  ADD COLUMN IF NOT EXISTS privacy_online TEXT DEFAULT 'contacts',
  ADD COLUMN IF NOT EXISTS privacy_add_contact TEXT DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Index username
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles(username);
CREATE INDEX IF NOT EXISTS profiles_phone_idx ON profiles(phone);

-- ─────────────────────────────────────────
-- 2. CONTACTS & DEMANDES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT DEFAULT 'pending', -- pending | accepted | rejected
  message       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

CREATE TABLE IF NOT EXISTS user_contacts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS user_contacts_user_idx ON user_contacts(user_id);
CREATE INDEX IF NOT EXISTS user_contacts_contact_idx ON user_contacts(contact_id);
CREATE INDEX IF NOT EXISTS contact_requests_receiver_idx ON contact_requests(receiver_id, status);

-- ─────────────────────────────────────────
-- 3. UTILISATEURS BLOQUÉS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS blocked_users_blocker_idx ON blocked_users(blocker_id);

-- ─────────────────────────────────────────
-- 4. SESSIONS ACTIVES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_name   TEXT,
  device_type   TEXT, -- mobile | desktop | tablet
  ip_address    TEXT,
  last_active   TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id);

-- ─────────────────────────────────────────
-- 5. NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL, -- contact_request | message | system
  title         TEXT,
  body          TEXT,
  data          JSONB,
  read          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read);

-- ─────────────────────────────────────────
-- 6. RLS — CONTACT REQUESTS
-- ─────────────────────────────────────────
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own contact requests"
  ON contact_requests FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send contact requests"
  ON contact_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Receivers can update contact requests"
  ON contact_requests FOR UPDATE TO authenticated
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id);

CREATE POLICY "Users can delete their contact requests"
  ON contact_requests FOR DELETE TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- ─────────────────────────────────────────
-- 7. RLS — USER CONTACTS
-- ─────────────────────────────────────────
ALTER TABLE user_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their contacts"
  ON user_contacts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add contacts"
  ON user_contacts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove contacts"
  ON user_contacts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 8. RLS — BLOCKED USERS
-- ─────────────────────────────────────────
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their blocks"
  ON blocked_users FOR ALL TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

-- ─────────────────────────────────────────
-- 9. RLS — SESSIONS
-- ─────────────────────────────────────────
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their sessions"
  ON user_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 10. RLS — NOTIFICATIONS
-- ─────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their notifications"
  ON notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 11. RLS PROFILES — mise à jour avec confidentialité
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "Profiles are viewable by all authenticated users" ON profiles;
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON profiles;

CREATE POLICY "Profiles viewable by contacts or public"
  ON profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR privacy_photo = 'everyone'
    OR EXISTS (
      SELECT 1 FROM user_contacts uc
      WHERE uc.user_id = auth.uid() AND uc.contact_id = profiles.id
    )
  );

-- ─────────────────────────────────────────
-- 12. REALTIME pour nouvelles tables
-- ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE contact_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE user_contacts;

-- ─────────────────────────────────────────
-- 13. FONCTION : Accepter une demande de contact
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_contact_request(request_id UUID)
RETURNS VOID AS $$
DECLARE
  req contact_requests%ROWTYPE;
BEGIN
  SELECT * INTO req FROM contact_requests WHERE id = request_id;

  -- Mettre à jour le statut
  UPDATE contact_requests SET status = 'accepted', updated_at = NOW()
  WHERE id = request_id;

  -- Ajouter mutuellement aux contacts
  INSERT INTO user_contacts (user_id, contact_id)
  VALUES (req.sender_id, req.receiver_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO user_contacts (user_id, contact_id)
  VALUES (req.receiver_id, req.sender_id)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
