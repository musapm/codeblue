-- UniAgent AI · Phase 16 · Migration 22: a rate limiter shared by every server instance.
--
-- The app's limits (sign-in attempts, forms, AI requests, uploads...) were counted in each
-- server's memory, so several instances multiplied them. Counters now live here.
--
-- * Fixed windows: one counter per bucket and window, incremented atomically.
-- * Buckets are HMAC-SHA-256 hashes made by the server with a secret only it holds
--   (RATE_LIMIT_SECRET), so the function can be called by anyone (sign-in happens before a
--   session exists) without letting a caller fill someone else's bucket to lock them out.
--   No email address, user id or IP address is stored.
-- * The table lives in the private `app` schema: not reachable through the API.

create table app.rate_limit_hits (
  bucket text not null constraint rate_limit_hits_bucket check (bucket ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);
create index rate_limit_hits_window_idx on app.rate_limit_hits (window_start);
alter table app.rate_limit_hits enable row level security;
revoke all on table app.rate_limit_hits from public, anon, authenticated;

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$' or p_limit is null or p_limit not between 1 and 100000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into app.rate_limit_hits as h (bucket, window_start) values (p_bucket, v_start)
  on conflict (bucket, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;

  -- Old windows are removed now and then (no scheduled job needed).
  if random() < 0.01 then
    delete from app.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'remaining', greatest(p_limit - v_hits, 0),
    'retry_after_ms', case when v_hits <= p_limit then 0
      else ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())) * 1000)::bigint end
  );
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public;
grant execute on function public.rate_limit_hit(text, integer, integer) to anon, authenticated, service_role;

-- Defense in depth (found by the Phase 16 coverage test): the only private table without row
-- level security. It was already unreachable (private schema, privileges revoked).
alter table app.academic_join_failures enable row level security;
revoke all on table app.academic_join_failures from anon, authenticated;
