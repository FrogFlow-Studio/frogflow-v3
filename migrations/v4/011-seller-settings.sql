-- v4/011: настройки ИИ-продавца в панели — анкета, стоп-слова, лимит ИИ (только показ).
-- Только схема v4. Применяет Яков в SQL-редакторе Supabase после 010.

-- Версия настроек — md5 анкеты и стоп-слов (32 знака): по ней запись не затирает
-- то, что другой сотрудник сохранил между открытием страницы и нажатием «Сохранить».
create or replace function v4.seller_settings_version(p_profile jsonb, p_spam_words text[])
returns text language sql immutable as $$
  select md5(coalesce(p_profile, '{}'::jsonb)::text || '|' || coalesce(array_to_string(p_spam_words, chr(10)), ''))
$$;

create or replace function v4.seller_settings(p_bot_id uuid, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profile', s.seller_profile,
    'spam_words', to_jsonb(s.spam_words),
    'limit_micro_usd', s.ai_monthly_limit_micro_usd,
    'room_micro_usd', v4.ai_room_micro_usd(s.bot_id, p_now),
    'version', v4.seller_settings_version(s.seller_profile, s.spam_words))
  from v4.shops s where s.bot_id = p_bot_id
$$;

-- Сохранить анкету и стоп-слова. false — версия устарела (кто-то сохранил раньше)
-- или магазина нет; лимит ИИ отсюда не меняется (его задаёт тариф, 005).
create or replace function v4.save_seller_settings(
  p_bot_id uuid, p_profile jsonb, p_spam_words text[], p_version text
) returns boolean language plpgsql as $$
begin
  if jsonb_typeof(p_profile) <> 'object' then
    raise exception using errcode = 'P0001', message = 'v4:bad_status';
  end if;
  update v4.shops s set seller_profile = p_profile, spam_words = coalesce(p_spam_words, '{}')
  where s.bot_id = p_bot_id and v4.seller_settings_version(s.seller_profile, s.spam_words) = p_version;
  return found;
end $$;

revoke all on function v4.seller_settings_version(jsonb, text[]), v4.seller_settings(uuid, timestamptz),
  v4.save_seller_settings(uuid, jsonb, text[], text) from public, anon, authenticated;
grant execute on function v4.seller_settings_version(jsonb, text[]), v4.seller_settings(uuid, timestamptz),
  v4.save_seller_settings(uuid, jsonb, text[], text) to service_role, tenant_bot;

-- Проверка (должно вернуть 3):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and p.proname in ('seller_settings_version', 'seller_settings', 'save_seller_settings');
