CREATE TABLE IF NOT EXISTS ai_platform.mcp_oauth_pairings (
  id uuid PRIMARY KEY,
  code varchar(8) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  state text NOT NULL DEFAULT '',
  approved_user_id integer REFERENCES ai_platform.internal_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_pairings_expires_at_idx
  ON ai_platform.mcp_oauth_pairings (expires_at);
