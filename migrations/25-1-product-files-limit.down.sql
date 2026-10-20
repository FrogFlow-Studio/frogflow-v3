-- 25-1 down: откат лимита размера файлов для product-files обратно до 200 МБ.
UPDATE storage.buckets
SET file_size_limit = 209715200 -- 200 MB (200 * 1024 * 1024)
WHERE id = 'product-files';
