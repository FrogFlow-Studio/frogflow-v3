-- 23-2: индексы на внешние ключи по советнику Supabase (unindexed_foreign_keys).
-- Пункт А плана работ от 08.10. Только добавление: таблицы, колонки и данные не меняются
-- (база общая с v1). Без индекса удаление или смена ключа в родительской таблице
-- (товар, вариант, зона доставки, тариф VIP, заказ) перебирает всю дочернюю таблицу,
-- чтобы проверить ссылки. Таблицы маленькие (самая большая около 2 тыс. строк),
-- поэтому обычный CREATE INDEX: блокировка записи на доли секунды, и файл можно
-- выполнить одним запросом в SQL-редакторе.
-- Применяет Яков своим словом; пока не применена, всё работает как сейчас.
-- Откат: 23-2-fk-indexes.down.sql.

CREATE INDEX IF NOT EXISTS idx_buyer_favorites_bot_id ON buyer_favorites (bot_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items (product_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_variant_id ON cart_items (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_comment_dm_fallback_sends_bot_id ON comment_dm_fallback_sends (bot_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_post_id ON community_reports (post_id);
CREATE INDEX IF NOT EXISTS idx_community_reports_thread_id ON community_reports (thread_id);
CREATE INDEX IF NOT EXISTS idx_consultant_handoffs_run_id ON consultant_handoffs (run_id);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_bot_id ON delivery_zones (bot_id);
CREATE INDEX IF NOT EXISTS idx_gift_certificates_redeemed_order_id ON gift_certificates (redeemed_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_variant_id ON order_items (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_zone_id ON orders (delivery_zone_id);
CREATE INDEX IF NOT EXISTS idx_platform_news_reads_news_id ON platform_news_reads (news_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_bot_id ON product_variants (bot_id);
CREATE INDEX IF NOT EXISTS idx_vip_member_profiles_assigned_tariff_id ON vip_member_profiles (assigned_tariff_id);
CREATE INDEX IF NOT EXISTS idx_vip_subscriptions_tariff_id ON vip_subscriptions (tariff_id);
