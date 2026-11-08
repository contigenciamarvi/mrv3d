-- Testes da Fase 4 (rodar depois de testes.sql, regressao.sql e fase3.sql, na mesma sessão)
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table f4(k text primary key, v uuid); grant all on f4 to authenticated, anon;
insert into f4 select 'ea', id from public.empresas where nome = 'Loja A';
insert into f4 select 'eb', id from public.empresas where nome = 'Loja B';
insert into f4 select 'pla', id from public.materiais where codigo = 'PLA-PT';
insert into f4 select 'imp', id from public.impressoras where nome = 'Bambu P1S';
update public.planos set limite_usuarios = null;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000e1', 'estoque@x.com'), ('00000000-0000-0000-0000-0000000000f1', 'financeiro@x.com');
insert into public.membros(empresa_id, user_id, papel) values ((select v from f4 where k = 'ea'), '00000000-0000-0000-0000-0000000000e1', 'estoque'),
  ((select v from f4 where k = 'ea'), '00000000-0000-0000-0000-0000000000f1', 'financeiro');
update public.impressoras set status = 'disponivel' where id = (select v from f4 where k = 'imp');

-- ===================== COMPRAS =====================
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
insert into public.fornecedores(empresa_id, nome, prazo_medio_dias) values ((select v from f4 where k = 'ea'), 'Filamentos SP', 10);
insert into f4 select 'forn', id from public.fornecedores where nome = 'Filamentos SP';
insert into public.pedidos_compra(empresa_id, fornecedor_id, frete, desconto, parcelas, status, aprovado_por)
values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'forn'), 20, 10, 2, 'recebido', '00000000-0000-0000-0000-00000000000a');
insert into f4 select 'pc', id from public.pedidos_compra order by created_at desc limit 1;
select pg_temp.ok((select status = 'rascunho' and aprovado_por is null from public.pedidos_compra where id = (select v from f4 where k = 'pc')), 'F4 compra nova nasce rascunho (situação forjada ignorada)');
insert into public.pedido_compra_itens(empresa_id, pedido_compra_id, material_id, descricao, unidade, quantidade, preco_unitario, quantidade_recebida)
values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'pc'), (select v from f4 where k = 'pla'), 'PLA preto', 'g', 2, 100, 2),
       ((select v from f4 where k = 'ea'), (select v from f4 where k = 'pc'), null, 'Bico 0.4', 'un', 1, 30, 0);
select pg_temp.ok((select unidade = 'kg' and quantidade_recebida = 0 from public.pedido_compra_itens where descricao = 'PLA preto'), 'F4 item usa a unidade do estoque e não nasce recebido');
select pg_temp.ok((select subtotal = 230 and total = 240 from public.pedidos_compra where id = (select v from f4 where k = 'pc')), 'F4 total = itens 230 + frete 20 - desconto 10');
select public.compra_mudar_status((select v from f4 where k = 'pc'), 'solicitado', null);
select pg_temp.falha($$select public.compra_mudar_status((select v from f4 where k = 'pc'), 'aprovado', null)$$, 'F4 estoque não aprova a própria compra', 'administração');
select pg_temp.falha($$update public.pedidos_compra set status = 'aprovado' where id = (select v from f4 where k = 'pc')$$, 'F4 situação não muda por update', 'botões');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select public.compra_mudar_status((select v from f4 where k = 'pc'), 'aprovado', null);
select pg_temp.ok((select status = 'aprovado' and aprovado_por = '00000000-0000-0000-0000-0000000000f1' from public.pedidos_compra where id = (select v from f4 where k = 'pc')), 'F4 financeiro aprova');
select pg_temp.falha($$update public.pedido_compra_itens set preco_unitario = 1 where descricao = 'PLA preto'$$, 'F4 itens travados depois de aprovar', 'rascunho');
select pg_temp.falha($$update public.pedidos_compra set frete = 0 where id = (select v from f4 where k = 'pc')$$, 'F4 frete travado depois de aprovar', 'aprovação');
select pg_temp.falha($$select public.receber_compra((select v from f4 where k = 'pc'), '[]', null, null, null, null)$$, 'F4 não recebe antes de enviar ao fornecedor', 'enviadas');
select public.compra_mudar_status((select v from f4 where k = 'pc'), 'enviado', null);
select pg_temp.ok((select count(*) = 2 and sum(valor) = 240 and bool_and(categoria = 'filamentos' and not pago) from public.lancamentos where compra_id = (select v from f4 where k = 'pc')), 'F4 compra enviada gera 2 parcelas a pagar = 240');
select pg_temp.ok((select min(vencimento) = current_date + 10 from public.lancamentos where compra_id = (select v from f4 where k = 'pc')), 'F4 1º vencimento pelo prazo do fornecedor');
select pg_temp.falha(format($$insert into public.lancamentos(empresa_id, tipo, categoria, descricao, valor, vencimento, compra_id) values (%L, 'despesa', 'outros', 'x', 1, current_date, %L)$$,
  (select v from f4 where k = 'ea'), (select v from f4 where k = 'pc')), 'F4 lançamento manual não se liga a compra', 'módulos');
reset role;
create temp table s4 as select quantidade q, custo_medio cm from public.materiais where id = (select v from f4 where k = 'pla');
grant all on s4 to authenticated;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.ok((select public.receber_compra((select v from f4 where k = 'pc'),
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.pedido_compra_itens where descricao = 'PLA preto'), 'quantidade', 1)), current_date, '123', null, null) = 'parcial'), 'F4 recebimento parcial');
select pg_temp.ok((select quantidade = (select q from s4) + 1
   and custo_medio = round(((select q from s4) * (select cm from s4) + 1 * round(100 * 240.0 / 230, 4)) / ((select q from s4) + 1), 4)
   from public.materiais where id = (select v from f4 where k = 'pla')), 'F4 entrada com custo rateando frete e desconto (custo médio)');
select pg_temp.falha(format($$select public.receber_compra(%L, jsonb_build_array(jsonb_build_object('item_id', %L, 'quantidade', 5)), null, null, null, null)$$,
  (select v from f4 where k = 'pc'), (select id from public.pedido_compra_itens where descricao = 'PLA preto')), 'F4 não recebe mais que o pedido', 'pendente');
select pg_temp.falha($$update public.pedido_compra_itens set quantidade_recebida = 99 where descricao = 'Bico 0.4'$$, 'F4 recebido não é forjado');
select pg_temp.ok((select public.receber_compra((select v from f4 where k = 'pc'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', quantidade - quantidade_recebida)) from public.pedido_compra_itens where pedido_compra_id = (select v from f4 where k = 'pc')),
  current_date, '124', null, 'caixa amassada') = 'recebido'), 'F4 recebimento completo');
select pg_temp.ok((select count(*) = 2 from public.compra_recebimentos where pedido_compra_id = (select v from f4 where k = 'pc')), 'F4 dois recebimentos registrados');
select pg_temp.falha($$select public.compra_mudar_status((select v from f4 where k = 'pc'), 'cancelado', 'desisti')$$, 'F4 compra recebida não é cancelada', 'recebidos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$select public.estornar_movimentacao((select id from public.movimentacoes_estoque where compra_id is not null limit 1), 'errei')$$, 'F4 entrada de compra não é estornada pelo estoque', 'compra');
-- cancelamento de compra enviada cancela as contas
insert into public.pedidos_compra(empresa_id, fornecedor_id) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'forn'));
insert into f4 select 'pc2', id from public.pedidos_compra order by numero desc limit 1;
insert into public.pedido_compra_itens(empresa_id, pedido_compra_id, descricao, quantidade, preco_unitario) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'pc2'), 'Correia', 2, 25);
select public.compra_mudar_status((select v from f4 where k = 'pc2'), 'aprovado', null);
select public.compra_mudar_status((select v from f4 where k = 'pc2'), 'enviado', null);
select pg_temp.falha($$select public.compra_mudar_status((select v from f4 where k = 'pc2'), 'cancelado', null)$$, 'F4 cancelar pede motivo', 'motivo');
select public.compra_mudar_status((select v from f4 where k = 'pc2'), 'cancelado', 'fornecedor sem estoque');
select pg_temp.ok((select bool_and(cancelado) from public.lancamentos where compra_id = (select v from f4 where k = 'pc2')), 'F4 compra cancelada cancela as contas a pagar');
select pg_temp.ok((select count(*) > 0 from jsonb_array_elements(public.relatorio((select v from f4 where k = 'ea'), 'compras_fornecedor', current_date - 30, current_date)->'linhas')), 'F4 relatório de compras por fornecedor');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.fornecedores) and (select count(*) = 0 from public.pedidos_compra), 'F4 Loja B não vê compras da A');
select pg_temp.falha(format($$insert into public.pedido_compra_itens(empresa_id, pedido_compra_id, descricao, quantidade) values (%L, %L, 'x', 1)$$,
  (select v from f4 where k = 'eb'), (select v from f4 where k = 'pc2')), 'F4 B não põe item em compra da A');
select pg_temp.falha($$select public.compra_mudar_status((select v from f4 where k = 'pc2'), 'rascunho', null)$$, 'F4 B não mexe na compra da A', 'não encontrada');

-- ===================== MANUTENÇÃO =====================
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.manutencao_planos(empresa_id, impressora_id, servico, intervalo_horas) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'imp'), 'lubrificacao', 10);
insert into f4 select 'plano', id from public.manutencao_planos limit 1;
select pg_temp.ok((select ultima_horas = (select horas_acumuladas from public.impressoras where id = (select v from f4 where k = 'imp')) from public.manutencao_planos where id = (select v from f4 where k = 'plano')), 'F4 plano conta a partir das horas atuais');
select pg_temp.ok((select jsonb_array_length(public.manutencao_alertas((select v from f4 where k = 'ea'))) = 0), 'F4 sem aviso logo após criar o plano');
reset role; update public.impressoras set horas_acumuladas = horas_acumuladas + 12 where id = (select v from f4 where k = 'imp');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select public.manutencao_alertas((select v from f4 where k = 'ea'))->0->>'nivel' = 'vencida'), 'F4 aviso de manutenção vencida por horas');
select pg_temp.ok((select count(*) > 0 from jsonb_array_elements(public.minhas_notificacoes((select v from f4 where k = 'ea'))) x where x->>'id' like 'manut-%'), 'F4 notificação de manutenção');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha(format($$insert into public.manutencoes(empresa_id, impressora_id, descricao) values (%L, %L, 'x')$$, (select v from f4 where k = 'ea'), (select v from f4 where k = 'imp')), 'F4 comercial não registra manutenção');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into public.manutencoes(empresa_id, impressora_id, plano_id, descricao, status, custo_mao_obra) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'imp'), (select v from f4 where k = 'plano'), 'Lubrificar eixos', 'concluida', 40);
insert into f4 select 'man', id from public.manutencoes where descricao = 'Lubrificar eixos';
select pg_temp.ok((select status = 'agendada' from public.manutencoes where id = (select v from f4 where k = 'man')), 'F4 manutenção nasce agendada');
select public.iniciar_manutencao((select v from f4 where k = 'man'));
select pg_temp.ok((select status = 'manutencao' from public.impressoras where id = (select v from f4 where k = 'imp')), 'F4 impressora fica em manutenção');
select pg_temp.falha($$update public.manutencoes set status = 'concluida' where id = (select v from f4 where k = 'man')$$, 'F4 situação da manutenção só por botões', 'botões');
select pg_temp.falha($$select public.concluir_manutencao((select v from f4 where k = 'man'), 0, 40, 1, null, null, 'ok', true)$$, 'F4 produção não lança no financeiro', 'financeiro');
select public.concluir_manutencao((select v from f4 where k = 'man'), 0, 40, 1.5, null, null, 'ok', false);
select pg_temp.ok((select status = 'concluida' and tempo_parado_h = 1.5 and custo_total = 40 and lancamento_id is null from public.manutencoes where id = (select v from f4 where k = 'man')), 'F4 manutenção concluída com custo');
select pg_temp.ok((select status = 'disponivel' from public.impressoras where id = (select v from f4 where k = 'imp')), 'F4 impressora volta a ficar disponível');
select pg_temp.ok((select ultima_horas = (select horas_acumuladas from public.impressoras where id = (select v from f4 where k = 'imp')) from public.manutencao_planos where id = (select v from f4 where k = 'plano'))
  and jsonb_array_length(public.manutencao_alertas((select v from f4 where k = 'ea'))) = 0, 'F4 plano reinicia a contagem');
-- dono: peça do estoque + mão de obra; só a mão de obra vai para o financeiro
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
reset role; create temp table s5 as select quantidade q from public.materiais where id = (select v from f4 where k = 'pla'); grant all on s5 to authenticated;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.manutencoes(empresa_id, impressora_id, tipo, servico, descricao) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'imp'), 'corretiva', 'troca_bico', 'Troca de bico entupido');
insert into f4 select 'man2', id from public.manutencoes where descricao = 'Troca de bico entupido';
select public.concluir_manutencao((select v from f4 where k = 'man2'), null, 25, null, (select v from f4 where k = 'pla'), 0.1, null, true);
select pg_temp.ok((select l.valor = 25 and l.categoria = 'manutencao' and m.custo_pecas > 0 from public.manutencoes m join public.lancamentos l on l.id = m.lancamento_id where m.id = (select v from f4 where k = 'man2')), 'F4 peça do estoque não vira despesa de novo (só mão de obra)');
select pg_temp.ok((select quantidade = (select q from s5) - 0.1 from public.materiais where id = (select v from f4 where k = 'pla')), 'F4 peça baixada do estoque');
reset role; update public.impressoras set status = 'imprimindo' where id = (select v from f4 where k = 'imp');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.manutencoes(empresa_id, impressora_id, descricao) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'imp'), 'Calibrar');
select pg_temp.falha($$select public.iniciar_manutencao((select id from public.manutencoes where descricao = 'Calibrar'))$$, 'F4 não inicia manutenção com impressão em andamento', 'impressão');
reset role; update public.impressoras set status = 'disponivel' where id = (select v from f4 where k = 'imp');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
delete from public.lancamentos where manutencao_id = (select v from f4 where k = 'man2');
reset role;
select pg_temp.ok((select lancamento_id is null from public.manutencoes where id = (select v from f4 where k = 'man2')), 'F4 financeiro pode excluir o lançamento da manutenção');
set role authenticated;

-- ===================== EXPEDIÇÃO =====================
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.clientes(empresa_id, nome, endereco, cidade, uf, cep) values ((select v from f4 where k = 'ea'), 'Cliente Envio', 'Rua 1, 10', 'Campinas', 'SP', '13000-000');
insert into public.pedidos(empresa_id, descricao, valor_total, cliente_id) values ((select v from f4 where k = 'ea'), 'F4 envio', 100, (select id from public.clientes where nome = 'Cliente Envio'));
insert into f4 select 'pe', id from public.pedidos where descricao = 'F4 envio';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.falha($$select public.criar_envio((select v from f4 where k = 'pe'), 'correios')$$, 'F4 não expede antes de produzir', 'produção');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.pedidos set status_producao = 'nao_aplica' where id = (select v from f4 where k = 'pe');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
insert into f4 values ('env', public.criar_envio((select v from f4 where k = 'pe'), 'correios'));
select pg_temp.ok((select destinatario = 'Cliente Envio' and cidade = 'Campinas' and status = 'separacao' from public.envios where id = (select v from f4 where k = 'env')), 'F4 envio criado com endereço do cliente');
select pg_temp.ok((select status_entrega = 'pronto' from public.pedidos where id = (select v from f4 where k = 'pe')), 'F4 pedido fica pronto para expedição');
select pg_temp.falha($$select public.criar_envio((select v from f4 where k = 'pe'), 'correios')$$, 'F4 não duplica envio', 'já está');
select pg_temp.falha($$select public.atualizar_entrega((select v from f4 where k = 'pe'), 'entregue', null, null)$$, 'F4 entrega pelo pedido bloqueada com envio ativo', 'Expedição');
select pg_temp.falha($$update public.envios set status = 'entregue' where id = (select v from f4 where k = 'env')$$, 'F4 situação do envio só por botões', 'botões');
update public.envios set peso_g = 350, altura_cm = 10, largura_cm = 15, comprimento_cm = 20, frete_custo = 18 where id = (select v from f4 where k = 'env');
select public.conferir_envio((select v from f4 where k = 'env'));
select public.mudar_status_envio((select v from f4 where k = 'env'), 'embalado', null, null);
select pg_temp.falha($$select public.mudar_status_envio((select v from f4 where k = 'env'), 'enviado', null, null)$$, 'F4 Correios exige rastreio', 'rastreio');
update public.envios set codigo_rastreio = 'BR999' where id = (select v from f4 where k = 'env');
select public.mudar_status_envio((select v from f4 where k = 'env'), 'enviado', null, null);
select pg_temp.ok((select status_entrega = 'enviado' and codigo_rastreio = 'BR999' from public.pedidos where id = (select v from f4 where k = 'pe')), 'F4 pedido acompanha o envio (enviado + rastreio)');
select pg_temp.ok((select data_postagem = current_date and conferido_em is not null and lancamento_id is not null from public.envios where id = (select v from f4 where k = 'env')), 'F4 postagem registrada e frete vira conta a pagar');
select pg_temp.falha($$select public.mudar_status_envio((select v from f4 where k = 'env'), 'embalado', null, null)$$, 'F4 envio que saiu não volta', 'saiu');
select public.mudar_status_envio((select v from f4 where k = 'env'), 'entregue', null, null);
select pg_temp.ok((select status = 'entregue' and status_entrega = 'entregue' and entregue_em is not null from public.pedidos where id = (select v from f4 where k = 'pe')), 'F4 entregue');
select pg_temp.ok((select count(*) >= 4 from public.envio_eventos where envio_id = (select v from f4 where k = 'env')), 'F4 histórico do envio');
-- retirada no local, pelo dono (frete lança no financeiro)
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.pedidos(empresa_id, descricao, valor_total) values ((select v from f4 where k = 'ea'), 'F4 retirada', 50);
update public.pedidos set status_producao = 'nao_aplica' where descricao = 'F4 retirada';
insert into f4 values ('env2', public.criar_envio((select id from public.pedidos where descricao = 'F4 retirada'), 'retirada'));
select pg_temp.falha($$select public.mudar_status_envio((select v from f4 where k = 'env2'), 'retirado', null, 'Ana')$$, 'F4 retirada exige embalar antes', 'embale');
select public.mudar_status_envio((select v from f4 where k = 'env2'), 'embalado', null, null);
select pg_temp.falha($$select public.mudar_status_envio((select v from f4 where k = 'env2'), 'retirado', null, null)$$, 'F4 retirada exige nome de quem retirou', 'retirou');
select public.mudar_status_envio((select v from f4 where k = 'env2'), 'retirado', null, 'Ana Souza');
select pg_temp.ok((select p.status_entrega = 'retirado' and e.recebido_por = 'Ana Souza' from public.pedidos p join public.envios e on e.pedido_id = p.id where e.id = (select v from f4 where k = 'env2')), 'F4 retirada registrada');
insert into public.pedidos(empresa_id, descricao, valor_total) values ((select v from f4 where k = 'ea'), 'F4 frete', 80);
update public.pedidos set status_producao = 'nao_aplica' where descricao = 'F4 frete';
insert into f4 values ('env3', public.criar_envio((select id from public.pedidos where descricao = 'F4 frete'), 'entrega_propria'));
update public.envios set frete_custo = 12 where id = (select v from f4 where k = 'env3');
select pg_temp.falha($$select public.mudar_status_envio((select v from f4 where k = 'env3'), 'entregue', null, null)$$, 'F4 entrega própria pede quem recebeu', 'recebeu');
select public.mudar_status_envio((select v from f4 where k = 'env3'), 'entregue', null, 'Porteiro');
select pg_temp.ok((select l.valor = 12 and l.categoria = 'fretes' from public.envios e join public.lancamentos l on l.id = e.lancamento_id where e.id = (select v from f4 where k = 'env3')), 'F4 frete vira conta a pagar (dono)');
-- pedido cancelado leva o envio que não saiu
insert into public.pedidos(empresa_id, descricao, valor_total) values ((select v from f4 where k = 'ea'), 'F4 cancela', 10);
update public.pedidos set status_producao = 'nao_aplica' where descricao = 'F4 cancela';
insert into f4 values ('env4', public.criar_envio((select id from public.pedidos where descricao = 'F4 cancela'), 'correios'));
select public.cancelar_pedido((select id from public.pedidos where descricao = 'F4 cancela'), 'cliente desistiu');
select pg_temp.ok((select status = 'cancelado' from public.envios where id = (select v from f4 where k = 'env4')), 'F4 cancelar pedido cancela o envio');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.envios), 'F4 B não vê envios da A');
select pg_temp.falha($$select public.criar_envio((select v from f4 where k = 'pe'), 'correios')$$, 'F4 B não cria envio na A', 'não encontrado');

-- ===================== PORTAL =====================
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha(format($$insert into public.portal_config(empresa_id, slug, ativo) values (%L, 'admin', true)$$, (select v from f4 where k = 'ea')), 'F4 endereço reservado bloqueado', 'reservado');
insert into public.portal_config(empresa_id, slug, ativo, materiais_ids, cores) values ((select v from f4 where k = 'ea'), 'Loja-A', true, array[(select v from f4 where k = 'pla')], 'Preto, Branco');
select pg_temp.ok((select slug = 'loja-a' from public.portal_config where empresa_id = (select v from f4 where k = 'ea')), 'F4 endereço do portal normalizado');
insert into public.produtos(empresa_id, nome, preco_venda, no_portal, foto_path) values ((select v from f4 where k = 'ea'), 'Vaso Portal', 45, true, (select v from f4 where k = 'ea') || '/produtos/vaso.png');
insert into public.produtos(empresa_id, nome, preco_venda, no_portal) values ((select v from f4 where k = 'ea'), 'Interno', 99, false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha(format($$insert into public.portal_config(empresa_id, slug) values (%L, 'loja-a')$$, (select v from f4 where k = 'eb')), 'F4 endereço já usado por outra loja', 'em uso');
select pg_temp.falha(format($$insert into public.portal_config(empresa_id, slug, materiais_ids) values (%L, 'loja-b', array[%L]::uuid[])$$, (select v from f4 where k = 'eb'), (select v from f4 where k = 'pla')), 'F4 B não expõe material da A', 'não encontrado');
reset role;
insert into storage.objects(bucket_id, name, metadata) values ('empresa', (select v from f4 where k = 'ea') || '/produtos/vaso.png', '{"size": 1000}'), ('empresa', (select v from f4 where k = 'ea') || '/produtos/segredo.png', '{"size": 1000}');
insert into f4 select 'interno', id from public.produtos where nome = 'Interno';
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select (public.portal_publico('loja-a')->'produtos'->0->>'nome') = 'Vaso Portal' and jsonb_array_length(public.portal_publico('loja-a')->'produtos') = 1
  and jsonb_array_length(public.portal_publico('loja-a')->'materiais') = 1), 'F4 portal mostra só produtos marcados');
select pg_temp.ok((select (public.portal_publico('loja-a')->'produtos'->0) ? 'foto_path' and not (public.portal_publico('loja-a')->'produtos'->0 ? 'custo_padrao')), 'F4 portal não expõe custo');
select pg_temp.ok((select count(*) = 1 from storage.objects where name like '%/produtos/%'), 'F4 visitante vê só a foto do produto do portal');
select pg_temp.falha($$select public.portal_publico('nao-existe')$$, 'F4 loja inexistente', 'não encontrada');
insert into f4 values ('pasta', gen_random_uuid());
insert into storage.objects(bucket_id, name, metadata) values ('empresa', (select v from f4 where k = 'ea') || '/portal/' || (select v from f4 where k = 'pasta') || '/peca.stl', '{"size": 5000}');
select pg_temp.falha(format($$insert into storage.objects(bucket_id, name) values ('empresa', %L)$$, (select v from f4 where k = 'ea') || '/produtos/hack.stl'), 'F4 visitante não grava fora da pasta do portal');
select pg_temp.falha(format($$insert into storage.objects(bucket_id, name) values ('empresa', %L)$$, (select v from f4 where k = 'ea') || '/portal/' || gen_random_uuid() || '/virus.exe'), 'F4 visitante só envia modelo 3D');
select pg_temp.falha(format($$insert into storage.objects(bucket_id, name) values ('empresa', %L)$$, (select v from f4 where k = 'ea') || '/portal/x/y/z.stl'), 'F4 caminho do portal validado');
select pg_temp.falha(format($$insert into storage.objects(bucket_id, name) values ('empresa', %L)$$, (select v from f4 where k = 'eb') || '/portal/' || gen_random_uuid() || '/a.stl'), 'F4 loja sem portal não recebe arquivos');
select pg_temp.ok((select count(*) = 0 from storage.objects where name like '%/portal/%'), 'F4 visitante não lê arquivos enviados');
create temp table tk(t text); grant all on tk to anon, authenticated;
insert into tk select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Carlos', 'email', 'Carlos@x.com', 'quantidade', 3, 'cor', 'Preto',
  'material_id', (select v from f4 where k = 'pla'), 'arquivos', jsonb_build_array((select v from f4 where k = 'ea') || '/portal/' || (select v from f4 where k = 'pasta') || '/peca.stl'),
  'observacoes', 'Peça de reposição'));
select pg_temp.ok((select length(t) = 64 from tk), 'F4 solicitação pelo portal devolve link secreto');
select pg_temp.falha(format($$select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Outro', 'email', 'o@x.com', 'arquivos', jsonb_build_array(%L)))$$,
  (select v from f4 where k = 'ea') || '/portal/' || (select v from f4 where k = 'pasta') || '/peca.stl'), 'F4 arquivo não é reaproveitado', 'já usado');
select pg_temp.falha(format($$select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Outro', 'email', 'o@x.com', 'arquivos', jsonb_build_array(%L)))$$,
  (select v from f4 where k = 'ea') || '/portal/' || gen_random_uuid() || '/fantasma.stl'), 'F4 arquivo inexistente', 'envie de novo');
select pg_temp.falha(format($$select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Outro', 'email', 'o@x.com', 'produto_id', %L))$$,
  (select v from f4 where k = 'interno')), 'F4 produto fora do portal', 'não encontrado');
select pg_temp.falha($$select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Outro', 'observacoes', 'quero uma peça grande'))$$, 'F4 exige contato', 'e-mail ou telefone');
select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Spam', 'email', 'spam@x.com', 'observacoes', 'mensagem número um ok')) from generate_series(1, 3);
select pg_temp.falha($$select public.portal_solicitar('loja-a', jsonb_build_object('nome', 'Spam', 'email', 'spam@x.com', 'observacoes', 'mensagem número quatro'))$$, 'F4 limite por contato', 'várias');
select pg_temp.falha($$select count(*) from public.portal_solicitacoes$$, 'F4 visitante não lista solicitações');
select pg_temp.ok((select (public.portal_acompanhar(t)->'solicitacao'->>'status') = 'nova' and public.portal_acompanhar(t)->'orcamento' = 'null'::jsonb from tk), 'F4 comprador acompanha a própria solicitação');
select pg_temp.falha($$select public.portal_acompanhar('abc')$$, 'F4 link curto recusado', 'inválido');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.portal_solicitacoes), 'F4 B não vê solicitações da A');
select pg_temp.falha($$select public.portal_gerar_orcamento((select id from public.portal_solicitacoes where nome = 'Carlos'))$$, 'F4 B não orça solicitação da A');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) > 0 from jsonb_array_elements(public.minhas_notificacoes((select v from f4 where k = 'ea'))) x where x->>'id' like 'portal-%'), 'F4 notificação de nova solicitação');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into f4 values ('orcp', public.portal_gerar_orcamento((select id from public.portal_solicitacoes where nome = 'Carlos')));
select pg_temp.ok((select o.status = 'rascunho' and c.email = 'carlos@x.com' and i.quantidade = 3 and i.arquivo_path like '%/peca.stl' and i.material_id = (select v from f4 where k = 'pla')
  from public.orcamentos o join public.clientes c on c.id = o.cliente_id join public.orcamento_itens i on i.orcamento_id = o.id where o.id = (select v from f4 where k = 'orcp')), 'F4 solicitação vira orçamento com cliente, arquivo e material');
select pg_temp.ok((select public.portal_gerar_orcamento((select id from public.portal_solicitacoes where nome = 'Carlos')) = (select v from f4 where k = 'orcp')), 'F4 não duplica orçamento');
select public.enviar_orcamento((select v from f4 where k = 'orcp'));
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select (public.portal_acompanhar(t)->'orcamento'->>'token') is not null from tk), 'F4 comprador vê a proposta enviada e o link de aprovação');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.portal_config set ativo = false where empresa_id = (select v from f4 where k = 'ea');
set role anon; reset request.jwt.claim.sub;
select pg_temp.falha($$select public.portal_publico('loja-a')$$, 'F4 portal desativado sai do ar', 'não encontrada');
select pg_temp.ok((select count(*) = 0 from storage.objects where name like '%/produtos/%'), 'F4 fotos deixam de ser públicas com o portal desligado');

-- ===================== RELATÓRIOS =====================
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select bool_and(jsonb_typeof(public.relatorio((select v from f4 where k = 'ea'), t, current_date - 365, current_date)->'linhas') = 'array')
  from unnest(array['faturamento','lucro_pedido','lucro_produto','lucro_impressora','rentabilidade_cliente','materiais_consumidos','desperdicio','maquinas','falhas',
                    'pedidos_atrasados','orcamentos','estoque_valorizado','fluxo_caixa','producao_operador','compras_fornecedor','manutencao']) t), 'F4 todos os relatórios respondem');
select pg_temp.ok((select jsonb_array_length(public.relatorio((select v from f4 where k = 'ea'), 'lucro_pedido', current_date - 30, current_date)->'linhas') > 0
  and jsonb_array_length(public.relatorio((select v from f4 where k = 'ea'), 'maquinas', current_date - 30, current_date)->'linhas') > 0
  and jsonb_array_length(public.relatorio((select v from f4 where k = 'ea'), 'estoque_valorizado', current_date, current_date)->'linhas') > 0
  and jsonb_array_length(public.relatorio((select v from f4 where k = 'ea'), 'manutencao', current_date - 30, current_date)->'linhas') > 0), 'F4 relatórios trazem dados');
select pg_temp.falha($$select public.relatorio((select v from f4 where k = 'ea'), 'faturamento', current_date, current_date - 10)$$, 'F4 período invertido', 'período');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha($$select public.relatorio((select v from f4 where k = 'ea'), 'lucro_pedido', current_date - 30, current_date)$$, 'F4 comercial sem acesso a relatórios de lucro', 'relatórios');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha($$select public.relatorio((select v from f4 where k = 'ea'), 'faturamento', current_date - 30, current_date)$$, 'F4 B não vê relatórios da A', 'relatórios');


\echo FASE 4 OK
-- ===================== REVISÃO DE SEGURANÇA =====================
reset role;
insert into f4 select 'cliCarlos', cliente_id from public.portal_solicitacoes where nome = 'Carlos';
insert into storage.objects(bucket_id, name, metadata) values ('empresa', (select v from f4 where k = 'ea') || '/financeiro/extrato.pdf', '{"size": 10}');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.portal_config(empresa_id, slug, ativo) values ((select v from f4 where k = 'eb'), 'loja-b', true);
select pg_temp.falha(format($$insert into public.produtos(empresa_id, nome, no_portal, foto_path) values (%L, 'isca', true, %L)$$, (select v from f4 where k = 'eb'), (select v from f4 where k = 'ea') || '/financeiro/extrato.pdf'), 'F4R1 produto não aponta para arquivo de outra loja', 'produto_foto_propria');
select pg_temp.falha(format($$update public.empresa_config set logo_path = %L where empresa_id = %L$$, (select v from f4 where k = 'ea') || '/financeiro/extrato.pdf', (select v from f4 where k = 'eb')), 'F4R1 logo não aponta para arquivo de outra loja', 'config_logo_propria');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha(format($$insert into public.produtos(empresa_id, nome, no_portal, foto_path) values (%L, 'vazamento', true, %L)$$, (select v from f4 where k = 'ea'), (select v from f4 where k = 'ea') || '/financeiro/extrato.pdf'), 'F4R1 foto só da pasta produtos', 'produto_foto_propria');
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select count(*) = 0 from storage.objects where name like '%/financeiro/%'), 'F4R1 visitante não lê arquivos financeiros');
-- R2: cliente só é vinculado por escolha da equipe
select public.portal_solicitar('loja-b', jsonb_build_object('nome', 'Impostor', 'email', 'carlos@x.com', 'observacoes', 'quero passar por outro cliente'));
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha(format($$select public.portal_gerar_orcamento((select id from public.portal_solicitacoes where nome = 'Impostor'), %L)$$, (select v from f4 where k = 'cliCarlos')), 'F4R2 não vincula a cliente de outra loja');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
-- R4: solicitada fica congelada
insert into public.pedidos_compra(empresa_id, fornecedor_id) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'forn'));
insert into f4 select 'pc3', id from public.pedidos_compra order by numero desc limit 1;
insert into public.pedido_compra_itens(empresa_id, pedido_compra_id, material_id, descricao, quantidade, preco_unitario) values ((select v from f4 where k = 'ea'), (select v from f4 where k = 'pc3'), (select v from f4 where k = 'pla'), 'PLA R5', 4, 50);
select public.compra_mudar_status((select v from f4 where k = 'pc3'), 'solicitado', null);
select pg_temp.falha($$update public.pedido_compra_itens set preco_unitario = 999 where descricao = 'PLA R5'$$, 'F4R4 itens congelados ao pedir aprovação', 'rascunho');
select pg_temp.falha($$update public.pedidos_compra set frete = 99 where id = (select v from f4 where k = 'pc3')$$, 'F4R4 valores congelados ao pedir aprovação', 'aprovação');
-- R5: encerrar parcial reduz as parcelas em aberto
select public.compra_mudar_status((select v from f4 where k = 'pc3'), 'aprovado', null);
select public.compra_mudar_status((select v from f4 where k = 'pc3'), 'enviado', null);
select public.receber_compra((select v from f4 where k = 'pc3'), jsonb_build_array(jsonb_build_object('item_id', (select id from public.pedido_compra_itens where descricao = 'PLA R5'), 'quantidade', 1)), null, null, null, null);
select public.encerrar_compra((select v from f4 where k = 'pc3'), 'fornecedor sem estoque');
select pg_temp.ok((select sum(valor) = 50 from public.lancamentos where compra_id = (select v from f4 where k = 'pc3') and not cancelado), 'F4R5 encerrar parcial deixa a pagar só o recebido');
-- R8c: plano de outra impressora
insert into public.impressoras(empresa_id, nome) values ((select v from f4 where k = 'ea'), 'Ender R8');
select pg_temp.falha(format($$insert into public.manutencoes(empresa_id, impressora_id, plano_id, descricao) values (%L, (select id from public.impressoras where nome = 'Ender R8'), %L, 'x')$$,
  (select v from f4 where k = 'ea'), (select v from f4 where k = 'plano')), 'F4R8 plano de outra impressora', 'outra impressora');
-- R8a: frete alterado acompanha a conta
insert into public.pedidos(empresa_id, descricao, valor_total) values ((select v from f4 where k = 'ea'), 'F4 R8 frete', 70);
update public.pedidos set status_producao = 'nao_aplica' where descricao = 'F4 R8 frete';
insert into f4 values ('env5', public.criar_envio((select id from public.pedidos where descricao = 'F4 R8 frete'), 'correios'));
update public.envios set frete_custo = 15, codigo_rastreio = 'BR5' where id = (select v from f4 where k = 'env5');
select public.mudar_status_envio((select v from f4 where k = 'env5'), 'enviado', null, null);
update public.envios set frete_custo = 20 where id = (select v from f4 where k = 'env5');
select pg_temp.falha($$update public.envios set frete_custo = 1 where id = (select v from f4 where k = 'env3')$$, 'F4R8 envio encerrado não muda frete', 'encerrado');
reset role;
select pg_temp.ok((select l.valor = 20 from public.envios e join public.lancamentos l on l.id = e.lancamento_id where e.id = (select v from f4 where k = 'env5')), 'F4R8 frete alterado atualiza a conta a pagar');
\echo REVISAO FASE 4 OK
