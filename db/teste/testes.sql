-- Testes de regras de negócio e isolamento. Rodar: psql -f testes.sql (após reset.sh)
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, nome text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', nome; end if; raise notice 'ok - %', nome; end $$;
create or replace function pg_temp.falha(sql text, nome text, trecho text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if trecho is not null and position(lower(trecho) in lower(sqlerrm)) = 0 then raise exception 'FALHOU (erro inesperado) %: %', nome, sqlerrm; end if;
    raise notice 'ok - % (bloqueado: %)', nome, left(sqlerrm, 90); return; end;
  raise exception 'FALHOU: % deveria ter sido bloqueado', nome;
end $$;
set client_min_messages = notice;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'dono.a@x.com'),
 ('00000000-0000-0000-0000-00000000000b', 'dono.b@x.com'),
 ('00000000-0000-0000-0000-00000000000c', 'comercial@x.com');
create temp table ids(k text primary key, v uuid);
grant all on ids to authenticated;

-- ===== Empresas
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into ids values ('ea', public.criar_empresa('Loja A', '11999990000'));
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into ids values ('eb', public.criar_empresa('Loja B', null));
reset role;
select pg_temp.ok((select count(*) = 2 from public.empresa_config), 'config criada para cada empresa');
-- plano Pro para A (3 usuários, 5 impressoras)
update public.assinaturas set plano_id = (select id from public.planos where slug = 'pro') where empresa_id = (select v from ids where k = 'ea');

-- ===== Isolamento
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.clientes(empresa_id, nome, whatsapp) values ((select v from ids where k = 'ea'), 'Cliente da A', '11988887777');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.clientes), 'B não vê clientes da A');
select pg_temp.falha($$insert into public.clientes(empresa_id, nome) values ((select v from ids where k = 'ea'), 'invasor')$$, 'B não insere na A');
select pg_temp.ok((select count(*) = 0 from public.empresa_config where empresa_id = (select v from ids where k = 'ea')), 'B não vê config da A');
select pg_temp.falha($$select public.painel_dashboard((select v from ids where k = 'ea'), current_date - 30, current_date)$$, 'B não abre dashboard da A', 'acesso');
select pg_temp.falha($$select public.equipe_adicionar((select v from ids where k = 'ea'), 'dono.b@x.com', 'admin')$$, 'B não se adiciona na A', 'permissão');
select pg_temp.ok((select public.busca_global((select v from ids where k = 'ea'), 'Cliente')->'clientes' = '[]'::jsonb), 'busca de B na A vem vazia');

-- ===== Equipe e permissões
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.equipe_adicionar((select v from ids where k = 'ea'), 'comercial@x.com', 'comercial');
select pg_temp.ok((select count(*) = 2 from public.equipe_listar((select v from ids where k = 'ea'))), 'equipe com 2 pessoas');
select pg_temp.falha($$update public.empresas set status = 'ativa' where id = (select v from ids where k = 'ea')$$, 'assinante não muda status da empresa', 'plataforma');
update public.empresa_config set energia_kwh = 0.95, mao_obra_hora = 30, margem_pct = 40, impostos_pct = 6, taxas_pct = 0, desperdicio_pct = 5, desconto_livre_pct = 5
 where empresa_id = (select v from ids where k = 'ea');
select pg_temp.falha($$update public.empresa_config set margem_pct = 60, impostos_pct = 30, taxas_pct = 15 where empresa_id = (select v from ids where k = 'ea')$$, 'percentuais somando 100% bloqueados');

-- ===== Matéria-prima
insert into ids values ('pla', public.cadastrar_materia_prima((select v from ids where k = 'ea'),
  '{"nome":"PLA Preto","codigo":"PLA-PT","categoria":"filamento","material":"PLA","cor":"Preto","unidade":"kg","estoque_minimo":"1"}', 2, 100));
select pg_temp.ok((select quantidade = 2 and custo_medio = 100 from public.materiais where id = (select v from ids where k = 'pla')), 'saldo inicial 2 kg a R$100');
select public.movimentar_materia_prima((select v from ids where k = 'pla'), 'entrada', 1, 130, null);
select pg_temp.ok((select custo_medio = 110 from public.materiais where id = (select v from ids where k = 'pla')), 'custo médio ponderado = 110');
select pg_temp.falha($$update public.materiais set quantidade = 99 where id = (select v from ids where k = 'pla')$$, 'saldo não muda por edição direta', 'saldo');
select pg_temp.falha($$select public.movimentar_materia_prima((select v from ids where k = 'pla'), 'saida', 5, null, null)$$, 'saída maior que o saldo bloqueada', 'disponível');
select pg_temp.falha($$select public.movimentar_materia_prima((select v from ids where k = 'pla'), 'ajuste', 1, null, '')$$, 'ajuste sem justificativa bloqueado', 'justificativa');
insert into ids values ('res', public.reservar_materia_prima((select v from ids where k = 'pla'), 2, 'OP teste', null, null));
select pg_temp.falha($$select public.movimentar_materia_prima((select v from ids where k = 'pla'), 'saida', 1.5, null, null)$$, 'saída não usa material reservado', 'reservado');
select pg_temp.falha($$select public.reservar_materia_prima((select v from ids where k = 'pla'), 1.5, 'OP 2', null, null)$$, 'reserva acima do disponível bloqueada', 'disponível');
select public.consumir_reserva((select v from ids where k = 'res'), 1.8);
select pg_temp.ok((select quantidade = 1.2 and quantidade_reservada = 0 from public.materiais where id = (select v from ids where k = 'pla')), 'consumo real baixa 1,8 e libera a reserva');
select pg_temp.falha($$select public.consumir_reserva((select v from ids where k = 'res'), 1.8)$$, 'reserva não é consumida duas vezes', 'já foi');
insert into ids values ('mov', (select id from public.movimentacoes_estoque where material_id = (select v from ids where k = 'pla') and tipo = 'entrada' and custo_unitario = 130));
select public.estornar_movimentacao((select v from ids where k = 'mov'), 'lançado errado');
select pg_temp.ok((select quantidade = 0.2 from public.materiais where id = (select v from ids where k = 'pla')), 'estorno da entrada de 1 kg');
select pg_temp.falha($$select public.estornar_movimentacao((select v from ids where k = 'mov'), 'de novo')$$, 'estorno duplicado bloqueado', 'já foi estornada');
select public.inventariar_materia_prima((select v from ids where k = 'pla'), 3, 'contagem mensal');
select pg_temp.ok((select quantidade = 3 from public.materiais where id = (select v from ids where k = 'pla')), 'inventário ajusta para 3');
delete from public.movimentacoes_estoque where material_id = (select v from ids where k = 'pla');
select pg_temp.ok((select count(*) > 0 from public.movimentacoes_estoque where material_id = (select v from ids where k = 'pla')), 'movimentação não pode ser apagada (histórico preservado)');
-- bobina
insert into public.material_bobinas(empresa_id, material_id, codigo, peso_inicial_g) values ((select v from ids where k = 'ea'), (select v from ids where k = 'pla'), '001', 1000);
insert into ids values ('bob', (select id from public.material_bobinas where codigo = '001'));
select public.reservar_materia_prima((select v from ids where k = 'pla'), 0.12, 'OP bobina', null, (select v from ids where k = 'bob'));
select public.consumir_bobina((select v from ids where k = 'bob'), 280, 'peça X');
select pg_temp.ok((select saldo_fisico_g = 720 and disponivel_g = 600 from public.material_bobinas where id = (select v from ids where k = 'bob')), 'bobina: físico 720 g, disponível 600 g (exemplo do prompt)');
-- compra (registrar_compra continua funcionando)
select public.registrar_compra((select v from ids where k = 'ea'), 'embalagem', 'Caixa P', 10, 25);
select pg_temp.ok((select custo_medio = 2.5 and quantidade = 10 from public.materiais where nome = 'Caixa P'), 'compra entra no estoque com custo');
select pg_temp.ok((select count(*) = 1 from public.gastos where descricao like 'Compra: Caixa P%'), 'compra lançada em gastos');

-- ===== Impressoras + limite do plano (Pro = 5)
insert into public.impressoras(empresa_id, nome, potencia_w, custo_aquisicao, vida_util_horas, custo_manutencao_hora)
values ((select v from ids where k = 'ea'), 'Bambu P1S', 200, 3000, 5000, 0.1);
insert into ids values ('imp', (select id from public.impressoras where nome = 'Bambu P1S'));
select pg_temp.ok((select custo_hora = 0.7 from public.impressoras where id = (select v from ids where k = 'imp')), 'custo/hora = 3000/5000 + 0,10 = 0,70');
insert into public.impressoras(empresa_id, nome) select (select v from ids where k = 'ea'), 'Imp ' || g from generate_series(2, 5) g;
select pg_temp.falha($$insert into public.impressoras(empresa_id, nome) values ((select v from ids where k = 'ea'), 'Imp 6')$$, '6ª impressora bloqueada pelo plano', 'plano');
update public.impressoras set status = 'manutencao' where nome = 'Imp 5';
select pg_temp.ok((select count(*) = 2 from public.impressora_eventos where impressora_id = (select id from public.impressoras where nome = 'Imp 5')), 'histórico de status da impressora');

-- ===== Orçamento: fórmulas
insert into public.orcamentos(empresa_id, cliente_id, titulo) values ((select v from ids where k = 'ea'), (select id from public.clientes where nome = 'Cliente da A'), 'Suporte de celular');
insert into ids values ('orc', (select id from public.orcamentos where titulo = 'Suporte de celular'));
-- custo médio atual do PLA: 110/kg
insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, material_id, impressora_id, quantidade, peso_g, tempo_h)
values ((select v from ids where k = 'ea'), (select v from ids where k = 'orc'), 'Suporte', (select v from ids where k = 'pla'), (select v from ids where k = 'imp'), 2, 100, 5);
-- material 0,1×110×1,05 = 11,55 | energia 0,2×5×0,95 = 0,95 | máquina 5×0,7 = 3,5 | total 16,00 | preço 16/(1−0,46) = 29,63
select pg_temp.ok((select custo_material = 11.55 and custo_energia = 0.95 and custo_maquina = 3.5 and custo_unitario = 16 and preco_unitario = 29.63 and preco_total = 59.26
                   from public.orcamento_itens where orcamento_id = (select v from ids where k = 'orc')), 'fórmulas: custo 16,00 → preço 29,63 (×2 = 59,26)');
select pg_temp.ok((select subtotal = 59.26 and total = 59.26 and custo_total = 32 from public.orcamentos where id = (select v from ids where k = 'orc')), 'totais do orçamento');
select pg_temp.ok((select lucro_estimado = round(59.26 - 32 - 59.26 * 0.06, 2) from public.orcamentos where id = (select v from ids where k = 'orc')), 'lucro = venda − custo − impostos');
select pg_temp.falha($$update public.orcamento_itens set margem_pct = 80, impostos_pct = 20 where orcamento_id = (select v from ids where k = 'orc')$$, 'margem+impostos ≥ 100% bloqueado');
select pg_temp.falha($$update public.orcamentos set status = 'aprovado' where id = (select v from ids where k = 'orc')$$, 'status não muda por edição direta', 'botões');

-- desconto: comercial não passa do limite livre (5%)
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha($$update public.orcamentos set desconto_valor = 10 where id = (select v from ids where k = 'orc')$$, 'comercial não dá desconto de 17%', 'desconto');
update public.orcamentos set desconto_valor = 2 where id = (select v from ids where k = 'orc');
select pg_temp.falha($$select public.movimentar_materia_prima((select v from ids where k = 'pla'), 'saida', 0.1, null, null)$$, 'comercial não movimenta matéria-prima', 'permissão');
select pg_temp.ok((select count(*) = 0 from public.gastos), 'comercial não vê gastos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.orcamentos set desconto_valor = 10 where id = (select v from ids where k = 'orc');
select pg_temp.ok((select total = 49.26 from public.orcamentos where id = (select v from ids where k = 'orc')), 'dono aplica desconto de R$10');

-- envio, link público, aprovação, conversão
insert into ids values ('tok', null);
select public.enviar_orcamento((select v from ids where k = 'orc')) as token \gset
select pg_temp.ok((select revisao = 1 and status = 'enviado' from public.orcamentos where id = (select v from ids where k = 'orc')), 'enviado com revisão 1');
reset role; set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select (public.orcamento_publico(:'token')->'orcamento'->>'total')::numeric = 49.26), 'link público mostra o total');
select pg_temp.ok((select public.orcamento_publico(:'token')::text not like '%custo%'), 'link público não expõe custos');
select pg_temp.falha($$select * from public.orcamentos$$, 'anônimo não lê a tabela');
select public.responder_orcamento_publico(:'token', true, 'Maria Cliente', null);
select pg_temp.falha(format($$select public.responder_orcamento_publico(%L, false, 'Maria', 'mudei')$$, :'token'), 'resposta dupla bloqueada', 'respondido');
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$update public.orcamento_itens set quantidade = 5 where orcamento_id = (select v from ids where k = 'orc')$$, 'aprovado: itens congelados', 'não podem');
update public.materiais set margem_pct = 10 where id = (select v from ids where k = 'pla');
select pg_temp.ok((select preco_total = 59.26 from public.orcamento_itens where orcamento_id = (select v from ids where k = 'orc')), 'valores aprovados preservados');
insert into ids values ('ped', public.converter_orcamento_em_pedido((select v from ids where k = 'orc')));
select pg_temp.ok((select public.converter_orcamento_em_pedido((select v from ids where k = 'orc')) = (select v from ids where k = 'ped')), 'conversão idempotente (não duplica pedido)');
select pg_temp.ok((select valor_total = 49.26 and custo_estimado = 32 and numero = 1 from public.pedidos where id = (select v from ids where k = 'ped')), 'pedido criado com valores do orçamento');
select pg_temp.ok((select sum(quantidade * valor_unitario) = 49.26 from public.pedido_itens where pedido_id = (select v from ids where k = 'ped')), 'itens do pedido somam o total');
select pg_temp.ok((select count(*) >= 3 from public.orcamento_revisoes where orcamento_id = (select v from ids where k = 'orc')), 'histórico de revisões');
insert into ids values ('dup', public.duplicar_orcamento((select v from ids where k = 'orc')));
select pg_temp.ok((select status = 'rascunho' and numero = 2 from public.orcamentos where id = (select v from ids where k = 'dup')), 'duplicado vira rascunho #2');

-- ===== Produtos
insert into public.produtos(empresa_id, nome, codigo, material_id, peso_g, tempo_h, impressora_id, preco_venda, controla_estoque)
values ((select v from ids where k = 'ea'), 'Vaso', 'VS-1', (select v from ids where k = 'pla'), 100, 5, (select v from ids where k = 'imp'), 40, true);
insert into ids values ('prod', (select id from public.produtos where codigo = 'VS-1'));
select pg_temp.ok((select (public.calcular_custo_produto((select v from ids where k = 'prod'))->>'total')::numeric = 16), 'custo do produto = 16,00');
select public.movimentar_produto((select v from ids where k = 'prod'), null, 'entrada', 5, 'produção');
select pg_temp.falha($$select public.movimentar_produto((select v from ids where k = 'prod'), null, 'saida', 6, null)$$, 'estoque de acabado não fica negativo', 'insuficiente');
select pg_temp.falha($$update public.produtos set estoque_qtd = 50 where id = (select v from ids where k = 'prod')$$, 'estoque de acabado só por movimentação', 'movimentação');
update public.produtos set preco_venda = 45 where id = (select v from ids where k = 'prod');
select pg_temp.ok((select count(*) = 2 from public.produto_precos where produto_id = (select v from ids where k = 'prod')), 'histórico de preço');

-- ===== Dashboard, busca, notificações, assinatura
select pg_temp.ok((select (public.painel_dashboard((select v from ids where k = 'ea'), current_date - 29, current_date)->>'faturamento_periodo')::numeric = 49.26), 'dashboard: faturamento');
select pg_temp.ok((select (public.painel_dashboard((select v from ids where k = 'ea'), current_date - 29, current_date)->>'lucro_bruto')::numeric = 17.26), 'dashboard: lucro bruto 49,26 − 32');
select pg_temp.ok((select jsonb_array_length(public.busca_global((select v from ids where k = 'ea'), 'PLA')->'materiais') = 1), 'busca encontra matéria-prima');
select pg_temp.ok((select jsonb_array_length(public.minhas_notificacoes((select v from ids where k = 'ea'))) >= 1), 'notificações geradas');
select pg_temp.ok((select public.minha_assinatura((select v from ids where k = 'ea'))->'plano'->>'nome' = 'Pro'), 'minha assinatura');
select public.solicitar_alteracao_assinatura((select v from ids where k = 'ea'), 'upgrade', (select id from public.planos where slug = 'business'), null, null);
select pg_temp.falha($$select public.solicitar_alteracao_assinatura((select v from ids where k = 'ea'), 'cancelamento', null, null, 'caro demais')$$, 'só uma solicitação pendente', 'pendente');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha($$select public.solicitar_alteracao_assinatura((select v from ids where k = 'ea'), 'cancelamento', null, null, 'quero cancelar')$$, 'comercial não mexe na assinatura', 'proprietário');
select pg_temp.ok((select count(*) = 0 from public.auditoria), 'comercial não vê auditoria');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) > 5 from public.auditoria where empresa_id = (select v from ids where k = 'ea')), 'dono vê a auditoria da empresa');

-- ===== Arquivos (função chamada pelas políticas do Storage)
reset role;
select pg_temp.ok(private.pode_enviar_arquivo((select v from ids where k = 'ea') || '/produtos/abc.stl'), 'dono pode enviar STL');
select pg_temp.ok(not private.pode_enviar_arquivo((select v from ids where k = 'ea') || '/produtos/virus.exe'), 'extensão .exe recusada');
select pg_temp.ok(not private.pode_enviar_arquivo((select v from ids where k = 'eb') || '/produtos/abc.stl'), 'A não envia para pasta da B');
set role authenticated;

-- ===== Suspensão: leitura sim, escrita não
reset role;
reset request.jwt.claim.sub;
update public.empresas set status = 'suspensa' where id = (select v from ids where k = 'ea');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 1 from public.clientes), 'suspensa: ainda lê os dados');
select pg_temp.falha($$insert into public.clientes(empresa_id, nome) values ((select v from ids where k = 'ea'), 'novo')$$, 'suspensa: não grava');
select pg_temp.falha(format($$select public.movimentar_materia_prima(%L, 'entrada', 1, 1, null)$$, (select v from ids where k = 'pla')), 'suspensa: não movimenta estoque', 'permissão');
reset role;
\echo TODOS OS TESTES PASSARAM
