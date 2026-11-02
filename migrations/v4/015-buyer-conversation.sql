-- v4/015: переписка Zernio у канала покупателя. Instagram и WhatsApp пишут в
-- переписку (conversation), а не по id пользователя: без неё выдача в Direct
-- невозможна. В v3 это bot_users.zernio_conversation_id. Только схема v4.
-- Применяет Яков после 014.

alter table v4.buyer_channels add column conversation_id text check (conversation_id <> '');
-- Аккаунт Zernio магазина, через который покупатель писал (у магазина их бывает
-- несколько; в v3 — bot_users.zernio_account_id).
alter table v4.buyer_channels add column account_id text check (account_id <> '');
-- Дописывает их бот из входящего вебхука (update на buyer_channels у арендатора уже есть, 002).

-- План выдачи (012) — теперь и с перепиской канала.
create or replace function v4.delivery_plan(p_bot_id uuid, p_access_id uuid)
returns jsonb language sql stable as $$
  with ch as (
    select bc.channel, bc.external_id, bc.conversation_id, bc.account_id from v4.buyer_channels bc, v4.access a
    where a.id = p_access_id and a.bot_id = p_bot_id
      and bc.bot_id = a.bot_id and bc.buyer_id = a.buyer_id and bc.channel in ('telegram', 'instagram', 'whatsapp')
    order by bc.created_at desc, bc.channel, bc.external_id
    limit 1)
  select jsonb_build_object(
    'access_id', a.id, 'status', a.status, 'kind', a.kind, 'buyer_id', a.buyer_id, 'order_id', a.order_id,
    'ends_at', a.ends_at,
    'title', coalesce(par.title, p.title) || coalesce(' · ' || p.variant_label, ''),
    'language', coalesce(b.language, 'ru'),
    'channel', ch.channel, 'external_id', ch.external_id, 'conversation_id', ch.conversation_id,
    'account_id', ch.account_id,
    'delivered', exists (select 1 from v4.deliveries d where d.access_id = a.id and d.channel = ch.channel),
    'claimed_at', (select c.claimed_at from v4.delivery_claims c where c.access_id = a.id and c.channel = ch.channel))
  from v4.access a
  join v4.products p on p.id = a.product_id
  left join v4.products par on par.id = p.parent_id
  join v4.buyers b on b.bot_id = a.bot_id and b.id = a.buyer_id
  left join ch on true
  where a.id = p_access_id and a.bot_id = p_bot_id
$$;

-- Проверка (должно вернуть 2):
-- select count(*) from information_schema.columns
--  where table_schema = 'v4' and table_name = 'buyer_channels' and column_name in ('conversation_id', 'account_id');
