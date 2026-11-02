-- v4/009: несколько файлов у товара, по языку (Копилка: до 3 файлов на язык, ru и kk).
-- Только схема v4. Применяет Яков в SQL-редакторе Supabase после 008.

create table v4.product_files (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  product_id uuid not null,
  -- null — файл для любого языка покупателя.
  language text check (language in ('ru', 'kk', 'en', 'uz')),
  storage_path text not null check (storage_path <> ''),
  file_name text not null check (file_name <> ''),
  file_bytes bigint check (file_bytes >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (bot_id, product_id) references v4.products (bot_id, id)
);
create index product_files_product on v4.product_files (bot_id, product_id, language, sort, id);

-- Что выдать покупателю: файлы его языка; нет таких — файлы без языка; нет и их — все.
create or replace function v4.files_for(p_bot_id uuid, p_product_id uuid, p_language text)
returns setof v4.product_files language sql stable as $$
  with f as (select * from v4.product_files where bot_id = p_bot_id and product_id = p_product_id),
  pick as (
    select case
      when exists (select 1 from f where language = p_language) then 'lang'
      when exists (select 1 from f where language is null) then 'any'
      else 'all' end as mode)
  select f.* from f, pick
  where (pick.mode = 'lang' and f.language = p_language)
     or (pick.mode = 'any' and f.language is null)
     or pick.mode = 'all'
  order by f.language nulls first, f.sort, f.id
$$;

alter table v4.product_files enable row level security;
create policy tenant_isolation on v4.product_files for all to tenant_bot
  using (bot_id = v4.current_bot_id()) with check (bot_id = v4.current_bot_id());
revoke all on v4.product_files from public, anon, authenticated, tenant_bot;
grant select, insert, update on v4.product_files to service_role, tenant_bot;
revoke all on function v4.files_for(uuid, uuid, text) from public, anon, authenticated;
grant execute on function v4.files_for(uuid, uuid, text) to service_role, tenant_bot;

-- Проверка (должно вернуть 1):
-- select count(*) from pg_tables where schemaname = 'v4' and tablename = 'product_files';
