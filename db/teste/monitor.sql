-- Testes do monitoramento de impressoras (telemetria SIMULADA — não usa hardware real)
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table mo(k text primary key, v uuid); grant all on mo to authenticated, anon;
create temp table mt(k text primary key, t text); grant all on mt to authenticated, anon;
insert into mo select 'ea', id from public.empresas where nome = 'Loja A';
insert into mo select 'eb', id from public.empresas where nome = 'Loja B';
insert into mo select 'imp', id from public.impressoras where nome = 'Bambu P1S';
insert into mo select 'pla', id from public.materiais where codigo = 'PLA-PT';
update public.impressoras set status = 'disponivel' where id = (select v from mo where k = 'imp');
create or replace function pg_temp.ev(tipo text, em text, trab text, arq text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'tipo_conexao', 'bambu_lan', 'dispositivo_id', '01P00A123456789', 'tipo', tipo, 'em', em,
    'trabalho', jsonb_build_object('id', trab, 'arquivo', arq), 'dados', extra) $$;

-- 1. pareamento
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falha($$select public.criar_pareamento((select v from mo where k = 'ea'), 'PC')$$, 'MON comercial não pareia agente', 'administração');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into mt select 'cod', public.criar_pareamento((select v from mo where k = 'ea'), 'PC da oficina')->>'codigo';
select pg_temp.ok((select t ~ '^[A-Z2-9]{5}-[A-Z2-9]{5}$' from mt where k = 'cod'), 'MON código de pareamento curto');
select pg_temp.falha($$select codigo_hash from public.agente_pareamentos$$, 'MON hash do código não é lido');
set role anon; reset request.jwt.claim.sub;
select pg_temp.falha($$select public.agente_parear('AAAAA-AAAAA', '{}')$$, 'MON código errado', 'inválido');
insert into mt select 'tok', public.agente_parear(lower(replace((select t from mt where k = 'cod'), '-', ' ')), '{"versao": "0.1.0", "maquina": "oficina", "sistema": "Linux"}')->>'token';
select pg_temp.ok((select t ~ '^mrv3d_ag_[0-9a-f]{64}$' from mt where k = 'tok'), 'MON agente recebe o próprio token');
select pg_temp.falha($$select public.agente_parear((select t from mt where k = 'cod'), '{}')$$, 'MON código não é reutilizado', 'usado');
-- 2. expiração
reset role;
insert into public.agente_pareamentos(empresa_id, nome, codigo_hash, expira_em) values ((select v from mo where k = 'ea'), 'velho', encode(extensions.digest('ZZZZZ-ZZZZZ', 'sha256'), 'hex'), now() - interval '1 minute');
set role anon;
select pg_temp.falha($$select public.agente_parear('ZZZZZ-ZZZZZ', '{}')$$, 'MON código expirado recusado', 'expirado');

-- 3. impressora conectada pelo identificador
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.impressoras set conexao_tipo = 'bambu_lan', dispositivo_id = '01P00A123456789' where id = (select v from mo where k = 'imp');
reset role; insert into public.impressoras(empresa_id, nome) values ((select v from mo where k = 'eb'), 'P1S da B');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha($$update public.impressoras set conexao_tipo = 'bambu_lan', dispositivo_id = '01p00a123456789' where nome = 'P1S da B'$$, 'MON mesmo número de série em duas empresas', 'outra conta');

-- 4. telemetria + eventos (simulados)
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select (public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('versao', '0.1.0',
  'eventos', jsonb_build_array(pg_temp.ev('conectada', (now() - interval '2 hours')::text, null, null), pg_temp.ev('impressao_iniciada', (now() - interval '90 minutes')::text, 'job-1', 'suporte.gcode.3mf')),
  'impressoras', jsonb_build_array(jsonb_build_object('tipo_conexao', 'bambu_lan', 'dispositivo_id', '01P00A123456789', 'conexao', 'online', 'estado', 'imprimindo', 'trabalho_id', 'job-1',
     'arquivo', 'suporte.gcode.3mf', 'progresso', 40, 'restante_s', 3000, 'temp_bico', 220, 'temp_mesa', 9999, 'hack', 'x'),
   jsonb_build_object('tipo_conexao', 'moonraker', 'dispositivo_id', 'voron-24', 'nome', 'Voron'))))->>'eventos_novos') = '2'), 'MON eventos recebidos');
reset role;
select pg_temp.ok((select estado = 'imprimindo' and progresso = 40 and temp_bico = 220 and temp_mesa is null from public.impressora_telemetria where impressora_id = (select v from mo where k = 'imp')), 'MON telemetria normalizada (valor fora da faixa descartado)');
select pg_temp.ok((select dispositivos_detectados->0->>'dispositivo_id' = 'voron-24' from public.agentes_locais where nome = 'PC da oficina'), 'MON impressora desconhecida aparece como detectada');
select pg_temp.ok((select count(*) = 1 and bool_and(status = 'imprimindo' and ordem_id is null) from public.impressora_trabalhos where impressora_id = (select v from mo where k = 'imp')), 'MON trabalho detectado, sem vínculo automático');
-- 11. eventos duplicados (reenvio da fila offline)
insert into mt select 'evid', id::text from public.impressora_eventos_integracao where tipo = 'impressao_iniciada' limit 1;
set role anon;
select pg_temp.ok((select (public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(jsonb_build_object('id', (select t from mt where k = 'evid'),
  'tipo_conexao', 'bambu_lan', 'dispositivo_id', '01P00A123456789', 'tipo', 'impressao_iniciada', 'em', now()::text, 'trabalho', jsonb_build_object('id', 'job-1'))))))->>'ignorado' = 'true'), 'MON envios seguidos são agrupados');
reset role; update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select pg_temp.ok((select (public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(jsonb_build_object('id', (select t from mt where k = 'evid'),
  'tipo_conexao', 'bambu_lan', 'dispositivo_id', '01P00A123456789', 'tipo', 'impressao_iniciada', 'em', now()::text, 'trabalho', jsonb_build_object('id', 'job-1'))))))->>'eventos_novos' = '0'), 'MON evento repetido não duplica');
-- 12. telemetria atrasada não sobrescreve a atual
reset role; update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('impressoras', jsonb_build_array(jsonb_build_object('tipo_conexao', 'bambu_lan', 'dispositivo_id', '01P00A123456789',
  'estado', 'disponivel', 'progresso', 0, 'medido_em', (now() - interval '1 hour')::text))));
reset role;
select pg_temp.ok((select estado = 'imprimindo' from public.impressora_telemetria where impressora_id = (select v from mo where k = 'imp')), 'MON leitura antiga não vira estado atual');

-- 14. vínculo com ordem de produção (operador confirma)
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.ordens_producao(empresa_id, descricao, impressora_id, material_id, peso_previsto_g, tempo_previsto_h) values ((select v from mo where k = 'ea'), 'suporte', (select v from mo where k = 'imp'), (select v from mo where k = 'pla'), 30, 1.5);
insert into mo select 'op', id from public.ordens_producao where descricao = 'suporte' order by created_at desc limit 1;
select public.movimentar_materia_prima((select v from mo where k = 'pla'), 'entrada', 1, 100, null);
reset role; update public.impressoras set status = 'disponivel' where id = (select v from mo where k = 'imp');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.falha($$select public.vincular_trabalho_ordem((select id from public.impressora_trabalhos limit 1), (select v from mo where k = 'op'))$$, 'MON expedição não vincula', 'não encontrado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.falha(format($$select public.vincular_trabalho_ordem(%L, (select v from mo where k = 'op'))$$, (select id from public.impressora_trabalhos limit 1)), 'MON outra loja não vincula', 'não encontrado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
insert into mt select 'vinc', public.vincular_trabalho_ordem((select id from public.impressora_trabalhos where chave = 'job-1'), (select v from mo where k = 'op'));
select pg_temp.ok((select t = 'vinculado e ordem iniciada' from mt where k = 'vinc'), 'MON vínculo inicia a ordem');
reset role;
select pg_temp.ok((select status = 'imprimindo' and iniciada_em <= now() - interval '80 minutes' from public.ordens_producao where id = (select v from mo where k = 'op')), 'MON início real = início detectado');
-- 16. conclusão detectada: registra, não conclui a ordem sozinha
update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(pg_temp.ev('impressao_concluida', now()::text, 'job-1', 'suporte.gcode.3mf', '{"decorrido_s": 5400}'))));
reset role;
select pg_temp.ok((select status = 'concluido' and duracao_s = 5400 and progresso = 100 from public.impressora_trabalhos where chave = 'job-1'), 'MON trabalho concluído com tempo efetivo');
select pg_temp.ok((select status = 'imprimindo' and not consumo_registrado from public.ordens_producao where id = (select v from mo where k = 'op')), 'MON ordem não é concluída nem baixa material sozinha');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) > 0 from jsonb_array_elements(public.minhas_notificacoes((select v from mo where k = 'ea'))) x where x->>'id' like 'evimp-%'), 'MON alerta de conclusão');
-- 15. nomes repetidos: sem sugestão automática
insert into public.ordens_producao(empresa_id, descricao, impressora_id) values ((select v from mo where k = 'ea'), 'caixa', (select v from mo where k = 'imp')), ((select v from mo where k = 'ea'), 'caixa', (select v from mo where k = 'imp'));
reset role; select set_config('app.op_interno', '1', false); update public.ordens_producao set status = 'na_fila' where descricao = 'caixa'; select set_config('app.op_interno', '0', false); update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(pg_temp.ev('impressao_iniciada', now()::text, 'job-2', 'caixa.gcode.3mf'))));
reset role;
select pg_temp.ok((select sugestao_ordem_id is null from public.impressora_trabalhos where chave = 'job-2'), 'MON nome duplicado não gera sugestão');
-- 17. falha detectada
update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(pg_temp.ev('impressao_falhou', now()::text, 'job-2', 'caixa.gcode.3mf', '{"codigo": "0300-4000"}'))));
reset role;
select pg_temp.ok((select status = 'falhou' from public.impressora_trabalhos where chave = 'job-2'), 'MON falha registrada no trabalho');
-- eventos inválidos ignorados
update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select pg_temp.ok((select (public.agente_reportar((select t from mt where k = 'tok'), jsonb_build_object('eventos', jsonb_build_array(
  pg_temp.ev('impressao_iniciada', (now() + interval '1 day')::text, 'futuro', 'x'), pg_temp.ev('apagar_tudo', now()::text, 'x', 'x'),
  jsonb_build_object('id', gen_random_uuid(), 'tipo_conexao', 'bambu_lan', 'dispositivo_id', 'SERIAL-DA-B', 'tipo', 'conectada', 'em', now()::text)))))->>'eventos_novos' = '0'), 'MON eventos futuros, desconhecidos ou de outra impressora são ignorados');

-- 4/21. isolamento e privacidade
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.agentes_locais) and (select count(*) = 0 from public.impressora_telemetria) and (select count(*) = 0 from public.impressora_trabalhos)
  and (select count(*) = 0 from public.impressora_eventos_integracao), 'MON Loja B não vê nada do monitoramento da A');
select pg_temp.falha($$select * from public.admin_uso_empresas()$$, 'MON métricas só para a plataforma', 'plataforma');
-- 20. limites do plano
reset role; update public.planos set limite_agentes = 1;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$select public.criar_pareamento((select v from mo where k = 'ea'), 'Segundo PC')$$, 'MON limite de agentes do plano', 'plano');
reset role; update public.planos set limite_agentes = null, limite_impressoras_conectadas = 1;
insert into public.impressoras(empresa_id, nome) values ((select v from mo where k = 'ea'), 'Klipper');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$update public.impressoras set conexao_tipo = 'moonraker', dispositivo_id = 'voron-24' where nome = 'Klipper'$$, 'MON limite de impressoras conectadas', 'plano');
reset role; update public.planos set limite_impressoras_conectadas = null;
-- 3. revogação e desconexão
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.desconectar_impressora((select v from mo where k = 'imp'));
reset role;
select pg_temp.ok((select dispositivo_id is null and conexao_tipo = 'nenhuma' from public.impressoras where id = (select v from mo where k = 'imp'))
  and (select count(*) = 0 from public.impressora_telemetria) and (select count(*) > 0 from public.impressora_eventos_integracao), 'MON desconectar mantém o histórico');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.revogar_agente((select id from public.agentes_locais where nome = 'PC da oficina'));
reset role; update public.agentes_locais set ultimo_contato = now() - interval '1 minute';
set role anon;
select pg_temp.falha($$select public.agente_reportar((select t from mt where k = 'tok'), '{}')$$, 'MON agente revogado não envia', 'revogado');
reset role;
\echo MONITORAMENTO OK
