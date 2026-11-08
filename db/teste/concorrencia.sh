#!/bin/bash
# Duas reservas simultâneas maiores que o disponível: só uma pode passar.
P="psql -h /tmp/pg -p 5499 -U postgres -d t -qtA"
MAT=$($P -c "select id from public.materiais where codigo='PLA-PT'")
EMP=$($P -c "select empresa_id from public.materiais where id='$MAT'")
$P -c "update public.empresas set status='ativa' where id='$EMP'" >/dev/null
Q="set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; begin; select public.reservar_materia_prima('$MAT', 2, 'concorrente', null, null); select pg_sleep(1); commit;"
$P -c "$Q" > /tmp/r1 2>&1 & $P -c "$Q" > /tmp/r2 2>&1 & wait
OK=$(grep -L ERROR /tmp/r1 /tmp/r2 | wc -l)
[ "$OK" = "1" ] && echo "ok - reservas simultâneas: só uma passou" || { echo "FALHOU concorrência"; cat /tmp/r1 /tmp/r2; exit 1; }
