-- Откат v4/019: поиск снова по подстроке (как в 005), без карточки и отмены покупателем.
-- Поиск товара для бота: по словам названия и варианта, только то, что продаётся.
create or replace function v4.find_products(p_bot_id uuid, p_query text, p_limit integer default 8)
returns table (product_id uuid, title text, variant_label text, kind text, has_variants boolean)
language sql stable as $$
  with words as (
    select w from regexp_split_to_table(lower(coalesce(p_query, '')), '[[:space:][:punct:]]+') w where length(w) >= 2
  )
  select p.id, p.title, p.variant_label, p.kind,
    exists (select 1 from v4.products c where c.parent_id = p.id and c.status = 'active')
  from v4.products p
  left join v4.products par on par.id = p.parent_id
  where p.bot_id = p_bot_id and p.status = 'active' and coalesce(par.status, 'active') = 'active'
    and (not exists (select 1 from words)
         or exists (select 1 from words where lower(p.title || ' ' || coalesce(p.variant_label, '')) like '%' || w || '%'))
  order by (select count(*) from words where lower(p.title || ' ' || coalesce(p.variant_label, '')) like '%' || w || '%') desc,
    p.parent_id nulls first, p.title, p.variant_label nulls first, p.id
  limit greatest(1, least(p_limit, 20))
$$;

drop function if exists v4.cancel_by_buyer(uuid, uuid, bigint);
drop function if exists v4.product_details(uuid, uuid, text);
drop function if exists v4.search_stopword(text);
drop function if exists v4.word_matches(text, text);
drop function if exists v4.word_stem(text);
alter table v4.products
  drop column if exists description,
  drop column if exists keywords,
  drop column if exists photo_paths,
  drop column if exists pairs_with;
