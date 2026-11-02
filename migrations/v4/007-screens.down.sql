-- Откат v4/007: убирает экраны «Сегодня» и «Внимание». Только схема v4.
drop function if exists v4.attention(timestamptz);
drop function if exists v4.today(uuid, timestamptz);
drop function if exists v4.case_light(text, smallint, timestamptz, timestamptz);
