# MRV3D Solutions — ERP para impressão 3D

| Pasta | O que é |
|---|---|
| `painel/` | Painel das lojas (Next.js, exportação estática) — mrv3dsolutions.tech |
| `admin/` | Super Admin da plataforma — admin.mrv3dsolutions.tech |
| `db/migrations/` | Mudanças do banco, aplicadas em ordem pelo script de atualização |
| `db/teste/` | Banco de teste local + testes de regras de negócio e isolamento |
| `deploy/` | `atualizar.sh` (atualiza a VPS) e `voltar.sh` (desfaz o site) |

## Atualizar a VPS
```
bash /opt/mrv3d/deploy/atualizar.sh
```
Faz backup, aplica as migrações novas (cada uma numa transação), monta e publica os dois sites.

## Testes do banco (local)
```
db/teste/reset.sh && psql -h /tmp/pg -p 5499 -U postgres -d t -f db/teste/testes.sql && db/teste/concorrencia.sh
```

## Segurança
Toda regra de acesso fica no banco (RLS + funções `security definer` que conferem empresa e permissão).
O navegador nunca recebe chaves de serviço; a configuração pública vem de `/config.js`, gerado na VPS.
