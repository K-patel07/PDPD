-- field_submissions: make sure the strict submitted_* and helper columns exist
ALTER TABLE public.field_submissions
  ADD COLUMN IF NOT EXISTS submitted_name     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_email    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_phone    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_card     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_address  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_age      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_gender   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_country  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS path                 text,
  ADD COLUMN IF NOT EXISTS last_input_time      timestamptz,
  ADD COLUMN IF NOT EXISTS screen_time_seconds  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category             text,
  ADD COLUMN IF NOT EXISTS category_confidence  numeric,
  ADD COLUMN IF NOT EXISTS category_method      text,
  ADD COLUMN IF NOT EXISTS event_type           text NOT NULL DEFAULT 'submit',
  ADD COLUMN IF NOT EXISTS created_at           timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_field_submissions_user_host_time
  ON public.field_submissions (ext_user_id, hostname, created_at DESC);

-- site_visits perf (if not already)
CREATE INDEX IF NOT EXISTS idx_site_visits_user_host
  ON public.site_visits (ext_user_id, hostname);
