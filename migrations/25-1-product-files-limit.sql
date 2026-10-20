-- 25-1: расширение лимита размера файлов для цифровых товаров и материалов с 200 МБ до 500 МБ.
UPDATE storage.buckets
SET file_size_limit = 524288000 -- 500 MB (500 * 1024 * 1024)
WHERE id = 'product-files';
