-- Réplica mínima do banco atual (Supabase) para testar as migrações localmente.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema private; create schema extensions; create schema storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, storage to anon, authenticated;

create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, last_sign_in_at timestamptz, banned_until timestamptz, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select, insert on storage.objects to anon;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;

create type public.categoria_gasto as enum ('material','equipamento','manutencao','energia','frete','marketing','taxas','outro');
create type public.categoria_material as enum ('filamento','resina','sublimacao','laser','bordado','embalagem','outro');
create type public.papel_membro as enum ('dono','admin','operador');
create type public.papel_plataforma as enum ('proprietario','administrador','financeiro','suporte','atendimento');
create type public.periodicidade as enum ('mensal','anual');
create type public.status_assinatura as enum ('teste','ativa','pendente','atrasada','suspensa','cancelada');
create type public.status_empresa as enum ('teste','ativa','suspensa','cancelada');
create type public.status_fatura as enum ('aberta','paga','vencida','cancelada','reembolsada');
create type public.status_pedido as enum ('orcamento','aprovado','em_producao','pronto','entregue','cancelado');
create type public.tipo_compra as enum ('filamento','materia_prima','insumo','ferramenta','embalagem','manutencao','acessorio','escritorio_limpeza','outro');
create type public.tipo_movimentacao as enum ('entrada','saida','ajuste');
create type public.tipo_servico as enum ('impressao_3d','sublimacao','laser','bordado','outro');

create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table public.empresas (id uuid primary key default gen_random_uuid(), nome text not null, whatsapp text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  razao_social text, documento text, responsavel text, email text, telefone text, endereco text, cidade text, uf char(2), cep text, status public.status_empresa not null default 'teste');
create table public.membros (empresa_id uuid references public.empresas(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, papel public.papel_membro not null default 'operador', created_at timestamptz not null default now(), primary key (empresa_id, user_id));
create table public.equipe_plataforma (user_id uuid primary key references auth.users(id), nome text, papel public.papel_plataforma not null, ativo boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.clientes (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, nome text not null, telefone text, email text, observacoes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.links_acesso (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, token text unique not null, nome text not null, pode_pedidos boolean default false, pode_gastos boolean default false, pode_estoque boolean default false, ativo boolean default true, expira_em timestamptz, ultimo_uso timestamptz, created_by uuid, created_at timestamptz default now());
create table public.pedidos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, numero bigint, cliente_id uuid references public.clientes(id) on delete set null,
  status public.status_pedido not null default 'orcamento', tipo_servico public.tipo_servico not null default 'outro', descricao text, valor_total numeric not null default 0, valor_pago numeric not null default 0, custo_estimado numeric,
  data_entrega date, origem text not null default 'manual', created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), link_id uuid references public.links_acesso(id) on delete set null);
create table public.pedido_itens (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, pedido_id uuid not null references public.pedidos(id) on delete cascade, descricao text not null, quantidade numeric not null default 1, valor_unitario numeric not null default 0, created_at timestamptz default now());
create table public.equipamentos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, nome text not null, tipo public.tipo_servico, modelo text, data_compra date, valor_compra numeric, ativo boolean default true, observacoes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.materiais (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, nome text not null, categoria public.categoria_material not null default 'outro', cor text, unidade text not null default 'un',
  quantidade numeric not null default 0, estoque_minimo numeric not null default 0, custo_unitario numeric, ativo boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), tipo_compra public.tipo_compra not null default 'materia_prima');
create table public.movimentacoes_estoque (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, material_id uuid not null references public.materiais(id) on delete cascade, tipo public.tipo_movimentacao not null, quantidade numeric not null,
  pedido_id uuid references public.pedidos(id) on delete set null, observacao text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), link_id uuid references public.links_acesso(id) on delete set null);
create table public.gastos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, descricao text not null, categoria public.categoria_gasto not null default 'outro', valor numeric not null, data date not null default current_date,
  material_id uuid references public.materiais(id) on delete set null, equipamento_id uuid references public.equipamentos(id) on delete set null, pedido_id uuid references public.pedidos(id) on delete set null, created_by uuid, created_at timestamptz not null default now(), link_id uuid);
create table public.planos (id uuid primary key default gen_random_uuid(), nome text not null, slug text unique, descricao text, preco_mensal numeric not null default 0, preco_anual numeric not null default 0, limite_impressoras int, limite_usuarios int, armazenamento_mb int,
  dias_teste int default 14, recursos text[] default '{}', ativo boolean default true, descontinuado boolean default false, ordem int default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.assinaturas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, plano_id uuid references public.planos(id), status public.status_assinatura not null default 'teste', periodicidade public.periodicidade default 'mensal',
  valor numeric default 0, desconto_percentual numeric default 0, inicio date default current_date, teste_ate date, proxima_cobranca date, cancelada_em timestamptz, motivo_cancelamento text, gateway text, gateway_assinatura_id text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.faturas (id uuid primary key default gen_random_uuid(), empresa_id uuid not null references public.empresas(id) on delete cascade, assinatura_id uuid, descricao text, valor numeric not null, vencimento date, status public.status_fatura default 'aberta', valor_pago numeric, pago_em timestamptz, metodo text, gateway text, gateway_fatura_id text, link_pagamento text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.auditoria (id bigserial primary key, user_id uuid, email text, acao text, entidade text, entidade_id text, empresa_id uuid, detalhes jsonb, created_at timestamptz default now());
create table public.acessos_suporte (id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id) on delete cascade, admin_id uuid, motivo text, inicio timestamptz default now(), expira_em timestamptz, encerrado_em timestamptz);
do $$ declare t text; begin
  foreach t in array array['empresas','membros','equipe_plataforma','clientes','links_acesso','pedidos','pedido_itens','equipamentos','materiais','movimentacoes_estoque','gastos','planos','assinaturas','faturas','auditoria','acessos_suporte'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop; end $$;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

create function private.is_admin_plataforma() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.equipe_plataforma where user_id = (select auth.uid()) and ativo) $$;
create function private.tem_papel(variadic p public.papel_plataforma[]) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.equipe_plataforma where user_id = (select auth.uid()) and ativo and papel = any(p)) $$;
create function private.tem_acesso_suporte(p_empresa uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.acessos_suporte a join public.equipe_plataforma e on e.user_id = a.admin_id and e.ativo where a.empresa_id = p_empresa and a.admin_id = (select auth.uid()) and a.encerrado_em is null and a.expira_em > now()) $$;
create function private.is_membro(p_empresa uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = (select auth.uid())) $$;
create function private.is_admin(p_empresa uuid) returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.papel in ('dono','admin')) $$;
create function private.pode_escrever(p_empresa uuid) returns boolean language sql stable security definer set search_path = '' as $$ select private.is_membro(p_empresa) and exists (select 1 from public.empresas where id = p_empresa and status not in ('suspensa','cancelada')) $$;
create function private.registrar_auditoria(p_acao text, p_entidade text, p_entidade_id text, p_empresa uuid, p_detalhes jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.auditoria(user_id, email, acao, entidade, entidade_id, empresa_id, detalhes) values ((select auth.uid()), (select email from auth.users where id = (select auth.uid())), p_acao, p_entidade, p_entidade_id, p_empresa, p_detalhes) $$;
create function private.auditar_alteracao() returns trigger language plpgsql security definer set search_path = '' as $$ begin return coalesce(new, old); end $$;
create function private.validar_link(p_token text, p_permissao text) returns public.links_acesso language plpgsql security definer set search_path = '' as $$
declare l public.links_acesso; begin
  select * into l from public.links_acesso where token = p_token and ativo and (expira_em is null or expira_em > now());
  if l.id is null then raise exception 'Link inválido ou expirado'; end if;
  if not exists (select 1 from public.empresas where id = l.empresa_id and status not in ('suspensa','cancelada')) then raise exception 'Empresa suspensa'; end if;
  if (p_permissao = 'estoque' and not l.pode_estoque) or (p_permissao = 'pedidos' and not l.pode_pedidos) or (p_permissao = 'gastos' and not l.pode_gastos) then raise exception 'Sem permissão'; end if;
  return l; end $$;
create function public.empresa_add_dono() returns trigger language plpgsql security definer set search_path = '' as $$
begin if auth.uid() is not null then insert into public.membros(empresa_id, user_id, papel) values (new.id, auth.uid(), 'dono'); end if; return new; end $$;
create trigger trg_empresa_dono after insert on public.empresas for each row execute function public.empresa_add_dono();
create function private.criar_assinatura_teste() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.planos; begin
  select * into p from public.planos where slug = 'starter' and ativo and not descontinuado;
  if p.id is not null then insert into public.assinaturas(empresa_id, plano_id, status, valor, teste_ate, proxima_cobranca) values (new.id, p.id, 'teste', p.preco_mensal, current_date + p.dias_teste, current_date + p.dias_teste); end if;
  return new; end $$;
create trigger trg_empresa_assinatura after insert on public.empresas for each row execute function private.criar_assinatura_teste();
create function public.criar_empresa(p_nome text, p_whatsapp text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  insert into public.empresas(nome, whatsapp) values (trim(p_nome), nullif(trim(p_whatsapp), '')) returning id into v_id; return v_id; end $$;
create function public.link_movimentar_estoque(p_token text, p_material_id uuid, p_tipo public.tipo_movimentacao, p_quantidade numeric, p_observacao text default null) returns numeric language sql as $$ select 0::numeric $$;
create function public.aplicar_movimentacao() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_mov_aplicar after insert on public.movimentacoes_estoque for each row execute function public.aplicar_movimentacao();
create function public.registrar_compra(p_empresa uuid, p_tipo public.tipo_compra, p_nome text, p_quantidade numeric, p_valor_total numeric, p_unidade text default 'un', p_detalhe text default null, p_data date default current_date, p_estoque_minimo numeric default null, p_lancar_gasto boolean default true)
returns jsonb language sql as $$ select '{}'::jsonb $$;
create policy planos_ver on public.planos for select using (ativo or private.is_admin_plataforma());
create policy assin_ver on public.assinaturas for select using (private.is_admin_plataforma() or private.is_membro(empresa_id));
create policy faturas_ver on public.faturas for select using (private.tem_papel('proprietario','administrador','financeiro','suporte') or private.is_admin(empresa_id));
create policy empresas_select on public.empresas for select using (private.is_membro(id));
create policy empresas_insert on public.empresas for insert with check (true);
create policy membros_select on public.membros for select using (private.is_membro(empresa_id));
create policy auditoria_ver on public.auditoria for select using (private.tem_papel('proprietario','administrador'));
insert into public.planos(nome, slug, preco_mensal, preco_anual, limite_impressoras, limite_usuarios, armazenamento_mb, dias_teste, ordem) values
 ('Starter','starter',49,490,2,1,500,14,1), ('Pro','pro',99,990,5,3,2000,14,2), ('Business','business',199,1990,20,10,10000,14,3);
