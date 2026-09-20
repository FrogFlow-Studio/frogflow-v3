-- Очередь фоновых задач платформы v2. Аддитивно: v1 таблицу не читает.
-- Только service_role: RLS включена, политик нет.
create table if not exists public.v2_jobs (
  id          bigserial primary key,
  kind        text        not null,
  bot_id      uuid        null references public.bots(id) on delete cascade,
  payload     jsonb       not null default '{}'::jsonb,
  dedupe_key  text        null,
  status      text        not null default 'queued'
              check (status in ('queued','running','done','failed','dead')),
  run_at      timestamptz not null default now(),
  attempts    int         not null default 0,
  max_attempts int        not null default 8,
  locked_at   timestamptz null,
  locked_by   text        null,
  last_error  text        null,
  result      jsonb       null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz null
);
create index if not exists v2_jobs_ready_idx on public.v2_jobs (run_at) where status = 'queued';
create index if not exists v2_jobs_bot_idx on public.v2_jobs (bot_id, created_at desc);
create unique index if not exists v2_jobs_dedupe_idx on public.v2_jobs (dedupe_key) where dedupe_key is not null and status in ('queued','running');
alter table public.v2_jobs enable row level security;
revoke all on public.v2_jobs from anon, authenticated, tenant_bot;
grant all on public.v2_jobs to service_role;

-- Захват пачки задач одним оператором: FOR UPDATE SKIP LOCKED, чтобы два
-- воркера (два инстанса крона) не взяли одну задачу.
create or replace function public.v2_claim_jobs(p_limit int, p_worker text, p_lock_ttl_sec int default 300)
returns setof public.v2_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from public.v2_jobs
    where (status = 'queued' and run_at <= now())
       or (status = 'running' and locked_at < now() - make_interval(secs => p_lock_ttl_sec))
    order by run_at
    limit p_limit
    for update skip locked
  )
  update public.v2_jobs j
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
    from picked where j.id = picked.id
  returning j.*;
end $$;
revoke all on function public.v2_claim_jobs(int, text, int) from public, anon, authenticated, tenant_bot;
grant execute on function public.v2_claim_jobs(int, text, int) to service_role;
