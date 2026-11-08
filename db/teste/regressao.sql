-- Regressões dos problemas achados na revisão de segurança. Rodar DEPOIS de testes.sql.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table rids(k text primary key, v uuid); grant all on rids to authenticated;
insert into rids select 'ea', id from public.empresas where nome = 'Loja A';
insert into rids select 'eb', id from public.empresas where nome = 'Loja B';
update public.empresas set status = 'ativa' where id in (select v from rids);
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000d1', 'producao@x.com'), ('00000000-0000-0000-0000-0000000000d2', 'outro@x.com');
update public.assinaturas set plano_id = (select id from public.planos where slug = 'business') where empresa_id = (select v from rids where k = 'ea');

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.equipe_adicionar((select v from rids where k = 'ea'), 'producao@x.com', 'producao');
select public.equipe_alterar((select v from rids where k = 'ea'), '00000000-0000-0000-0000-0000000000d1', 'producao', array['usuarios_admin'], '{}', true);
insert into rids select 'pla', id from public.materiais where codigo = 'PLA-PT';
insert into rids select 'imp', id from public.impressoras where nome = 'Bambu P1S';
insert into rids select 'cliA', id from public.clientes where nome = 'Cliente da A';
-- orçamento aprovado para os testes
insert into public.orcamentos(empresa_id, titulo) values ((select v from rids where k = 'ea'), 'Reg aprovado');
insert into rids select 'oa', id from public.orcamentos where titulo = 'Reg aprovado';
insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, material_id, impressora_id, quantidade, peso_g, tempo_h)
values ((select v from rids where k = 'ea'), (select v from rids where k = 'oa'), 'Peça', (select v from rids where k = 'pla'), (select v from rids where k = 'imp'), 2, 100, 5);
select public.decidir_orcamento((select v from rids where k = 'oa'), true, null);
insert into public.orcamentos(empresa_id, titulo) values ((select v from rids where k = 'ea'), 'Reg rascunho');
insert into rids select 'or', id from public.orcamentos where titulo = 'Reg rascunho';

-- 1) totais de orçamento aprovado não mudam
select pg_temp.falha($$update public.orcamentos set total = 1, subtotal = 1 where id = (select v from rids where k = 'oa')$$, 'R1 total de aprovado não muda', 'preservados');
-- 5) item não muda de orçamento
select pg_temp.falha($$update public.orcamento_itens set orcamento_id = (select v from rids where k = 'or') where orcamento_id = (select v from rids where k = 'oa')$$, 'R5 item não sai do aprovado', 'não pode mudar');

-- 2/3) outra empresa não referencia cadastros da A
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
reset role; insert into rids select 'opA', null; update rids set v = (select gen_random_uuid()) where k = 'opA';
insert into public.crm_oportunidades(id, empresa_id, cliente_id, titulo) values ((select v from rids where k = 'opA'), (select v from rids where k = 'ea'), (select v from rids where k = 'cliA'), 'Oportunidade A');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha(format($$insert into public.orcamentos(empresa_id, titulo, oportunidade_id) values (%L, 't', %L)$$, (select v from rids where k = 'eb'), (select v from rids where k = 'opA')), 'R2 B não vincula oportunidade da A', 'oportunidade');
select pg_temp.falha(format($$insert into public.produtos(empresa_id, nome, material_id) values (%L, 'p', %L)$$, (select v from rids where k = 'eb'), (select v from rids where k = 'pla')), 'R3 B não aponta para material da A', 'não encontrado');
select pg_temp.falha(format($$insert into public.produtos(empresa_id, nome, impressora_id) values (%L, 'p', %L)$$, (select v from rids where k = 'eb'), (select v from rids where k = 'imp')), 'R3 B não aponta para impressora da A', 'não encontrado');
select pg_temp.falha(format($$insert into public.pedidos(empresa_id, cliente_id, descricao) values (%L, %L, 'x')$$, (select v from rids where k = 'eb'), (select v from rids where k = 'cliA')), 'R3 B não usa cliente da A em pedido', 'não encontrado');
select pg_temp.falha(format($$insert into public.material_bobinas(empresa_id, material_id, codigo, peso_inicial_g) values (%L, %L, '999', 1000)$$, (select v from rids where k = 'eb'), (select v from rids where k = 'pla')), 'R3 B não cria bobina no material da A', 'não encontrado');
select pg_temp.ok((select public.painel_dashboard((select v from rids where k = 'eb'), current_date - 30, current_date)::text not like '%Cliente da A%'), 'R3 dashboard da B não mostra cliente da A');

-- 4) descontos e preço abaixo da tabela
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, material_id, impressora_id, quantidade, peso_g, tempo_h)
values ((select v from rids where k = 'ea'), (select v from rids where k = 'or'), 'Item', (select v from rids where k = 'pla'), (select v from rids where k = 'imp'), 10, 100, 5);
update public.orcamentos set desconto_valor = 5 where id = (select v from rids where k = 'or');  -- ~2,6%: livre
select pg_temp.falha($$update public.orcamento_itens set quantidade = 1 where orcamento_id = (select v from rids where k = 'or')$$, 'R4 reduzir qtd não fura limite do desconto', 'desconto');
select pg_temp.falha($$update public.orcamento_itens set preco_manual = 0.01 where orcamento_id = (select v from rids where k = 'or')$$, 'R4 preço manual baixo exige aprovação', 'aprovar descontos');
select pg_temp.falha($$update public.orcamento_itens set margem_pct = 0 where orcamento_id = (select v from rids where k = 'or')$$, 'R4 margem zero exige aprovação', 'aprovar descontos');
select pg_temp.falha($$select public.decidir_orcamento((select v from rids where k = 'or'), true, null)$$, 'R4 comercial não aprova internamente', 'aprovar descontos');
select pg_temp.falha(format($$update public.clientes set margem_pct = 1 where id = %L$$, (select v from rids where k = 'cliA')), 'R4 comercial não muda margem do cliente', 'margem');
update public.orcamento_itens set margem_pct = 50 where orcamento_id = (select v from rids where k = 'or');
select pg_temp.ok(true, 'R4 margem MAIOR que o padrão é livre');

-- 6) usuarios_admin sem ser admin não cria/altera administradores
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.falha($$select public.equipe_adicionar((select v from rids where k = 'ea'), 'outro@x.com', 'admin')$$, 'R6 não cria admin', 'administrador');
select public.equipe_adicionar((select v from rids where k = 'ea'), 'outro@x.com', 'expedicao');
select pg_temp.falha($$select public.equipe_alterar((select v from rids where k = 'ea'), '00000000-0000-0000-0000-0000000000d2', 'expedicao', array['financeiro_ver'], '{}', true)$$, 'R6 não concede permissão que não tem', 'você mesmo');

-- 7) sem INSERT direto em movimentações; custo só por quem pode
select pg_temp.falha(format($$insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, custo_unitario) values (%L, %L, 'entrada', 0.001, 99999)$$, (select v from rids where k = 'ea'), (select v from rids where k = 'pla')), 'R7 sem insert direto em movimentações');
select public.movimentar_materia_prima((select v from rids where k = 'pla'), 'entrada', 0.001, 99999, null);
select pg_temp.ok((select custo_medio < 1000 from public.materiais where id = (select v from rids where k = 'pla')), 'R7 produção não altera o custo médio');
select pg_temp.ok((select created_by = '00000000-0000-0000-0000-0000000000d1' from public.movimentacoes_estoque order by created_at desc limit 1), 'R7 autor real gravado');

-- 8) consumo não come reservas alheias
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
reset role; set app.mov_interna = '1'; update public.materiais set quantidade_reservada = 0 where id = (select v from rids where k = 'pla');
update public.reservas_materia_prima set status = 'liberada' where status = 'ativa'; set app.mov_interna = '0';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.inventariar_materia_prima((select v from rids where k = 'pla'), 3, 'base');
insert into rids values ('r1', public.reservar_materia_prima((select v from rids where k = 'pla'), 1, 'OP1', null, null));
insert into rids values ('r2', public.reservar_materia_prima((select v from rids where k = 'pla'), 1.5, 'OP2', null, null));
select pg_temp.falha($$select public.consumir_reserva((select v from rids where k = 'r1'), 2)$$, 'R8 consumo não invade reserva de outra OP', 'passa do reservado');
select public.consumir_reserva((select v from rids where k = 'r1'), 1.5);
select pg_temp.ok((select quantidade = 1.5 and quantidade_reservada = 1.5 from public.materiais where id = (select v from rids where k = 'pla')), 'R8 consumo usa reserva + livre');

-- 9) estorno de ajuste desfaz só a diferença
select public.liberar_reserva((select v from rids where k = 'r2'));
select public.inventariar_materia_prima((select v from rids where k = 'pla'), 10, 'contagem');
insert into rids select 'aj', id from public.movimentacoes_estoque where material_id = (select v from rids where k = 'pla') and tipo = 'ajuste' order by created_at desc limit 1;
select public.movimentar_materia_prima((select v from rids where k = 'pla'), 'entrada', 5, null, null);
select public.estornar_movimentacao((select v from rids where k = 'aj'), 'contagem errada');
select pg_temp.ok((select quantidade = 6.5 from public.materiais where id = (select v from rids where k = 'pla')), 'R9 estorno do ajuste preserva a entrada posterior (1,5 + 5 = 6,5)');
reset role;
\echo REGRESSOES OK
