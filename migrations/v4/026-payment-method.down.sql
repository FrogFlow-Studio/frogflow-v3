-- Откат v4/026: убирает запись способа оплаты и списки. Только схема v4.
drop function if exists v4.save_payment_method(uuid, text, text, text, text, uuid);
drop function if exists v4.list_payment_methods(uuid);
drop function if exists v4.list_lessons(uuid);
