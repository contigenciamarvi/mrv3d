#!/bin/bash
# Recria o banco local de testes e aplica todas as migrações
P="psql -h /tmp/pg -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists t" -c "create database t" >/dev/null
psql -h /tmp/pg -p 5499 -U postgres -d postgres -c "drop role if exists anon; drop role if exists authenticated; drop role if exists service_role" >/dev/null 2>&1
$P -d t -f "$(dirname $0)/000_base_stub.sql" || exit 1
for f in $(dirname $0)/../migrations/*.sql; do echo "== $(basename $f)"; $P -d t -1 -f "$f" || exit 1; done
echo "OK"
