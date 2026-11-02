-- v4/013: кабинет покупателя по ссылке — файлы по языку покупателя (009) вместо
-- одного products.storage_path. Только схема v4. Применяет Яков после 012.

-- Что показать по ссылке: действующие доступы и их файлы на языке покупателя.
-- Неверная или старая ссылка — пусто. У клуба файлов нет — одна строка без файла.
create or replace function v4.cabinet_files(p_bot_id uuid, p_token_sha256 text, p_now timestamptz default now())
returns table (access_id uuid, title text, kind text, ends_at timestamptz, language text,
               file_id uuid, file_name text)
language plpgsql as $$
declare
  l v4.cabinet_links;
  lang text;
begin
  update v4.cabinet_links cl set last_used_at = p_now
  where cl.token_sha256 = lower(p_token_sha256) and cl.bot_id = p_bot_id and cl.expires_at > p_now
  returning * into l;
  if not found then return; end if;
  select coalesce(b.language, 'ru') into lang from v4.buyers b where b.bot_id = p_bot_id and b.id = l.buyer_id;
  return query
  select a.id, coalesce(par.title, p.title) || coalesce(' · ' || p.variant_label, ''), a.kind, a.ends_at, lang,
         f.id, f.file_name
  from v4.access a
  join v4.products p on p.id = a.product_id
  left join v4.products par on par.id = p.parent_id
  -- Файлы варианта; если у варианта своих нет — файлы основного товара.
  left join lateral (
    select * from v4.files_for(p_bot_id, a.product_id, lang)
    union all
    select * from v4.files_for(p_bot_id, p.parent_id, lang)
    where p.parent_id is not null
      and not exists (select 1 from v4.product_files x where x.bot_id = p_bot_id and x.product_id = a.product_id)
  ) f on true
  where a.bot_id = p_bot_id and a.buyer_id = l.buyer_id and a.status = 'active'
    and (a.ends_at is null or a.ends_at > p_now)
  order by a.created_at desc, a.id, f.sort, f.id;
end $$;

-- Путь файла для скачивания — только если ссылка жива и у покупателя есть
-- действующий доступ к товару этого файла (или к его варианту). Иначе пусто.
create or replace function v4.cabinet_file(p_bot_id uuid, p_token_sha256 text, p_file_id uuid, p_now timestamptz default now())
returns table (storage_path text, file_name text)
language sql stable as $$
  select f.storage_path, f.file_name
  from v4.cabinet_links l
  join v4.product_files f on f.bot_id = l.bot_id and f.id = p_file_id
  where l.token_sha256 = lower(p_token_sha256) and l.bot_id = p_bot_id and l.expires_at > p_now
    and exists (select 1 from v4.access a join v4.products p on p.id = a.product_id
                where a.bot_id = l.bot_id and a.buyer_id = l.buyer_id
                  and (a.product_id = f.product_id or p.parent_id = f.product_id)
                  and a.status = 'active' and (a.ends_at is null or a.ends_at > p_now))
$$;

revoke all on function v4.cabinet_files(uuid, text, timestamptz), v4.cabinet_file(uuid, text, uuid, timestamptz)
  from public, anon, authenticated, tenant_bot;
grant execute on function v4.cabinet_files(uuid, text, timestamptz), v4.cabinet_file(uuid, text, uuid, timestamptz)
  to service_role;

-- Проверка (должно вернуть 2):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'v4' and p.proname in ('cabinet_files', 'cabinet_file');
