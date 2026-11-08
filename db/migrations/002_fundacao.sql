-- =====================================================================
-- FASE 1 — Fundação: permissões granulares, configurações da empresa,
-- limites do plano, numeração, auditoria da empresa, solicitações de assinatura
-- =====================================================================

-- ---------- Permissões por perfil -------------------------------------
-- Códigos de permissão usados no banco e no painel:
--  clientes_ver clientes_editar orcamentos_ver orcamentos_criar descontos_aprovar
--  pedidos_ver pedidos_editar producao_gerenciar impressoras_ver impressoras_editar
--  materia_ver materia_editar materia_movimentar produtos_ver produtos_editar
--  custos_ver financeiro_ver compras_gerenciar relatorios_ver usuarios_admin
--  integracoes_config config_editar expedicao_gerenciar
create or replace function private.permissoes_papel(p public.papel_membro)
returns text[] language sql immutable set search_path = '' as $$
  select case p::text
    when 'dono'       then array['*']
    when 'admin'      then array['*']
    when 'comercial'  then array['clientes_ver','clientes_editar','orcamentos_ver','orcamentos_criar','pedidos_ver','pedidos_editar',
                                 'produtos_ver','materia_ver','impressoras_ver','custos_ver']
    when 'producao'   then array['clientes_ver','orcamentos_ver','pedidos_ver','producao_gerenciar','impressoras_ver','impressoras_editar',
                                 'materia_ver','materia_movimentar','produtos_ver']
    when 'estoque'    then array['materia_ver','materia_editar','materia_movimentar','produtos_ver','impressoras_ver','compras_gerenciar']
    when 'financeiro' then array['clientes_ver','orcamentos_ver','pedidos_ver','pedidos_editar','custos_ver','financeiro_ver',
                                 'compras_gerenciar','relatorios_ver','produtos_ver','materia_ver']
    when 'expedicao'  then array['clientes_ver','pedidos_ver','expedicao_gerenciar','produtos_ver']
    when 'operador'   then array['clientes_ver','clientes_editar','pedidos_ver','pedidos_editar','materia_ver','materia_movimentar',
                                 'produtos_ver','impressoras_ver','orcamentos_ver','orcamentos_criar']
    else array[]::text[] end;
$$;

alter table public.membros
  add column if not exists ativo boolean not null default true,
  add column if not exists permissoes_extra text[] not null default '{}',
  add column if not exists permissoes_removidas text[] not null default '{}';

create or replace function private.tem_permissao(p_empresa uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros m
     where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.ativo
       and (m.papel = 'dono' or not (p_perm = any(m.permissoes_removidas)))
       and ('*' = any(private.permissoes_papel(m.papel))
            or p_perm = any(private.permissoes_papel(m.papel))
            or p_perm = any(m.permissoes_extra)));
$$;

-- Permissão + empresa não suspensa/cancelada (para escrita)
create or replace function private.pode(p_empresa uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.tem_permissao(p_empresa, p_perm)
     and exists (select 1 from public.empresas where id = p_empresa and status not in ('suspensa','cancelada'));
$$;

-- is_membro passa a considerar só membros ativos
create or replace function private.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.ativo);
$$;
create or replace function private.is_admin(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.ativo and m.papel in ('dono','admin'));
$$;

-- O que o usuário logado pode fazer (para montar o menu)
create or replace function public.minhas_permissoes(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'papel', m.papel,
    'permissoes', case when '*' = any(private.permissoes_papel(m.papel)) then to_jsonb(array['*'])
                       else to_jsonb(array(select unnest(private.permissoes_papel(m.papel) || m.permissoes_extra)
                                           except select unnest(m.permissoes_removidas))) end,
    'empresa_status', e.status)
  from public.membros m join public.empresas e on e.id = m.empresa_id
  where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.ativo;
$$;

-- Empresas do usuário (seletor de empresa)
create or replace function public.minhas_empresas()
returns table(id uuid, nome text, papel public.papel_membro, status public.status_empresa)
language sql stable security definer set search_path = '' as $$
  select e.id, e.nome, m.papel, e.status from public.membros m join public.empresas e on e.id = m.empresa_id
   where m.user_id = (select auth.uid()) and m.ativo order by e.created_at;
$$;

-- ---------- Configurações da empresa (tenant_settings) -----------------
create table if not exists public.empresa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  logo_path text,
  energia_kwh numeric(10,4) not null default 0.95 check (energia_kwh >= 0),
  mao_obra_hora numeric(12,2) not null default 0 check (mao_obra_hora >= 0),
  margem_pct numeric(5,2) not null default 40 check (margem_pct >= 0 and margem_pct < 100),
  impostos_pct numeric(5,2) not null default 6 check (impostos_pct >= 0 and impostos_pct < 100),
  taxas_pct numeric(5,2) not null default 0 check (taxas_pct >= 0 and taxas_pct < 100),
  desperdicio_pct numeric(5,2) not null default 5 check (desperdicio_pct >= 0 and desperdicio_pct <= 200),
  custos_fixos_mensais numeric(12,2) not null default 0 check (custos_fixos_mensais >= 0),
  embalagem_padrao numeric(12,2) not null default 0 check (embalagem_padrao >= 0),
  desconto_livre_pct numeric(5,2) not null default 5 check (desconto_livre_pct >= 0 and desconto_livre_pct <= 100),
  moeda text not null default 'BRL',
  fuso text not null default 'America/Sao_Paulo',
  prefixo_pedido text not null default 'PED' check (length(prefixo_pedido) <= 10),
  prefixo_orcamento text not null default 'ORC' check (length(prefixo_orcamento) <= 10),
  prazo_padrao_dias integer not null default 7 check (prazo_padrao_dias between 0 and 365),
  validade_orcamento_dias integer not null default 15 check (validade_orcamento_dias between 1 and 365),
  msg_orcamento text not null default 'Olá {cliente}! Segue o orçamento {numero} da {empresa}, no valor de {total}. Para ver e aprovar: {link}',
  msg_pedido text not null default 'Olá {cliente}! Seu pedido {numero} foi registrado. Prazo previsto: {prazo}.',
  onboarding_etapa integer not null default 0,
  onboarding_concluido boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint config_percentuais_validos check (margem_pct + impostos_pct + taxas_pct < 100)
);
alter table public.empresa_config enable row level security;
drop trigger if exists trg_config_upd on public.empresa_config;
create trigger trg_config_upd before update on public.empresa_config for each row execute function public.set_updated_at();

create policy config_ler on public.empresa_config for select using (private.is_membro(empresa_id) or private.tem_acesso_suporte(empresa_id));
create policy config_alterar on public.empresa_config for update using (private.pode(empresa_id, 'config_editar')) with check (private.pode(empresa_id, 'config_editar'));

create or replace function private.criar_config_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin insert into public.empresa_config(empresa_id) values (new.id) on conflict do nothing; return new; end; $$;
drop trigger if exists trg_empresa_config on public.empresas;
create trigger trg_empresa_config after insert on public.empresas for each row execute function private.criar_config_empresa();
insert into public.empresa_config(empresa_id) select id from public.empresas on conflict do nothing;

-- Empresas: dados editáveis por quem pode configurar; RPC criar_empresa continua igual
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas for update
  using (private.pode(id, 'config_editar')) with check (private.pode(id, 'config_editar'));

-- Evita que o assinante altere status/assinatura pelo navegador
create or replace function private.proteger_campos_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and (select auth.uid()) is not null and not private.is_admin_plataforma() then
    raise exception 'O status da empresa só pode ser alterado pela plataforma';
  end if;
  return new;
end; $$;
drop trigger if exists trg_empresa_proteger on public.empresas;
create trigger trg_empresa_proteger before update on public.empresas for each row execute function private.proteger_campos_empresa();

-- ---------- Numeração automática por empresa --------------------------
create table if not exists public.contadores (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,
  ultimo bigint not null default 0,
  primary key (empresa_id, tipo)
);
alter table public.contadores enable row level security; -- sem políticas: só funções internas usam

create or replace function private.proximo_numero(p_empresa uuid, p_tipo text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.contadores(empresa_id, tipo, ultimo) values (p_empresa, p_tipo, 1)
  on conflict (empresa_id, tipo) do update set ultimo = public.contadores.ultimo + 1
  returning ultimo into v;
  return v;
end; $$;

-- pedidos: numeração automática a partir do maior número existente
insert into public.contadores(empresa_id, tipo, ultimo)
  select empresa_id, 'pedido', coalesce(max(numero), 0) from public.pedidos group by empresa_id
  on conflict (empresa_id, tipo) do update set ultimo = greatest(public.contadores.ultimo, excluded.ultimo);
create or replace function private.numerar_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.numero is null then new.numero := private.proximo_numero(new.empresa_id, 'pedido'); end if;
  return new;
end; $$;
drop trigger if exists trg_pedido_numero on public.pedidos;
create trigger trg_pedido_numero before insert on public.pedidos for each row execute function private.numerar_pedido();

-- ---------- Limites do plano ------------------------------------------
create or replace function private.plano_empresa(p_empresa uuid)
returns public.planos language sql stable security definer set search_path = '' as $$
  select p.* from public.assinaturas a join public.planos p on p.id = a.plano_id
   where a.empresa_id = p_empresa order by (a.status in ('ativa','teste','pendente','atrasada')) desc, a.created_at desc limit 1;
$$;

create or replace function private.checar_limite_usuarios() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int; v_qtd int;
begin
  if not new.ativo then return new; end if;
  if tg_op = 'UPDATE' and old.ativo then return new; end if;
  v_lim := (private.plano_empresa(new.empresa_id)).limite_usuarios;
  select count(*) into v_qtd from public.membros where empresa_id = new.empresa_id and ativo and user_id <> new.user_id;
  if v_lim is not null and v_qtd >= v_lim then
    raise exception 'Seu plano permite até % usuário(s). Faça upgrade em Minha Assinatura.', v_lim;
  end if;
  return new;
end; $$;
drop trigger if exists trg_membros_limite on public.membros;
create trigger trg_membros_limite before insert or update of ativo on public.membros for each row execute function private.checar_limite_usuarios();

-- ---------- Equipe (somente por funções) ------------------------------
drop policy if exists membros_insert on public.membros;
drop policy if exists membros_update on public.membros;
drop policy if exists membros_delete on public.membros;

create or replace function public.equipe_listar(p_empresa uuid)
returns table(user_id uuid, email text, papel public.papel_membro, ativo boolean, permissoes_extra text[], permissoes_removidas text[], desde timestamptz, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_membro(p_empresa) then raise exception 'Sem acesso'; end if;
  return query select m.user_id, u.email::text, m.papel, m.ativo, m.permissoes_extra, m.permissoes_removidas, m.created_at, u.last_sign_in_at
    from public.membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa order by m.created_at;
end; $$;

create or replace function public.equipe_adicionar(p_empresa uuid, p_email text, p_papel public.papel_membro)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not private.pode(p_empresa, 'usuarios_admin') then raise exception 'Você não tem permissão para administrar usuários'; end if;
  if p_papel = 'dono' then raise exception 'Só existe um proprietário por empresa'; end if;
  if p_papel = 'admin' and not private.is_admin(p_empresa) then raise exception 'Só o proprietário ou um administrador pode criar administradores'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Nenhuma conta com esse e-mail. Peça para a pessoa criar a conta em mrv3dsolutions.tech e tente de novo.'; end if;
  if exists (select 1 from public.membros where empresa_id = p_empresa and user_id = v_user) then
    if exists (select 1 from public.membros where empresa_id = p_empresa and user_id = v_user and papel in ('dono','admin')) and not private.is_admin(p_empresa) then
      raise exception 'Só o proprietário ou um administrador pode alterar um administrador';
    end if;
    update public.membros set ativo = true, papel = p_papel where empresa_id = p_empresa and user_id = v_user and papel <> 'dono';
  else
    insert into public.membros(empresa_id, user_id, papel) values (p_empresa, v_user, p_papel);
  end if;
end; $$;

create or replace function public.equipe_alterar(p_empresa uuid, p_user uuid, p_papel public.papel_membro, p_extra text[], p_removidas text[], p_ativo boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_atual public.papel_membro;
begin
  if not private.pode(p_empresa, 'usuarios_admin') then raise exception 'Você não tem permissão para administrar usuários'; end if;
  select papel into v_atual from public.membros where empresa_id = p_empresa and user_id = p_user;
  if v_atual is null then raise exception 'Usuário não faz parte da empresa'; end if;
  if v_atual = 'dono' then raise exception 'O proprietário não pode ser alterado'; end if;
  if p_papel = 'dono' then raise exception 'Só existe um proprietário por empresa'; end if;
  if p_user = (select auth.uid()) then raise exception 'Você não pode alterar o seu próprio acesso'; end if;
  if (v_atual = 'admin' or p_papel = 'admin') and not private.is_admin(p_empresa) then
    raise exception 'Só o proprietário ou um administrador pode criar ou alterar administradores';
  end if;
  -- ninguém concede uma permissão que não tem
  if exists (select 1 from unnest(coalesce(p_extra, '{}')) x where not private.tem_permissao(p_empresa, x)) then
    raise exception 'Você só pode conceder permissões que você mesmo tem';
  end if;
  update public.membros set papel = p_papel, permissoes_extra = coalesce(p_extra, '{}'), permissoes_removidas = coalesce(p_removidas, '{}'), ativo = coalesce(p_ativo, ativo)
   where empresa_id = p_empresa and user_id = p_user;
end; $$;

create or replace function public.equipe_remover(p_empresa uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.pode(p_empresa, 'usuarios_admin') then raise exception 'Você não tem permissão para administrar usuários'; end if;
  if exists (select 1 from public.membros where empresa_id = p_empresa and user_id = p_user and papel = 'dono') then raise exception 'O proprietário não pode ser removido'; end if;
  if p_user = (select auth.uid()) then raise exception 'Você não pode remover a si mesmo'; end if;
  if exists (select 1 from public.membros where empresa_id = p_empresa and user_id = p_user and papel = 'admin') and not private.is_admin(p_empresa) then
    raise exception 'Só o proprietário ou um administrador pode remover um administrador';
  end if;
  delete from public.membros where empresa_id = p_empresa and user_id = p_user;
end; $$;

-- ---------- Auditoria das empresas ------------------------------------
create or replace function private.auditar_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_diff jsonb; v_id text; v_emp uuid; v_uid uuid := (select auth.uid()); v_email text;
begin
  -- ações da equipe da plataforma já são auditadas por private.auditar_alteracao
  if v_uid is not null and exists (select 1 from public.equipe_plataforma where user_id = v_uid)
     and tg_table_name in ('empresas') then
    return coalesce(new, old);
  end if;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('de', v_old->k, 'para', v_new->k)) into v_diff
      from jsonb_object_keys(v_new) k where (v_old->k) is distinct from (v_new->k) and k not in ('updated_at');
    if v_diff is null then return new; end if;
  else
    v_diff := coalesce(v_new, v_old);
  end if;
  v_id := coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'empresa_id', v_old->>'empresa_id');
  v_emp := nullif(coalesce(v_new->>'empresa_id', v_old->>'empresa_id', case when tg_table_name = 'empresas' then v_id end), '')::uuid;
  select email into v_email from auth.users where id = v_uid;
  insert into public.auditoria(user_id, email, acao, entidade, entidade_id, empresa_id, detalhes)
  values (v_uid, v_email, lower(tg_op), tg_table_name, v_id, v_emp, v_diff);
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_audemp_empresas on public.empresas;
create trigger trg_audemp_empresas after update on public.empresas for each row execute function private.auditar_empresa();
drop trigger if exists trg_audemp_config on public.empresa_config;
create trigger trg_audemp_config after update on public.empresa_config for each row execute function private.auditar_empresa();
drop trigger if exists trg_audemp_membros on public.membros;
create trigger trg_audemp_membros after insert or update or delete on public.membros for each row execute function private.auditar_empresa();
drop trigger if exists trg_audemp_clientes on public.clientes;
create trigger trg_audemp_clientes after insert or update or delete on public.clientes for each row execute function private.auditar_empresa();
drop trigger if exists trg_audemp_pedidos on public.pedidos;
create trigger trg_audemp_pedidos after insert or update or delete on public.pedidos for each row execute function private.auditar_empresa();
drop trigger if exists trg_audemp_materiais on public.materiais;
create trigger trg_audemp_materiais after insert or update or delete on public.materiais for each row execute function private.auditar_empresa();

create index if not exists auditoria_empresa_idx on public.auditoria(empresa_id, created_at desc);
create policy auditoria_empresa_ver on public.auditoria for select
  using (empresa_id is not null and private.tem_permissao(empresa_id, 'usuarios_admin'));

-- ---------- Assinatura: solicitações feitas pelo assinante -------------
create table if not exists public.solicitacoes_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('upgrade','downgrade','cancelamento','periodicidade')),
  plano_id uuid references public.planos(id),
  periodicidade public.periodicidade,
  motivo text check (length(motivo) <= 2000),
  status text not null default 'pendente' check (status in ('pendente','atendida','recusada','cancelada')),
  resposta text,
  solicitado_por uuid references auth.users(id) on delete set null default auth.uid(),
  resolvido_por uuid references auth.users(id) on delete set null,
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
alter table public.solicitacoes_assinatura enable row level security;
create index if not exists solic_assin_empresa_idx on public.solicitacoes_assinatura(empresa_id, created_at desc);
create policy solic_ver on public.solicitacoes_assinatura for select
  using (private.is_admin(empresa_id) or private.is_admin_plataforma());
create policy solic_resolver on public.solicitacoes_assinatura for update
  using (private.tem_papel('proprietario','administrador','financeiro'))
  with check (private.tem_papel('proprietario','administrador','financeiro'));
drop trigger if exists trg_aud_solic on public.solicitacoes_assinatura;
create trigger trg_aud_solic after update on public.solicitacoes_assinatura for each row execute function private.auditar_alteracao();

create or replace function public.solicitar_alteracao_assinatura(p_empresa uuid, p_tipo text, p_plano uuid, p_periodicidade public.periodicidade, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin(p_empresa) then raise exception 'Somente o proprietário ou administrador pode alterar a assinatura'; end if;
  if p_tipo not in ('upgrade','downgrade','cancelamento','periodicidade') then raise exception 'Tipo inválido'; end if;
  if p_tipo in ('upgrade','downgrade') and not exists (select 1 from public.planos where id = p_plano and ativo and not descontinuado) then
    raise exception 'Escolha um plano disponível';
  end if;
  if p_tipo = 'cancelamento' and coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Conte o motivo do cancelamento'; end if;
  if exists (select 1 from public.solicitacoes_assinatura where empresa_id = p_empresa and status = 'pendente') then
    raise exception 'Já existe uma solicitação pendente. Aguarde a resposta ou cancele a anterior.';
  end if;
  insert into public.solicitacoes_assinatura(empresa_id, tipo, plano_id, periodicidade, motivo)
  values (p_empresa, p_tipo, case when p_tipo in ('upgrade','downgrade') then p_plano end, p_periodicidade, nullif(trim(p_motivo), ''))
  returning id into v_id;
  perform private.registrar_auditoria('solicitacao_' || p_tipo, 'assinaturas', v_id::text, p_empresa, jsonb_build_object('plano', p_plano, 'motivo', p_motivo));
  return v_id;
end; $$;

create or replace function public.cancelar_solicitacao_assinatura(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.solicitacoes_assinatura set status = 'cancelada', resolvido_em = now(), resolvido_por = (select auth.uid())
   where id = p_id and status = 'pendente' and private.is_admin(empresa_id);
  if not found then raise exception 'Solicitação não encontrada'; end if;
end; $$;

-- Planos disponíveis para upgrade (visível a qualquer usuário logado já pela política planos_ver)

-- ---------- Permissões das tabelas existentes --------------------------
-- clientes
drop policy if exists clientes_ler on public.clientes;
drop policy if exists clientes_inserir on public.clientes;
drop policy if exists clientes_alterar on public.clientes;
drop policy if exists clientes_excluir on public.clientes;
create policy clientes_ler on public.clientes for select using (private.tem_permissao(empresa_id, 'clientes_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar'));
create policy clientes_inserir on public.clientes for insert with check (private.pode(empresa_id, 'clientes_editar') or private.pode(empresa_id, 'orcamentos_criar'));
create policy clientes_alterar on public.clientes for update using (private.pode(empresa_id, 'clientes_editar')) with check (private.pode(empresa_id, 'clientes_editar'));
create policy clientes_excluir on public.clientes for delete using (private.pode(empresa_id, 'clientes_editar'));

-- pedidos e itens
drop policy if exists pedidos_ler on public.pedidos;
drop policy if exists pedidos_inserir on public.pedidos;
drop policy if exists pedidos_alterar on public.pedidos;
drop policy if exists pedidos_excluir on public.pedidos;
create policy pedidos_ler on public.pedidos for select using (private.tem_permissao(empresa_id, 'pedidos_ver'));
create policy pedidos_inserir on public.pedidos for insert with check (private.pode(empresa_id, 'pedidos_editar'));
create policy pedidos_alterar on public.pedidos for update using (private.pode(empresa_id, 'pedidos_editar')) with check (private.pode(empresa_id, 'pedidos_editar'));
create policy pedidos_excluir on public.pedidos for delete using (private.pode(empresa_id, 'pedidos_editar'));
drop policy if exists pedido_itens_ler on public.pedido_itens;
drop policy if exists pedido_itens_inserir on public.pedido_itens;
drop policy if exists pedido_itens_alterar on public.pedido_itens;
drop policy if exists pedido_itens_excluir on public.pedido_itens;
create policy pedido_itens_ler on public.pedido_itens for select using (private.tem_permissao(empresa_id, 'pedidos_ver'));
create policy pedido_itens_inserir on public.pedido_itens for insert with check (private.pode(empresa_id, 'pedidos_editar'));
create policy pedido_itens_alterar on public.pedido_itens for update using (private.pode(empresa_id, 'pedidos_editar')) with check (private.pode(empresa_id, 'pedidos_editar'));
create policy pedido_itens_excluir on public.pedido_itens for delete using (private.pode(empresa_id, 'pedidos_editar'));

-- gastos (financeiro / compras)
drop policy if exists gastos_ler on public.gastos;
drop policy if exists gastos_inserir on public.gastos;
drop policy if exists gastos_alterar on public.gastos;
drop policy if exists gastos_excluir on public.gastos;
create policy gastos_ler on public.gastos for select using (private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_permissao(empresa_id, 'compras_gerenciar'));
create policy gastos_inserir on public.gastos for insert with check (private.pode(empresa_id, 'financeiro_ver') or private.pode(empresa_id, 'compras_gerenciar'));
create policy gastos_alterar on public.gastos for update using (private.pode(empresa_id, 'financeiro_ver')) with check (private.pode(empresa_id, 'financeiro_ver'));
create policy gastos_excluir on public.gastos for delete using (private.pode(empresa_id, 'financeiro_ver') or private.pode(empresa_id, 'compras_gerenciar'));

-- links de acesso: quem configura a empresa
drop policy if exists links_select on public.links_acesso;
drop policy if exists links_insert on public.links_acesso;
drop policy if exists links_update on public.links_acesso;
drop policy if exists links_delete on public.links_acesso;
create policy links_select on public.links_acesso for select using (private.tem_permissao(empresa_id, 'config_editar'));
create policy links_insert on public.links_acesso for insert with check (private.pode(empresa_id, 'config_editar'));
create policy links_update on public.links_acesso for update using (private.pode(empresa_id, 'config_editar')) with check (private.pode(empresa_id, 'config_editar'));
create policy links_delete on public.links_acesso for delete using (private.tem_permissao(empresa_id, 'config_editar'));

-- Grants das funções novas
revoke all on function public.minhas_permissoes(uuid), public.minhas_empresas(), public.equipe_listar(uuid),
  public.equipe_adicionar(uuid, text, public.papel_membro),
  public.equipe_alterar(uuid, uuid, public.papel_membro, text[], text[], boolean), public.equipe_remover(uuid, uuid),
  public.solicitar_alteracao_assinatura(uuid, text, uuid, public.periodicidade, text), public.cancelar_solicitacao_assinatura(uuid)
  from public, anon;
grant execute on function public.minhas_permissoes(uuid), public.minhas_empresas(), public.equipe_listar(uuid),
  public.equipe_adicionar(uuid, text, public.papel_membro),
  public.equipe_alterar(uuid, uuid, public.papel_membro, text[], text[], boolean), public.equipe_remover(uuid, uuid),
  public.solicitar_alteracao_assinatura(uuid, text, uuid, public.periodicidade, text), public.cancelar_solicitacao_assinatura(uuid)
  to authenticated;
