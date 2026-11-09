#!/bin/bash
# Configuração única da integração com o Mercado Livre (rodar como root na VPS):
#   bash /opt/mrv3d/deploy/integra/configurar-ml.sh
# A chave secreta é digitada aqui, fica só neste servidor (/etc/mrv3d-integra.env, permissão 600) e nunca vai para o GitHub.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DOM=mrv3dsolutions.tech
ENVF=/etc/mrv3d-integra.env
echo
echo "== Integração Mercado Livre =="
echo "Antes, crie o aplicativo em https://developers.mercadolivre.com.br/devcenter com:"
echo "  URL de redirecionamento: https://$DOM/integra/ml/callback"
echo "  URL de notificações:     https://$DOM/integra/ml/notificacoes"
echo "  Tópicos:                 Orders (orders_v2), Items e Shipments"
echo "  Permissões:              leitura e escrita"
echo
read -rp "App ID (só números): " APP
[[ "$APP" =~ ^[0-9]{5,25}$ ]] || { echo "App ID inválido"; exit 1; }
read -rsp "Secret Key (não aparece enquanto digita): " SEC; echo
[[ "$SEC" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || { echo "Secret Key inválida"; exit 1; }
SRK=$(grep '^SERVICE_ROLE_KEY=' /opt/supabase/.env | cut -d= -f2-)
[ -n "$SRK" ] || { echo "SERVICE_ROLE_KEY não encontrada em /opt/supabase/.env"; exit 1; }
umask 077
{
  printf 'SUPABASE_URL=https://api.%s\n' "$DOM"
  printf 'SERVICE_ROLE_KEY=%s\n' "$SRK"
  printf 'ML_CLIENT_ID=%s\n' "$APP"
  printf 'ML_CLIENT_SECRET=%s\n' "$SEC"
  printf 'ML_REDIRECT_URI=https://%s/integra/ml/callback\n' "$DOM"
  printf 'PAINEL_URL=https://%s\n' "$DOM"
  printf 'PORTA=8790\n'
} > "$ENVF"
chmod 600 "$ENVF"
unset SEC SRK
docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -c \
  "update public.configuracao_plataforma set ml_app_id = '$APP', ml_redirect_uri = 'https://$DOM/integra/ml/callback', updated_at = now() where id = 1;"
bash "$DIR/deploy/integra/iniciar.sh"
echo
echo "Pronto. Agora cada loja conecta a própria conta em: Integrações › Marketplaces › Conectar Mercado Livre."
