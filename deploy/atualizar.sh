#!/bin/bash
# Atualiza o MRV3D na VPS: baixa a versão nova, faz backup, aplica as mudanças do banco
# e publica o painel das lojas e o Super Admin. Rodar como root:  bash /opt/mrv3d/deploy/atualizar.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOM=mrv3dsolutions.tech
DB="docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
passo() { echo; echo "==> $*"; }

cd "$DIR"
if [ -d .git ]; then
  passo "1/5 Baixando a versão nova"
  git fetch --quiet origin && git reset --quiet --hard origin/main
  echo "versão: $(git log -1 --format='%h — %s (%cr)')"
else
  passo "1/5 Usando os arquivos desta pasta (sem git)"
fi

ANON=$(grep '^ANON_KEY=' /opt/supabase/.env | cut -d= -f2-)
[ -n "$ANON" ] || { echo "ANON_KEY não encontrada em /opt/supabase/.env"; exit 1; }
docker ps --format '{{.Names}}' | grep -q '^supabase-db$' || { echo "O banco (supabase-db) não está rodando. Rode: cd /opt/supabase && docker compose up -d"; exit 1; }

passo "2/5 Backup do banco antes de mudar qualquer coisa"
/usr/local/bin/backup-mrv3d

passo "3/5 Aplicando mudanças do banco"
echo "create schema if not exists private; create table if not exists private._migracoes (nome text primary key, aplicada_em timestamptz not null default now());" | $DB
for f in db/migrations/*.sql; do
  n=$(basename "$f")
  if [ -n "$(docker exec supabase-db psql -U supabase_admin -d postgres -tAc "select 1 from private._migracoes where nome = '$n'")" ]; then continue; fi
  echo "aplicando $n"
  # cada arquivo roda numa transação: se der erro, nada daquele arquivo fica pela metade
  { cat "$f"; echo; echo "insert into private._migracoes(nome) values ('$n');"; } | $DB -1 \
    || { echo; echo "ERRO ao aplicar $n. Nada deste arquivo foi gravado e o site não foi alterado."; echo "Backup de antes: $(ls -t /var/backups/mrv3d/*.dump | head -1)"; exit 1; }
done
echo "notify pgrst, 'reload schema';" | $DB
echo "banco em dia"

# limite de envio por arquivo: 200 MB (armazenamento do Supabase + nginx). Só mexe se ainda estiver diferente.
LIM=209715200
COMPOSE=/opt/supabase/docker-compose.yml
if [ -f "$COMPOSE" ] && grep -Eq 'FILE_SIZE_LIMIT: *"?[0-9]+' "$COMPOSE" && ! grep -Eq "FILE_SIZE_LIMIT: *\"?$LIM" "$COMPOSE"; then
  cp "$COMPOSE" "$COMPOSE.antes-limite"
  sed -i -E "s/(FILE_SIZE_LIMIT: *\"?)[0-9]+/\1$LIM/" "$COMPOSE"
  ( cd /opt/supabase && docker compose up -d storage >/dev/null 2>&1 ) && echo "armazenamento: limite por arquivo 200 MB" \
    || { cp "$COMPOSE.antes-limite" "$COMPOSE"; echo "AVISO: não consegui reiniciar o armazenamento com o limite novo (mantido o anterior)"; }
fi
grep -E 'FILE_SIZE_LIMIT' "$COMPOSE" 2>/dev/null | head -1 | sed 's/^ */armazenamento: /' || true
NGX=/etc/nginx/conf.d/mrv3d-upload.conf
if [ ! -f "$NGX" ]; then
  echo "client_max_body_size 210m;" > "$NGX"
  for f in $(grep -lE "server_name[^;]*api\.$DOM" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null); do
    cp "$f" "/root/$(basename "$f").antes-limite"
    sed -i -E 's/client_max_body_size[^;]*;/client_max_body_size 210m;/' "$f"
  done
  nginx -t -q 2>/dev/null && echo "nginx: envio até 210 MB" \
    || { rm -f "$NGX"; for b in /root/*.antes-limite; do [ -f "$b" ] || continue; n=$(basename "$b" .antes-limite); for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do [ -f "$d/$n" ] && cp "$b" "$d/$n"; done; done; echo "AVISO: nginx recusou o limite novo (mantido o anterior)"; }
fi

# soma de verificação do agente local (o usuário confere o download)
( cd "$DIR/painel/public/agente" && sha256sum mrv3d_agente.py > mrv3d_agente.py.sha256 ) 2>/dev/null || true

construir() { # $1 = pasta do app
  docker run --rm -v "$DIR/$1":/app -w /app node:22-alpine sh -c "npm ci --no-audit --no-fund --loglevel=error && npm run build" >/tmp/build-$1.log 2>&1 \
    || { echo "ERRO ao montar $1 (veja /tmp/build-$1.log). O site continua na versão anterior."; tail -20 /tmp/build-$1.log; exit 1; }
}
publicar() { # $1 = pasta do app  $2 = destino
  local novo="$2.novo" antigo="$2.anterior"
  rm -rf "$novo" && cp -r "$DIR/$1/out" "$novo"
  printf 'window.__CFG = { url: "https://api.%s", key: "%s" };\n' "$DOM" "$ANON" > "$novo/config.js"
  [ -f "$novo/l/index.html" ] && cp "$novo/l/index.html" "$novo/link.html"
  rm -rf "$antigo"; [ -d "$2" ] && mv "$2" "$antigo"; mv "$novo" "$2"
}

passo "4/5 Montando o painel das lojas e o Super Admin (pode levar alguns minutos)"
construir painel
construir admin

passo "5/5 Publicando"
publicar painel /var/www/app
publicar admin /var/www/admin
nginx -t -q && systemctl reload nginx

echo
echo "ATUALIZAÇÃO CONCLUÍDA"
echo "  Painel das lojas: https://$DOM"
echo "  Super Admin:      https://admin.$DOM"
echo "  (para voltar à versão anterior do site: bash $DIR/deploy/voltar.sh)"
