-- ============================================================
-- YO APP — Phase 5 : Sécurité Critique
-- 2FA + Confidentialité présence + Appels vidéo + E2EE
-- ============================================================

-- ─────────────────────────────────────────
-- 1. 2FA — codes de vérification
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS two_factor_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  purpose     TEXT DEFAULT 'login', -- login | enable_2fa | disable_2fa
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS twofa_user_idx ON two_factor_codes(user_id, expires_at);

ALTER TABLE two_factor_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their 2fa codes"
  ON two_factor_codes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Trusted devices (skip 2FA for known devices)
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_name   TEXT,
  trusted_until TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_fingerprint)
);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their trusted devices"
  ON trusted_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- 2. CONFIDENTIALITÉ PRÉSENCE — vue sécurisée
-- ─────────────────────────────────────────

-- Fonction qui calcule si on peut voir le statut en ligne de quelqu'un
CREATE OR REPLACE FUNCTION can_see_online_status(target_user_id UUID, viewer_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  target_privacy TEXT;
  is_contact BOOLEAN;
BEGIN
  IF target_user_id = viewer_id THEN RETURN TRUE; END IF;

  SELECT privacy_online INTO target_privacy FROM profiles WHERE id = target_user_id;

  IF target_privacy = 'everyone' THEN RETURN TRUE; END IF;
  IF target_privacy = 'nobody' THEN RETURN FALSE; END IF;

  -- 'contacts' : vérifier la relation
  SELECT EXISTS(
    SELECT 1 FROM user_contacts WHERE user_id = viewer_id AND contact_id = target_user_id
  ) INTO is_contact;

  RETURN is_contact;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Vue sécurisée des profils avec présence filtrée
CREATE OR REPLACE VIEW profiles_with_privacy AS
SELECT
  p.id,
  p.name,
  p.username,
  p.bio,
  p.avatar_url,
  p.created_at,
  CASE WHEN can_see_online_status(p.id, auth.uid()) THEN p.is_online ELSE NULL END AS is_online,
  CASE WHEN can_see_online_status(p.id, auth.uid()) THEN p.last_seen ELSE NULL END AS last_seen,
  p.privacy_online,
  p.privacy_photo,
  p.privacy_bio,
  p.two_factor_enabled
FROM profiles p;

-- Renforcer la RLS sur profiles pour cacher is_online/last_seen au niveau base
-- (la vue ci-dessus est utilisée côté client à la place de la table directe)

-- ─────────────────────────────────────────
-- 3. APPELS VIDÉO — signaling table (alternative au broadcast pur)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caller_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'audio', -- audio | video
  status          TEXT DEFAULT 'ringing', -- ringing | accepted | declined | ended | missed
  offer_sdp       TEXT,
  answer_sdp      TEXT,
  ice_candidates_caller JSONB DEFAULT '[]',
  ice_candidates_receiver JSONB DEFAULT '[]',
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration        INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS call_sessions_receiver_idx ON call_sessions(receiver_id, status);
CREATE INDEX IF NOT EXISTS call_sessions_caller_idx ON call_sessions(caller_id, status);

ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can see call sessions"
  ON call_sessions FOR SELECT TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can create calls"
  ON call_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = caller_id);

CREATE POLICY "Participants can update call sessions"
  ON call_sessions FOR UPDATE TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;

-- ─────────────────────────────────────────
-- 4. E2EE — Stockage des clés publiques (chiffrement asymétrique)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_encryption_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL, -- clé publique RSA/EC en base64
  key_algorithm TEXT DEFAULT 'RSA-OAEP-2048',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  rotated_at    TIMESTAMPTZ
);

ALTER TABLE user_encryption_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read public keys"
  ON user_encryption_keys FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users manage their own keys"
  ON user_encryption_keys FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their keys"
  ON user_encryption_keys FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Colonne pour indiquer si un message est chiffré E2EE
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_content TEXT; -- contenu chiffré pour le destinataire
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_content_sender TEXT; -- copie chiffrée pour l'expéditeur (relecture)

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS e2ee_enabled BOOLEAN DEFAULT FALSE;

-- ─────────────────────────────────────────
-- 5. PROFILES — 2FA flag
-- ─────────────────────────────────────────
-- (two_factor_enabled existe déjà depuis phase 1)

-- ─────────────────────────────────────────
-- 6. FONCTION : Générer code 2FA
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_2fa_code(target_user_id UUID, code_purpose TEXT DEFAULT 'login')
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
BEGIN
  new_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  INSERT INTO two_factor_codes (user_id, code, purpose, expires_at)
  VALUES (target_user_id, new_code, code_purpose, NOW() + INTERVAL '10 minutes');

  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- 7. FONCTION : Vérifier code 2FA
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_2fa_code(target_user_id UUID, input_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  valid_code RECORD;
BEGIN
  SELECT * INTO valid_code FROM two_factor_codes
  WHERE user_id = target_user_id
    AND code = input_code
    AND used = FALSE
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF valid_code.id IS NOT NULL THEN
    UPDATE two_factor_codes SET used = TRUE WHERE id = valid_code.id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────
-- 8. Nettoyage automatique des vieux codes 2FA
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_2fa()
RETURNS void AS $$
BEGIN
  DELETE FROM two_factor_codes WHERE expires_at < NOW() - INTERVAL '1 hour';
  DELETE FROM trusted_devices WHERE trusted_until < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
