-- Testes da integração Mercado Livre (o "serviço" é simulado com a role service_role)
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub; reset request.jwt.claims;
create temp table ml(k text primary key, v text); grant all on ml to authenticated, anon, service_role;
insert into ml select 'ea', id::text from public.empresas where nome = 'Loja A';
insert into ml select 'eb', id::text from public.empresas where nome = 'Loja B';
create or replace function pg_temp.v(p text) returns text language sql as $$ select v from ml where k = p $$;
create or replace function pg_temp.svc() returns void language plpgsql as $$ begin
  execute 'set role service_role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', false); perform set_config('request.jwt.claim.sub', '', false); end $$;
create or replace function pg_temp.usr(p text) returns void language plpgsql as $$ begin
  execute 'set role authenticated'; perform set_config('request.jwt.claims', '{"role":"authenticated"}', false); perform set_config('request.jwt.claim.sub', p, false); end $$;

-- ===== conexão =====
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
select pg_temp.falha(format($$select public.ml_iniciar_conexao(%L)$$, pg_temp.v('ea')), 'ML sem aplicativo configurado avisa', 'ainda não foi ativada');
select pg_temp.falha($$select public.admin_config_ml('123456', 'https://x.test/cb')$$, 'ML loja não configura o aplicativo', 'proprietário ou administrador');
select pg_temp.usr('00000000-0000-0000-0000-0000000000f3');
select public.admin_config_ml('1234567890', 'https://mrv3dsolutions.tech/integra/ml/callback');
select pg_temp.usr('00000000-0000-0000-0000-00000000000c');
select pg_temp.falha(format($$select public.ml_iniciar_conexao(%L)$$, pg_temp.v('ea')), 'ML comercial não conecta', 'configura integrações');
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
insert into ml select 'url', public.ml_iniciar_conexao(pg_temp.v('ea')::uuid)->>'url';
select pg_temp.ok((select v ~ '^https://mrv3dsolutions\.tech/integra/ml/iniciar\?estado=[0-9a-f]{48}$' from ml where k = 'url'), 'ML conexão passa pelo serviço da plataforma');
insert into ml select 'estado', substring(pg_temp.v('url') from 'estado=([0-9a-f]+)$');
-- funções do serviço fechadas para a loja e para visitantes
select pg_temp.falha(format($$select public.svc_ml_consumir_estado(%L)$$, pg_temp.v('estado')), 'ML loja não chama função do serviço', 'permission denied');
select pg_temp.falha($$select * from private.marketplace_tokens$$, 'ML loja não lê tokens', 'permission denied');
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.falha($$select public.svc_ml_enfileirar(1, 'orders_v2', '/orders/1')$$, 'ML visitante não enfileira', 'permission denied');

select pg_temp.svc();
select pg_temp.ok((select (public.svc_ml_consumir_estado(pg_temp.v('estado'))->>'empresa_id') = pg_temp.v('ea')), 'ML estado válido devolve a empresa');
select pg_temp.ok((select public.svc_ml_consumir_estado(pg_temp.v('estado')) is null), 'ML estado é de uso único');
select pg_temp.ok((select public.svc_ml_consumir_estado('abc') is null), 'ML estado inválido recusado');
insert into ml select 'conta', public.svc_ml_salvar_conta(pg_temp.v('ea')::uuid, '00000000-0000-0000-0000-00000000000a', 555001, 'LOJA_A_ML', 'APP_USR-acesso-aaaaaaaa', 'TG-refresh-aaaaaaaa', 21600)::text;
select pg_temp.falha($$select public.svc_ml_salvar_conta(pg_temp.v('eb')::uuid, null, 555001, 'B', 'APP_USR-acesso-bbbbbbbb', 'TG-refresh-bbbbbbbb', 21600)$$, 'ML mesma conta não liga em duas empresas', 'conta_em_outra_empresa');
select pg_temp.ok((select public.svc_ml_token(pg_temp.v('conta')::uuid)->>'access' = 'APP_USR-acesso-aaaaaaaa'), 'ML token guardado cifrado e lido pelo serviço');
reset role;
select pg_temp.ok((select position('acesso' in encode(access_cifrado, 'escape')) = 0 from private.marketplace_tokens where conta_id = pg_temp.v('conta')::uuid), 'ML token não fica em texto puro');

-- ===== anúncios e estoque =====
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
insert into public.produtos(empresa_id, nome, codigo, controla_estoque, preco_venda) values (pg_temp.v('ea')::uuid, 'Chaveiro dragão', 'CHAV-01', true, 25);
insert into ml select 'prod', id::text from public.produtos where codigo = 'CHAV-01';
select public.movimentar_produto(pg_temp.v('prod')::uuid, null, 'entrada', 5, null);
select pg_temp.svc();
select pg_temp.ok((select public.svc_ml_salvar_anuncios(pg_temp.v('conta')::uuid, '[{"item_id":"MLB111","titulo":"Chaveiro Dragão 3D","sku":"chav-01","status":"active","preco":"25","estoque":"7","link":"https://produto.mercadolivre.com.br/MLB-111"},
  {"item_id":"MLB222","titulo":"Vaso sob encomenda","status":"active","estoque":"99"},{"item_id":"xx; drop","titulo":"inválido"}]'::jsonb) = 2), 'ML anúncios salvos (inválido ignorado)');
reset role;
insert into ml select 'an1', id::text from public.marketplace_anuncios where item_id = 'MLB111';
insert into ml select 'an2', id::text from public.marketplace_anuncios where item_id = 'MLB222';
select pg_temp.ok((select produto_id::text = pg_temp.v('prod') from public.marketplace_anuncios where item_id = 'MLB111'), 'ML vínculo automático pelo SKU = código do produto');
select pg_temp.usr('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from public.marketplace_anuncios), 'ML Loja B não vê anúncios da A');
select pg_temp.falha(format($$select public.marketplace_vincular_anuncio(%L, null, null, false)$$, pg_temp.v('an1')), 'ML Loja B não mexe em anúncio da A', 'não encontrado');
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
select public.marketplace_vincular_anuncio(pg_temp.v('an1')::uuid, pg_temp.v('prod')::uuid, null, true);
select pg_temp.svc();
select pg_temp.ok((select count(*) = 1 and min(quantidade) = 5 from public.svc_ml_estoques_pendentes(10)), 'ML estoque a enviar = estoque do sistema');
select public.svc_ml_estoque_resultado(pg_temp.v('an1')::uuid, 5, null);
select pg_temp.ok((select count(*) = 0 from public.svc_ml_estoques_pendentes(10)), 'ML nada a enviar depois de sincronizado');

-- ===== importação de vendas =====
create temp table ped as select '{"id": 2000001, "status": "paid", "date_created": "2099-01-01T10:00:00.000-03:00", "pack_id": 3000001, "seller": {"id": 555001},
  "buyer": {"id": 777, "nickname": "COMPRADOR77", "first_name": "Maria", "last_name": "Souza"}, "shipping": {"id": 4000001},
  "order_items": [{"item": {"id": "MLB111", "title": "Chaveiro Dragão 3D", "variation_id": null}, "quantity": 2, "unit_price": 25, "sale_fee": 3.5},
                  {"item": {"id": "MLB999", "title": "Item sem vínculo", "variation_id": null}, "quantity": 1, "unit_price": 10, "sale_fee": 1}]}'::jsonb as j;
grant select on ped to service_role;
select pg_temp.svc();
insert into ml select 'imp', public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, (select j from ped),
  '{"mode":"me1","status":"ready_to_ship","receiver_address":{"street_name":"Rua Sinimbu","street_number":"120","zip_code":"95020510","city":{"name":"Caxias do Sul"},"state":{"id":"BR-RS"},"neighborhood":{"name":"São Pelegrino"}}}')::text;
reset role;
insert into ml select 'ped', (pg_temp.v('imp')::jsonb->>'pedido_id');
select pg_temp.ok((select valor_total = 60 and valor_pago = 60 and origem = 'mercado_livre' and status = 'aprovado' from public.pedidos where id = pg_temp.v('ped')::uuid), 'ML venda paga vira pedido pago');
select pg_temp.ok((select count(*) = 2 and count(produto_id) = 1 from public.pedido_itens where pedido_id = pg_temp.v('ped')::uuid), 'ML itens com e sem produto');
select pg_temp.ok((select estoque_qtd = 3 from public.produtos where id = pg_temp.v('prod')::uuid), 'ML venda baixa o estoque do produto');
select pg_temp.ok((select nome = 'Maria Souza' and cidade = 'Caxias do Sul' and uf = 'RS' and bairro = 'São Pelegrino' and numero_endereco = '120' from public.clientes where marketplace_ref = 'ml:777'), 'ML cliente criado com endereço');
select pg_temp.ok((select count(*) = 1 and bool_and(pago) and sum(valor) = 8 from public.lancamentos where descricao like 'Tarifa Mercado Livre%'), 'ML tarifa registrada como despesa paga');
select pg_temp.ok((select aviso like '%sem produto vinculado%' from public.marketplace_pedidos where pedido_externo_id = 2000001), 'ML aviso de anúncio sem vínculo');
-- de novo (aviso repetido do ML): não duplica nada
select pg_temp.svc();
select pg_temp.ok((select (public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, (select j from ped), null)->>'atualizado')::boolean), 'ML reimportar só atualiza');
reset role;
select pg_temp.ok((select count(*) = 1 from public.pedidos where origem = 'mercado_livre') and (select estoque_qtd = 3 from public.produtos where id = pg_temp.v('prod')::uuid)
  and (select count(*) = 1 from public.pagamentos where pedido_id = pg_temp.v('ped')::uuid), 'ML idempotente: sem pedido, estoque ou pagamento duplicado');
-- outro pedido do mesmo carrinho entra no mesmo pedido
select pg_temp.svc();
select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, jsonb_set(jsonb_set((select j from ped), '{id}', '2000002'), '{order_items}',
  '[{"item":{"id":"MLB111","title":"Chaveiro Dragão 3D"},"quantity":1,"unit_price":25,"sale_fee":3.5}]'), null);
reset role;
select pg_temp.ok((select valor_total = 85 and valor_pago = 85 from public.pedidos where id = pg_temp.v('ped')::uuid)
  and (select count(*) = 1 from public.pedidos where origem = 'mercado_livre'), 'ML carrinho (pack) vira um pedido só');
select pg_temp.svc();
select pg_temp.ok((select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, jsonb_set(jsonb_set((select j from ped), '{id}', '2000003'), '{status}', '"payment_required"'), null)->>'ignorado' = 'nao_pago'), 'ML venda não paga não vira pedido');
select pg_temp.ok((select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, jsonb_set(jsonb_set((select j from ped), '{id}', '2000004'), '{date_created}', '"2020-01-01T10:00:00Z"'), null)->>'ignorado' = 'anterior_a_conexao'), 'ML venda anterior à conexão ignorada');
select pg_temp.falha($$select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, jsonb_set(jsonb_set((select j from ped), '{id}', '2000005'), '{seller,id}', '999'), null)$$, 'ML pedido de outro vendedor recusado', 'outro vendedor');
select pg_temp.ok((select count(*) = 1 and min(quantidade) = 2 from public.svc_ml_estoques_pendentes(10)), 'ML estoque novo (2) pendente para o anúncio');

-- ===== rastreio =====
reset role;
select set_config('app.ped_interno', '1', false);
update public.pedidos set status_producao = 'nao_aplica' where id = pg_temp.v('ped')::uuid;
select set_config('app.ped_interno', '0', false);
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
insert into ml select 'env', public.criar_envio(pg_temp.v('ped')::uuid, 'correios')::text;
reset role; select set_config('app.envio_interno', '1', false);
update public.envios set codigo_rastreio = 'BR123456789BR', status = 'enviado' where id = pg_temp.v('env')::uuid;
select set_config('app.envio_interno', '0', false);
select pg_temp.svc();
select pg_temp.ok((select count(*) = 1 and bool_and(codigo = 'BR123456789BR' and envio_id = 4000001) from public.svc_ml_rastreios_pendentes(10)), 'ML rastreio pendente uma vez por envio (carrinho)');
select public.svc_ml_rastreio_resultado(mkt_pedido_id, codigo, null) from public.svc_ml_rastreios_pendentes(10);
select pg_temp.ok((select count(*) = 0 from public.svc_ml_rastreios_pendentes(10)), 'ML rastreio enviado não repete');
-- ME2: o rastreio vem do ML para o envio do sistema
reset role; select set_config('app.envio_interno', '1', false);
update public.envios set codigo_rastreio = null where id = pg_temp.v('env')::uuid;
select set_config('app.envio_interno', '0', false);
select pg_temp.svc();
select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, (select j from ped), '{"mode":"me2","status":"shipped","tracking_number":"ML987654"}');
reset role;
select pg_temp.ok((select codigo_rastreio = 'ML987654' from public.envios where id = pg_temp.v('env')::uuid), 'ML rastreio do Mercado Envios entra no envio do sistema');

-- ===== cancelamento e notificações =====
select pg_temp.svc();
select public.svc_ml_importar_pedido(pg_temp.v('conta')::uuid, jsonb_set((select j from ped), '{status}', '"cancelled"'), null);
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select aviso like 'Venda cancelada no Mercado Livre%' from public.marketplace_pedidos where pedido_externo_id = 2000001), 'ML cancelamento vira aviso');
select pg_temp.ok((select count(*) >= 1 from jsonb_array_elements(public.minhas_notificacoes(pg_temp.v('ea')::uuid)) n where n->>'id' like 'ml-aviso-%'), 'ML aviso aparece no sino');
select pg_temp.ok((select status <> 'cancelado' from public.pedidos where id = pg_temp.v('ped')::uuid), 'ML cancelamento não cancela o pedido sozinho');

-- ===== fila =====
select pg_temp.svc();
select pg_temp.ok((select public.svc_ml_enfileirar(555001, 'orders_v2', '/orders/2000009') = 1 and public.svc_ml_enfileirar(555001, 'orders_v2', '/orders/abc') = 0
  and public.svc_ml_enfileirar(555001, 'questions', '/questions/1') = 0 and public.svc_ml_enfileirar(999999, 'orders_v2', '/orders/1') = 0), 'ML aviso validado e enfileirado');
create temp table tf as select * from public.svc_ml_tarefas(50);
select pg_temp.ok((select count(*) >= 3 and bool_or(tipo = 'pedido' and recurso = '2000009') from tf), 'ML tarefas reservadas');
select pg_temp.ok((select count(*) = 0 from public.svc_ml_tarefas(50)), 'ML tarefa reservada não sai duas vezes');
select public.svc_ml_tarefa_fim(id, case when tipo = 'pedido' then 'erro temporário' end) from tf;
reset role;
select pg_temp.ok((select count(*) = 1 and min(proxima_em) > now() from private.marketplace_fila), 'ML erro reagenda com espera; sucesso sai da fila');

-- ===== desconectar =====
select pg_temp.usr('00000000-0000-0000-0000-00000000000c');
select pg_temp.falha(format($$select public.marketplace_desconectar(%L)$$, pg_temp.v('conta')), 'ML comercial não desconecta', 'não encontrada');
select pg_temp.usr('00000000-0000-0000-0000-00000000000a');
select public.marketplace_desconectar(pg_temp.v('conta')::uuid);
select pg_temp.svc();
select pg_temp.ok((select public.svc_ml_token(pg_temp.v('conta')::uuid) is null) and (select count(*) = 0 from public.svc_ml_estoques_pendentes(10)), 'ML desconectar apaga o acesso e para a sincronização');
reset role; reset request.jwt.claims; reset request.jwt.claim.sub;
\echo MERCADO LIVRE OK
