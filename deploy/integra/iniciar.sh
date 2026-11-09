#!/bin/bash
# (Re)inicia o serviço de integrações (Mercado Livre) e publica /integra/ no nginx do painel.
# Chamado pelo configurar-ml.sh e por cada atualização. Só roda se a integração já foi configurada.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENVF=/etc/mrv3d-integra.env
[ -f "$ENVF" ] || { echo "integrações: não configuradas (rode: bash $DIR/deploy/integra/configurar-ml.sh)"; exit 0; }

# nginx: /integra/ do painel vai para o serviço local (só uma vez)
SNIP=/etc/nginx/snippets/mrv3d-integra.conf
mkdir -p /etc/nginx/snippets
cat > "$SNIP" <<'NGX'
location /integra/ {
  proxy_pass http://127.0.0.1:8790;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  client_max_body_size 64k;
  proxy_read_timeout 30s;
}
NGX
ARQ=$(grep -lE "root +/var/www/app;" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1 || true)
if [ -n "$ARQ" ] && ! grep -q "mrv3d-integra.conf" "$ARQ"; then
  cp "$ARQ" "/root/$(basename "$ARQ").antes-integra"
  sed -i -E "s#^([[:space:]]*)root +/var/www/app;#&\n\1include $SNIP;#" "$ARQ"
  if nginx -t -q 2>/dev/null; then systemctl reload nginx; echo "nginx: /integra/ publicado"
  else cp "/root/$(basename "$ARQ").antes-integra" "$ARQ"; echo "AVISO: nginx recusou a configuração de /integra/ (mantida a anterior)"; fi
fi

# serviço em container (node oficial, sem dependências), só escuta em 127.0.0.1
docker rm -f mrv3d-integra >/dev/null 2>&1 || true
docker run -d --name mrv3d-integra --restart unless-stopped --network host --read-only --user node --memory 256m \
  --env-file "$ENVF" -v "$DIR/deploy/integra:/app:ro" node:22-alpine node /app/servidor.mjs >/dev/null
sleep 3
if curl -fsS http://127.0.0.1:8790/integra/saude >/dev/null 2>&1; then echo "integrações: serviço no ar"
else echo "AVISO: o serviço de integrações não respondeu. Veja: docker logs mrv3d-integra"; fi
