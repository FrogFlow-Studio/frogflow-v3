-- Откат v4/015: план выдачи без переписки (как в 012) и без колонки.
create or replace function v4.delivery_plan(p_bot_id uuid, p_access_id uuid)
returns jsonb language sql stable as $$
  with ch as (
    select bc.channel, bc.external_id from v4.buyer_channels bc, v4.access a
    where a.id = p_access_id and a.bot_id = p_bot_id
      and bc.bot_id = a.bot_id and bc.buyer_id = a.buyer_id and bc.channel in ('telegram', 'instagram', 'whatsapp')
    order by bc.created_at desc, bc.channel, bc.external_id
    limit 1)
  select jsonb_build_object(
    'access_id', a.id, 'status', a.status, 'kind', a.kind, 'buyer_id', a.buyer_id, 'order_id', a.order_id,
    'ends_at', a.ends_at,
    'title', coalesce(par.title, p.title) || coalesce(' · ' || p.variant_label, ''),
    'language', coalesce(b.language, 'ru'),
    'channel', ch.channel, 'external_id', ch.external_id,
    'delivered', exists (select 1 from v4.deliveries d where d.access_id = a.id and d.channel = ch.channel),
    'claimed_at', (select c.claimed_at from v4.delivery_claims c where c.access_id = a.id and c.channel = ch.channel))
  from v4.access a
  join v4.products p on p.id = a.product_id
  left join v4.products par on par.id = p.parent_id
  join v4.buyers b on b.bot_id = a.bot_id and b.id = a.buyer_id
  left join ch on true
  where a.id = p_access_id and a.bot_id = p_bot_id
$$;

alter table v4.buyer_channels drop column if exists conversation_id;
