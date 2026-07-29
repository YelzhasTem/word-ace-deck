BEGIN;

-- AI usage is intentionally server-only. Browser roles cannot read, reserve,
-- release, or alter quotas. The application server authenticates the user first
-- and then calls the SECURITY DEFINER functions with the backend service role.
CREATE TABLE IF NOT EXISTS public.ai_runtime_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_request_unit_budget INTEGER NOT NULL DEFAULT 50000
    CHECK (daily_request_unit_budget BETWEEN 0 AND 10000000),
  daily_heavy_request_unit_budget INTEGER NOT NULL DEFAULT 25000
    CHECK (daily_heavy_request_unit_budget BETWEEN 0 AND 10000000),
  per_user_hourly_unit_limit INTEGER NOT NULL DEFAULT 80
    CHECK (per_user_hourly_unit_limit BETWEEN 1 AND 100000),
  per_user_daily_unit_limit INTEGER NOT NULL DEFAULT 300
    CHECK (per_user_daily_unit_limit BETWEEN 1 AND 1000000),
  ip_minute_request_limit INTEGER NOT NULL DEFAULT 60
    CHECK (ip_minute_request_limit BETWEEN 1 AND 100000),
  ip_hour_request_limit INTEGER NOT NULL DEFAULT 600
    CHECK (ip_hour_request_limit BETWEEN 1 AND 1000000),
  ip_daily_request_limit INTEGER NOT NULL DEFAULT 3000
    CHECK (ip_daily_request_limit BETWEEN 1 AND 10000000),
  ip_concurrency_limit INTEGER NOT NULL DEFAULT 10
    CHECK (ip_concurrency_limit BETWEEN 1 AND 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.ai_runtime_config (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_endpoint_policies (
  endpoint TEXT PRIMARY KEY,
  request_class TEXT NOT NULL CHECK (request_class IN ('light', 'heavy')),
  request_units INTEGER NOT NULL CHECK (request_units BETWEEN 1 AND 1000),
  minute_limit INTEGER NOT NULL CHECK (minute_limit BETWEEN 1 AND 10000),
  hour_limit INTEGER NOT NULL CHECK (hour_limit BETWEEN 1 AND 100000),
  day_limit INTEGER NOT NULL CHECK (day_limit BETWEEN 1 AND 1000000),
  concurrency_limit INTEGER NOT NULL CHECK (concurrency_limit BETWEEN 1 AND 100),
  slot_ttl_seconds INTEGER NOT NULL CHECK (slot_ttl_seconds BETWEEN 30 AND 900),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.ai_endpoint_policies (
  endpoint,
  request_class,
  request_units,
  minute_limit,
  hour_limit,
  day_limit,
  concurrency_limit,
  slot_ttl_seconds
)
VALUES
  ('getTranslations', 'light', 1, 12, 60, 200, 2, 90),
  ('generateAssociation', 'light', 2, 8, 40, 120, 2, 120),
  ('generateStudyText', 'light', 3, 5, 25, 60, 1, 180),
  ('generateDeckWithAI', 'heavy', 5, 3, 12, 30, 1, 300),
  ('importManualCardsFromText', 'heavy', 5, 3, 12, 30, 1, 300),
  ('importManualCardsFromImage', 'heavy', 8, 2, 8, 15, 1, 300),
  ('generateDeckFromUrl', 'heavy', 8, 2, 8, 15, 1, 300)
ON CONFLICT (endpoint) DO UPDATE SET
  request_class = EXCLUDED.request_class,
  request_units = EXCLUDED.request_units,
  minute_limit = EXCLUDED.minute_limit,
  hour_limit = EXCLUDED.hour_limit,
  day_limit = EXCLUDED.day_limit,
  concurrency_limit = EXCLUDED.concurrency_limit,
  slot_ttl_seconds = EXCLUDED.slot_ttl_seconds,
  updated_at = clock_timestamp();

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  request_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL REFERENCES public.ai_endpoint_policies(endpoint),
  request_class TEXT NOT NULL CHECK (request_class IN ('light', 'heavy')),
  request_units INTEGER NOT NULL CHECK (request_units BETWEEN 1 AND 1000),
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  ip_hash TEXT CHECK (ip_hash IS NULL OR length(ip_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'succeeded', 'failed', 'timed_out', 'expired')),
  rate_limit_result TEXT NOT NULL DEFAULT 'accepted' CHECK (rate_limit_result = 'accepted'),
  input_size INTEGER NOT NULL CHECK (input_size >= 0),
  output_size INTEGER CHECK (output_size IS NULL OR output_size >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  provider_error_category TEXT CHECK (
    provider_error_category IS NULL OR length(provider_error_category) <= 80
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ai_usage_events_user_started_idx
  ON public.ai_usage_events (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_endpoint_started_idx
  ON public.ai_usage_events (endpoint, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_ip_started_idx
  ON public.ai_usage_events (ip_hash, started_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_events_active_expiry_idx
  ON public.ai_usage_events (expires_at)
  WHERE status = 'active';

-- Rejections are aggregated by minute so an abusive client cannot create one
-- persistent database row per denied request.
CREATE TABLE IF NOT EXISTS public.ai_rate_limit_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  result TEXT NOT NULL CHECK (length(result) BETWEEN 1 AND 80),
  ip_hash TEXT NOT NULL DEFAULT '' CHECK (ip_hash = '' OR length(ip_hash) = 64),
  rejection_count INTEGER NOT NULL DEFAULT 1 CHECK (rejection_count > 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (bucket_start, user_id, endpoint, result, ip_hash)
);

ALTER TABLE public.ai_runtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_endpoint_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_rate_limit_rollups ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ai_runtime_config FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.ai_endpoint_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.ai_usage_events FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.ai_rate_limit_rollups FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.ai_runtime_config TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.ai_endpoint_policies TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.ai_usage_events TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.ai_rate_limit_rollups TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_ai_request(
  p_request_id UUID,
  p_user_id UUID,
  p_endpoint TEXT,
  p_idempotency_key UUID,
  p_request_hash TEXT,
  p_ip_hash TEXT,
  p_input_size INTEGER
)
RETURNS TABLE(decision TEXT, reserved_request_id UUID, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_config public.ai_runtime_config%ROWTYPE;
  v_policy public.ai_endpoint_policies%ROWTYPE;
  v_existing public.ai_usage_events%ROWTYPE;
  v_count BIGINT;
  v_units BIGINT;
  v_reason TEXT;
  v_retry INTEGER := 60;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL OR p_user_id IS NULL OR p_idempotency_key IS NULL
     OR p_endpoint IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_input_size IS NULL OR p_input_size < 0
     OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid AI reservation input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = '22023';
  END IF;

  -- A global lock and then a user lock serialize all budget and per-user quota
  -- decisions. This prevents parallel serverless invocations from racing.
  PERFORM pg_advisory_xact_lock(71422001);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 71422001));

  UPDATE public.ai_usage_events
  SET status = 'expired', completed_at = v_now
  WHERE status = 'active' AND expires_at <= v_now;

  SELECT * INTO v_existing
  FROM public.ai_usage_events
  WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.endpoint <> p_endpoint THEN
      RETURN QUERY SELECT 'idempotency_conflict'::TEXT, v_existing.request_id, 0;
    ELSIF v_existing.status = 'active' AND v_existing.expires_at > v_now THEN
      RETURN QUERY SELECT 'idempotency_in_progress'::TEXT, v_existing.request_id,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_existing.expires_at - v_now)))::INTEGER);
    ELSE
      RETURN QUERY SELECT 'idempotency_replay'::TEXT, v_existing.request_id, 0;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_config FROM public.ai_runtime_config WHERE singleton FOR UPDATE;
  SELECT * INTO v_policy
  FROM public.ai_endpoint_policies
  WHERE endpoint = p_endpoint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown AI endpoint' USING ERRCODE = '22023';
  END IF;

  IF NOT v_config.enabled OR NOT v_policy.enabled THEN
    v_reason := 'disabled';
    v_retry := 300;
  END IF;

  IF v_reason IS NULL THEN
    SELECT COALESCE(SUM(request_units), 0) INTO v_units
    FROM public.ai_usage_events WHERE started_at >= date_trunc('day', v_now);
    IF v_units + v_policy.request_units > v_config.daily_request_unit_budget THEN
      v_reason := 'global_budget';
      v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('day', v_now) + INTERVAL '1 day' - v_now)))::INTEGER);
    END IF;
  END IF;

  IF v_reason IS NULL AND v_policy.request_class = 'heavy' THEN
    SELECT COALESCE(SUM(request_units), 0) INTO v_units
    FROM public.ai_usage_events
    WHERE request_class = 'heavy' AND started_at >= date_trunc('day', v_now);
    IF v_units + v_policy.request_units > v_config.daily_heavy_request_unit_budget THEN
      v_reason := 'global_heavy_budget';
      v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('day', v_now) + INTERVAL '1 day' - v_now)))::INTEGER);
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE user_id = p_user_id AND endpoint = p_endpoint AND started_at >= v_now - INTERVAL '1 minute';
    IF v_count >= v_policy.minute_limit THEN v_reason := 'user_minute'; v_retry := 60; END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE user_id = p_user_id AND endpoint = p_endpoint AND started_at >= v_now - INTERVAL '1 hour';
    IF v_count >= v_policy.hour_limit THEN v_reason := 'user_hour'; v_retry := 3600; END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE user_id = p_user_id AND endpoint = p_endpoint AND started_at >= date_trunc('day', v_now);
    IF v_count >= v_policy.day_limit THEN
      v_reason := 'user_day';
      v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('day', v_now) + INTERVAL '1 day' - v_now)))::INTEGER);
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT COALESCE(SUM(request_units), 0) INTO v_units FROM public.ai_usage_events
    WHERE user_id = p_user_id AND started_at >= v_now - INTERVAL '1 hour';
    IF v_units + v_policy.request_units > v_config.per_user_hourly_unit_limit THEN
      v_reason := 'user_units_hour'; v_retry := 3600;
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT COALESCE(SUM(request_units), 0) INTO v_units FROM public.ai_usage_events
    WHERE user_id = p_user_id AND started_at >= date_trunc('day', v_now);
    IF v_units + v_policy.request_units > v_config.per_user_daily_unit_limit THEN
      v_reason := 'user_units_day';
      v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('day', v_now) + INTERVAL '1 day' - v_now)))::INTEGER);
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE user_id = p_user_id AND endpoint = p_endpoint
      AND status = 'active' AND expires_at > v_now;
    IF v_count >= v_policy.concurrency_limit THEN v_reason := 'user_concurrency'; v_retry := 15; END IF;
  END IF;

  IF v_reason IS NULL AND p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE ip_hash = p_ip_hash AND started_at >= v_now - INTERVAL '1 minute';
    IF v_count >= v_config.ip_minute_request_limit THEN v_reason := 'ip_minute'; v_retry := 60; END IF;
  END IF;

  IF v_reason IS NULL AND p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE ip_hash = p_ip_hash AND started_at >= v_now - INTERVAL '1 hour';
    IF v_count >= v_config.ip_hour_request_limit THEN v_reason := 'ip_hour'; v_retry := 3600; END IF;
  END IF;

  IF v_reason IS NULL AND p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE ip_hash = p_ip_hash AND started_at >= date_trunc('day', v_now);
    IF v_count >= v_config.ip_daily_request_limit THEN
      v_reason := 'ip_day';
      v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (date_trunc('day', v_now) + INTERVAL '1 day' - v_now)))::INTEGER);
    END IF;
  END IF;

  IF v_reason IS NULL AND p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.ai_usage_events
    WHERE ip_hash = p_ip_hash AND status = 'active' AND expires_at > v_now;
    IF v_count >= v_config.ip_concurrency_limit THEN v_reason := 'ip_concurrency'; v_retry := 15; END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.ai_rate_limit_rollups (
      bucket_start, user_id, endpoint, result, ip_hash, rejection_count, last_seen_at
    ) VALUES (
      date_trunc('minute', v_now), p_user_id, p_endpoint, v_reason, COALESCE(p_ip_hash, ''), 1, v_now
    )
    ON CONFLICT (bucket_start, user_id, endpoint, result, ip_hash)
    DO UPDATE SET
      rejection_count = public.ai_rate_limit_rollups.rejection_count + 1,
      last_seen_at = EXCLUDED.last_seen_at;

    RETURN QUERY SELECT v_reason, NULL::UUID, v_retry;
    RETURN;
  END IF;

  INSERT INTO public.ai_usage_events (
    request_id, user_id, endpoint, request_class, request_units,
    idempotency_key, request_hash, ip_hash, status, input_size, expires_at
  ) VALUES (
    p_request_id, p_user_id, p_endpoint, v_policy.request_class, v_policy.request_units,
    p_idempotency_key, p_request_hash, p_ip_hash, 'active', p_input_size,
    v_now + make_interval(secs => v_policy.slot_ttl_seconds)
  );

  RETURN QUERY SELECT 'accepted'::TEXT, p_request_id, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_request(
  p_request_id UUID,
  p_user_id UUID,
  p_status TEXT,
  p_output_size INTEGER,
  p_latency_ms INTEGER,
  p_provider_error_category TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('succeeded', 'failed', 'timed_out')
     OR p_output_size IS NULL OR p_output_size < 0
     OR p_latency_ms IS NULL OR p_latency_ms < 0 THEN
    RAISE EXCEPTION 'invalid AI completion input' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ai_usage_events
  SET status = p_status,
      output_size = p_output_size,
      latency_ms = p_latency_ms,
      provider_error_category = left(p_provider_error_category, 80),
      completed_at = clock_timestamp()
  WHERE request_id = p_request_id AND user_id = p_user_id AND status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_ai_request(UUID, UUID, TEXT, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_ai_request(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_ai_request(UUID, UUID, TEXT, UUID, TEXT, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_request(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

COMMENT ON TABLE public.ai_runtime_config IS
  'Server-only AI kill switch and global/user/IP request-unit budgets.';
COMMENT ON TABLE public.ai_usage_events IS
  'Minimized AI usage audit. Prompts, responses, email, JWTs, keys, images, and raw IPs are forbidden.';
COMMENT ON FUNCTION public.acquire_ai_request(UUID, UUID, TEXT, UUID, TEXT, TEXT, INTEGER) IS
  'Atomically enforces idempotency, user/IP rate limits, concurrency, and global request-unit budgets.';

COMMIT;
