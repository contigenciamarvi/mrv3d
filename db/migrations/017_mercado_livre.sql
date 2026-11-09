-- =====================================================================
-- MERCADO LIVRE: conectar a conta do vendedor (OAuth oficial), importar vendas como pedidos,
-- sincronizar estoque dos anúncios vinculados e trocar o código de rastreio.
-- O serviço "integra" (deploy/integra) roda na VPS com a chave secreta do aplicativo e a
-- service_role; as funções svc_* só podem ser chamadas por ele. Tokens ficam cifrados no banco.
-- =====================================================================

-- ---------- configuração da plataforma (valores públicos do aplicativo) ----------
alter table public.configuracao_plataforma
  add column if not exists ml_app_id text check (ml_app_id is null or ml_app_id ~ '^[0-9]{5,25}$'),
  add column if not exists ml_redirect_uri text check (ml_redirect_uri is null or (length(ml_redirect_uri) <= 300 and ml_redirect_uri ~* '^https://'));

-- cliente criado a partir de um comprador do marketplace (reaproveitado nas próximas compras)
alter table public.clientes add column if not exists marketplace_ref text check (length(marketplace_ref) <= 60);
create unique index if not exists clientes_marketplace_ref_uq on public.clientes(empresa_id, marketplace_ref) where marketplace_ref is not null;

-- ---------- contas conectadas ----------
create table if not exists public.marketplace_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  canal text not null default 'mercado_livre' check (canal in ('mercado_livre')),
  conta_externa_id bigint not null,
  apelido text check (length(apelido) <= 120),
  status text not null default 'conectada' check (status in ('conectada','erro','desconectada')),
  erro text check (length(erro) <= 500),
  importar_pedidos boolean not null default true,
  baixar_estoque boolean not null default true,       -- venda de produto com estoque baixa o estoque do sistema
  registrar_tarifas boolean not null default true,    -- tarifa de venda vira despesa paga
  importar_desde timestamptz not null default now(),  -- vendas anteriores à conexão não entram
  conectada_em timestamptz not null default now(),
  conectada_por uuid references auth.users(id) on delete set null,
  ultima_sincronizacao timestamptz,
  ultima_busca_pedidos timestamptz,
  created_at timestamptz not null default now()
);
-- a mesma conta do Mercado Livre não fica ligada a duas empresas ao mesmo tempo
create unique index if not exists mkt_conta_externa_uq on public.marketplace_contas(canal, conta_externa_id) where status <> 'desconectada';
create index if not exists mkt_contas_empresa_idx on public.marketplace_contas(empresa_id);
alter table public.marketplace_contas enable row level security;
revoke all on public.marketplace_contas from anon, authenticated;
grant select on public.marketplace_contas to authenticated;
create policy mkt_contas_ler on public.marketplace_contas for select
  using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_permissao(empresa_id, 'pedidos_ver'));

create table if not exists private.marketplace_tokens (
  conta_id uuid primary key references public.marketplace_contas(id) on delete cascade,
  access_cifrado bytea not null,
  refresh_cifrado bytea not null,
  expira_em timestamptz not null,
  atualizado_em timestamptz not null default now()
);
revoke all on private.marketplace_tokens from public, anon, authenticated;

create table if not exists private.marketplace_oauth_estados (
  estado_hash text primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  expira_em timestamptz not null,
  usado_em timestamptz
);
revoke all on private.marketplace_oauth_estados from public, anon, authenticated;

-- ---------- anúncios ----------
create table if not exists public.marketplace_anuncios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.marketplace_contas(id) on delete cascade,
  item_id text not null check (item_id ~ '^[A-Z]{3}[0-9]{1,20}$'),
  variacao_id bigint,
  titulo text check (length(titulo) <= 300),
  variacao_nome text check (length(variacao_nome) <= 200),
  sku text check (length(sku) <= 120),
  status_externo text check (length(status_externo) <= 40),
  logistica text check (length(logistica) <= 40),
  preco numeric(12,2),
  estoque_externo integer,
  link text check (link is null or (length(link) <= 400 and link ~* '^https://')),
  produto_id uuid references public.produtos(id) on delete set null,
  variante_id uuid references public.produto_variantes(id) on delete set null,
  sincronizar_estoque boolean not null default false,
  ultimo_estoque_enviado integer,
  estoque_enviado_em timestamptz,
  erro_estoque text check (length(erro_estoque) <= 300),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists mkt_anuncio_uq on public.marketplace_anuncios(conta_id, item_id, coalesce(variacao_id, 0));
create index if not exists mkt_anuncio_produto_idx on public.marketplace_anuncios(produto_id) where produto_id is not null;
alter table public.marketplace_anuncios enable row level security;
revoke all on public.marketplace_anuncios from anon, authenticated;
grant select on public.marketplace_anuncios to authenticated;
create policy mkt_anuncios_ler on public.marketplace_anuncios for select
  using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_permissao(empresa_id, 'produtos_ver'));

-- ---------- vendas importadas ----------
create table if not exists public.marketplace_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.marketplace_contas(id) on delete cascade,
  pedido_externo_id bigint not null,
  pack_id bigint,
  pedido_id uuid references public.pedidos(id) on delete set null,
  status_externo text check (length(status_externo) <= 40),
  comprador text check (length(comprador) <= 150),
  total numeric(12,2),
  tarifa numeric(12,2) not null default 0,
  envio_id bigint,
  envio_modo text check (length(envio_modo) <= 30),          -- me2 (etiqueta do ML), me1, custom, not_specified
  envio_status text check (length(envio_status) <= 40),
  rastreio_ml text check (length(rastreio_ml) <= 100),        -- rastreio que o Mercado Livre informou (ME2)
  rastreio_enviado text check (length(rastreio_enviado) <= 100), -- rastreio que o sistema informou ao ML (ME1/personalizado)
  rastreio_enviado_em timestamptz,
  erro_rastreio text check (length(erro_rastreio) <= 300),
  data_venda timestamptz,
  importado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  aviso text check (length(aviso) <= 300),
  unique (conta_id, pedido_externo_id)
);
create index if not exists mkt_pedidos_empresa_idx on public.marketplace_pedidos(empresa_id, data_venda desc);
create index if not exists mkt_pedidos_pack_idx on public.marketplace_pedidos(conta_id, pack_id) where pack_id is not null;
create index if not exists mkt_pedidos_pedido_idx on public.marketplace_pedidos(pedido_id) where pedido_id is not null;
alter table public.marketplace_pedidos enable row level security;
revoke all on public.marketplace_pedidos from anon, authenticated;
grant select on public.marketplace_pedidos to authenticated;
create policy mkt_pedidos_ler on public.marketplace_pedidos for select
  using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_permissao(empresa_id, 'pedidos_ver'));

-- ---------- fila do serviço (avisos do ML e tarefas periódicas) ----------
create table if not exists private.marketplace_fila (
  id bigserial primary key,
  conta_id uuid not null references public.marketplace_contas(id) on delete cascade,
  tipo text not null check (tipo in ('pedido','anuncio','envio','importar_anuncios','buscar_pedidos')),
  recurso text not null check (length(recurso) <= 120),
  tentativas int not null default 0,
  proxima_em timestamptz not null default now(),
  erro text,
  criado_em timestamptz not null default now()
);
create unique index if not exists mkt_fila_uq on private.marketplace_fila(conta_id, tipo, recurso);
create index if not exists mkt_fila_proxima_idx on private.marketplace_fila(proxima_em);
revoke all on private.marketplace_fila from public, anon, authenticated;

-- ---------- quem é o serviço ----------
-- service_role pela API (claim do JWT) ou conexão direta ao banco por um administrador (não pela API)
create or replace function private.eh_servico() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or (session_user <> 'authenticator' and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') not in ('authenticated', 'anon'))
$$;

create or replace function private.cifrar(p text) returns bytea
language sql stable security definer set search_path = '' as $$
  select extensions.pgp_sym_encrypt(p, (select valor from private.segredos where nome = 'chave_integracoes'))
$$;
create or replace function private.decifrar(p bytea) returns text
language sql stable security definer set search_path = '' as $$
  select extensions.pgp_sym_decrypt(p, (select valor from private.segredos where nome = 'chave_integracoes'))
$$;
revoke all on function private.cifrar(text), private.decifrar(bytea) from public, anon, authenticated;

-- =====================================================================
-- Funções da loja (painel)
-- =====================================================================
create or replace function public.ml_iniciar_conexao(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg public.configuracao_plataforma; v_estado text;
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só quem configura integrações conecta o Mercado Livre'; end if;
  select * into cfg from public.configuracao_plataforma where id = 1;
  if cfg.ml_app_id is null or cfg.ml_redirect_uri is null then
    raise exception 'A integração com o Mercado Livre ainda não foi ativada na plataforma. Fale com o suporte.';
  end if;
  if (select count(*) from private.marketplace_oauth_estados where empresa_id = p_empresa and expira_em > now()) >= 10 then
    raise exception 'Muitas tentativas de conexão: aguarde alguns minutos';
  end if;
  delete from private.marketplace_oauth_estados where expira_em < now() - interval '1 day';
  v_estado := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.marketplace_oauth_estados(estado_hash, empresa_id, user_id, expira_em)
  values (encode(extensions.digest(v_estado, 'sha256'), 'hex'), p_empresa, (select auth.uid()), now() + interval '15 minutes');
  -- passa pelo serviço da plataforma, que prende o estado a este navegador (cookie) antes de ir ao Mercado Livre:
  -- assim um link de autorização enviado por outra pessoa não liga a conta dela à empresa errada
  return jsonb_build_object('url', regexp_replace(cfg.ml_redirect_uri, '/callback$', '/iniciar') || '?estado=' || v_estado);
end; $$;

create or replace function public.marketplace_desconectar(p_conta uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas;
begin
  select * into c from public.marketplace_contas where id = p_conta for update;
  if c.id is null or not private.pode(c.empresa_id, 'integracoes_config') then raise exception 'Conta não encontrada'; end if;
  delete from private.marketplace_tokens where conta_id = c.id;
  delete from private.marketplace_fila where conta_id = c.id;
  update public.marketplace_contas set status = 'desconectada', erro = null where id = c.id;
  update public.marketplace_anuncios set sincronizar_estoque = false where conta_id = c.id;
  perform private.registrar_evento_mkt(c.empresa_id, 'desconexao', 'Mercado Livre desconectado: ' || coalesce(c.apelido, c.conta_externa_id::text) || ' (acesso apagado do sistema)', null);
end; $$;

create or replace function public.marketplace_config(p_conta uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas;
begin
  select * into c from public.marketplace_contas where id = p_conta;
  if c.id is null or not private.pode(c.empresa_id, 'integracoes_config') then raise exception 'Conta não encontrada'; end if;
  update public.marketplace_contas set
    importar_pedidos = coalesce((p->>'importar_pedidos')::boolean, importar_pedidos),
    baixar_estoque = coalesce((p->>'baixar_estoque')::boolean, baixar_estoque),
    registrar_tarifas = coalesce((p->>'registrar_tarifas')::boolean, registrar_tarifas)
  where id = c.id;
end; $$;

create or replace function public.marketplace_sincronizar(p_conta uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas;
begin
  select * into c from public.marketplace_contas where id = p_conta;
  if c.id is null or not private.pode(c.empresa_id, 'integracoes_config') then raise exception 'Conta não encontrada'; end if;
  if c.status = 'desconectada' then raise exception 'Conta desconectada: conecte de novo'; end if;
  insert into private.marketplace_fila(conta_id, tipo, recurso) values (c.id, 'importar_anuncios', 'todos'), (c.id, 'buscar_pedidos', 'recentes')
  on conflict (conta_id, tipo, recurso) do update set proxima_em = least(private.marketplace_fila.proxima_em, now()), tentativas = 0;
end; $$;

-- vincular anúncio a um produto (e ligar a sincronização de estoque)
create or replace function public.marketplace_vincular_anuncio(p_anuncio uuid, p_produto uuid, p_variante uuid, p_sincronizar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.marketplace_anuncios; p public.produtos;
begin
  select * into a from public.marketplace_anuncios where id = p_anuncio for update;
  if a.id is null or not (private.pode(a.empresa_id, 'integracoes_config') or private.pode(a.empresa_id, 'produtos_editar')) then raise exception 'Anúncio não encontrado'; end if;
  if p_produto is not null then
    select * into p from public.produtos where id = p_produto and empresa_id = a.empresa_id;
    if p.id is null then raise exception 'Produto não encontrado'; end if;
    if p_variante is not null and not exists (select 1 from public.produto_variantes where id = p_variante and produto_id = p.id) then raise exception 'Variação não encontrada'; end if;
    if coalesce(p_sincronizar, false) and not p.controla_estoque then raise exception 'Este produto não controla estoque: ligue "Controla estoque" no produto para sincronizar'; end if;
  elsif p_variante is not null then raise exception 'Escolha o produto';
  end if;
  update public.marketplace_anuncios set produto_id = p_produto, variante_id = p_variante,
    sincronizar_estoque = coalesce(p_sincronizar, false) and p_produto is not null,
    ultimo_estoque_enviado = case when produto_id is distinct from p_produto or variante_id is distinct from p_variante then null else ultimo_estoque_enviado end,
    erro_estoque = null
  where id = a.id;
end; $$;

create or replace function private.registrar_evento_mkt(p_empresa uuid, p_tipo text, p_msg text, p_dados jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.integracao_eventos(empresa_id, provedor, tipo, mensagem, dados, autor_id) values (p_empresa, 'mercado_livre', p_tipo, left(p_msg, 500), p_dados, (select auth.uid()));
$$;
revoke all on function private.registrar_evento_mkt(uuid, text, text, jsonb), private.eh_servico() from public, anon, authenticated;

-- =====================================================================
-- Funções do serviço (só service_role)
-- =====================================================================
create or replace function public.svc_ml_consumir_estado(p_estado text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e private.marketplace_oauth_estados;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  update private.marketplace_oauth_estados set usado_em = now()
   where estado_hash = encode(extensions.digest(coalesce(p_estado, ''), 'sha256'), 'hex') and usado_em is null and expira_em > now()
  returning * into e;
  if e.estado_hash is null then return null; end if;
  if not exists (select 1 from public.empresas where id = e.empresa_id and status not in ('suspensa','cancelada')) then return null; end if;
  return jsonb_build_object('empresa_id', e.empresa_id, 'user_id', e.user_id);
end; $$;

create or replace function public.svc_ml_salvar_conta(p_empresa uuid, p_user uuid, p_ml_user bigint, p_apelido text, p_access text, p_refresh text, p_expira_s int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_outra uuid;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  if p_ml_user is null or p_ml_user <= 0 or length(coalesce(p_access, '')) < 10 or length(coalesce(p_refresh, '')) < 10 then raise exception 'Dados inválidos'; end if;
  perform pg_advisory_xact_lock(hashtext('ml_conta:' || p_ml_user));
  select id into v_outra from public.marketplace_contas where canal = 'mercado_livre' and conta_externa_id = p_ml_user and status <> 'desconectada' and empresa_id <> p_empresa;
  if v_outra is not null then raise exception 'conta_em_outra_empresa'; end if;
  select id into v from public.marketplace_contas where empresa_id = p_empresa and canal = 'mercado_livre' and conta_externa_id = p_ml_user order by created_at desc limit 1;
  if v is null then
    insert into public.marketplace_contas(empresa_id, conta_externa_id, apelido, conectada_por) values (p_empresa, p_ml_user, left(p_apelido, 120), p_user) returning id into v;
  else
    update public.marketplace_contas set status = 'conectada', erro = null, apelido = coalesce(left(p_apelido, 120), apelido), conectada_em = now(), conectada_por = p_user,
      importar_desde = case when status = 'desconectada' then now() else importar_desde end
    where id = v;
  end if;
  insert into private.marketplace_tokens(conta_id, access_cifrado, refresh_cifrado, expira_em)
  values (v, private.cifrar(p_access), private.cifrar(p_refresh), now() + make_interval(secs => greatest(coalesce(p_expira_s, 21600) - 300, 60)))
  on conflict (conta_id) do update set access_cifrado = excluded.access_cifrado, refresh_cifrado = excluded.refresh_cifrado, expira_em = excluded.expira_em, atualizado_em = now();
  insert into private.marketplace_fila(conta_id, tipo, recurso) values (v, 'importar_anuncios', 'todos'), (v, 'buscar_pedidos', 'recentes') on conflict do nothing;
  insert into public.integracao_eventos(empresa_id, provedor, tipo, mensagem, autor_id)
  values (p_empresa, 'mercado_livre', 'conexao', 'Mercado Livre conectado: ' || coalesce(p_apelido, p_ml_user::text), p_user);
  return v;
end; $$;

-- contas com acesso vencendo (o serviço renova com a chave secreta)
create or replace function public.svc_ml_contas_renovar()
returns table(conta_id uuid, refresh text) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  return query select t.conta_id, private.decifrar(t.refresh_cifrado) from private.marketplace_tokens t join public.marketplace_contas c on c.id = t.conta_id
   where c.status <> 'desconectada' and t.expira_em < now() + interval '45 minutes' limit 50;
end; $$;

create or replace function public.svc_ml_salvar_tokens(p_conta uuid, p_access text, p_refresh text, p_expira_s int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  update private.marketplace_tokens set access_cifrado = private.cifrar(p_access), refresh_cifrado = private.cifrar(coalesce(p_refresh, private.decifrar(refresh_cifrado))),
    expira_em = now() + make_interval(secs => greatest(coalesce(p_expira_s, 21600) - 300, 60)), atualizado_em = now()
  where conta_id = p_conta;
  update public.marketplace_contas set status = 'conectada', erro = null where id = p_conta and status = 'erro';
end; $$;

create or replace function public.svc_ml_token(p_conta uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select jsonb_build_object('access', private.decifrar(t.access_cifrado), 'ml_user', c.conta_externa_id, 'vence', t.expira_em < now())
    into r from private.marketplace_tokens t join public.marketplace_contas c on c.id = t.conta_id where t.conta_id = p_conta and c.status <> 'desconectada';
  return r;
end; $$;

create or replace function public.svc_ml_erro_conta(p_conta uuid, p_msg text, p_perdeu_acesso boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select * into c from public.marketplace_contas where id = p_conta;
  if c.id is null then return; end if;
  update public.marketplace_contas set status = 'erro', erro = left(p_msg, 500) where id = c.id and status <> 'desconectada';
  if p_perdeu_acesso then
    delete from private.marketplace_tokens where conta_id = c.id;
    delete from private.marketplace_fila where conta_id = c.id;
  end if;
  if c.status <> 'erro' then perform private.registrar_evento_mkt(c.empresa_id, 'erro', 'Mercado Livre: ' || left(p_msg, 400), null); end if;
end; $$;

-- aviso do Mercado Livre (webhook): só enfileira; o serviço busca o recurso na API oficial
create or replace function public.svc_ml_enfileirar(p_ml_user bigint, p_topico text, p_recurso text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_tipo text; v_rec text; n int := 0; c record;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  v_tipo := case p_topico when 'orders_v2' then 'pedido' when 'items' then 'anuncio' when 'shipments' then 'envio' end;
  if v_tipo is null then return 0; end if;
  v_rec := case v_tipo
    when 'pedido' then substring(p_recurso from '^/orders/([0-9]{1,20})$')
    when 'anuncio' then substring(p_recurso from '^/items/([A-Z]{3}[0-9]{1,20})$')
    when 'envio' then substring(p_recurso from '^/shipments/([0-9]{1,20})$') end;
  if v_rec is null then return 0; end if;
  for c in select id, importar_pedidos from public.marketplace_contas where canal = 'mercado_livre' and conta_externa_id = p_ml_user and status <> 'desconectada' loop
    if v_tipo = 'pedido' and not c.importar_pedidos then continue; end if;
    insert into private.marketplace_fila(conta_id, tipo, recurso) values (c.id, v_tipo, v_rec)
    on conflict (conta_id, tipo, recurso) do update set proxima_em = least(private.marketplace_fila.proxima_em, now() + interval '5 seconds'), tentativas = 0, erro = null;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- pega tarefas da fila (cada uma fica reservada por 3 minutos)
create or replace function public.svc_ml_tarefas(p_limite int)
returns table(id bigint, conta_id uuid, tipo text, recurso text, tentativas int) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  -- tarefas periódicas: busca de pedidos a cada 15 min por conta (garante o que o aviso perdeu)
  insert into private.marketplace_fila(conta_id, tipo, recurso)
  select c.id, 'buscar_pedidos', 'recentes' from public.marketplace_contas c
   where c.status = 'conectada' and c.importar_pedidos and coalesce(c.ultima_busca_pedidos, '-infinity') < now() - interval '15 minutes'
  on conflict do nothing;
  return query
  with alvo as (
    select f.id from private.marketplace_fila f join public.marketplace_contas c on c.id = f.conta_id
     where f.proxima_em <= now() and c.status <> 'desconectada'
     order by case f.tipo when 'pedido' then 0 when 'envio' then 1 else 2 end, f.proxima_em
     limit least(greatest(coalesce(p_limite, 20), 1), 100) for update of f skip locked)
  update private.marketplace_fila f set proxima_em = now() + interval '3 minutes', tentativas = f.tentativas + 1
    from alvo where f.id = alvo.id
  returning f.id, f.conta_id, f.tipo, f.recurso, f.tentativas;
end; $$;

create or replace function public.svc_ml_tarefa_fim(p_id bigint, p_erro text)
returns void language plpgsql security definer set search_path = '' as $$
declare f private.marketplace_fila; c public.marketplace_contas;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select * into f from private.marketplace_fila where id = p_id;
  if f.id is null then return; end if;
  if p_erro is null then
    delete from private.marketplace_fila where id = p_id;
    if f.tipo = 'buscar_pedidos' then update public.marketplace_contas set ultima_busca_pedidos = now(), ultima_sincronizacao = now() where id = f.conta_id; end if;
    if f.tipo = 'importar_anuncios' then update public.marketplace_contas set ultima_sincronizacao = now() where id = f.conta_id; end if;
  elsif f.tentativas >= 8 then
    delete from private.marketplace_fila where id = p_id;
    select * into c from public.marketplace_contas where id = f.conta_id;
    perform private.registrar_evento_mkt(c.empresa_id, 'erro', 'Mercado Livre: desisti de processar ' || f.tipo || ' ' || f.recurso || ' depois de 8 tentativas: ' || left(p_erro, 300), null);
  else
    -- espera crescente: 1, 2, 4, 8... minutos
    update private.marketplace_fila set erro = left(p_erro, 500), proxima_em = now() + make_interval(mins => power(2, least(tentativas, 8))::int) where id = p_id;
    if f.tipo = 'buscar_pedidos' then update public.marketplace_contas set ultima_busca_pedidos = now() where id = f.conta_id; end if;
  end if;
end; $$;

-- anúncios (lista vinda de /users/{id}/items/search + /items): cada variação é uma linha
create or replace function public.svc_ml_salvar_anuncios(p_conta uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas; i jsonb; n int := 0; v_prod uuid; v_var uuid; v_sku text;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select * into c from public.marketplace_contas where id = p_conta and status <> 'desconectada';
  if c.id is null then return 0; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 500 then raise exception 'Lista inválida'; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    if coalesce(i->>'item_id', '') !~ '^[A-Z]{3}[0-9]{1,20}$' then continue; end if;
    v_sku := nullif(left(trim(i->>'sku'), 120), '');
    -- vínculo automático pelo SKU = código do produto (só se ainda não estiver vinculado)
    v_prod := null; v_var := null;
    if v_sku is not null then
      select pv.produto_id, pv.id into v_prod, v_var from public.produto_variantes pv where pv.empresa_id = c.empresa_id and lower(pv.sku) = lower(v_sku) limit 1;
      if v_prod is null then select p.id into v_prod from public.produtos p where p.empresa_id = c.empresa_id and lower(p.codigo) = lower(v_sku) limit 1; end if;
    end if;
    insert into public.marketplace_anuncios(empresa_id, conta_id, item_id, variacao_id, titulo, variacao_nome, sku, status_externo, logistica, preco, estoque_externo, link, produto_id, variante_id)
    values (c.empresa_id, c.id, i->>'item_id', nullif(i->>'variacao_id', '')::bigint, left(i->>'titulo', 300), left(i->>'variacao_nome', 200), v_sku,
            left(i->>'status', 40), left(i->>'logistica', 40), nullif(i->>'preco', '')::numeric, nullif(i->>'estoque', '')::numeric::int,
            case when coalesce(i->>'link', '') ~* '^https://[a-z0-9.-]*mercadoli(vre|bre)\.com' then left(i->>'link', 400) end, v_prod, v_var)
    on conflict (conta_id, item_id, coalesce(variacao_id, 0)) do update set
      titulo = excluded.titulo, variacao_nome = excluded.variacao_nome, sku = excluded.sku, status_externo = excluded.status_externo, logistica = excluded.logistica,
      preco = excluded.preco, estoque_externo = excluded.estoque_externo, link = coalesce(excluded.link, public.marketplace_anuncios.link),
      produto_id = coalesce(public.marketplace_anuncios.produto_id, excluded.produto_id),
      variante_id = case when public.marketplace_anuncios.produto_id is null then excluded.variante_id else public.marketplace_anuncios.variante_id end,
      atualizado_em = now();
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ---------- importação de uma venda ----------
-- p_pedido: o JSON de /orders/{id} (campos usados: id, status, date_created, total_amount, pack_id, order_items, buyer, shipping)
-- p_envio:  o JSON de /shipments/{id} (opcional): mode, status, tracking_number, receiver_address
create or replace function public.svc_ml_importar_pedido(p_conta uuid, p_pedido jsonb, p_envio jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.marketplace_contas; mp public.marketplace_pedidos; v_ped uuid; v_cli uuid; v_id bigint; v_pack bigint;
  v_status text; v_data timestamptz; v_total numeric := 0; v_tarifa numeric := 0; it jsonb; a public.marketplace_anuncios; v_qtd numeric;
  v_comprador text; v_ref text; v_novo boolean := false; v_aviso text; v_saldo numeric; v_pago boolean; v_endereco jsonb; v_lanc uuid;
  v_env_modo text; v_env_status text; v_rastreio text; v_desc text;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select * into c from public.marketplace_contas where id = p_conta and status <> 'desconectada';
  if c.id is null then return jsonb_build_object('ignorado', 'conta'); end if;
  if jsonb_typeof(p_pedido) <> 'object' or length(p_pedido::text) > 200000 then raise exception 'Pedido inválido'; end if;
  v_id := (p_pedido->>'id')::bigint;
  if v_id is null or v_id <= 0 then raise exception 'Pedido sem id'; end if;
  -- o pedido tem que ser desta conta
  if coalesce((p_pedido#>>'{seller,id}')::bigint, c.conta_externa_id) <> c.conta_externa_id then raise exception 'Pedido de outro vendedor'; end if;
  v_pack := nullif(p_pedido->>'pack_id', '')::bigint;
  v_status := left(p_pedido->>'status', 40);
  v_data := coalesce((p_pedido->>'date_created')::timestamptz, now());
  v_pago := v_status in ('paid', 'partially_refunded');
  v_env_modo := left(p_envio->>'mode', 30); v_env_status := left(p_envio->>'status', 40);
  v_rastreio := nullif(left(trim(p_envio->>'tracking_number'), 100), '');
  for it in select * from jsonb_array_elements(coalesce(p_pedido->'order_items', '[]'::jsonb)) loop
    v_total := v_total + coalesce((it->>'unit_price')::numeric, 0) * coalesce((it->>'quantity')::numeric, 0);
    v_tarifa := v_tarifa + coalesce((it->>'sale_fee')::numeric, 0) * coalesce((it->>'quantity')::numeric, 0);
  end loop;
  v_comprador := left(nullif(trim(concat_ws(' ', p_pedido#>>'{buyer,first_name}', p_pedido#>>'{buyer,last_name}')), ''), 150);
  v_comprador := coalesce(v_comprador, left(p_pedido#>>'{buyer,nickname}', 150), 'Comprador Mercado Livre');

  perform pg_advisory_xact_lock(hashtext('ml_pedido:' || c.id || ':' || coalesce(v_pack, v_id)));
  select * into mp from public.marketplace_pedidos where conta_id = c.id and pedido_externo_id = v_id for update;

  if mp.id is null then
    if v_data < c.importar_desde - interval '1 day' then
      return jsonb_build_object('ignorado', 'anterior_a_conexao');
    end if;
    if not v_pago then
      -- só vira pedido depois de pago (pedido não pago some sozinho no ML)
      return jsonb_build_object('ignorado', 'nao_pago', 'status', v_status);
    end if;
    -- carrinho (pack): vários pedidos do ML viram um pedido só
    if v_pack is not null then
      select pedido_id into v_ped from public.marketplace_pedidos where conta_id = c.id and pack_id = v_pack and pedido_id is not null limit 1;
    end if;
    if v_ped is not null and exists (select 1 from public.pedidos where id = v_ped and (status = 'cancelado' or status_entrega <> 'pendente')) then v_ped := null; end if;

    -- cliente (reaproveitado pelo id do comprador)
    v_ref := 'ml:' || coalesce(p_pedido#>>'{buyer,id}', '0');
    select id into v_cli from public.clientes where empresa_id = c.empresa_id and marketplace_ref = v_ref;
    v_endereco := p_envio->'receiver_address';
    if v_cli is null then
      insert into public.clientes(empresa_id, nome, marketplace_ref, observacoes, endereco, numero_endereco, complemento, bairro, cidade, uf, cep, etiquetas)
      values (c.empresa_id, v_comprador, v_ref, left('Comprador do Mercado Livre (' || coalesce(p_pedido#>>'{buyer,nickname}', '') || ')', 500),
              left(v_endereco->>'street_name', 300), left(v_endereco->>'street_number', 20), left(v_endereco->>'comment', 100), left(v_endereco#>>'{neighborhood,name}', 100),
              left(v_endereco#>>'{city,name}', 100), case when v_endereco#>>'{state,id}' ~ '^BR-[A-Z]{2}$' then right(v_endereco#>>'{state,id}', 2) end,
              left(v_endereco->>'zip_code', 10), array['mercado livre'])
      returning id into v_cli;
    end if;

    perform set_config('app.ped_interno', '1', true);
    if v_ped is null then
      insert into public.pedidos(empresa_id, cliente_id, status, descricao, valor_total, origem, data_entrega, observacoes)
      values (c.empresa_id, v_cli, 'aprovado', left('Mercado Livre #' || coalesce(v_pack, v_id), 500), 0, 'mercado_livre',
              nullif(left(p_envio#>>'{shipping_option,estimated_delivery_time,date}', 10), '')::date,
              left('Venda Mercado Livre ' || coalesce('carrinho ' || v_pack, 'pedido ' || v_id) || coalesce('. Envio: ' || v_env_modo, '') || '.', 5000))
      returning id into v_ped;
      v_novo := true;
    end if;

    -- itens: produto pelo vínculo do anúncio (ou SKU); sem vínculo entra só a descrição
    for it in select * from jsonb_array_elements(coalesce(p_pedido->'order_items', '[]'::jsonb)) loop
      a := null;
      select * into a from public.marketplace_anuncios where conta_id = c.id and item_id = it#>>'{item,id}'
        and coalesce(variacao_id, 0) = coalesce(nullif(it#>>'{item,variation_id}', '')::bigint, 0);
      v_qtd := greatest(coalesce((it->>'quantity')::numeric, 1), 0.01);
      v_desc := left(coalesce(it#>>'{item,title}', 'Item Mercado Livre')
        || coalesce(' (' || (select string_agg(x->>'value_name', ', ') from jsonb_array_elements(coalesce(it#>'{item,variation_attributes}', '[]'::jsonb)) x) || ')', ''), 500);
      insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario, produto_id)
      values (c.empresa_id, v_ped, v_desc, v_qtd, coalesce((it->>'unit_price')::numeric, 0), a.produto_id);
      -- baixa de estoque do produto acabado (só se houver o suficiente; senão avisa para produzir)
      if c.baixar_estoque and a.produto_id is not null then
        if exists (select 1 from public.produtos where id = a.produto_id and controla_estoque) then
          if a.variante_id is not null then select estoque_qtd into v_saldo from public.produto_variantes where id = a.variante_id for update;
          else select estoque_qtd into v_saldo from public.produtos where id = a.produto_id for update; end if;
          if coalesce(v_saldo, 0) >= v_qtd then
            perform set_config('app.mov_interna', '1', true);
            if a.variante_id is not null then
              update public.produto_variantes set estoque_qtd = estoque_qtd - v_qtd where id = a.variante_id returning estoque_qtd into v_saldo;
            else
              update public.produtos set estoque_qtd = estoque_qtd - v_qtd where id = a.produto_id returning estoque_qtd into v_saldo;
            end if;
            perform set_config('app.mov_interna', '0', true);
            insert into public.produto_movimentacoes(empresa_id, produto_id, variante_id, tipo, quantidade, saldo_apos, observacao, pedido_id, created_by)
            values (c.empresa_id, a.produto_id, a.variante_id, 'saida', v_qtd, v_saldo, left('Venda Mercado Livre ' || v_id, 500), v_ped, null);
          else
            v_aviso := left(coalesce(v_aviso || '; ', '') || 'estoque insuficiente de "' || left(v_desc, 60) || '": produzir ' || v_qtd, 300);
          end if;
        end if;
      elsif a.produto_id is null then
        v_aviso := left(coalesce(v_aviso || '; ', '') || 'anúncio ' || coalesce(it#>>'{item,id}', '?') || ' sem produto vinculado', 300);
      end if;
    end loop;
    update public.pedidos set valor_total = valor_total + v_total where id = v_ped;

    -- recebimento: o comprador pagou ao Mercado Livre
    if v_total > 0 then
      insert into public.pagamentos(empresa_id, pedido_id, valor, data, forma, observacao, created_by)
      values (c.empresa_id, v_ped, v_total, v_data::date, 'Mercado Livre', left('Pedido ML ' || v_id || ' (repasse conforme o Mercado Pago)', 500), null);
      perform private.recalcular_pago(v_ped);
    end if;
    perform set_config('app.ped_interno', '1', true);
    -- tarifa de venda do ML como despesa já paga
    if c.registrar_tarifas and v_tarifa > 0 then
      v_lanc := private.lancar_despesa(c.empresa_id, 'taxas_financeiras', 'Tarifa Mercado Livre — pedido ' || v_id, round(v_tarifa, 2), v_data::date,
                                       null, null, null, null, 'Mercado Livre', null, null, null);
      perform set_config('app.fin_interno', '1', true);
      update public.lancamentos set pago = true, data_pagamento = v_data::date where id = v_lanc;
      perform set_config('app.fin_interno', '0', true);
    end if;
    perform set_config('app.ped_interno', '0', true);

    insert into public.marketplace_pedidos(empresa_id, conta_id, pedido_externo_id, pack_id, pedido_id, status_externo, comprador, total, tarifa, envio_id, envio_modo, envio_status, rastreio_ml, data_venda, aviso)
    values (c.empresa_id, c.id, v_id, v_pack, v_ped, v_status, v_comprador, v_total, round(v_tarifa, 2), nullif(p_pedido#>>'{shipping,id}', '')::bigint,
            v_env_modo, v_env_status, case when v_env_modo = 'me2' then v_rastreio end, v_data, v_aviso)
    returning * into mp;
    perform private.registrar_evento_mkt(c.empresa_id, 'importacao', 'Venda Mercado Livre ' || v_id || ' importada' || case when v_novo then ' como pedido novo' else ' no pedido do carrinho' end
      || coalesce(' — atenção: ' || v_aviso, ''), jsonb_build_object('pedido_ml', v_id, 'pedido_id', v_ped));
    return jsonb_build_object('importado', true, 'pedido_id', v_ped, 'aviso', v_aviso);
  end if;

  -- já importado: atualiza situação, envio e rastreio do ML
  update public.marketplace_pedidos set status_externo = v_status, atualizado_em = now(),
    envio_id = coalesce(nullif(p_pedido#>>'{shipping,id}', '')::bigint, envio_id),
    envio_modo = coalesce(v_env_modo, envio_modo), envio_status = coalesce(v_env_status, envio_status),
    rastreio_ml = case when coalesce(v_env_modo, envio_modo) = 'me2' then coalesce(v_rastreio, rastreio_ml) else rastreio_ml end
  where id = mp.id;
  -- venda cancelada no ML depois de importada: não cancela sozinho (pode ter produção/estoque); avisa
  if v_status = 'cancelled' and mp.status_externo is distinct from 'cancelled' then
    update public.marketplace_pedidos set aviso = left('Venda cancelada no Mercado Livre: confira e cancele o pedido no sistema' || coalesce('; ' || aviso, ''), 300) where id = mp.id;
    perform private.registrar_evento_mkt(c.empresa_id, 'atualizacao', 'Venda Mercado Livre ' || v_id || ' foi CANCELADA no ML: cancele o pedido no sistema se ainda não foi enviado', jsonb_build_object('pedido_id', mp.pedido_id));
  end if;
  -- rastreio do ML (etiqueta Mercado Envios) vai para o envio do sistema, se houver e estiver vazio
  if v_env_modo = 'me2' and v_rastreio is not null and mp.pedido_id is not null then
    perform set_config('app.envio_interno', '1', true);
    update public.envios set codigo_rastreio = v_rastreio, transportadora = coalesce(transportadora, 'Mercado Envios')
     where pedido_id = mp.pedido_id and status not in ('cancelado','devolvido') and codigo_rastreio is null;
    perform set_config('app.envio_interno', '0', true);
  end if;
  return jsonb_build_object('atualizado', true, 'pedido_id', mp.pedido_id);
end; $$;

-- estoque a enviar: anúncios vinculados cujo estoque no sistema mudou
create or replace function public.svc_ml_estoques_pendentes(p_limite int)
returns table(anuncio_id uuid, conta_id uuid, item_id text, variacao_id bigint, quantidade int) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  return query
  select a.id, a.conta_id, a.item_id, a.variacao_id, q.qtd
    from public.marketplace_anuncios a
    join public.marketplace_contas c on c.id = a.conta_id and c.status = 'conectada'
    join public.produtos p on p.id = a.produto_id and p.controla_estoque
    left join public.produto_variantes v on v.id = a.variante_id
    cross join lateral (select greatest(floor(coalesce(v.estoque_qtd, p.estoque_qtd)), 0)::int as qtd) q
   where a.sincronizar_estoque and coalesce(a.logistica, '') <> 'fulfillment'
     and a.ultimo_estoque_enviado is distinct from q.qtd
     and (a.erro_estoque is null or a.estoque_enviado_em < now() - interval '30 minutes')
   order by a.estoque_enviado_em nulls first
   limit least(greatest(coalesce(p_limite, 20), 1), 100);
end; $$;

create or replace function public.svc_ml_estoque_resultado(p_anuncio uuid, p_qtd int, p_erro text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  update public.marketplace_anuncios set estoque_enviado_em = now(),
    ultimo_estoque_enviado = case when p_erro is null then p_qtd else ultimo_estoque_enviado end,
    estoque_externo = case when p_erro is null then p_qtd else estoque_externo end,
    erro_estoque = left(p_erro, 300)
  where id = p_anuncio;
end; $$;

-- rastreio a enviar: vendas com envio próprio (ME1/personalizado) cujo envio no sistema já tem código
create or replace function public.svc_ml_rastreios_pendentes(p_limite int)
returns table(mkt_pedido_id uuid, conta_id uuid, envio_id bigint, envio_modo text, codigo text, transportadora text, comprador_id bigint) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  -- um envio do ML pode ter vários pedidos (carrinho): informa uma vez por envio
  return query
  select distinct on (mp.conta_id, mp.envio_id) mp.id, mp.conta_id, mp.envio_id, mp.envio_modo, e.codigo_rastreio, e.transportadora, null::bigint
    from public.marketplace_pedidos mp
    join public.marketplace_contas c on c.id = mp.conta_id and c.status = 'conectada'
    join public.envios e on e.pedido_id = mp.pedido_id and e.status in ('enviado','em_transito','entregue')
   where coalesce(mp.envio_modo, (select x.envio_modo from public.marketplace_pedidos x where x.conta_id = mp.conta_id and x.envio_id = mp.envio_id and x.envio_modo is not null limit 1)) in ('me1','custom')
     and mp.envio_id is not null and coalesce(mp.status_externo, '') <> 'cancelled'
     and e.codigo_rastreio is not null and mp.rastreio_enviado is distinct from e.codigo_rastreio
     and (mp.erro_rastreio is null or mp.rastreio_enviado_em < now() - interval '1 hour')
   order by mp.conta_id, mp.envio_id
   limit least(greatest(coalesce(p_limite, 10), 1), 50);
end; $$;

create or replace function public.svc_ml_rastreio_resultado(p_mkt_pedido uuid, p_codigo text, p_erro text)
returns void language plpgsql security definer set search_path = '' as $$
declare mp public.marketplace_pedidos;
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  select * into mp from public.marketplace_pedidos where id = p_mkt_pedido;
  if mp.id is null then return; end if;
  update public.marketplace_pedidos set rastreio_enviado_em = now(),
    rastreio_enviado = case when p_erro is null then left(p_codigo, 100) else rastreio_enviado end,
    erro_rastreio = left(p_erro, 300)
  where conta_id = mp.conta_id and (id = mp.id or (mp.envio_id is not null and envio_id = mp.envio_id));
  if p_erro is null and mp.id is not null then
    perform private.registrar_evento_mkt(mp.empresa_id, 'atualizacao', 'Rastreio ' || left(p_codigo, 60) || ' informado ao Mercado Livre (pedido ' || mp.pedido_externo_id || ')', null);
  end if;
end; $$;

-- limpeza periódica
create or replace function public.svc_ml_limpeza()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.eh_servico() then raise exception 'Acesso negado'; end if;
  delete from private.marketplace_oauth_estados where expira_em < now() - interval '1 day';
  delete from public.integracao_eventos where provedor = 'mercado_livre' and created_at < now() - interval '180 days';
end; $$;

-- ---------- notificações da loja ----------
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'minhas_notificacoes_plataforma') then
    alter function public.minhas_notificacoes(uuid) rename to minhas_notificacoes_plataforma;
  end if;
end $$;
create or replace function public.minhas_notificacoes(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := public.minhas_notificacoes_plataforma(p_empresa);
begin
  if not private.is_membro(p_empresa) then return r; end if;
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'ml-conta-' || c.id || '-' || to_char(coalesce(c.ultima_sincronizacao, c.conectada_em), 'YYYYMMDDHH24'), 'tipo', 'integracao', 'nivel', 'erro',
            'titulo', 'Mercado Livre com problema', 'texto', left(coalesce(c.erro, 'Verifique a conexão'), 160), 'link', '/integracoes/marketplaces/'))
           from public.marketplace_contas c where c.empresa_id = p_empresa and c.status = 'erro'
             and (private.tem_permissao(p_empresa, 'integracoes_config') or private.tem_permissao(p_empresa, 'pedidos_ver'))), '[]'::jsonb);
  r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'ml-aviso-' || mp.id || '-' || to_char(mp.atualizado_em, 'YYYYMMDDHH24MI'), 'tipo', 'pedido', 'nivel', 'alerta',
            'titulo', 'Venda Mercado Livre precisa de atenção', 'texto', left(mp.aviso, 160), 'link', '/integracoes/marketplaces/?aba=vendas'))
           from public.marketplace_pedidos mp where mp.empresa_id = p_empresa and mp.aviso is not null and mp.atualizado_em > now() - interval '3 days'
             and private.tem_permissao(p_empresa, 'pedidos_ver')), '[]'::jsonb);
  return r;
end; $$;
revoke all on function public.minhas_notificacoes_plataforma(uuid) from public, anon, authenticated;

-- ---------- Super Admin: ativar o aplicativo do Mercado Livre ----------
create or replace function public.admin_config_ml(p_app_id text, p_redirect text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.tem_papel('proprietario', 'administrador') then raise exception 'Só proprietário ou administrador'; end if;
  update public.configuracao_plataforma set ml_app_id = nullif(trim(p_app_id), ''), ml_redirect_uri = nullif(trim(p_redirect), ''), updated_at = now(), updated_by = (select auth.uid()) where id = 1;
  perform private.registrar_auditoria('configuracao_ml', 'configuracao_plataforma', '1', null, jsonb_build_object('ml_app_id', nullif(trim(p_app_id), '')));
end; $$;

-- ---------- Super Admin › Integrações: situação do Mercado Livre (só contagens) ----------
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
    'versao_banco', v_versao,
    'ml_configurado', (select ml_app_id is not null and ml_redirect_uri is not null from public.configuracao_plataforma where id = 1),
    'ml_contas', (select count(*) from public.marketplace_contas where status = 'conectada'),
    'ml_contas_erro', (select count(*) from public.marketplace_contas where status = 'erro'),
    'ml_vendas_30d', (select count(*) from public.marketplace_pedidos where importado_em > now() - interval '30 days')
  );
end; $$;

-- ---------- permissões ----------
revoke all on function public.ml_iniciar_conexao(uuid), public.marketplace_desconectar(uuid), public.marketplace_config(uuid, jsonb), public.marketplace_sincronizar(uuid),
  public.marketplace_vincular_anuncio(uuid, uuid, uuid, boolean), public.admin_config_ml(text, text), public.minhas_notificacoes(uuid) from public, anon;
grant execute on function public.ml_iniciar_conexao(uuid), public.marketplace_desconectar(uuid), public.marketplace_config(uuid, jsonb), public.marketplace_sincronizar(uuid),
  public.marketplace_vincular_anuncio(uuid, uuid, uuid, boolean), public.admin_config_ml(text, text), public.minhas_notificacoes(uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['svc_ml_consumir_estado(text)', 'svc_ml_salvar_conta(uuid, uuid, bigint, text, text, text, int)', 'svc_ml_contas_renovar()',
    'svc_ml_salvar_tokens(uuid, text, text, int)', 'svc_ml_token(uuid)', 'svc_ml_erro_conta(uuid, text, boolean)', 'svc_ml_enfileirar(bigint, text, text)',
    'svc_ml_tarefas(int)', 'svc_ml_tarefa_fim(bigint, text)', 'svc_ml_salvar_anuncios(uuid, jsonb)', 'svc_ml_importar_pedido(uuid, jsonb, jsonb)',
    'svc_ml_estoques_pendentes(int)', 'svc_ml_estoque_resultado(uuid, int, text)', 'svc_ml_rastreios_pendentes(int)', 'svc_ml_rastreio_resultado(uuid, text, text)', 'svc_ml_limpeza()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;
