-- Testes do Super Admin: configurações, avisos, suporte, relatórios e integrações
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role; reset request.jwt.claim.sub;
create temp table pl(k text primary key, v uuid); grant all on pl to authenticated, anon;
insert into pl select 'ea', id from public.empresas where nome = 'Loja A';
insert into pl select 'eb', id from public.empresas where nome = 'Loja B';
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000f3', 'adm@plataforma.test') on conflict (id) do nothing;
insert into public.equipe_plataforma(user_id, nome, papel) values ('00000000-0000-0000-0000-0000000000f3', 'Ana Admin', 'administrador') on conflict (user_id) do update set papel = excluded.papel, ativo = true;
-- f2 = suporte (financeiro.sql), f1 = financeiro

-- ===== configurações =====
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.falha($$select public.admin_salvar_configuracao('{"manutencao_ativa": true}')$$, 'PL suporte não altera configurações', 'proprietário ou administrador');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
select public.admin_salvar_configuracao('{"nome_plataforma": "MRV3D", "email_suporte": "ajuda@mrv3d.tech", "whatsapp_suporte": "(54) 99999-0000", "manutencao_ativa": true, "manutencao_mensagem": "Atualização às 22h"}');
select pg_temp.falha($$select public.admin_salvar_configuracao('{"url_termos": "http://inseguro.com"}')$$, 'PL links só https', 'check');
set role anon; reset request.jwt.claim.sub;
select pg_temp.ok((select p->>'whatsapp_suporte' = '54999990000' and (p->>'manutencao')::boolean and p->>'manutencao_mensagem' = 'Atualização às 22h' from (select public.plataforma_publica() p) x), 'PL lojas e visitantes veem contato e manutenção');
select pg_temp.falha($$select * from public.configuracao_plataforma$$, 'PL visitante não lê a tabela', 'permission denied');
reset role;
select pg_temp.ok((select count(*) > 0 from public.auditoria where acao = 'configuracao_plataforma'), 'PL mudança de configuração auditada');

-- ===== avisos =====
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha($$insert into public.avisos_plataforma(titulo, texto) values ('hack', 'loja não publica aviso')$$, 'PL loja não publica aviso', 'row-level security');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
insert into public.avisos_plataforma(titulo, texto, nivel) values ('Manutenção hoje', 'O sistema fica fora do ar às 22h', 'alerta');
insert into public.avisos_plataforma(titulo, texto, alvo, empresa_id) values ('Só para a Loja B', 'Aviso direcionado', 'empresa', (select v from pl where k = 'eb'));
insert into public.avisos_plataforma(titulo, texto, inicio) values ('Futuro', 'Ainda não começou', now() + interval '1 day');
select pg_temp.falha($$insert into public.avisos_plataforma(titulo, texto, link) values ('x', 'link perigoso', 'javascript:alert(1)')$$, 'PL link do aviso validado', 'check');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(public.minhas_notificacoes((select v from pl where k = 'ea'))) n where n->>'tipo' = 'plataforma' and n->>'titulo' = 'Manutenção hoje'),
  'PL Loja A recebe só o aviso geral já iniciado');
select pg_temp.ok((select count(*) = 0 from public.avisos_plataforma), 'PL loja não lê a tabela de avisos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(public.minhas_notificacoes((select v from pl where k = 'eb'))) n where n->>'tipo' = 'plataforma'), 'PL Loja B recebe o geral e o direcionado');
select pg_temp.falha(format($$select public.minhas_notificacoes(%L)$$, (select v from pl where k = 'ea')), 'PL B não vê notificações da A', 'Sem acesso');

-- ===== suporte =====
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into pl values ('ch', public.abrir_chamado((select v from pl where k = 'ea'), 'Erro ao importar', 'problema', 'urgente', 'O arquivo não abre'));
select pg_temp.ok((select prioridade = 'normal' and status = 'aberto' from public.chamados where id = (select v from pl where k = 'ch')), 'PL loja não marca urgente sozinha');
select pg_temp.falha(format($$select public.abrir_chamado(%L, 'x', 'duvida', 'normal', 'outra loja')$$, (select v from pl where k = 'eb')), 'PL não abre chamado por outra loja', 'não encontrada');
select pg_temp.falha(format($$select public.responder_chamado(%L, 'nota', true)$$, (select v from pl where k = 'ch')), 'PL loja não escreve nota interna', 'só da equipe');
select pg_temp.falha(format($$select public.mudar_chamado(%L, 'fechado')$$, (select v from pl where k = 'ch')), 'PL loja não fecha pelo suporte', 'não permitida');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) = 0 from public.chamados), 'PL Loja B não vê chamados da A');
select pg_temp.falha(format($$select public.responder_chamado(%L, 'intrometido')$$, (select v from pl where k = 'ch')), 'PL Loja B não responde chamado da A', 'não encontrado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select public.responder_chamado((select v from pl where k = 'ch'), 'Só para a equipe: verificar logs', true);
select public.responder_chamado((select v from pl where k = 'ch'), 'Pode mandar o arquivo de novo?');
select public.mudar_chamado((select v from pl where k = 'ch'), null, 'alta', true);
select pg_temp.ok((select status = 'aguardando_cliente' and prioridade = 'alta' and atribuido_a = '00000000-0000-0000-0000-0000000000f2' and ultima_mensagem_de = 'plataforma'
  from public.chamados where id = (select v from pl where k = 'ch')), 'PL resposta da equipe muda situação e atribui');
select pg_temp.ok((select count(*) = 1 and bool_and(atribuido = 'Suporte') from public.admin_chamados('abertos')), 'PL equipe lista chamados abertos');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.falha($$select * from public.admin_chamados()$$, 'PL financeiro não entra no suporte', 'restrito');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) = 2 and bool_and(not interno) from public.chamado_mensagens), 'PL loja não vê a nota interna');
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(public.minhas_notificacoes((select v from pl where k = 'ea'))) n where n->>'tipo' = 'suporte'), 'PL loja é avisada da resposta');
select public.responder_chamado((select v from pl where k = 'ch'), 'Enviei de novo');
select public.mudar_chamado((select v from pl where k = 'ch'), 'resolvido');
select public.mudar_chamado((select v from pl where k = 'ch'), null, null, false, 5);
select pg_temp.ok((select status = 'resolvido' and avaliacao = 5 and resolvido_em is not null from public.chamados where id = (select v from pl where k = 'ch')), 'PL loja resolve e avalia');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f2';
select public.mudar_chamado((select v from pl where k = 'ch'), 'fechado');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha(format($$select public.responder_chamado(%L, 'mais uma')$$, (select v from pl where k = 'ch')), 'PL chamado fechado não recebe resposta', 'fechado');
reset role; update public.configuracao_plataforma set limite_chamados_dia = 1;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.falha(format($$select public.abrir_chamado(%L, 'spam', 'duvida', 'normal', 'de novo')$$, (select v from pl where k = 'ea')), 'PL limite de chamados por dia', 'Limite');

-- ===== relatórios e integrações =====
select pg_temp.falha($$select public.admin_relatorios(12)$$, 'PL loja não vê relatórios da plataforma', 'restrito');
select pg_temp.falha($$select public.admin_integracoes()$$, 'PL loja não vê integrações da plataforma', 'administrador');
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f3';
create temp table pr as select public.admin_relatorios(6) as r;
select pg_temp.ok((select (r#>>'{totais,empresas}')::int >= 2 and jsonb_array_length(r->'mensal') = 6 and (r#>>'{funil,cadastradas}')::int >= 2 from pr), 'PL relatórios: totais, série e funil');
select pg_temp.ok((select (public.admin_integracoes()->>'agentes_ativos') is not null), 'PL integrações: situação');
select pg_temp.ok((select count(*) = 1 from public.admin_buscar_empresas('loja b')), 'PL busca de empresa');
reset role;
\echo PLATAFORMA OK
