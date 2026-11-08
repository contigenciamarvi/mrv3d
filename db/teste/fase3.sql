-- Testes da Fase 3 (rodar depois de testes.sql e regressao.sql, na mesma sessão)
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table f3(k text primary key, v uuid); grant all on f3 to authenticated;
insert into f3 select 'ea', id from public.empresas where nome = 'Loja A';
insert into f3 select 'pla', id from public.materiais where codigo = 'PLA-PT';
insert into f3 select 'imp', id from public.impressoras where nome = 'Bambu P1S';
update public.impressoras set status = 'disponivel' where id = (select v from f3 where k = 'imp');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.movimentar_materia_prima((select v from f3 where k = 'pla'), 'entrada', 3, 100, null);

-- FLUXO A: orçamento aprovado → pedido → ordem
insert into public.orcamentos(empresa_id, titulo) values ((select v from f3 where k = 'ea'), 'F3 suporte');
insert into f3 select 'orc', id from public.orcamentos where titulo = 'F3 suporte';
insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, material_id, impressora_id, quantidade, peso_g, tempo_h)
values ((select v from f3 where k = 'ea'), (select v from f3 where k = 'orc'), 'Suporte', (select v from f3 where k = 'pla'), (select v from f3 where k = 'imp'), 2, 100, 5);
select public.decidir_orcamento((select v from f3 where k = 'orc'), true, null);
insert into f3 values ('ped', public.converter_orcamento_em_pedido((select v from f3 where k = 'orc')));
insert into f3 select 'op', id from public.ordens_producao where pedido_id = (select v from f3 where k = 'ped');
select pg_temp.ok((select count(*) = 1 from public.ordens_producao where pedido_id = (select v from f3 where k = 'ped')), 'F3 A: pedido nasce com 1 ordem planejada');
select pg_temp.ok((select peso_previsto_g = 200 and tempo_previsto_h = 10 and status = 'planejada' from public.ordens_producao where id = (select v from f3 where k = 'op')), 'F3 A: ordem com peso e tempo do orçamento (×2)');
select pg_temp.ok((select status_pagamento = 'aguardando' and status_producao = 'aguardando' and status_entrega = 'pendente' and impostos_estimados > 0 from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 status independentes iniciais');

-- FLUXO E: pagamentos parciais
select public.registrar_pagamento((select v from f3 where k = 'ped'), 10, current_date, 'Pix', null, 'sinal');
select pg_temp.ok((select status_pagamento = 'parcial' and valor_pago = 10 from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 E: pagamento parcial');
select pg_temp.falha($$select public.registrar_pagamento((select v from f3 where k = 'ped'), 99999, current_date, 'Pix', null, null)$$, 'F3 E: pagamento acima do saldo bloqueado', 'saldo');
select pg_temp.falha($$update public.pedidos set valor_pago = 0 where id = (select v from f3 where k = 'ped')$$, 'F3 E: valor pago não é editado à mão', 'pagamentos');
select public.registrar_pagamento((select v from f3 where k = 'ped'), (select valor_total - valor_pago from public.pedidos where id = (select v from f3 where k = 'ped')), current_date, 'Cartão', null, null);
select pg_temp.ok((select status_pagamento = 'pago' from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 E: quitado → pago');
select public.estornar_pagamento((select id from public.pagamentos where pedido_id = (select v from f3 where k = 'ped') and observacao = 'sinal'), 'cliente desistiu do pix');
select pg_temp.ok((select status_pagamento = 'parcial' from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 E: estorno volta para parcial');
select pg_temp.falha($$select public.estornar_pagamento((select id from public.pagamentos where observacao = 'sinal'), 'de novo')$$, 'F3 E: estorno duplo bloqueado', 'já foi');

-- FLUXO B: liberar reserva material
select pg_temp.ok((select public.liberar_ordem((select v from f3 where k = 'op')) = 'na_fila'), 'F3 B: ordem liberada para a fila');
select pg_temp.ok((select r.quantidade = 0.21 and r.status = 'ativa' from public.reservas_materia_prima r join public.ordens_producao o on o.reserva_id = r.id where o.id = (select v from f3 where k = 'op')), 'F3 B: reservou 200 g + 5% = 0,21 kg');
select pg_temp.falha($$update public.ordens_producao set status = 'concluida' where id = (select v from f3 where k = 'op')$$, 'F3 situação da ordem só por botões', 'botões');
select pg_temp.falha($$update public.ordens_producao set peso_previsto_g = 1 where id = (select v from f3 where k = 'op')$$, 'F3 peso não muda com material reservado', 'reservado');

-- impressão → FLUXO C
select public.iniciar_ordem((select v from f3 where k = 'op'));
select pg_temp.ok((select status = 'imprimindo' from public.impressoras where id = (select v from f3 where k = 'imp')), 'F3 impressora fica imprimindo');
select pg_temp.ok((select status_producao = 'em_producao' and status = 'em_producao' from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 pedido em produção');
create temp table s3 as select quantidade q, custo_medio cm, (select horas_acumuladas from public.impressoras where id = (select v from f3 where k = 'imp')) h from public.materiais where id = (select v from f3 where k = 'pla');
select public.finalizar_impressao((select v from f3 where k = 'op'), 9, 190, 15, 2, 'ok');
select pg_temp.ok((select consumo_registrado and status = 'acabamento' and custo_energia = 1.71 and custo_maquina = 6.30 and custos_adicionais = 2
                   and custo_material = round(0.205 * (select cm from s3), 2) and custo_real_total = custo_material + 1.71 + 6.30 + 2
                   from public.ordens_producao where id = (select v from f3 where k = 'op')), 'F3 C: custo real = material(0,205 kg) + energia 1,71 + máquina 6,30 + 2');
select pg_temp.ok((select quantidade = (select q from s3) - 0.205 and quantidade_reservada = 0 from public.materiais where id = (select v from f3 where k = 'pla')), 'F3 C: baixa real de 205 g e reserva liberada');
select pg_temp.ok((select status = 'disponivel' and horas_acumuladas = (select h from s3) + 9 from public.impressoras where id = (select v from f3 where k = 'imp')), 'F3 C: impressora livre e +9 h');
select pg_temp.falha($$select public.finalizar_impressao((select v from f3 where k = 'op'), 1, 1, 0, 0, null)$$, 'F3 C: consumo não é baixado duas vezes');
select public.avancar_ordem((select v from f3 where k = 'op'), 'concluida', 'pronto');
select pg_temp.ok((select status_producao = 'concluida' and status_entrega = 'pronto' and status = 'pronto' and custo_real > 0 from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 D: pedido pronto para expedição com custo real');
select public.atualizar_entrega((select v from f3 where k = 'ped'), 'entregue', 'Correios', 'BR123');
select pg_temp.ok((select status = 'entregue' and entregue_em is not null from public.pedidos where id = (select v from f3 where k = 'ped')), 'F3 D: entrega registrada');

-- FLUXO F: falha e reimpressão
insert into public.ordens_producao(empresa_id, descricao, material_id, impressora_id, peso_previsto_g, tempo_previsto_h)
values ((select v from f3 where k = 'ea'), 'Peça avulsa', (select v from f3 where k = 'pla'), (select v from f3 where k = 'imp'), 100, 3);
insert into f3 select 'op2', id from public.ordens_producao where descricao = 'Peça avulsa';
select public.iniciar_ordem((select v from f3 where k = 'op2'));
insert into f3 values ('op3', public.registrar_falha((select v from f3 where k = 'op2'), 2, 50, 'descolou da mesa', true));
select pg_temp.ok((select status = 'falha' and custo_real_total > 0 and perdas_g = 50 from public.ordens_producao where id = (select v from f3 where k = 'op2')), 'F3 F: falha registra o custo perdido');
select pg_temp.ok((select status = 'planejada' and reimpressao_de = (select v from f3 where k = 'op2') and prioridade = 'alta' from public.ordens_producao where id = (select v from f3 where k = 'op3')), 'F3 F: reimpressão vinculada criada');
select pg_temp.ok((select quantidade_reservada = 0 from public.materiais where id = (select v from f3 where k = 'pla')), 'F3 F: sobra da reserva voltou para o estoque');
select public.cancelar_ordem((select v from f3 where k = 'op3'), 'não precisa mais');
select pg_temp.ok((select status = 'cancelada' from public.ordens_producao where id = (select v from f3 where k = 'op3')), 'F3 cancelar ordem');
select pg_temp.ok((select count(*) >= 3 from public.producao_eventos where ordem_id = (select v from f3 where k = 'op2')), 'F3 histórico de eventos da ordem');

-- cancelamento de pedido libera reservas
insert into public.pedidos(empresa_id, descricao, valor_total, valor_pago) values ((select v from f3 where k = 'ea'), 'F3 pedido avulso', 50, 10);
insert into f3 select 'ped2', id from public.pedidos where descricao = 'F3 pedido avulso';
select pg_temp.ok((select count(*) = 1 from public.pagamentos where pedido_id = (select v from f3 where k = 'ped2')), 'F3 pago na criação vira pagamento');
insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario, material_id, peso_g) values ((select v from f3 where k = 'ea'), (select v from f3 where k = 'ped2'), 'Chaveiro', 10, 5, (select v from f3 where k = 'pla'), 10);
select pg_temp.ok((select public.gerar_ordens_pedido((select v from f3 where k = 'ped2')) = 1 and public.gerar_ordens_pedido((select v from f3 where k = 'ped2')) = 0), 'F3 gerar ordens não duplica');
select public.liberar_ordem((select id from public.ordens_producao where pedido_id = (select v from f3 where k = 'ped2')));
select public.cancelar_pedido((select v from f3 where k = 'ped2'), 'cliente desistiu');
select pg_temp.ok((select o.status = 'cancelada' and r.status = 'liberada' from public.ordens_producao o join public.reservas_materia_prima r on r.id = o.reserva_id where o.pedido_id = (select v from f3 where k = 'ped2')), 'F3 cancelar pedido cancela ordens e libera material');

-- Financeiro
select pg_temp.ok((select public.criar_lancamentos((select v from f3 where k = 'ea'), 'despesa', 'equipamentos', 'Impressora nova', 100, current_date, 3, null, false, null, null, null, null) = 3), 'F3 parcelamento em 3');
select pg_temp.ok((select array_agg(valor order by parcela) = array[33.33, 33.33, 33.34]::numeric[] from public.lancamentos where descricao like 'Impressora nova%'), 'F3 parcelas fecham o total (33,33 + 33,33 + 33,34)');
select pg_temp.ok((select public.criar_lancamentos((select v from f3 where k = 'ea'), 'despesa', 'aluguel', 'Aluguel', 800, current_date - 40, null, 12, false, null, null, null, null) = 12), 'F3 recorrência de 12 meses');
select pg_temp.ok((select (public.financeiro_resumo((select v from f3 where k = 'ea'), current_date - 29, current_date)->>'vencidas_pagar')::numeric >= 800), 'F3 conta vencida aparece');
select pg_temp.ok((select (public.financeiro_resumo((select v from f3 where k = 'ea'), current_date - 29, current_date)->>'custos_fixos')::numeric = 0), 'F3 com despesas lançadas, custo fixo da configuração não é somado de novo');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha($$select public.financeiro_resumo((select v from f3 where k = 'ea'), current_date - 29, current_date)$$, 'F3 comercial não vê o financeiro', 'financeiro');
select pg_temp.ok((select count(*) = 0 from public.lancamentos), 'F3 comercial não lê lançamentos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha($$select public.registrar_pagamento((select v from f3 where k = 'ped'), 1, current_date, null, null, null)$$, 'F3 outra empresa não registra pagamento', 'não encontrado');
select pg_temp.falha($$select public.iniciar_ordem((select v from f3 where k = 'op2'))$$, 'F3 outra empresa não mexe na produção', 'não encontrada');
reset role;
\echo FASE 3 OK
