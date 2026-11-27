-- Откат v4/022: перенос из v3.
drop function if exists v4.transfer_from_v3(uuid, jsonb, timestamptz);
drop function if exists v4.transfer_catalog(uuid);
