-- Откат v4/009: убирает файлы товаров по языкам. Только схема v4.
drop function if exists v4.files_for(uuid, uuid, text);
drop table if exists v4.product_files;
