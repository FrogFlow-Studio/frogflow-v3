-- Откат v4/011: убирает функции настроек ИИ-продавца. Данные магазинов не трогает.
drop function if exists v4.save_seller_settings(uuid, jsonb, text[], text);
drop function if exists v4.seller_settings(uuid, timestamptz);
drop function if exists v4.seller_settings_version(jsonb, text[]);
