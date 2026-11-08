#!/bin/bash
# Roda todos os testes do banco num banco local recriado do zero
set -e
cd "$(dirname "$0")"
PGOPTIONS='-c client_min_messages=warning' ./reset.sh >/dev/null
psql -h /tmp/pg -p 5499 -U postgres -d t -f testes.sql -f regressao.sql -f fase3.sql -f fase4.sql -f bambu.sql 2>&1 | grep -E "FALHOU|ERROR|TODOS|REGRESS|FASE 3|FASE 4|REVISAO|BAMBU"
./concorrencia.sh
