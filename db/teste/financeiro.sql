-- Testes do Super Admin › Financeiro SaaS
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table fs(k text primary key, v uuid); grant all on fs to authenticated, anon;
insert into fs select 'ea', id from public.empresas where nome = 'Loja A';
insert into fs select 'eb', id from public.empresas where nome = 'Loja B';
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000f1', 'fin@plataforma.test'), ('00000000-0000-0000-0000-0000000000f2', 'sup@plataforma.test') on conflict (id) do nothing;
insert into public.equipe_plataforma(user_id, nome, papel) values ('00000000-0000-0000-0000-0000000000f1', 'Financeiro', 'financeiro'), ('00000000-0000-0000-0000-0000000000f2', 'Suporte', 'suporte') on conflict (user_id) do update set papel = excluded.papel, ativo = true;
-- A: mensal R$ 100 com 10% de desconto (= 90), atrasada; B: anual R$ 1200 (= 100/mês), ativa
update public.assinaturas set status = 'atrasada', periodicidade = 'mensal', valor = 100, desconto_percentual = 10, inicio = current_date where empresa_id = (select v from fs where k = 'ea');
update public.assinaturas set status = 'ativa', periodicidade = 'anual', valor = 1200, desconto_percentual = 0, inicio = current_date where empresa_id = (select v from fs where k = 'eb');
insert into public.faturas(empresa_id, descricao, valor, vencimento, status) values
  ((select v from fs where k = 'ea'), 'Mensalidade vencida', 90, current_date - 10, 'aberta'),
  ((select v from fs where k = 'ea'), 'Mensalidade futura', 90, current_date + 5, 'aberta'),
  ((select v from fs where k = 'eb'), 'Anuidade', 1200, current_date - 1, 'paga');
update public.faturas set valor_pago = 1200, pago_em = now() where descricao = 'Anuidade';

-- acesso
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$select public.admin_financeiro(12)$$, 'FS dono de loja não vê financeiro da plataforma', 'restrito');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.falha($$select public.admin_financeiro(12)$$, 'FS suporte não vê financeiro', 'restrito');
set role anon; reset request.jwt.claim.sub;
select pg_temp.falha($$select public.admin_financeiro(12)$$, 'FS visitante não chama', 'permission denied');

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
create temp table fr as select public.admin_financeiro(6) as r;
select pg_temp.ok((select (r#>>'{kpis,mrr}')::numeric = 190 and (r#>>'{kpis,arr}')::numeric = 2280 and (r#>>'{kpis,pagantes}')::int = 2 from fr), 'FS MRR com desconto e anual dividido por 12');
select pg_temp.ok((select (r#>>'{kpis,mrr_em_risco}')::numeric = 90 and (r#>>'{kpis,em_atraso}')::numeric = 90 and (r#>>'{kpis,empresas_inadimplentes}')::int = 1 from fr), 'FS inadimplência só com fatura vencida');
select pg_temp.ok((select (r#>>'{kpis,a_receber_30d}')::numeric = 90 and (r#>>'{kpis,recebido_mes}')::numeric = 1200 from fr), 'FS a receber e recebido no mês');
select pg_temp.ok((select jsonb_array_length(r->'mensal') = 6 and (r->'mensal'->5->>'recebido')::numeric = 1200 from fr), 'FS série mensal');
select pg_temp.ok((select r->'inadimplentes'->0->>'empresa' = 'Loja A' and (r->'inadimplentes'->0->>'dias_atraso')::int = 10 from fr), 'FS lista de inadimplentes');
reset role;
\echo FINANCEIRO SAAS OK
