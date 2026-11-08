-- Testes do módulo Bambu Lab / biblioteca de projetos / orçamento automático (depois de fase4.sql)
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table bb(k text primary key, v uuid); grant all on bb to authenticated, anon;
create temp table bt(k text primary key, t text); grant all on bt to authenticated, anon;
insert into bb select 'ea', id from public.empresas where nome = 'Loja A';
insert into bb select 'eb', id from public.empresas where nome = 'Loja B';
insert into bb select 'pla', id from public.materiais where codigo = 'PLA-PT';
insert into bb select 'imp', id from public.impressoras where nome = 'Bambu P1S';
reset role;
insert into public.materiais(empresa_id, nome, cor, unidade, categoria, material) values ((select v from bb where k = 'ea'), 'PETG', 'Branco', 'kg', 'filamento', 'PETG');
insert into bb select 'petg', id from public.materiais where nome = 'PETG' and cor = 'Branco';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.movimentar_materia_prima((select v from bb where k = 'petg'), 'entrada', 2, 80, null);

-- ===================== BIBLIOTECA =====================
insert into public.projetos_3d(empresa_id, nome, origem, arquivo_path, arquivo_nome, formato, sha256, pecas, placas, tempo_estimado_min, peso_g, materiais, cores)
values ((select v from bb where k = 'ea'), 'Suporte headset', 'upload', (select v from bb where k = 'ea') || '/projetos/a.gcode.3mf', 'a.gcode.3mf', 'gcode.3mf', repeat('a', 64), 4, 1, 120, 50, '{PLA}', '{#000000}');
insert into bb select 'proj', id from public.projetos_3d where nome = 'Suporte headset';
select pg_temp.ok((select licenca = 'propria' and uso_comercial = 'permitido' from public.projetos_3d where id = (select v from bb where k = 'proj')), 'BB upload próprio = uso comercial permitido');
select pg_temp.falha(format($$insert into public.projetos_3d(empresa_id, nome, arquivo_path, sha256) values (%L, 'dup', %L, %L)$$, (select v from bb where k = 'ea'), (select v from bb where k = 'ea') || '/projetos/b.stl', repeat('a', 64)), 'BB duplicado pelo hash bloqueado', 'já está na biblioteca');
insert into public.projetos_3d(empresa_id, nome, arquivo_path, sha256, copia_de) values ((select v from bb where k = 'ea'), 'Suporte cópia', (select v from bb where k = 'ea') || '/projetos/a2.gcode.3mf', repeat('a', 64), (select v from bb where k = 'proj'));
select pg_temp.ok((select copia_de is not null and versao = 1 from public.projetos_3d where nome = 'Suporte cópia'), 'BB importar como cópia é permitido de propósito');
insert into public.projetos_3d(empresa_id, nome, arquivo_path, sha256, projeto_raiz_id) values ((select v from bb where k = 'ea'), 'Suporte v2', (select v from bb where k = 'ea') || '/projetos/a3.gcode.3mf', repeat('c', 64), (select v from bb where k = 'proj'));
insert into public.projetos_3d(empresa_id, nome, arquivo_path, sha256, projeto_raiz_id, versao) values ((select v from bb where k = 'ea'), 'Suporte v3', (select v from bb where k = 'ea') || '/projetos/a4.gcode.3mf', repeat('d', 64), (select id from public.projetos_3d where nome = 'Suporte v2'), 99);
select pg_temp.ok((select versao = 2 from public.projetos_3d where nome = 'Suporte v2') and (select versao = 3 and projeto_raiz_id = (select v from bb where k = 'proj') from public.projetos_3d where nome = 'Suporte v3'), 'BB versões numeradas no projeto raiz');
select pg_temp.falha($$update public.projetos_3d set versao = 7 where nome = 'Suporte v2'$$, 'BB versão não é alterada', 'versão');
select pg_temp.falha(format($$insert into public.projetos_3d(empresa_id, nome, origem, arquivo_path) values (%L, 'x', 'sincronizado', %L)$$, (select v from bb where k = 'ea'), (select v from bb where k = 'ea') || '/projetos/c.stl'), 'BB origem sincronizado só pela integração', 'integração');
select pg_temp.falha(format($$insert into public.projetos_3d(empresa_id, nome, arquivo_path) values (%L, 'x', %L)$$, (select v from bb where k = 'ea'), (select v from bb where k = 'eb') || '/projetos/c.stl'), 'BB arquivo de outra loja bloqueado', 'check');
select pg_temp.falha($$update public.projetos_3d set sha256 = repeat('b', 64) where nome = 'Suporte headset'$$, 'BB arquivo do projeto não muda', 'nova versão');
-- MakerWorld
insert into public.projetos_3d(empresa_id, nome, origem, makerworld_url, autor, licenca) values ((select v from bb where k = 'ea'), 'Vaso Voronoi', 'makerworld', 'https://makerworld.com/en/models/12345', 'Fulano', 'sdfl');
select pg_temp.ok((select uso_comercial = 'proibido' from public.projetos_3d where nome = 'Vaso Voronoi'), 'BB licença padrão do MakerWorld = sem uso comercial');
select pg_temp.falha(format($$insert into public.projetos_3d(empresa_id, nome, origem, makerworld_url) values (%L, 'dup', 'makerworld', 'https://MAKERWORLD.com/en/models/12345')$$, (select v from bb where k = 'ea')), 'BB link do MakerWorld duplicado', 'projetos_mw_uq');
select pg_temp.falha(format($$insert into public.projetos_3d(empresa_id, nome, origem, makerworld_url) values (%L, 'x', 'makerworld', 'https://evil.com/makerworld.com/')$$, (select v from bb where k = 'ea')), 'BB só links do MakerWorld', 'check');
select pg_temp.falha($$select public.projeto_criar_orcamento((select id from public.projetos_3d where nome = 'Vaso Voronoi'), null, 1)$$, 'BB licença não comercial bloqueia orçamento', 'licença');
update public.projetos_3d set licenca = 'licenca_comercial' where nome = 'Vaso Voronoi';
select pg_temp.ok((select uso_comercial = 'permitido' from public.projetos_3d where nome = 'Vaso Voronoi'), 'BB licença comercial comprada libera');
select pg_temp.ok((select count(*) >= 3 from public.integracao_eventos where empresa_id = (select v from bb where k = 'ea') and tipo in ('importacao','atualizacao')), 'BB histórico registra importação e atualização');

-- reutilização
insert into bb values ('orc', public.projeto_criar_orcamento((select v from bb where k = 'proj'), null, 2));
select pg_temp.ok((select i.peso_g = 50 and i.tempo_h = 2 and i.quantidade = 2 and i.arquivo_path like '%a.gcode.3mf' from public.orcamento_itens i where i.orcamento_id = (select v from bb where k = 'orc')), 'BB orçamento com peso e tempo do projeto');
select pg_temp.ok((select count(*) = 1 from public.projeto_vinculos where projeto_id = (select v from bb where k = 'proj') and orcamento_id = (select v from bb where k = 'orc')), 'BB vínculo com orçamento');
insert into bb values ('op', public.projeto_criar_ordem((select v from bb where k = 'proj'), 3, null, (select v from bb where k = 'imp')));
select pg_temp.ok((select peso_previsto_g = 150 and tempo_previsto_h = 6 and status = 'planejada' from public.ordens_producao where id = (select v from bb where k = 'op')), 'BB ordem de produção ×3');
insert into public.produtos(empresa_id, nome) values ((select v from bb where k = 'ea'), 'Suporte headset (produto)');
select public.projeto_vincular((select v from bb where k = 'proj'), 'produto', (select id from public.produtos where nome = 'Suporte headset (produto)'));
select pg_temp.ok((select produto_id is not null from public.projetos_3d where id = (select v from bb where k = 'proj')), 'BB vinculado ao produto');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.falha($$select public.projeto_criar_ordem((select v from bb where k = 'proj'), 1, null, null)$$, 'BB expedição não cria ordem', 'permissão');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.projetos_3d) and (select count(*) = 0 from public.integracao_eventos), 'BB Loja B não vê a biblioteca da A');
select pg_temp.falha($$select public.projeto_criar_orcamento((select v from bb where k = 'proj'), null, 1)$$, 'BB B não usa projeto da A', 'não encontrado');
select pg_temp.falha(format($$select public.projeto_vincular((select v from bb where k = 'proj'), 'produto', %L)$$, gen_random_uuid()), 'BB B não vincula projeto da A', 'não encontrado');

-- ===================== ORÇAMENTO MULTIMATERIAL =====================
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.orcamentos(empresa_id, titulo) values ((select v from bb where k = 'ea'), 'BB multicolor');
insert into bb select 'om', id from public.orcamentos where titulo = 'BB multicolor';
insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, material_id, impressora_id, quantidade, peso_g, tempo_h, desperdicio_pct, filamentos_extras, projeto_id, placa)
values ((select v from bb where k = 'ea'), (select v from bb where k = 'om'), 'Placa 1', (select v from bb where k = 'pla'), (select v from bb where k = 'imp'), 1, 100, 2, 0,
        jsonb_build_array(jsonb_build_object('material_id', (select v from bb where k = 'petg'), 'peso_g', 50)), (select v from bb where k = 'proj'), 1);
select pg_temp.ok((select custo_material = round(100.0 / 1000 * preco_kg + 50.0 / 1000 * 80, 4) and (filamentos_extras->0->>'preco_kg')::numeric = 80
  from public.orcamento_itens where orcamento_id = (select v from bb where k = 'om')), 'BB custo soma cada filamento com seu preço/kg');
select pg_temp.falha(format($$insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, filamentos_extras) values (%L, %L, 'x', %L)$$, (select v from bb where k = 'ea'), (select v from bb where k = 'om'),
  jsonb_build_array(jsonb_build_object('material_id', (select id from public.materiais where empresa_id = (select v from bb where k = 'ea') limit 0), 'peso_g', -1))::text), 'BB peso negativo bloqueado', 'inválido');
reset role;
insert into public.materiais(empresa_id, nome, unidade) values ((select v from bb where k = 'eb'), 'PLA da B', 'kg');
insert into bb select 'plab', id from public.materiais where nome = 'PLA da B';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha(format($$insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, filamentos_extras) values (%L, %L, 'x', %L)$$, (select v from bb where k = 'ea'), (select v from bb where k = 'om'),
  jsonb_build_array(jsonb_build_object('material_id', (select v from bb where k = 'plab'), 'peso_g', 10))::text), 'BB material de outra loja no item', 'não encontrada');
select pg_temp.ok((select count(*) = 1 from public.projeto_vinculos where orcamento_id = (select v from bb where k = 'om')), 'BB item com projeto vincula o orçamento');
-- custos fixos rateados
reset role; update public.empresa_config set custos_fixos_mensais = 1000, horas_produtivas_mes = 200 where empresa_id = (select v from bb where k = 'ea');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.orcamento_itens set descricao = 'Placa 1 ' where orcamento_id = (select v from bb where k = 'om');
select pg_temp.ok((select custo_fixo = 10 and preco_unitario = round((custo_unitario + 10) / (1 - (margem_efetiva + impostos_efetivo + taxas_efetiva) / 100), 2) and custo_total = round(custo_unitario, 2)
  from public.orcamento_itens where orcamento_id = (select v from bb where k = 'om')), 'BB custos fixos (R$ 5/h × 2 h) entram no preço, não no custo variável');
insert into bb values ('omd', public.duplicar_orcamento((select v from bb where k = 'om')));
select pg_temp.ok((select jsonb_array_length(filamentos_extras) = 1 and projeto_id is not null from public.orcamento_itens where orcamento_id = (select v from bb where k = 'omd')), 'BB duplicar mantém filamentos e projeto');
reset role; update public.empresa_config set horas_produtivas_mes = 0 where empresa_id = (select v from bb where k = 'ea');

-- desconectar apaga credenciais e revoga
reset role;
select private.salvar_credencial((select v from bb where k = 'ea'), 'bambu_lab', 'token-secreto', null, null);
select pg_temp.ok((select token_cifrado::text not like '%token-secreto%' from private.integracao_credenciais) and private.ler_credencial((select v from bb where k = 'ea'), 'bambu_lab') = 'token-secreto', 'BB token guardado criptografado');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$select * from private.integracao_credenciais$$, 'BB credenciais fora do alcance da tela');
select pg_temp.falha($$select private.ler_credencial((select v from bb where k = 'ea'), 'bambu_lab')$$, 'BB tela não decifra credenciais');
select public.desconectar_integracao((select v from bb where k = 'ea'), 'bambu_lab');
reset role;
select pg_temp.ok((select count(*) = 0 from private.integracao_credenciais), 'BB desconectar apaga as credenciais');
-- ===================== COMPLEMENTOS DO MVP =====================
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.impressoras set custo_aquisicao = 6000, valor_residual = 1000, vida_util_horas = 5000, custo_manutencao_hora = 0.1, custo_operacional_hora = 0.2 where id = (select v from bb where k = 'imp');
select pg_temp.ok((select custo_hora = 1.3 from public.impressoras where id = (select v from bb where k = 'imp')), 'MVP custo/hora = (6000−1000)/5000 + 0,10 + 0,20 = 1,30');
select pg_temp.falha($$update public.impressoras set valor_residual = 99999 where id = (select v from bb where k = 'imp')$$, 'MVP residual maior que a aquisição', 'residual');
reset role; update public.empresa_config set falha_metodo = 'sucesso', taxa_sucesso_pct = 80 where empresa_id = (select v from bb where k = 'ea');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.orcamento_itens set descricao = 'Placa 1  ' where orcamento_id = (select v from bb where k = 'om');
select pg_temp.ok((select custo_falha = round((custo_material + custo_energia + custo_maquina) * 0.25, 4) and versao_calculo = 2 from public.orcamento_itens where orcamento_id = (select v from bb where k = 'om')), 'MVP reserva por taxa de sucesso 80% = +25% do custo de impressão');
reset role; update public.empresa_config set falha_metodo = 'percentual', falha_pct = 10 where empresa_id = (select v from bb where k = 'ea');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.orcamento_itens set descricao = 'Placa 1' where orcamento_id = (select v from bb where k = 'om');
select pg_temp.ok((select custo_falha = round((custo_material + custo_energia + custo_maquina + custo_mao_obra + acabamento_custo + embalagem_custo) * 0.10, 4) from public.orcamento_itens where orcamento_id = (select v from bb where k = 'om')), 'MVP reserva percentual 10% (um método só)');
reset role; update public.empresa_config set falha_metodo = 'nenhum' where empresa_id = (select v from bb where k = 'ea');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.enviar_orcamento((select v from bb where k = 'om'));
select public.registrar_compartilhamento((select v from bb where k = 'om'), 'whatsapp');
select public.registrar_compartilhamento((select v from bb where k = 'om'), 'whatsapp');
select pg_temp.ok((select count(*) = 1 from public.orcamento_revisoes where orcamento_id = (select v from bb where k = 'om') and evento = 'compartilhado_whatsapp'), 'MVP compartilhamento registrado sem repetir');
select pg_temp.falha($$update public.orcamentos set visualizado_em = now() where id = (select v from bb where k = 'om')$$, 'MVP visualização não é forjada', 'link');
reset role; insert into bt select 'tokorc', token_publico from public.orcamentos where id = (select v from bb where k = 'om');
set role anon; reset request.jwt.claim.sub;
select public.orcamento_visualizado((select t from bt where k = 'tokorc'));
reset role;
select pg_temp.ok((select visualizado_em is not null from public.orcamentos where id = (select v from bb where k = 'om')), 'MVP comprador abriu o link: visualizado');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$select * from public.admin_uso_empresas()$$, 'MVP métricas só para a plataforma', 'plataforma');
reset role;
\echo BAMBU OK
