-- Откат v4/010: убирает проверку «магазин есть в v4». Только схема v4.
drop function if exists v4.shop_ready(uuid);
