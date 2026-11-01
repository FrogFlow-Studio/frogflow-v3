#!/usr/bin/env bash
# Проверка гонок книги денег v4 на настоящем Postgres с параллельными подключениями.
# PGlite в тестах — одно подключение, поэтому блокировки (for update) там не проверить;
# этот скрипт запускается руками, когда меняются функции migrations/v4/*.sql.
#
#   PGHOST=/path/to/socket PGPORT=54329 PGUSER=postgres scripts/v4/race-check.sh
#
# Нужна ПУСТАЯ база (роли service_role, anon, authenticated, tenant_bot скрипт создаст).
# Никогда не запускать на живой базе Supabase.
set -euo pipefail
P="psql -v ON_ERROR_STOP=1 -qtA"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1 ($2)"; else echo "FAIL $1: ждали $3, вышло $2"; fail=1; fi; }

for r in service_role anon authenticated tenant_bot; do
  $P -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$r') then create role $r; end if; end \$\$;"
done
for f in migrations/v4/[0-9][0-9][0-9]-*.sql; do case "$f" in *.down.sql) ;; *) $P -f "$f" ;; esac; done

A=aaaaaaaa-0000-4000-8000-0000000000ff
$P -c "insert into v4.shops (bot_id, base_currency, points_earn_pct, points_redeem_pct) values ('$A', 'KZT', 5, 100)"
BU=$($P -c "insert into v4.buyers (bot_id, country) values ('$A', 'KZ') returning id" | head -1)
PR=$($P -c "insert into v4.products (bot_id, title, kind, base_price_minor) values ('$A', 'p', 'file', 50000) returning id" | head -1)
new_order() { $P -c "select id from v4.create_order('$A', '$1', 'KZ', array['$PR']::uuid[])" | head -1; }

O1=$(new_order "$BU")
for i in $(seq 1 30); do $P -c "select became_paid from v4.record_payment('$A', '$O1', 50000, 'KZT', 'transfer', 'r1-$i', 't')" >"$OUT/a$i" 2>&1 & done; wait
check "30 разных платежей одновременно: «стал оплаченным» один раз" "$(cat "$OUT"/a* | grep -c '^t$')" 1
check "баллы за заказ начислены один раз" "$($P -c "select count(*) from v4.points where order_id = '$O1' and kind = 'earn'")" 1

O2=$(new_order "$BU")
for i in $(seq 1 30); do $P -c "select 1 from v4.record_payment('$A', '$O2', 50000, 'KZT', 'transfer', 'same', 't')" >"$OUT/b$i" 2>&1 & done; wait
check "30 повторов одного вебхука: одна запись в книге" "$($P -c "select count(*) from v4.ledger where order_id = '$O2'")" 1
check "повторы без ошибок" "$(grep -l ERROR "$OUT"/b* 2>/dev/null | wc -l)" 0

for i in $(seq 1 30); do $P -c "select 1 from v4.create_order('$A', '$BU', 'KZ', array['$PR']::uuid[])" >"$OUT/c$i" 2>&1 & done; wait
check "номера заказов без дублей и дыр" "$($P -c "select count(*) = count(distinct no) and max(no) - min(no) + 1 = count(*) from v4.orders where bot_id = '$A'")" t

B2=$($P -c "insert into v4.buyers (bot_id, country) values ('$A', 'KZ') returning id" | head -1)
$P -c "insert into v4.points (bot_id, buyer_id, kind, delta, created_by) values ('$A', '$B2', 'migrated', 100, 't')"
for i in $(seq 1 10); do $P -c "select 1 from v4.create_order('$A', '$B2', 'KZ', array['$PR']::uuid[], 100)" >"$OUT/d$i" 2>&1 & done; wait
check "10 заказов на одни 100 баллов: прошёл один" "$(grep -L ERROR "$OUT"/d* | wc -l)" 1
check "баланс не ушёл в минус" "$($P -c "select v4.points_balance('$A', '$B2')")" 0

O5=$(new_order "$BU")
RC=$($P -c "select id from v4.submit_receipt('$A', '$O5', 'x/y.jpg', repeat('a', 64))" | head -1)
for i in $(seq 1 10); do $P -c "select decided from v4.decide_receipt('$A', '$RC', true, 50000, null, 'u$i')" >"$OUT/e$i" 2>&1 & done; wait
check "10 «Принять чек» одновременно: решил один" "$(cat "$OUT"/e* | grep -c '^t$')" 1
check "по чеку один платёж" "$($P -c "select count(*) from v4.ledger where order_id = '$O5'")" 1

exit $fail
