-- Refresh tokens for the auth flow. Access tokens are now short-lived (1 day); clients
-- exchange a long-lived (30-day) refresh token for a new access token via POST /api/auth/refresh.
--
-- Tokens are stored HASHED (SHA-256) so a DB leak can't reuse them. Rotation: each refresh
-- revokes the used row and inserts a new one. Additive & reversible:
--   DROP TABLE IF EXISTS auth_refresh_tokens;

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_art_user    ON auth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_art_expires ON auth_refresh_tokens (expires_at);
