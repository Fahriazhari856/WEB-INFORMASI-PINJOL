CREATE TABLE IF NOT EXISTS public.company_unlikes (
  company_id INTEGER NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (
    to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  PRIMARY KEY (company_id, user_id)
);

ALTER TABLE public.company_unlikes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.company_unlikes FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;
