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

# Этап 2: дела, уведомления, задачи
O6=$(new_order "$BU")
$P -c "select 1 from v4.submit_receipt('$A', '$O6', 'x/z.jpg', repeat('b', 64))" >/dev/null
CS=$($P -c "select id from v4.cases where order_id = '$O6' and kind = 'receipt_review'" | head -1)
for i in $(seq 1 10); do $P -c "select v4.tick(now() + interval '3 hours')" >"$OUT/f$i" 2>&1 & done; wait
check "10 тиков одновременно: напоминание по чеку одно" "$($P -c "select count(*) from v4.case_events where case_id = '$CS' and kind = 'reminded'")" 1
check "тики без ошибок" "$(grep -l ERROR "$OUT"/f* 2>/dev/null | wc -l)" 0
$P -c "select v4.notify('$A', 'seller', 'now', 'race', 'race-' || g) from generate_series(1, 40) g" >/dev/null
for i in $(seq 1 8); do $P -c "select id from v4.claim_notifications('now', 10) where kind = 'race'" >"$OUT/g$i" 2>&1 & done; wait
check "8 отправщиков на 40 уведомлений: каждое забрано один раз" "$(cat "$OUT"/g* | grep -E '^[0-9]+$' | sort | uniq -d | wc -l):$(cat "$OUT"/g* | grep -cE '^[0-9]+$')" "0:40"
$P -c "select v4.enqueue_job('race', 'j' || g) from generate_series(1, 30) g" >/dev/null
for i in $(seq 1 6); do $P -c "select id from v4.claim_jobs(10) where kind = 'race'" >"$OUT/h$i" 2>&1 & done; wait
check "6 исполнителей на 30 задач: каждая забрана один раз" "$(cat "$OUT"/h* | grep -E '^[0-9]+$' | sort | uniq -d | wc -l):$(cat "$OUT"/h* | grep -cE '^[0-9]+$')" "0:30"

# Этап 3: выдача и доступы
check "30 платежей одновременно: доступ выдан один раз" "$($P -c "select count(*) from v4.access where order_id = '$O1'")" 1
check "задача выдачи одна" "$($P -c "select count(*) from v4.jobs j join v4.access a on a.id::text = j.payload ->> 'access_id' where a.order_id = '$O1' and j.kind = 'deliver'")" 1
CL=$($P -c "insert into v4.products (bot_id, title, kind, base_price_minor, term) values ('$A', 'club', 'club', 100, '30 days') returning id" | head -1)
CO=$($P -c "select id from v4.create_order('$A', '$BU', 'KZ', array['$CL']::uuid[])" | head -1)
$P -c "select 1 from v4.record_payment('$A', '$CO', 100, 'KZT', 'transfer', 'club-race', 't')" >/dev/null
for i in $(seq 1 10); do $P -c "select v4.expire_access(now() + interval '28 days')" >"$OUT/k$i" 2>&1 & done; wait
check "10 тиков одновременно: напоминание о продлении одно" "$($P -c "select count(*) from v4.notifications where kind = 'club_renew_reminder'")" 1
for i in $(seq 1 10); do $P -c "select v4.expire_access(now() + interval '31 days')" >"$OUT/l$i" 2>&1 & done; wait
check "10 тиков одновременно: убрать из клуба — одна задача" "$($P -c "select count(*) from v4.jobs where kind = 'club_remove'")" 1
check "тики доступа без ошибок" "$(grep -l ERROR "$OUT"/k* "$OUT"/l* 2>/dev/null | wc -l)" 0

exit $fail
