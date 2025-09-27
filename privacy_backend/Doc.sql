CREATE INDEX IF NOT EXISTS ix_visits_u_w_t
  ON site_visits (user_id, website_id, started_at);

CREATE INDEX IF NOT EXISTS ix_submissions_u_w_t
  ON field_submissions (user_id, website_id, submitted_at);

CREATE INDEX IF NOT EXISTS ix_risk_u_w_t
  ON risk_assessments (user_id, website_id, created_at);

CREATE INDEX IF NOT EXISTS ix_phish_u_w_t
  ON phishing_results (user_id, website_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_websites_hostname_norm
  ON websites ((LOWER(hostname)));
