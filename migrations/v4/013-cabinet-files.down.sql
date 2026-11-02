-- Откат v4/013: убирает кабинет с файлами по языку. Ссылки и доступы не трогает.
drop function if exists v4.cabinet_file(uuid, text, uuid, timestamptz);
drop function if exists v4.cabinet_files(uuid, text, timestamptz);
