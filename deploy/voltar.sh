#!/bin/bash
# Volta o site (painel e Super Admin) para a versão publicada antes da última atualização.
# O banco não é alterado; para restaurar o banco use o backup em /var/backups/mrv3d.
set -euo pipefail
for d in /var/www/app /var/www/admin; do
  if [ -d "$d.anterior" ]; then rm -rf "$d.desfeito"; mv "$d" "$d.desfeito"; mv "$d.anterior" "$d"; echo "voltou: $d"; else echo "sem versão anterior de $d"; fi
done
systemctl reload nginx
