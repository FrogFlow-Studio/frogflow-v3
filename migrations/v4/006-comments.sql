-- v4/006: комментарии и Direct (этап 4б; решения 56, 90, 104).
-- Только схема v4. Таблицы public не трогает. Применяет Яков в SQL-редакторе Supabase.
--
-- Как задумано (осознанные решения, CLAUDE.md, Яков 25.10):
--  * Под комментарием — публичный ответ, и покупателю — сообщение в Direct. Оба.
--  * Первое сообщение в Direct без кнопок (Instagram режет кнопки в первом
--    сообщении); покупатель отвечает «+» — второе приходит с карточкой и кнопкой.
--  * Direct от нас — не раньше 60 с после комментария: если автоматизация Zernio
--    за минуту не ответила, она уже не ответит; ответила — мы не дублируем.
--  * Каждая отправка — «один раз»: условная запись pending → sending до отправки,
--    итог sent / failed / unknown; unknown (обрыв, тайм-аут, 5xx) не повторяется.
--  * Спам — без ИИ: ссылки и слова магазина (решение 56).

-- Спам по правилам магазина. Одно место правды: и комментарии, и Direct.
create or replace function v4.is_spam(p_bot_id uuid, p_text text) returns boolean
language sql stable as $$
  select coalesce(p_text, '') ~* '(https?://|t\.me/|wa\.me/)'
    or exists (select 1 from v4.shops s, unnest(s.spam_words) w
               where s.bot_id = p_bot_id and btrim(w) <> ''
                 and strpos(lower(coalesce(p_text, '')), lower(btrim(w))) > 0)
$$;

create table v4.comment_rules (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  -- null — правило на все посты; своё правило поста важнее общего.
  post_id text,
  match_mode text not null default 'contains' check (match_mode in ('any', 'exact', 'contains')),
  keywords text[] not null default '{}',
  public_reply text not null check (length(public_reply) between 1 and 300),
  -- Первое сообщение в Direct, без кнопок: Instagram принимает до 1000 знаков.
  dm_first text not null check (length(dm_first) between 1 and 1000),
  -- Карточка после «+»: товар и текст с кнопкой (до 640 знаков с кнопками).
  product_id uuid,
  card_text text check (card_text is null or length(card_text) between 1 and 640),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (bot_id, id),
  check (match_mode = 'any' or cardinality(keywords) > 0),
  check ((product_id is null) = (card_text is null)),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);
create index comment_rules_bot on v4.comment_rules (bot_id, post_id) where active;

create table v4.comments (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references v4.shops (bot_id),
  channel text not null check (channel in ('instagram')),
  external_id text not null check (external_id <> ''),
  post_id text,
  commenter_external_id text not null check (commenter_external_id <> ''),
  buyer_id uuid not null,
  text text not null,
  commented_at timestamptz not null,
  received_at timestamptz not null default now(),
  verdict text not null check (verdict in ('spam', 'no_rule', 'rule', 'nested')),
  rule_id uuid,
  public_status text not null default 'none'
    check (public_status in ('none', 'pending', 'sending', 'sent', 'failed', 'unknown')),
  public_lease_at timestamptz,
  dm_status text not null default 'none'
    check (dm_status in ('none', 'pending', 'sending', 'sent', 'failed', 'unknown', 'external', 'expired')),
  dm_not_before timestamptz,
  dm_lease_at timestamptz,
  dm_sent_at timestamptz,
  card_status text not null default 'none'
    check (card_status in ('none', 'awaiting_plus', 'sending', 'sent', 'failed', 'unknown')),
  card_lease_at timestamptz,
  unique (bot_id, channel, external_id),
  unique (bot_id, id),
  foreign key (bot_id, buyer_id) references v4.buyers (bot_id, id),
  foreign key (bot_id, rule_id) references v4.comment_rules (bot_id, id),
  check ((verdict = 'rule') = (rule_id is not null) or verdict = 'nested'),
  check (dm_status <> 'pending' or dm_not_before is not null)
);
create index comments_public_pending on v4.comments (received_at) where public_status = 'pending';
create index comments_dm_pending on v4.comments (dm_not_before) where dm_status = 'pending';
create index comments_card on v4.comments (bot_id, buyer_id, dm_sent_at) where card_status = 'awaiting_plus';

-- Отправка «зависла» в sending дольше 3 минут — исполнитель упал посреди
-- отправки: могло дойти, поэтому unknown, не повтор.
create or replace function v4.comment_lease_interval() returns interval language sql immutable as $$
  select interval '3 minutes'
$$;

-- Входящий комментарий (вебхук). Повтор того же комментария — та же строка.
create or replace function v4.accept_comment(
  p_bot_id uuid, p_channel text, p_external_id text, p_post_id text,
  p_commenter text, p_text text, p_commented_at timestamptz,
  p_nested boolean default false, p_now timestamptz default now()
) returns table (comment_id uuid, created boolean, verdict text, buyer_id uuid)
language plpgsql as $$
#variable_conflict use_column
declare
  b uuid;
  r v4.comment_rules;
  v text;
  t text := lower(btrim(coalesce(p_text, '')));
  cid uuid;
begin
  select c.id, c.verdict, c.buyer_id into cid, v, b from v4.comments c
  where c.bot_id = p_bot_id and c.channel = p_channel and c.external_id = p_external_id;
  if cid is not null then
    return query select cid, false, v, b;
    return;
  end if;

  -- Покупатель по аккаунту в канале: тот же человек из комментария и из Direct.
  -- Замок на аккаунт: два вебхука одного человека не заведут двух покупателей.
  perform pg_advisory_xact_lock(hashtext('v4.buyer:' || p_bot_id || ':' || p_channel || ':' || p_commenter));
  select bc.buyer_id into b from v4.buyer_channels bc
  where bc.bot_id = p_bot_id and bc.channel = p_channel and bc.external_id = p_commenter;
  if b is null then
    insert into v4.buyers (bot_id) values (p_bot_id) returning id into b;
    insert into v4.buyer_channels (bot_id, channel, external_id, buyer_id)
    values (p_bot_id, p_channel, p_commenter, b)
    ;
  end if;

  if v4.is_spam(p_bot_id, p_text) then
    v := 'spam';
  else
    select * into r from v4.comment_rules cr
    where cr.bot_id = p_bot_id and cr.active and (cr.post_id = p_post_id or cr.post_id is null)
      and (cr.match_mode = 'any'
           or (cr.match_mode = 'exact' and exists (select 1 from unnest(cr.keywords) k where lower(btrim(k)) = t))
           or (cr.match_mode = 'contains' and exists (select 1 from unnest(cr.keywords) k
                                                      where btrim(k) <> '' and strpos(t, lower(btrim(k))) > 0)))
    order by cr.post_id nulls last, cr.created_at, cr.id
    limit 1;
    v := case when r.id is null then 'no_rule' when p_nested then 'nested' else 'rule' end;
  end if;

  insert into v4.comments (bot_id, channel, external_id, post_id, commenter_external_id, buyer_id, text,
                           commented_at, received_at, verdict, rule_id, public_status, dm_status, dm_not_before)
  values (p_bot_id, p_channel, p_external_id, p_post_id, p_commenter, b, coalesce(p_text, ''),
          p_commented_at, p_now, v, case when v in ('rule', 'nested') then r.id end,
          case when v in ('rule', 'nested') then 'pending' else 'none' end,
          -- На ответ в ветке Instagram в Direct ответить не даёт: только публичный ответ.
          case when v = 'rule' then 'pending' else 'none' end,
          case when v = 'rule' then greatest(p_commented_at, p_now - interval '1 day') + interval '60 seconds' end)
  on conflict (bot_id, channel, external_id) do nothing
  returning id into cid;
  if cid is null then
    select c.id, c.verdict, c.buyer_id into cid, v, b from v4.comments c
    where c.bot_id = p_bot_id and c.channel = p_channel and c.external_id = p_external_id;
    return query select cid, false, v, b;
    return;
  end if;
  return query select cid, true, v, b;
end $$;

-- Автоматизация Zernio сама написала в Direct: мы не дублируем.
create or replace function v4.note_external_dm(p_bot_id uuid, p_channel text, p_external_id text)
returns boolean language sql as $$
  with u as (
    update v4.comments set dm_status = 'external'
    where bot_id = p_bot_id and channel = p_channel and external_id = p_external_id and dm_status = 'pending'
    returning 1)
  select exists (select 1 from u)
$$;

-- Забрать отправки (сервисная роль): публичные ответы сразу, Direct — после 60 с.
-- Комментарий старше 6,5 суток — Direct уже нельзя (окно Instagram 7 дней).
create or replace function v4.claim_comment_sends(p_limit integer default 20, p_now timestamptz default now())
returns table (comment_id uuid, bot_id uuid, channel text, kind text, external_id text,
               commenter_external_id text, text text)
language plpgsql as $$
#variable_conflict use_column
begin
  update v4.comments set public_status = 'unknown'
  where public_status = 'sending' and public_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set dm_status = 'unknown'
  where dm_status = 'sending' and dm_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set card_status = 'unknown'
  where card_status = 'sending' and card_lease_at < p_now - v4.comment_lease_interval();
  update v4.comments set dm_status = 'expired'
  where dm_status = 'pending' and commented_at < p_now - interval '6 days 12 hours';

  return query
  with pub as (
    select c.id from v4.comments c where c.public_status = 'pending'
    order by c.received_at, c.id limit greatest(1, p_limit) for update skip locked
  ), pu as (
    update v4.comments c set public_status = 'sending', public_lease_at = p_now
    from pub where c.id = pub.id
    returning c.id, c.bot_id, c.channel, 'public'::text as kind, c.external_id, c.commenter_external_id, c.rule_id
  )
  select pu.id, pu.bot_id, pu.channel, pu.kind, pu.external_id, pu.commenter_external_id, cr.public_reply
  from pu join v4.comment_rules cr on cr.id = pu.rule_id;

  return query
  with dm as (
    select c.id from v4.comments c where c.dm_status = 'pending' and c.dm_not_before <= p_now
    order by c.dm_not_before, c.id limit greatest(1, p_limit) for update skip locked
  ), du as (
    update v4.comments c set dm_status = 'sending', dm_lease_at = p_now
    from dm where c.id = dm.id
    returning c.id, c.bot_id, c.channel, 'dm'::text as kind, c.external_id, c.commenter_external_id, c.rule_id
  )
  select du.id, du.bot_id, du.channel, du.kind, du.external_id, du.commenter_external_id, cr.dm_first
  from du join v4.comment_rules cr on cr.id = du.rule_id;
end $$;

-- Итог отправки. Только из sending: повторный итог ничего не меняет.
-- Direct дошёл и в правиле есть карточка — ждём «+».
create or replace function v4.finish_comment_send(
  p_comment_id uuid, p_kind text, p_outcome text, p_now timestamptz default now()
) returns boolean language plpgsql as $$
declare
  n integer;
begin
  if p_outcome not in ('sent', 'failed', 'unknown') then raise exception 'v4:bad_status'; end if;
  if p_kind = 'public' then
    update v4.comments set public_status = p_outcome where id = p_comment_id and public_status = 'sending';
  elsif p_kind = 'dm' then
    update v4.comments c set dm_status = p_outcome,
      dm_sent_at = case when p_outcome = 'sent' then p_now end,
      card_status = case when p_outcome = 'sent' and cr.product_id is not null then 'awaiting_plus' else c.card_status end
    from v4.comment_rules cr
    where c.id = p_comment_id and c.dm_status = 'sending' and cr.id = c.rule_id;
  else
    raise exception 'v4:bad_status';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Покупатель написал в Direct. Если он ждёт карточку (ответил на первое сообщение
-- в течение 24 часов — окно Instagram), забираем её отправку один раз.
-- Пусто — карточки нет, сообщение отвечает продавец-бот.
create or replace function v4.claim_card(p_bot_id uuid, p_buyer_id uuid, p_now timestamptz default now())
returns table (comment_id uuid, product_id uuid, card_text text)
language sql as $$
  with c as (
    select c.id from v4.comments c
    where c.bot_id = p_bot_id and c.buyer_id = p_buyer_id and c.card_status = 'awaiting_plus'
      and c.dm_sent_at > p_now - interval '24 hours'
    order by c.dm_sent_at desc, c.id limit 1
    for update skip locked
  ), u as (
    update v4.comments x set card_status = 'sending', card_lease_at = p_now
    from c where x.id = c.id and x.card_status = 'awaiting_plus'
    returning x.id, x.rule_id
  )
  select u.id, cr.product_id, cr.card_text from u join v4.comment_rules cr on cr.id = u.rule_id
$$;

create or replace function v4.finish_card(p_bot_id uuid, p_comment_id uuid, p_outcome text)
returns boolean language plpgsql as $$
declare
  n integer;
begin
  if p_outcome not in ('sent', 'failed', 'unknown') then raise exception 'v4:bad_status'; end if;
  update v4.comments set card_status = p_outcome
  where bot_id = p_bot_id and id = p_comment_id and card_status = 'sending';
  get diagnostics n = row_count;
  return n > 0;
end $$;

alter table v4.comment_rules enable row level security;
alter table v4.comments enable row level security;
create policy tenant_isolation on v4.comment_rules for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
create policy tenant_isolation on v4.comments for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());

revoke all on v4.comment_rules, v4.comments from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.comment_rules, v4.comments to service_role;
grant select, insert, update on v4.comment_rules to tenant_bot;
-- Статусы отправок меняют только функции; продавец видит комментарии и правит правила.
grant select, insert on v4.comments to tenant_bot;
grant update (card_status, card_lease_at) on v4.comments to tenant_bot;

revoke all on all functions in schema v4 from public, anon, authenticated;
grant execute on all functions in schema v4 to service_role, tenant_bot;
revoke execute on function v4.tick(timestamptz), v4.tick_cases(timestamptz), v4.claim_notifications(text, integer, timestamptz),
  v4.finish_notification(bigint, text, text), v4.expire_notification_leases(timestamptz),
  v4.claim_jobs(integer, interval, timestamptz),
  v4.finish_job(bigint, boolean, text, interval), v4.expire_access(timestamptz),
  v4.cabinet_items(uuid, text, timestamptz),
  v4.claim_comment_sends(integer, timestamptz), v4.finish_comment_send(uuid, text, text, timestamptz),
  v4.note_external_dm(uuid, text, text)
  from tenant_bot;

-- Проверка (должно вернуть 2 таблицы и функцию спама):
-- select (select count(*) from pg_tables where schemaname = 'v4' and tablename in ('comment_rules', 'comments')) as tables,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname = 'v4' and p.proname = 'is_spam') as spam_fn;
