-- Super Admin: Configurações, Notificações (avisos às lojas), Suporte (chamados), Relatórios e Integrações.
-- Princípio: a equipe da plataforma vê contagens e o que a loja escreve no chamado; nunca clientes, valores ou arquivos das lojas.

-- =========================== CONFIGURAÇÕES ===========================
create table if not exists public.configuracao_plataforma (
  id int primary key default 1 check (id = 1),
  nome_plataforma text not null default 'MRV3D' check (length(nome_plataforma) between 2 and 80),
  email_suporte text check (email_suporte is null or (length(email_suporte) <= 150 and email_suporte ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  whatsapp_suporte text check (whatsapp_suporte is null or whatsapp_suporte ~ '^[0-9]{10,13}$'),
  horario_suporte text check (length(horario_suporte) <= 120),
  url_termos text check (url_termos is null or (length(url_termos) <= 300 and url_termos ~* '^https://')),
  url_privacidade text check (url_privacidade is null or (length(url_privacidade) <= 300 and url_privacidade ~* '^https://')),
  manutencao_ativa boolean not null default false,
  manutencao_mensagem text check (length(manutencao_mensagem) <= 500),
  limite_chamados_dia int not null default 10 check (limite_chamados_dia between 1 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.configuracao_plataforma(id) values (1) on conflict (id) do nothing;
alter table public.configuracao_plataforma enable row level security;
revoke all on public.configuracao_plataforma from anon, authenticated;
grant select on public.configuracao_plataforma to authenticated;
drop policy if exists cfgplat_ler on public.configuracao_plataforma;
create policy cfgplat_ler on public.configuracao_plataforma for select using (private.is_admin_plataforma());

-- o que as lojas (e a tela de login) podem saber: contato do suporte e aviso de manutenção
create or replace function public.plataforma_publica()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', nome_plataforma, 'email_suporte', email_suporte, 'whatsapp_suporte', whatsapp_suporte, 'horario_suporte', horario_suporte,
    'url_termos', url_termos, 'url_privacidade', url_privacidade, 'manutencao', manutencao_ativa, 'manutencao_mensagem', case when manutencao_ativa then manutencao_mensagem end)
  from public.configuracao_plataforma where id = 1
$$;

create or replace function public.admin_salvar_configuracao(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare antes jsonb;
begin
  if not private.tem_papel('proprietario', 'administrador') then raise exception 'Só proprietário ou administrador altera as configurações'; end if;
  select to_jsonb(c) - 'updated_at' - 'updated_by' into antes from public.configuracao_plataforma c where id = 1;
  update public.configuracao_plataforma set
    nome_plataforma = coalesce(nullif(trim(p->>'nome_plataforma'), ''), nome_plataforma),
    email_suporte = nullif(trim(p->>'email_suporte'), ''),
    whatsapp_suporte = nullif(regexp_replace(coalesce(p->>'whatsapp_suporte', ''), '\D', '', 'g'), ''),
    horario_suporte = nullif(trim(p->>'horario_suporte'), ''),
    url_termos = nullif(trim(p->>'url_termos'), ''),
    url_privacidade = nullif(trim(p->>'url_privacidade'), ''),
    manutencao_ativa = coalesce((p->>'manutencao_ativa')::boolean, false),
    manutencao_mensagem = nullif(trim(p->>'manutencao_mensagem'), ''),
    limite_chamados_dia = coalesce((p->>'limite_chamados_dia')::int, limite_chamados_dia),
    updated_at = now(), updated_by = (select auth.uid())
  where id = 1;
  perform private.registrar_auditoria('configuracao_plataforma', 'configuracao_plataforma', '1', null,
    jsonb_build_object('antes', antes, 'depois', (select to_jsonb(c) - 'updated_at' - 'updated_by' from public.configuracao_plataforma c where id = 1)));
end; $$;

-- =========================== NOTIFICAÇÕES (avisos) ===========================
create table if not exists public.avisos_plataforma (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(titulo) between 3 and 120),
  texto text not null check (length(texto) between 3 and 1000),
  nivel text not null default 'info' check (nivel in ('info','alerta','erro','sucesso')),
  link text check (link is null or (length(link) <= 300 and (link ~ '^/[A-Za-z0-9/_?=&.-]*$' or link ~* '^https://'))),
  alvo text not null default 'todas' check (alvo in ('todas','plano','empresa','status')),
  plano_id uuid references public.planos(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete cascade,
  status_assinatura public.status_assinatura,
  inicio timestamptz not null default now(),
  fim timestamptz,
  ativo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint aviso_alvo check ((alvo = 'todas') or (alvo = 'plano' and plano_id is not null) or (alvo = 'empresa' and empresa_id is not null) or (alvo = 'status' and status_assinatura is not null)),
  constraint aviso_periodo check (fim is null or fim > inicio)
);
create index if not exists avisos_ativos_idx on public.avisos_plataforma(inicio desc) where ativo;
alter table public.avisos_plataforma enable row level security;
revoke all on public.avisos_plataforma from anon, authenticated;
grant select, insert, update, delete on public.avisos_plataforma to authenticated;
drop policy if exists avisos_ler on public.avisos_plataforma;
drop policy if exists avisos_escrever on public.avisos_plataforma;
create policy avisos_ler on public.avisos_plataforma for select using (private.is_admin_plataforma());
create policy avisos_escrever on public.avisos_plataforma for all using (private.tem_papel('proprietario', 'administrador', 'suporte'))
  with check (private.tem_papel('proprietario', 'administrador', 'suporte'));

create or replace function private.aviso_auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.registrar_auditoria('aviso_' || lower(tg_op), 'avisos_plataforma', coalesce(new.id, old.id)::text, coalesce(new.empresa_id, old.empresa_id),
    jsonb_build_object('titulo', coalesce(new.titulo, old.titulo), 'alvo', coalesce(new.alvo, old.alvo), 'ativo', coalesce(new.ativo, old.ativo)));
  return null;
end; $$;
drop trigger if exists trg_aviso_auditar on public.avisos_plataforma;
create trigger trg_aviso_auditar after insert or update or delete on public.avisos_plataforma for each row execute function private.aviso_auditar();

-- avisos que valem para uma empresa agora
create or replace function private.avisos_da_empresa(p_empresa uuid) returns setof public.avisos_plataforma
language sql stable security definer set search_path = '' as $$
  select v.* from public.avisos_plataforma v
   where v.ativo and v.inicio <= now() and (v.fim is null or v.fim > now())
     and (v.alvo = 'todas'
          or (v.alvo = 'empresa' and v.empresa_id = p_empresa)
          or (v.alvo = 'plano' and exists (select 1 from public.assinaturas a where a.empresa_id = p_empresa and a.plano_id = v.plano_id and a.status <> 'cancelada'))
          or (v.alvo = 'status' and exists (select 1 from public.assinaturas a where a.empresa_id = p_empresa and a.status = v.status_assinatura)))
   order by v.inicio desc limit 20
$$;
revoke all on function private.avisos_da_empresa(uuid) from public, anon, authenticated;

-- =========================== SUPORTE (chamados) ===========================
create table if not exists public.chamados (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  assunto text not null check (length(assunto) between 3 and 150),
  categoria text not null default 'duvida' check (categoria in ('duvida','problema','financeiro','sugestao','outro')),
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status text not null default 'aberto' check (status in ('aberto','em_atendimento','aguardando_cliente','resolvido','fechado')),
  aberto_por uuid references auth.users(id) on delete set null,
  atribuido_a uuid references auth.users(id) on delete set null,
  ultima_mensagem_em timestamptz not null default now(),
  ultima_mensagem_de text not null default 'loja' check (ultima_mensagem_de in ('loja','plataforma')),
  resolvido_em timestamptz,
  avaliacao int check (avaliacao between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chamados_empresa_idx on public.chamados(empresa_id, ultima_mensagem_em desc);
create index if not exists chamados_status_idx on public.chamados(status, ultima_mensagem_em desc);
create table if not exists public.chamado_mensagens (
  id bigserial primary key,
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  autor_tipo text not null check (autor_tipo in ('loja','plataforma')),
  autor_nome text check (length(autor_nome) <= 120),
  texto text not null check (length(texto) between 1 and 5000),
  interno boolean not null default false,  -- nota da equipe: a loja não vê
  created_at timestamptz not null default now(),
  constraint msg_interna_so_plataforma check (not interno or autor_tipo = 'plataforma')
);
create index if not exists chamado_msg_idx on public.chamado_mensagens(chamado_id, id);
alter table public.chamados enable row level security;
alter table public.chamado_mensagens enable row level security;
revoke all on public.chamados, public.chamado_mensagens from anon, authenticated;
grant select on public.chamados, public.chamado_mensagens to authenticated;
drop policy if exists chamados_ler on public.chamados;
drop policy if exists chamado_msg_ler on public.chamado_mensagens;
create policy chamados_ler on public.chamados for select
  using (private.tem_papel('proprietario', 'administrador', 'suporte', 'atendimento') or private.is_membro(empresa_id));
create policy chamado_msg_ler on public.chamado_mensagens for select
  using (private.tem_papel('proprietario', 'administrador', 'suporte', 'atendimento')
         or (not interno and exists (select 1 from public.chamados c where c.id = chamado_id and private.is_membro(c.empresa_id))));

create or replace function private.nome_usuario() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nome from public.equipe_plataforma where user_id = (select auth.uid()) and ativo),
                  (select split_part(email, '@', 1) from auth.users where id = (select auth.uid())), 'Usuário')
$$;
revoke all on function private.nome_usuario() from public, anon, authenticated;

create or replace function public.abrir_chamado(p_empresa uuid, p_assunto text, p_categoria text, p_prioridade text, p_texto text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_lim int := (select limite_chamados_dia from public.configuracao_plataforma where id = 1);
begin
  if not private.is_membro(p_empresa) then raise exception 'Empresa não encontrada'; end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'Descreva o que aconteceu'; end if;
  perform pg_advisory_xact_lock(hashtext('chamado:' || p_empresa::text));
  if (select count(*) from public.chamados where empresa_id = p_empresa and created_at > now() - interval '1 day') >= coalesce(v_lim, 10) then
    raise exception 'Limite de chamados por dia atingido. Responda num chamado já aberto.';
  end if;
  insert into public.chamados(empresa_id, assunto, categoria, prioridade, aberto_por)
  values (p_empresa, left(trim(p_assunto), 150), coalesce(nullif(p_categoria, ''), 'duvida'),
          case when p_prioridade in ('baixa','normal','alta') then p_prioridade else 'normal' end, (select auth.uid()))  -- "urgente" só a equipe marca
  returning id into v_id;
  insert into public.chamado_mensagens(chamado_id, autor_id, autor_tipo, autor_nome, texto) values (v_id, (select auth.uid()), 'loja', private.nome_usuario(), trim(p_texto));
  return v_id;
end; $$;

create or replace function public.responder_chamado(p_chamado uuid, p_texto text, p_interno boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chamados; v_equipe boolean := private.tem_papel('proprietario', 'administrador', 'suporte', 'atendimento'); v_tipo text;
begin
  select * into c from public.chamados where id = p_chamado for update;
  if c.id is null or not (v_equipe or private.is_membro(c.empresa_id)) then raise exception 'Chamado não encontrado'; end if;
  if length(trim(coalesce(p_texto, ''))) < 1 then raise exception 'Escreva a mensagem'; end if;
  if c.status = 'fechado' then raise exception 'Chamado fechado: abra um novo'; end if;
  -- quem é membro de uma loja e também da equipe responde como plataforma
  v_tipo := case when v_equipe then 'plataforma' else 'loja' end;
  if coalesce(p_interno, false) and v_tipo <> 'plataforma' then raise exception 'Nota interna é só da equipe'; end if;
  if (select count(*) from public.chamado_mensagens where autor_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Muitas mensagens em pouco tempo: aguarde um pouco';
  end if;
  insert into public.chamado_mensagens(chamado_id, autor_id, autor_tipo, autor_nome, texto, interno)
  values (c.id, (select auth.uid()), v_tipo, private.nome_usuario(), trim(p_texto), coalesce(p_interno, false));
  if not coalesce(p_interno, false) then
    update public.chamados set ultima_mensagem_em = now(), ultima_mensagem_de = v_tipo, updated_at = now(),
      status = case when v_tipo = 'plataforma' then case when status in ('aberto','em_atendimento') then 'aguardando_cliente' else status end
                    else case when status in ('aguardando_cliente','resolvido') then 'aberto' else status end end,
      resolvido_em = case when v_tipo = 'loja' and status = 'resolvido' then null else resolvido_em end,
      atribuido_a = case when v_tipo = 'plataforma' then coalesce(atribuido_a, (select auth.uid())) else atribuido_a end
    where id = c.id;
  end if;
end; $$;

create or replace function public.mudar_chamado(p_chamado uuid, p_status text, p_prioridade text default null, p_atribuir_a_mim boolean default false, p_avaliacao int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chamados; v_equipe boolean := private.tem_papel('proprietario', 'administrador', 'suporte', 'atendimento');
begin
  select * into c from public.chamados where id = p_chamado for update;
  if c.id is null or not (v_equipe or private.is_membro(c.empresa_id)) then raise exception 'Chamado não encontrado'; end if;
  if not v_equipe then
    -- a loja só marca como resolvido, reabre e avalia
    if p_status is not null and p_status not in ('resolvido','aberto') then raise exception 'Ação não permitida'; end if;
    if p_prioridade is not null or p_atribuir_a_mim then raise exception 'Ação não permitida'; end if;
    if p_avaliacao is not null and c.status not in ('resolvido','fechado') then raise exception 'Avalie depois que o chamado for resolvido'; end if;
  elsif p_avaliacao is not null then raise exception 'A avaliação é da loja';
  end if;
  if p_status is not null and p_status not in ('aberto','em_atendimento','aguardando_cliente','resolvido','fechado') then raise exception 'Situação inválida'; end if;
  if p_prioridade is not null and p_prioridade not in ('baixa','normal','alta','urgente') then raise exception 'Prioridade inválida'; end if;
  if p_avaliacao is not null and p_avaliacao not between 1 and 5 then raise exception 'Avaliação de 1 a 5'; end if;
  update public.chamados set status = coalesce(p_status, status), prioridade = coalesce(p_prioridade, prioridade),
    atribuido_a = case when p_atribuir_a_mim then (select auth.uid()) else atribuido_a end,
    avaliacao = coalesce(p_avaliacao, avaliacao),
    resolvido_em = case when coalesce(p_status, status) in ('resolvido','fechado') then coalesce(resolvido_em, now()) else null end,
    updated_at = now()
  where id = c.id;
end; $$;

-- lista para a equipe (com nome da empresa e de quem atende)
create or replace function public.admin_chamados(p_status text default null)
returns table(id uuid, numero bigint, empresa_id uuid, empresa text, assunto text, categoria text, prioridade text, status text, atribuido text,
              ultima_mensagem_em timestamptz, ultima_mensagem_de text, mensagens bigint, created_at timestamptz, avaliacao int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.tem_papel('proprietario', 'administrador', 'suporte', 'atendimento') then raise exception 'Acesso restrito ao suporte da plataforma'; end if;
  return query
  select c.id, c.numero, c.empresa_id, e.nome, c.assunto, c.categoria, c.prioridade, c.status,
         (select coalesce(ep.nome, split_part(u.email, '@', 1)) from auth.users u left join public.equipe_plataforma ep on ep.user_id = u.id where u.id = c.atribuido_a),
         c.ultima_mensagem_em, c.ultima_mensagem_de, (select count(*) from public.chamado_mensagens m where m.chamado_id = c.id and not m.interno), c.created_at, c.avaliacao
    from public.chamados c join public.empresas e on e.id = c.empresa_id
   where p_status is null or c.status = p_status or (p_status = 'abertos' and c.status in ('aberto','em_atendimento','aguardando_cliente'))
   order by case c.prioridade when 'urgente' then 0 when 'alta' then 1 else 2 end, c.ultima_mensagem_em desc
   limit 500;
end; $$;

-- =========================== Central de notificações das lojas ===========================
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'minhas_notificacoes_monitor') then
    alter function public.minhas_notificacoes(uuid) rename to minhas_notificacoes_monitor;
  end if;
end $$;
create or replace function public.minhas_notificacoes(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := public.minhas_notificacoes_monitor(p_empresa);
begin
  if not private.is_membro(p_empresa) then return r; end if;
  -- avisos da plataforma
  r := coalesce((select jsonb_agg(jsonb_build_object('id', 'aviso-' || v.id, 'tipo', 'plataforma', 'nivel', v.nivel, 'titulo', v.titulo, 'texto', v.texto, 'link', coalesce(v.link, '/dashboard/')))
                   from private.avisos_da_empresa(p_empresa) v), '[]'::jsonb) || r;
  -- resposta do suporte esperando a loja
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'chamado-' || c.id || '-' || to_char(c.ultima_mensagem_em, 'YYYYMMDDHH24MISS'), 'tipo', 'suporte', 'nivel', 'info',
            'titulo', 'Resposta do suporte', 'texto', '#' || c.numero || ' · ' || c.assunto, 'link', '/suporte/?id=' || c.id))
           from public.chamados c where c.empresa_id = p_empresa and c.ultima_mensagem_de = 'plataforma' and c.status in ('aguardando_cliente','em_atendimento','resolvido')
             and c.ultima_mensagem_em > now() - interval '7 days'), '[]'::jsonb);
  return r;
end; $$;
revoke all on function public.minhas_notificacoes_monitor(uuid) from public, anon, authenticated;

-- =========================== RELATÓRIOS ===========================
-- crescimento, ativação, retenção por safra e uso por plano (contagens, sem dados de clientes ou valores das lojas)
create or replace function public.admin_relatorios(p_meses int default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_meses int := least(greatest(coalesce(p_meses, 12), 3), 36);
  v_ini date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  return (
  with meses as (select generate_series(v_ini - make_interval(months => v_meses - 1), v_ini, interval '1 month')::date as mes),
  emp as (
    select e.id, e.nome, e.status, e.created_at, date_trunc('month', e.created_at at time zone 'America/Sao_Paulo')::date as safra,
      (select a.status from public.assinaturas a where a.empresa_id = e.id order by a.created_at desc limit 1) as status_assinatura,
      (select p.nome from public.assinaturas a join public.planos p on p.id = a.plano_id where a.empresa_id = e.id order by a.created_at desc limit 1) as plano,
      (select a.cancelada_em from public.assinaturas a where a.empresa_id = e.id order by a.created_at desc limit 1) as cancelada_em,
      exists (select 1 from public.impressoras i where i.empresa_id = e.id) as tem_impressora,
      exists (select 1 from public.materiais m where m.empresa_id = e.id) as tem_material,
      exists (select 1 from public.orcamentos o where o.empresa_id = e.id) as tem_orcamento,
      exists (select 1 from public.pedidos p where p.empresa_id = e.id) as tem_pedido,
      (select min(o.created_at) from public.orcamentos o where o.empresa_id = e.id) as primeiro_orcamento,
      (select count(*) from public.membros m where m.empresa_id = e.id and m.ativo) as usuarios,
      (select count(*) from public.impressoras i where i.empresa_id = e.id and i.status <> 'inativa') as impressoras,
      (select count(*) from public.pedidos p where p.empresa_id = e.id and p.created_at > now() - interval '30 days') as pedidos_30d,
      (select count(*) from public.orcamentos o where o.empresa_id = e.id and o.created_at > now() - interval '30 days') as orcamentos_30d,
      greatest((select max(u.last_sign_in_at) from public.membros m join auth.users u on u.id = m.user_id where m.empresa_id = e.id), e.created_at) as ultimo_acesso
    from public.empresas e
  )
  select jsonb_build_object(
    'totais', jsonb_build_object('empresas', (select count(*) from emp), 'ativas_30d', (select count(*) from emp where ultimo_acesso > now() - interval '30 days'),
      'sem_acesso_14d', (select count(*) from emp where ultimo_acesso <= now() - interval '14 days' and status not in ('cancelada','suspensa')),
      'ativadas', (select count(*) from emp where tem_orcamento or tem_pedido),
      'tempo_ate_1o_orcamento_dias', (select round(avg(extract(epoch from primeiro_orcamento - created_at) / 86400)::numeric, 1) from emp where primeiro_orcamento is not null)),
    'funil', jsonb_build_object('cadastradas', (select count(*) from emp), 'impressora', (select count(*) from emp where tem_impressora),
      'material', (select count(*) from emp where tem_material), 'orcamento', (select count(*) from emp where tem_orcamento), 'pedido', (select count(*) from emp where tem_pedido),
      'pagante', (select count(*) from emp where status_assinatura in ('ativa','pendente','atrasada'))),
    'mensal', (select jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'),
        'novas', (select count(*) from emp where safra = m.mes),
        'ativadas', (select count(*) from emp where date_trunc('month', primeiro_orcamento at time zone 'America/Sao_Paulo') = m.mes),
        'canceladas', (select count(*) from emp where date_trunc('month', cancelada_em at time zone 'America/Sao_Paulo') = m.mes),
        'total_fim_mes', (select count(*) from emp where created_at < (m.mes + interval '1 month') and (cancelada_em is null or cancelada_em >= m.mes + interval '1 month'))
      ) order by m.mes) from meses m),
    'safras', (select coalesce(jsonb_agg(jsonb_build_object('safra', to_char(safra, 'YYYY-MM'), 'empresas', n, 'ainda_ativas', ativas, 'pagantes', pagantes,
                 'retencao_pct', round(ativas * 100.0 / nullif(n, 0), 1)) order by safra desc), '[]')
                 from (select safra, count(*) as n, count(*) filter (where status not in ('cancelada','suspensa') and coalesce(status_assinatura::text, '') <> 'cancelada') as ativas,
                              count(*) filter (where status_assinatura in ('ativa','pendente','atrasada')) as pagantes
                         from emp where safra >= v_ini - make_interval(months => v_meses - 1) group by safra) s),
    'por_plano', (select coalesce(jsonb_agg(jsonb_build_object('plano', coalesce(plano, 'Sem plano'), 'empresas', n, 'usuarios_media', u, 'impressoras_media', i,
                   'pedidos_30d_media', pd, 'orcamentos_30d_media', oc) order by n desc), '[]')
                   from (select plano, count(*) as n, round(avg(usuarios), 1) as u, round(avg(impressoras), 1) as i, round(avg(pedidos_30d), 1) as pd, round(avg(orcamentos_30d), 1) as oc
                           from emp where status not in ('cancelada') group by plano) s),
    'em_risco', (select coalesce(jsonb_agg(jsonb_build_object('empresa_id', id, 'empresa', nome, 'plano', plano, 'status_assinatura', status_assinatura, 'ultimo_acesso', ultimo_acesso,
                   'pedidos_30d', pedidos_30d) order by ultimo_acesso), '[]')
                   from (select * from emp where status not in ('cancelada','suspensa') and ultimo_acesso <= now() - interval '14 days' order by ultimo_acesso limit 100) s)
  ));
end; $$;

-- =========================== INTEGRAÇÕES (situação) ===========================
create or replace function public.admin_integracoes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_versao text;
begin
  if not private.tem_papel('proprietario', 'administrador') then raise exception 'Só proprietário ou administrador'; end if;
  if to_regclass('private._migracoes') is not null then execute 'select max(nome) from private._migracoes' into v_versao; end if;
  return jsonb_build_object(
    'agentes_ativos', (select count(*) from public.agentes_locais where ativo),
    'agentes_online', (select count(*) from public.agentes_locais where ativo and ultimo_contato > now() - interval '5 minutes'),
    'empresas_com_agente', (select count(distinct empresa_id) from public.agentes_locais where ativo),
    'impressoras_por_conexao', (select coalesce(jsonb_object_agg(conexao_tipo, n), '{}') from (select conexao_tipo, count(*) as n from public.impressoras where conexao_tipo <> 'nenhuma' group by conexao_tipo) s),
    'versoes_agente', (select coalesce(jsonb_object_agg(coalesce(versao, '?'), n), '{}') from (select versao, count(*) as n from public.agentes_locais where ativo group by versao) s),
    'erros_integracao_7d', (select count(*) from public.integracao_eventos where tipo = 'erro' and created_at > now() - interval '7 days'),
    'faturas_com_gateway', (select count(*) from public.faturas where gateway is not null),
    'gateways', (select coalesce(jsonb_agg(distinct gateway), '[]') from public.faturas where gateway is not null),
    'armazenamento_mb', (select round(coalesce(sum((metadata->>'size')::numeric), 0) / 1048576, 1) from storage.objects where bucket_id = 'empresa'),
    'versao_banco', v_versao
  );
end; $$;

-- busca de empresa para avisos direcionados
create or replace function public.admin_buscar_empresas(p_busca text)
returns table(id uuid, nome text, status public.status_empresa)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  return query select e.id, e.nome, e.status from public.empresas e
   where length(trim(coalesce(p_busca, ''))) >= 2 and e.nome ilike '%' || replace(replace(trim(p_busca), '%', ''), '_', '') || '%'
   order by e.nome limit 20;
end; $$;
revoke all on function public.admin_buscar_empresas(text) from public, anon;
grant execute on function public.admin_buscar_empresas(text) to authenticated;

-- =========================== permissões ===========================
revoke all on function public.admin_salvar_configuracao(jsonb), public.abrir_chamado(uuid, text, text, text, text), public.responder_chamado(uuid, text, boolean),
  public.mudar_chamado(uuid, text, text, boolean, int), public.admin_chamados(text), public.admin_relatorios(int), public.admin_integracoes(), public.minhas_notificacoes(uuid) from public, anon;
grant execute on function public.admin_salvar_configuracao(jsonb), public.abrir_chamado(uuid, text, text, text, text), public.responder_chamado(uuid, text, boolean),
  public.mudar_chamado(uuid, text, text, boolean, int), public.admin_chamados(text), public.admin_relatorios(int), public.admin_integracoes(), public.minhas_notificacoes(uuid) to authenticated;
grant execute on function public.plataforma_publica() to anon, authenticated;
