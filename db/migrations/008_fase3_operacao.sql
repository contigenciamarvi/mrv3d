-- =====================================================================
-- FASE 3 — Operação: pedidos com status independentes e pagamentos parciais,
-- ordens de produção (reserva, consumo real, custo real, falhas, reimpressão)
-- e financeiro básico (contas a pagar/receber, fluxo de caixa, contas)
-- =====================================================================

do $$ begin create type public.status_pagamento_pedido as enum ('aguardando','parcial','pago'); exception when duplicate_object then null; end $$;
do $$ begin create type public.status_producao_pedido as enum ('aguardando','em_producao','acabamento','qualidade','concluida','nao_aplica'); exception when duplicate_object then null; end $$;
do $$ begin create type public.status_entrega_pedido as enum ('pendente','pronto','enviado','entregue','retirado'); exception when duplicate_object then null; end $$;
do $$ begin create type public.status_op as enum ('planejada','aguardando_material','na_fila','imprimindo','pausada','falha','acabamento','qualidade','concluida','cancelada'); exception when duplicate_object then null; end $$;
do $$ begin create type public.prioridade_op as enum ('baixa','normal','alta','urgente'); exception when duplicate_object then null; end $$;

-- ---------- Pedidos ---------------------------------------------------
alter table public.pedidos
  add column if not exists status_pagamento public.status_pagamento_pedido not null default 'aguardando',
  add column if not exists status_producao public.status_producao_pedido not null default 'aguardando',
  add column if not exists status_entrega public.status_entrega_pedido not null default 'pendente',
  add column if not exists forma_pagamento text check (length(forma_pagamento) <= 60),
  add column if not exists observacoes text check (length(observacoes) <= 5000),
  add column if not exists orcamento_id uuid references public.orcamentos(id) on delete set null,
  add column if not exists impostos_estimados numeric(12,2) not null default 0,
  add column if not exists custo_real numeric(12,2) not null default 0,
  add column if not exists transportadora text check (length(transportadora) <= 100),
  add column if not exists codigo_rastreio text check (length(codigo_rastreio) <= 100),
  add column if not exists enviado_em timestamptz,
  add column if not exists entregue_em timestamptz,
  add column if not exists cancelado_em timestamptz,
  add column if not exists motivo_cancelamento text check (length(motivo_cancelamento) <= 1000);
alter table public.pedido_itens
  add column if not exists material_id uuid references public.materiais(id) on delete set null,
  add column if not exists impressora_id uuid references public.impressoras(id) on delete set null,
  add column if not exists cor text,
  add column if not exists peso_g numeric(10,2),
  add column if not exists tempo_h numeric(8,2),
  add column if not exists arquivo_path text;

-- situação atual → três status (dados existentes)
update public.pedidos set
  status_producao = case status when 'entregue' then 'concluida' when 'pronto' then 'concluida' when 'em_producao' then 'em_producao' else 'aguardando' end::public.status_producao_pedido,
  status_entrega = case status when 'entregue' then 'entregue' when 'pronto' then 'pronto' else 'pendente' end::public.status_entrega_pedido,
  status_pagamento = case when valor_pago >= valor_total and valor_total > 0 then 'pago' when valor_pago > 0 then 'parcial' else 'aguardando' end::public.status_pagamento_pedido;
update public.pedidos p set orcamento_id = o.id from public.orcamentos o where o.pedido_id = p.id and p.orcamento_id is null;

-- A situação geral (coluna status, usada pelos links e relatórios) acompanha os três status.
create or replace function private.sincronizar_status_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_mudou_campos boolean;
begin
  -- pagamento: sempre derivado do valor pago
  new.status_pagamento := case when new.valor_pago >= new.valor_total and new.valor_total > 0 then 'pago'
                               when new.valor_pago > 0 then 'parcial' else 'aguardando' end;
  if new.status = 'cancelado' then
    new.cancelado_em := coalesce(new.cancelado_em, now());
    return new;
  end if;
  v_mudou_campos := tg_op = 'INSERT' or new.status_producao is distinct from old.status_producao or new.status_entrega is distinct from old.status_entrega;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not v_mudou_campos then
    -- quem mudou só a situação geral (telas antigas / links): traduz para os três status
    if new.status = 'entregue' then new.status_entrega := 'entregue'; if new.status_producao <> 'nao_aplica' then new.status_producao := 'concluida'; end if;
    elsif new.status = 'pronto' then if new.status_producao <> 'nao_aplica' then new.status_producao := 'concluida'; end if; if new.status_entrega = 'pendente' then new.status_entrega := 'pronto'; end if;
    elsif new.status = 'em_producao' then new.status_producao := 'em_producao';
    end if;
  else
    new.status := case
      when new.status_entrega in ('entregue','retirado') then 'entregue'
      when new.status_entrega in ('pronto','enviado') or new.status_producao in ('concluida') then 'pronto'
      when new.status_producao in ('em_producao','acabamento','qualidade') then 'em_producao'
      when new.status = 'orcamento' and new.status_pagamento = 'aguardando' then 'orcamento'
      else 'aprovado' end::public.status_pedido;
  end if;
  if new.status_entrega in ('entregue','retirado') then new.entregue_em := coalesce(new.entregue_em, now()); end if;
  if new.status_entrega = 'enviado' then new.enviado_em := coalesce(new.enviado_em, now()); end if;
  return new;
end; $$;
drop trigger if exists trg_pedido_status on public.pedidos;
create trigger trg_pedido_status before insert or update on public.pedidos for each row execute function private.sincronizar_status_pedido();

-- ---------- Pagamentos parciais ---------------------------------------
create table if not exists public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 80),
  tipo text not null default 'banco' check (tipo in ('caixa','banco','carteira_digital')),
  saldo_inicial numeric(12,2) not null default 0,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.contas_financeiras enable row level security;
create policy contas_fin_ler on public.contas_financeiras for select using (private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_permissao(empresa_id, 'pedidos_editar'));
create policy contas_fin_inserir on public.contas_financeiras for insert with check (private.pode(empresa_id, 'financeiro_ver'));
create policy contas_fin_alterar on public.contas_financeiras for update using (private.pode(empresa_id, 'financeiro_ver')) with check (private.pode(empresa_id, 'financeiro_ver'));
create policy contas_fin_excluir on public.contas_financeiras for delete using (private.pode(empresa_id, 'financeiro_ver'));

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  valor numeric(12,2) not null check (valor > 0),
  data date not null default current_date,
  forma text check (length(forma) <= 60),
  conta_id uuid references public.contas_financeiras(id) on delete set null,
  observacao text check (length(observacao) <= 500),
  estornado boolean not null default false,
  estornado_em timestamptz,
  motivo_estorno text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pagamentos_pedido_idx on public.pagamentos(pedido_id);
create index if not exists pagamentos_empresa_data_idx on public.pagamentos(empresa_id, data);
alter table public.pagamentos enable row level security;
create policy pagamentos_ler on public.pagamentos for select using (private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_permissao(empresa_id, 'pedidos_ver'));
create trigger trg_mesma_empresa before insert or update on public.pagamentos for each row execute function private.checar_mesma_empresa('pedido_id:pedidos', 'conta_id:contas_financeiras');
create trigger trg_audemp_pagamentos after insert or update on public.pagamentos for each row execute function private.auditar_empresa();

-- valor_pago passa a ser a soma dos pagamentos (nunca editado à mão)
create or replace function private.recalcular_pago(p_pedido uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.pag_interno', '1', true);
  update public.pedidos set valor_pago = coalesce((select sum(valor) from public.pagamentos where pedido_id = p_pedido and not estornado), 0) where id = p_pedido;
  perform set_config('app.pag_interno', '0', true);
end; $$;

create or replace function private.proteger_valor_pago() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.valor_pago is distinct from old.valor_pago and coalesce(current_setting('app.pag_interno', true), '') <> '1' and (select auth.uid()) is not null then
    raise exception 'Pagamentos são registrados na aba Pagamentos do pedido';
  end if;
  return new;
end; $$;
drop trigger if exists trg_pedido_valor_pago on public.pedidos;
create trigger trg_pedido_valor_pago before update on public.pedidos for each row execute function private.proteger_valor_pago();

-- pedido criado já com algo pago (pedido manual ou link): vira o primeiro pagamento
create or replace function private.pagamento_inicial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.valor_pago > 0 and not exists (select 1 from public.pagamentos where pedido_id = new.id) then
    insert into public.pagamentos(empresa_id, pedido_id, valor, data, forma, observacao, created_by)
    values (new.empresa_id, new.id, new.valor_pago, new.created_at::date, new.forma_pagamento, 'Pago na criação do pedido', new.created_by);
  end if;
  return null;
end; $$;
drop trigger if exists trg_pedido_pagamento_inicial on public.pedidos;
create trigger trg_pedido_pagamento_inicial after insert on public.pedidos for each row execute function private.pagamento_inicial();
-- pedidos antigos com valor pago
insert into public.pagamentos(empresa_id, pedido_id, valor, data, observacao, created_by)
select p.empresa_id, p.id, p.valor_pago, p.created_at::date, 'Saldo pago antes da Fase 3', p.created_by
  from public.pedidos p where p.valor_pago > 0 and not exists (select 1 from public.pagamentos x where x.pedido_id = p.id);

create or replace function public.registrar_pagamento(p_pedido uuid, p_valor numeric, p_data date, p_forma text, p_conta uuid, p_observacao text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare p public.pedidos; v_saldo numeric;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not (private.pode(p.empresa_id, 'financeiro_ver') or private.pode(p.empresa_id, 'pedidos_editar')) then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido cancelado não recebe pagamento'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor recebido'; end if;
  v_saldo := p.valor_total - p.valor_pago;
  if p_valor > v_saldo + 0.004 then raise exception 'O valor (R$ %) é maior que o saldo em aberto (R$ %)', p_valor, greatest(v_saldo, 0); end if;
  insert into public.pagamentos(empresa_id, pedido_id, valor, data, forma, conta_id, observacao)
  values (p.empresa_id, p.id, p_valor, coalesce(p_data, current_date), nullif(trim(p_forma), ''), p_conta, nullif(trim(p_observacao), ''));
  perform private.recalcular_pago(p.id);
  return (select valor_total - valor_pago from public.pedidos where id = p.id);
end; $$;

create or replace function public.estornar_pagamento(p_pagamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.pagamentos;
begin
  select * into g from public.pagamentos where id = p_pagamento for update;
  if g.id is null or not (private.pode(g.empresa_id, 'financeiro_ver') or private.pode(g.empresa_id, 'pedidos_editar')) then raise exception 'Pagamento não encontrado'; end if;
  if g.estornado then raise exception 'Este pagamento já foi estornado'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
  update public.pagamentos set estornado = true, estornado_em = now(), motivo_estorno = trim(p_motivo) where id = g.id;
  perform private.recalcular_pago(g.pedido_id);
end; $$;

-- ---------- Ordens de produção ----------------------------------------
create table if not exists public.ordens_producao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  pedido_item_id uuid references public.pedido_itens(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  descricao text not null check (length(trim(descricao)) between 1 and 300),
  quantidade numeric(12,2) not null default 1 check (quantidade > 0),
  impressora_id uuid references public.impressoras(id) on delete set null,
  material_id uuid references public.materiais(id) on delete set null,
  cor text check (length(cor) <= 60),
  arquivo_path text,
  peso_previsto_g numeric(10,2) not null default 0 check (peso_previsto_g >= 0),
  tempo_previsto_h numeric(8,2) not null default 0 check (tempo_previsto_h >= 0),
  inicio_previsto date,
  prazo date,
  operador_id uuid references auth.users(id) on delete set null,
  prioridade public.prioridade_op not null default 'normal',
  status public.status_op not null default 'planejada',
  observacoes text check (length(observacoes) <= 5000),
  reserva_id uuid references public.reservas_materia_prima(id) on delete set null,
  reimpressao_de uuid references public.ordens_producao(id) on delete set null,
  -- execução real
  iniciada_em timestamptz,
  horas_reais numeric(8,2),
  consumo_real_g numeric(10,2),
  perdas_g numeric(10,2),
  consumo_registrado boolean not null default false,
  custo_material numeric(12,2) not null default 0,
  custo_energia numeric(12,2) not null default 0,
  custo_maquina numeric(12,2) not null default 0,
  custos_adicionais numeric(12,2) not null default 0,
  custo_real_total numeric(12,2) not null default 0,
  motivo_falha text,
  concluida_em timestamptz,
  concluida_por uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create unique index if not exists op_item_uq on public.ordens_producao(pedido_item_id) where pedido_item_id is not null and reimpressao_de is null;
create index if not exists op_empresa_status_idx on public.ordens_producao(empresa_id, status);
create index if not exists op_pedido_idx on public.ordens_producao(pedido_id);
create index if not exists op_impressora_idx on public.ordens_producao(impressora_id, status);
alter table public.ordens_producao enable row level security;
create policy op_ler on public.ordens_producao for select using (private.tem_permissao(empresa_id, 'producao_gerenciar') or private.tem_permissao(empresa_id, 'pedidos_ver') or private.tem_acesso_suporte(empresa_id));
create policy op_inserir on public.ordens_producao for insert with check (private.pode(empresa_id, 'producao_gerenciar') and status = 'planejada' and not consumo_registrado and reserva_id is null);
create policy op_alterar on public.ordens_producao for update using (private.pode(empresa_id, 'producao_gerenciar')) with check (private.pode(empresa_id, 'producao_gerenciar'));
create policy op_excluir on public.ordens_producao for delete using (private.pode(empresa_id, 'producao_gerenciar') and status in ('planejada','cancelada') and not consumo_registrado);
create trigger trg_op_upd before update on public.ordens_producao for each row execute function public.set_updated_at();
create trigger trg_mesma_empresa before insert or update on public.ordens_producao for each row execute function private.checar_mesma_empresa(
  'pedido_id:pedidos', 'pedido_item_id:pedido_itens', 'produto_id:produtos', 'impressora_id:impressoras', 'material_id:materiais', 'reimpressao_de:ordens_producao');
create trigger trg_audemp_op after insert or update or delete on public.ordens_producao for each row execute function private.auditar_empresa();

create or replace function private.op_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_int boolean := coalesce(current_setting('app.op_interno', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.numero := private.proximo_numero(new.empresa_id, 'op');
    return new;
  end if;
  if not v_int then
    -- situação, reserva, consumo e custos só mudam pelos botões da produção
    if (to_jsonb(new) - array['descricao','quantidade','impressora_id','material_id','cor','arquivo_path','peso_previsto_g','tempo_previsto_h','inicio_previsto','prazo','operador_id','prioridade','observacoes','updated_at'])
       <> (to_jsonb(old) - array['descricao','quantidade','impressora_id','material_id','cor','arquivo_path','peso_previsto_g','tempo_previsto_h','inicio_previsto','prazo','operador_id','prioridade','observacoes','updated_at']) then
      raise exception 'Use os botões da ordem de produção para mudar situação, consumo e custos';
    end if;
    -- material/quantidade/peso não mudam depois de reservar
    if old.reserva_id is not null and (new.material_id is distinct from old.material_id or new.peso_previsto_g <> old.peso_previsto_g or new.quantidade <> old.quantidade) then
      raise exception 'Material já reservado: cancele a reserva (volte a ordem para planejada) antes de mudar material ou peso';
    end if;
    if old.status in ('concluida','cancelada','falha') then raise exception 'Ordem % não pode mais ser alterada', old.status; end if;
  end if;
  if new.operador_id is not null and not exists (select 1 from public.membros where empresa_id = new.empresa_id and user_id = new.operador_id) then
    raise exception 'O operador precisa ser da equipe';
  end if;
  return new;
end; $$;
create trigger trg_op_antes before insert or update on public.ordens_producao for each row execute function private.op_antes();

create table if not exists public.producao_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.ordens_producao(id) on delete cascade,
  status_anterior public.status_op,
  status_novo public.status_op,
  observacao text,
  dados jsonb,
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists producao_eventos_idx on public.producao_eventos(ordem_id, id);
alter table public.producao_eventos enable row level security;
create policy producao_eventos_ler on public.producao_eventos for select using (private.tem_permissao(empresa_id, 'producao_gerenciar') or private.tem_permissao(empresa_id, 'pedidos_ver'));
create or replace function private.op_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.producao_eventos(empresa_id, ordem_id, status_anterior, status_novo, observacao)
    values (new.empresa_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, nullif(current_setting('app.op_obs', true), ''));
  end if;
  return null;
end; $$;
create trigger trg_op_evento after insert or update of status on public.ordens_producao for each row execute function private.op_evento();

create table if not exists public.ordem_fotos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.ordens_producao(id) on delete cascade,
  path text not null check (path like empresa_id::text || '/%'),
  nome text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.ordem_fotos enable row level security;
create policy ordem_fotos_ler on public.ordem_fotos for select using (private.tem_permissao(empresa_id, 'producao_gerenciar') or private.tem_permissao(empresa_id, 'pedidos_ver'));
create policy ordem_fotos_inserir on public.ordem_fotos for insert with check (private.pode(empresa_id, 'producao_gerenciar'));
create policy ordem_fotos_excluir on public.ordem_fotos for delete using (private.pode(empresa_id, 'producao_gerenciar'));
create trigger trg_mesma_empresa before insert on public.ordem_fotos for each row execute function private.checar_mesma_empresa('ordem_id:ordens_producao');

-- Pedido acompanha as ordens: status de produção, pronto para expedição e custo real
create or replace function private.atualizar_pedido_producao(p_pedido uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ativas int; v_concl int; v_qual int; v_acab int; v_prod int; v_custo numeric; p public.pedidos;
begin
  if p_pedido is null then return; end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or p.status = 'cancelado' then return; end if;
  select count(*) filter (where status not in ('cancelada','falha')),
         count(*) filter (where status = 'concluida'),
         count(*) filter (where status = 'qualidade'),
         count(*) filter (where status = 'acabamento'),
         count(*) filter (where status in ('imprimindo','pausada','na_fila','aguardando_material')),
         coalesce(sum(custo_real_total), 0)
    into v_ativas, v_concl, v_qual, v_acab, v_prod, v_custo
    from public.ordens_producao where pedido_id = p_pedido;
  update public.pedidos set
    custo_real = v_custo,
    status_producao = case
      when v_ativas = 0 then status_producao
      when v_concl = v_ativas then 'concluida'
      when v_qual > 0 and v_qual + v_concl = v_ativas then 'qualidade'
      when v_acab > 0 and v_acab + v_qual + v_concl = v_ativas then 'acabamento'
      when v_prod > 0 or v_acab > 0 or v_qual > 0 or v_concl > 0 then 'em_producao'
      else 'aguardando' end::public.status_producao_pedido,
    -- FLUXO D: tudo produzido → disponível para expedição
    status_entrega = case when v_ativas > 0 and v_concl = v_ativas and status_entrega = 'pendente' then 'pronto' else status_entrega end::public.status_entrega_pedido
  where id = p_pedido;
end; $$;

create or replace function private.op_mudar(p_op uuid, p_status public.status_op, p_obs text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.op_interno', '1', true);
  perform set_config('app.op_obs', coalesce(p_obs, ''), true);
  update public.ordens_producao set status = p_status where id = p_op;
  perform set_config('app.op_interno', '0', true);
  perform set_config('app.op_obs', '', true);
end; $$;

create or replace function private.op_carregar(p_op uuid) returns public.ordens_producao
language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  select * into o from public.ordens_producao where id = p_op for update;
  if o.id is null or not private.pode(o.empresa_id, 'producao_gerenciar') then raise exception 'Ordem de produção não encontrada'; end if;
  return o;
end; $$;

-- FLUXO B: liberar → reserva a matéria-prima (ou fica aguardando material)
create or replace function public.liberar_ordem(p_op uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao; m public.materiais; v_qtd numeric; v_res uuid; v_f numeric;
begin
  o := private.op_carregar(p_op);
  if o.status not in ('planejada','aguardando_material') then raise exception 'Só ordens planejadas ou aguardando material podem ser liberadas'; end if;
  if o.material_id is not null and o.peso_previsto_g > 0 and o.reserva_id is null then
    select * into m from public.materiais where id = o.material_id;
    v_f := private.fator_gramas(m.unidade, m.peso_liquido_g);
    if v_f is null then raise exception 'Defina a unidade do material "%" em g/kg (ou o peso líquido) para reservar por peso', m.nome; end if;
    v_qtd := round(o.peso_previsto_g * (1 + coalesce((select desperdicio_pct from public.empresa_config where empresa_id = o.empresa_id), 0) / 100) / v_f, 3);
    begin
      v_res := public.reservar_materia_prima(o.material_id, v_qtd, 'OP-' || o.numero, o.pedido_id, null);
    exception when others then
      if sqlerrm like 'Disponível%' then
        perform private.op_mudar(o.id, 'aguardando_material', sqlerrm);
        return 'aguardando_material';
      end if;
      raise;
    end;
    perform set_config('app.op_interno', '1', true);
    update public.ordens_producao set reserva_id = v_res where id = o.id;
  end if;
  perform private.op_mudar(o.id, 'na_fila', null);
  perform private.atualizar_pedido_producao(o.pedido_id);
  return 'na_fila';
end; $$;

create or replace function public.iniciar_ordem(p_op uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao; v text;
begin
  o := private.op_carregar(p_op);
  if o.status in ('planejada','aguardando_material') then
    v := public.liberar_ordem(p_op);
    if v <> 'na_fila' then raise exception 'Falta matéria-prima para iniciar esta ordem'; end if;
    o := private.op_carregar(p_op);
  end if;
  if o.status not in ('na_fila','pausada') then raise exception 'A ordem está %', o.status; end if;
  if o.impressora_id is null then raise exception 'Escolha a impressora antes de iniciar'; end if;
  if exists (select 1 from public.impressoras where id = o.impressora_id and status in ('manutencao','inativa')) then raise exception 'A impressora está em manutenção ou inativa'; end if;
  perform set_config('app.op_interno', '1', true);
  update public.ordens_producao set iniciada_em = coalesce(iniciada_em, now()) where id = o.id;
  perform private.op_mudar(o.id, 'imprimindo', null);
  update public.impressoras set status = 'imprimindo' where id = o.impressora_id;
  perform private.atualizar_pedido_producao(o.pedido_id);
end; $$;

create or replace function public.pausar_ordem(p_op uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  o := private.op_carregar(p_op);
  if o.status <> 'imprimindo' then raise exception 'Só é possível pausar uma ordem imprimindo'; end if;
  perform private.op_mudar(o.id, 'pausada', p_motivo);
  update public.impressoras set status = 'pausada' where id = o.impressora_id and status = 'imprimindo';
end; $$;

-- baixa do material + custo real (uma única vez por ordem)
create or replace function private.op_registrar_consumo(o public.ordens_producao, p_horas numeric, p_consumo_g numeric, p_perdas_g numeric, p_adicionais numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.materiais; i public.impressoras; c public.empresa_config; v_f numeric; v_qtd numeric; v_mat numeric := 0; v_en numeric := 0; v_maq numeric := 0;
begin
  if o.consumo_registrado then raise exception 'O consumo desta ordem já foi registrado'; end if;
  if coalesce(p_horas, 0) < 0 or coalesce(p_consumo_g, 0) < 0 or coalesce(p_perdas_g, 0) < 0 or coalesce(p_adicionais, 0) < 0 then raise exception 'Valores não podem ser negativos'; end if;
  select * into c from public.empresa_config where empresa_id = o.empresa_id;
  if o.material_id is not null then
    select * into m from public.materiais where id = o.material_id;
    v_f := private.fator_gramas(m.unidade, m.peso_liquido_g);
    v_qtd := case when v_f > 0 then round((coalesce(p_consumo_g, 0) + coalesce(p_perdas_g, 0)) / v_f, 3) else 0 end;
    if o.reserva_id is not null and exists (select 1 from public.reservas_materia_prima where id = o.reserva_id and status = 'ativa') then
      perform public.consumir_reserva(o.reserva_id, v_qtd);
    elsif v_qtd > 0 then
      perform set_config('app.mov_interna', '1', true);
      insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, observacao, pedido_id)
      values (o.empresa_id, o.material_id, 'saida', v_qtd, 'Consumo OP-' || o.numero, o.pedido_id);
    end if;
    v_mat := round(v_qtd * m.custo_medio, 2);
  end if;
  if o.impressora_id is not null then
    select * into i from public.impressoras where id = o.impressora_id;
    v_en := round(i.potencia_w / 1000 * coalesce(p_horas, 0) * coalesce(c.energia_kwh, 0), 2);
    v_maq := round(coalesce(p_horas, 0) * i.custo_hora, 2);
    update public.impressoras set horas_acumuladas = horas_acumuladas + coalesce(p_horas, 0),
           status = case when status in ('imprimindo','pausada','reservada') then 'disponivel' else status end where id = i.id;
  end if;
  perform set_config('app.op_interno', '1', true);
  update public.ordens_producao set horas_reais = coalesce(p_horas, 0), consumo_real_g = coalesce(p_consumo_g, 0), perdas_g = coalesce(p_perdas_g, 0),
         consumo_registrado = true, custo_material = v_mat, custo_energia = v_en, custo_maquina = v_maq, custos_adicionais = coalesce(p_adicionais, 0),
         custo_real_total = v_mat + v_en + v_maq + coalesce(p_adicionais, 0)
   where id = o.id;
end; $$;

-- FLUXO C: impressão terminou → consumo real, estoque e custo
create or replace function public.finalizar_impressao(p_op uuid, p_horas numeric, p_consumo_g numeric, p_perdas_g numeric, p_adicionais numeric, p_obs text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  o := private.op_carregar(p_op);
  if o.status not in ('imprimindo','pausada') then raise exception 'Só ordens imprimindo ou pausadas podem ser finalizadas'; end if;
  perform private.op_registrar_consumo(o, p_horas, p_consumo_g, p_perdas_g, p_adicionais);
  perform private.op_mudar(o.id, 'acabamento', p_obs);
  perform private.atualizar_pedido_producao(o.pedido_id);
end; $$;

create or replace function public.avancar_ordem(p_op uuid, p_para public.status_op, p_obs text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  o := private.op_carregar(p_op);
  if not ((o.status = 'acabamento' and p_para in ('qualidade','concluida')) or (o.status = 'qualidade' and p_para in ('concluida','acabamento'))
          or (o.status = 'pausada' and p_para = 'imprimindo')) then
    raise exception 'Não é possível ir de % para %', o.status, p_para;
  end if;
  if p_para = 'imprimindo' then perform public.iniciar_ordem(p_op); return; end if;
  if p_para = 'concluida' then
    perform set_config('app.op_interno', '1', true);
    update public.ordens_producao set concluida_em = now(), concluida_por = (select auth.uid()) where id = o.id;
  end if;
  perform private.op_mudar(o.id, p_para, p_obs);
  perform private.atualizar_pedido_producao(o.pedido_id);
end; $$;

-- FLUXO F: falha → registra a perda e (opcional) cria a reimpressão vinculada
create or replace function public.registrar_falha(p_op uuid, p_horas numeric, p_consumo_g numeric, p_motivo text, p_reimprimir boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao; v_nova uuid;
begin
  o := private.op_carregar(p_op);
  if o.status not in ('imprimindo','pausada','na_fila','acabamento','qualidade') then raise exception 'Não é possível registrar falha em uma ordem %', o.status; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Descreva a falha'; end if;
  if not o.consumo_registrado then
    perform private.op_registrar_consumo(o, p_horas, 0, p_consumo_g, 0);   -- tudo o que foi gasto vira perda
  elsif o.reserva_id is not null then
    null;
  end if;
  -- reserva que sobrou volta para o estoque
  if o.reserva_id is not null and exists (select 1 from public.reservas_materia_prima where id = o.reserva_id and status = 'ativa') then
    perform public.liberar_reserva(o.reserva_id);
  end if;
  perform set_config('app.op_interno', '1', true);
  update public.ordens_producao set motivo_falha = trim(p_motivo) where id = o.id;
  perform private.op_mudar(o.id, 'falha', p_motivo);
  update public.impressoras set status = 'disponivel' where id = o.impressora_id and status in ('imprimindo','pausada');
  if p_reimprimir then
    insert into public.ordens_producao(empresa_id, pedido_id, pedido_item_id, produto_id, descricao, quantidade, impressora_id, material_id, cor, arquivo_path,
                                       peso_previsto_g, tempo_previsto_h, inicio_previsto, prazo, operador_id, prioridade, observacoes, reimpressao_de)
    values (o.empresa_id, o.pedido_id, o.pedido_item_id, o.produto_id, o.descricao, o.quantidade, o.impressora_id, o.material_id, o.cor, o.arquivo_path,
            o.peso_previsto_g, o.tempo_previsto_h, current_date, o.prazo, o.operador_id,
            case when o.prioridade in ('baixa','normal') then 'alta' else o.prioridade end, 'Reimpressão da OP-' || o.numero || ': ' || trim(p_motivo), o.id)
    returning id into v_nova;
  end if;
  perform private.atualizar_pedido_producao(o.pedido_id);
  return v_nova;
end; $$;

create or replace function public.cancelar_ordem(p_op uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  o := private.op_carregar(p_op);
  if o.status in ('concluida','cancelada','falha') then raise exception 'Ordem já está %', o.status; end if;
  if o.status in ('imprimindo','pausada') then raise exception 'Ordem em impressão: registre como falha ou finalize antes de cancelar'; end if;
  if o.reserva_id is not null and exists (select 1 from public.reservas_materia_prima where id = o.reserva_id and status = 'ativa') then
    perform public.liberar_reserva(o.reserva_id);
  end if;
  perform private.op_mudar(o.id, 'cancelada', coalesce(nullif(trim(p_motivo), ''), 'Cancelada'));
  perform private.atualizar_pedido_producao(o.pedido_id);
end; $$;

-- volta para planejada (libera a reserva) para poder mudar material/peso
create or replace function public.replanejar_ordem(p_op uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordens_producao;
begin
  o := private.op_carregar(p_op);
  if o.status not in ('na_fila','aguardando_material') then raise exception 'Só ordens na fila ou aguardando material voltam para planejada'; end if;
  if o.reserva_id is not null and exists (select 1 from public.reservas_materia_prima where id = o.reserva_id and status = 'ativa') then
    perform public.liberar_reserva(o.reserva_id);
  end if;
  perform set_config('app.op_interno', '1', true);
  update public.ordens_producao set reserva_id = null where id = o.id;
  perform private.op_mudar(o.id, 'planejada', 'Replanejada');
  perform private.atualizar_pedido_producao(o.pedido_id);
end; $$;

-- Pedido → ordens (uma por item com produção)
create or replace function public.gerar_ordens_pedido(p_pedido uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare p public.pedidos; v int := 0; it record; c public.empresa_config;
begin
  select * into p from public.pedidos where id = p_pedido;
  if p.id is null or not private.pode(p.empresa_id, 'producao_gerenciar') and coalesce(current_setting('app.orcamento_rpc', true), '') <> '1' then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  select * into c from public.empresa_config where empresa_id = p.empresa_id;
  for it in
    select pi.*, pr.material_id as pr_material, pr.peso_g as pr_peso, pr.tempo_h as pr_tempo, pr.impressora_id as pr_imp, pr.cor as pr_cor
      from public.pedido_itens pi left join public.produtos pr on pr.id = pi.produto_id
     where pi.pedido_id = p.id and pi.valor_unitario >= 0 and pi.descricao not in ('Frete','Desconto')
       and not exists (select 1 from public.ordens_producao o where o.pedido_item_id = pi.id and o.reimpressao_de is null)
  loop
    insert into public.ordens_producao(empresa_id, pedido_id, pedido_item_id, produto_id, descricao, quantidade, impressora_id, material_id, cor, arquivo_path,
                                       peso_previsto_g, tempo_previsto_h, inicio_previsto, prazo)
    values (p.empresa_id, p.id, it.id, it.produto_id, it.descricao, it.quantidade, coalesce(it.impressora_id, it.pr_imp), coalesce(it.material_id, it.pr_material),
            coalesce(it.cor, it.pr_cor), it.arquivo_path,
            coalesce(it.peso_g, it.pr_peso, 0) * it.quantidade, coalesce(it.tempo_h, it.pr_tempo, 0) * it.quantidade, current_date, p.data_entrega);
    v := v + 1;
  end loop;
  perform private.atualizar_pedido_producao(p.id);
  return v;
end; $$;

-- Pedido: entrega e cancelamento
create or replace function public.atualizar_entrega(p_pedido uuid, p_status public.status_entrega_pedido, p_transportadora text, p_rastreio text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not (private.pode(p.empresa_id, 'pedidos_editar') or private.pode(p.empresa_id, 'expedicao_gerenciar')) then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  update public.pedidos set status_entrega = p_status, transportadora = coalesce(nullif(trim(p_transportadora), ''), transportadora),
         codigo_rastreio = coalesce(nullif(trim(p_rastreio), ''), codigo_rastreio) where id = p.id;
end; $$;

create or replace function public.cancelar_pedido(p_pedido uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos; o record;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not private.pode(p.empresa_id, 'pedidos_editar') then raise exception 'Sem permissão para cancelar pedidos'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido já cancelado'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  for o in select id, status, reserva_id from public.ordens_producao where pedido_id = p.id and status not in ('concluida','cancelada','falha') loop
    if o.reserva_id is not null and exists (select 1 from public.reservas_materia_prima where id = o.reserva_id and status = 'ativa') then
      perform public.liberar_reserva(o.reserva_id);
    end if;
    if o.status in ('imprimindo','pausada') then
      update public.impressoras set status = 'disponivel' where id = (select impressora_id from public.ordens_producao where id = o.id) and status in ('imprimindo','pausada');
    end if;
    perform private.op_mudar(o.id, 'cancelada', 'Pedido cancelado: ' || trim(p_motivo));
  end loop;
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo), cancelado_em = now() where id = p.id;
end; $$;

-- ---------- Financeiro --------------------------------------------------
create table if not exists public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('receita','despesa')),
  categoria text not null check (categoria in ('filamentos','resinas','energia','manutencao','equipamentos','embalagens','fretes','mao_de_obra',
                                               'impostos','taxas_financeiras','publicidade','aluguel','software','vendas','servicos','outros')),
  descricao text not null check (length(trim(descricao)) between 1 and 200),
  valor numeric(12,2) not null check (valor > 0),
  vencimento date not null,
  pago boolean not null default false,
  data_pagamento date,
  conta_id uuid references public.contas_financeiras(id) on delete set null,
  forma text check (length(forma) <= 60),
  centro_custo text check (length(centro_custo) <= 60),
  observacao text check (length(observacao) <= 1000),
  grupo_id uuid,
  parcela integer, total_parcelas integer,
  anexo_path text,
  cancelado boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint lanc_pago_data check (not pago or data_pagamento is not null)
);
create index if not exists lancamentos_empresa_idx on public.lancamentos(empresa_id, vencimento);
alter table public.lancamentos enable row level security;
create policy lanc_ler on public.lancamentos for select using (private.tem_permissao(empresa_id, 'financeiro_ver'));
create policy lanc_inserir on public.lancamentos for insert with check (private.pode(empresa_id, 'financeiro_ver'));
create policy lanc_alterar on public.lancamentos for update using (private.pode(empresa_id, 'financeiro_ver')) with check (private.pode(empresa_id, 'financeiro_ver'));
create policy lanc_excluir on public.lancamentos for delete using (private.pode(empresa_id, 'financeiro_ver'));
create trigger trg_mesma_empresa before insert or update on public.lancamentos for each row execute function private.checar_mesma_empresa('conta_id:contas_financeiras');
create trigger trg_audemp_lancamentos after insert or update or delete on public.lancamentos for each row execute function private.auditar_empresa();

-- parcelamento e recorrência numa única operação
create or replace function public.criar_lancamentos(p_empresa uuid, p_tipo text, p_categoria text, p_descricao text, p_valor_total numeric, p_primeiro_vencimento date,
  p_parcelas integer, p_recorrente_meses integer, p_pago boolean, p_conta uuid, p_forma text, p_centro_custo text, p_observacao text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int; i int; v_grupo uuid := gen_random_uuid(); v_parc numeric; v_rec boolean;
begin
  if not private.pode(p_empresa, 'financeiro_ver') then raise exception 'Sem permissão para lançar no financeiro'; end if;
  if p_valor_total is null or p_valor_total <= 0 then raise exception 'Informe o valor'; end if;
  v_rec := coalesce(p_recorrente_meses, 0) > 1;
  n := case when v_rec then least(p_recorrente_meses, 60) else greatest(1, least(coalesce(p_parcelas, 1), 60)) end;
  for i in 1 .. n loop
    -- parcelas: divide o total e ajusta os centavos na última; recorrência: repete o valor
    v_parc := case when v_rec then p_valor_total
                   when i < n then round(p_valor_total / n, 2) else p_valor_total - round(p_valor_total / n, 2) * (n - 1) end;
    insert into public.lancamentos(empresa_id, tipo, categoria, descricao, valor, vencimento, pago, data_pagamento, conta_id, forma, centro_custo, observacao, grupo_id, parcela, total_parcelas)
    values (p_empresa, p_tipo, p_categoria, trim(p_descricao) || case when n > 1 and not v_rec then ' (' || i || '/' || n || ')' else '' end, v_parc,
            (p_primeiro_vencimento + make_interval(months => i - 1))::date, coalesce(p_pago, false) and i = 1,
            case when coalesce(p_pago, false) and i = 1 then current_date end, p_conta, nullif(trim(p_forma), ''), nullif(trim(p_centro_custo), ''), nullif(trim(p_observacao), ''),
            case when n > 1 then v_grupo end, case when n > 1 then i end, case when n > 1 then n end);
  end loop;
  return n;
end; $$;

create or replace function public.financeiro_resumo(p_empresa uuid, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fat numeric; v_var numeric; v_imp numeric; v_receb numeric; v_rec_man numeric; v_desp numeric; v_desp_lanc numeric; v_oper numeric; c public.empresa_config;
begin
  if not private.tem_permissao(p_empresa, 'financeiro_ver') then raise exception 'Sem acesso ao financeiro'; end if;
  select * into c from public.empresa_config where empresa_id = p_empresa;
  -- competência (vendas do período)
  select coalesce(sum(valor_total), 0), coalesce(sum(case when custo_real > 0 then custo_real else coalesce(custo_estimado, 0) end), 0), coalesce(sum(impostos_estimados), 0)
    into v_fat, v_var, v_imp from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date between p_inicio and p_fim;
  -- caixa (o que entrou/saiu de fato no período)
  select coalesce(sum(valor), 0) into v_receb from public.pagamentos where empresa_id = p_empresa and not estornado and data between p_inicio and p_fim;
  select coalesce(sum(valor), 0) into v_rec_man from public.lancamentos where empresa_id = p_empresa and tipo = 'receita' and pago and not cancelado and data_pagamento between p_inicio and p_fim;
  select coalesce(sum(valor), 0) into v_desp from public.gastos where empresa_id = p_empresa and data between p_inicio and p_fim;
  select coalesce(sum(valor), 0) into v_desp_lanc from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and pago and not cancelado and data_pagamento between p_inicio and p_fim;
  -- despesas operacionais por competência (materiais ficam de fora: já estão no custo dos pedidos)
  select coalesce(sum(valor), 0) into v_oper from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and not cancelado
     and vencimento between p_inicio and p_fim and categoria not in ('filamentos','resinas','embalagens');
  return jsonb_build_object(
    'faturamento', v_fat, 'custos_variaveis', v_var, 'impostos_taxas', v_imp,
    'margem_contribuicao', v_fat - v_var - v_imp,
    'lucro_bruto', v_fat - v_var,
    'despesas_operacionais', v_oper,
    -- sem despesas lançadas no período, usa os custos fixos da configuração (nunca os dois juntos)
    'custos_fixos', case when v_oper > 0 then 0 else round(coalesce(c.custos_fixos_mensais, 0) * (p_fim - p_inicio + 1) / 30, 2) end,
    'resultado_liquido', v_fat - v_var - v_imp - case when v_oper > 0 then v_oper else round(coalesce(c.custos_fixos_mensais, 0) * (p_fim - p_inicio + 1) / 30, 2) end,
    'receita_recebida', v_receb + v_rec_man, 'despesas_pagas', v_desp + v_desp_lanc, 'fluxo_caixa', v_receb + v_rec_man - v_desp - v_desp_lanc,
    'a_receber', (select coalesce(sum(valor_total - valor_pago), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and valor_total > valor_pago)
               + (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'receita' and not pago and not cancelado),
    'a_pagar', (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and not pago and not cancelado),
    'vencidas_pagar', (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and not pago and not cancelado and vencimento < current_date),
    'mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
        'entradas', (select coalesce(sum(valor), 0) from public.pagamentos where empresa_id = p_empresa and not estornado and date_trunc('month', data) = m)
                  + (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'receita' and pago and not cancelado and date_trunc('month', data_pagamento) = m),
        'saidas', (select coalesce(sum(valor), 0) from public.gastos where empresa_id = p_empresa and date_trunc('month', data) = m)
                + (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and pago and not cancelado and date_trunc('month', data_pagamento) = m)) order by m)
        from generate_series(date_trunc('month', p_fim::timestamp) - interval '11 months', date_trunc('month', p_fim::timestamp), interval '1 month') m), '[]'::jsonb),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id', cf.id, 'nome', cf.nome, 'tipo', cf.tipo, 'saldo',
        cf.saldo_inicial
        + (select coalesce(sum(valor), 0) from public.pagamentos where conta_id = cf.id and not estornado)
        + (select coalesce(sum(case when tipo = 'receita' then valor else -valor end), 0) from public.lancamentos where conta_id = cf.id and pago and not cancelado)) order by cf.nome)
        from public.contas_financeiras cf where cf.empresa_id = p_empresa and cf.ativa), '[]'::jsonb));
end; $$;

revoke all on function public.registrar_pagamento(uuid, numeric, date, text, uuid, text), public.estornar_pagamento(uuid, text),
  public.liberar_ordem(uuid), public.iniciar_ordem(uuid), public.pausar_ordem(uuid, text), public.finalizar_impressao(uuid, numeric, numeric, numeric, numeric, text),
  public.avancar_ordem(uuid, public.status_op, text), public.registrar_falha(uuid, numeric, numeric, text, boolean), public.cancelar_ordem(uuid, text),
  public.replanejar_ordem(uuid), public.gerar_ordens_pedido(uuid), public.atualizar_entrega(uuid, public.status_entrega_pedido, text, text),
  public.cancelar_pedido(uuid, text), public.criar_lancamentos(uuid, text, text, text, numeric, date, integer, integer, boolean, uuid, text, text, text),
  public.financeiro_resumo(uuid, date, date) from public, anon;
grant execute on function public.registrar_pagamento(uuid, numeric, date, text, uuid, text), public.estornar_pagamento(uuid, text),
  public.liberar_ordem(uuid), public.iniciar_ordem(uuid), public.pausar_ordem(uuid, text), public.finalizar_impressao(uuid, numeric, numeric, numeric, numeric, text),
  public.avancar_ordem(uuid, public.status_op, text), public.registrar_falha(uuid, numeric, numeric, text, boolean), public.cancelar_ordem(uuid, text),
  public.replanejar_ordem(uuid), public.gerar_ordens_pedido(uuid), public.atualizar_entrega(uuid, public.status_entrega_pedido, text, text),
  public.cancelar_pedido(uuid, text), public.criar_lancamentos(uuid, text, text, text, numeric, date, integer, integer, boolean, uuid, text, text, text),
  public.financeiro_resumo(uuid, date, date) to authenticated;

-- =====================================================================
-- Funções existentes atualizadas para a Fase 3
-- =====================================================================

create or replace function public.converter_orcamento_em_pedido(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; v_ped uuid;
begin
  select * into o from public.orcamentos where id = p_id for update;
  if o.id is null or not (private.pode(o.empresa_id, 'orcamentos_criar') and private.pode(o.empresa_id, 'pedidos_editar')) then
    raise exception 'Sem permissão para gerar pedidos';
  end if;
  if o.pedido_id is not null then return o.pedido_id; end if;
  if o.status <> 'aprovado' then raise exception 'Somente orçamentos aprovados viram pedido'; end if;
  insert into public.pedidos(empresa_id, cliente_id, status, tipo_servico, descricao, valor_total, valor_pago, custo_estimado, data_entrega, origem, created_by, orcamento_id, impostos_estimados)
  values (o.empresa_id, o.cliente_id, 'aprovado', 'impressao_3d', o.titulo, o.total, 0, o.custo_total,
          current_date + coalesce(o.prazo_entrega_dias, 0), 'orcamento', (select auth.uid()), o.id, o.impostos_total + o.taxas_total)
  returning id into v_ped;
  insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario, produto_id, material_id, impressora_id, cor, peso_g, tempo_h, arquivo_path)
  select o.empresa_id, v_ped, i.descricao || coalesce(' · ' || nullif(i.cor, ''), ''), i.quantidade, i.preco_unitario, i.produto_id,
         i.material_id, i.impressora_id, i.cor, i.peso_g, i.tempo_h, i.arquivo_path
    from public.orcamento_itens i where i.orcamento_id = o.id order by i.ordem;
  if o.frete_cobrado > 0 then insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario) values (o.empresa_id, v_ped, 'Frete', 1, o.frete_cobrado); end if;
  if o.desconto_valor > 0 then insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario) values (o.empresa_id, v_ped, 'Desconto', 1, -o.desconto_valor); end if;
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = 'convertido', pedido_id = v_ped where id = o.id;
  perform private.snapshot_orcamento(o.id, 'convertido');
  perform public.gerar_ordens_pedido(v_ped);   -- FLUXO A: pedido já nasce com as ordens de produção planejadas
  perform set_config('app.orcamento_rpc', '0', true);
  return v_ped;
end; $$;

create or replace function public.painel_dashboard(p_empresa uuid, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_fin boolean; v_ped boolean; v_mat boolean; v_imp boolean; v_orc boolean; c public.empresa_config;
        r jsonb := '{}'::jsonb; v_dias numeric; v_fat numeric; v_custo numeric; v_desp numeric; v_receb numeric;
begin
  if not private.is_membro(p_empresa) then raise exception 'Sem acesso'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'Período inválido'; end if;
  v_fin := private.tem_permissao(p_empresa, 'financeiro_ver');
  v_ped := private.tem_permissao(p_empresa, 'pedidos_ver');
  v_mat := private.tem_permissao(p_empresa, 'materia_ver');
  v_imp := private.tem_permissao(p_empresa, 'impressoras_ver');
  v_orc := private.tem_permissao(p_empresa, 'orcamentos_ver') or private.tem_permissao(p_empresa, 'orcamentos_criar');
  select * into c from public.empresa_config where empresa_id = p_empresa;
  v_dias := p_fim - p_inicio + 1;

  if v_ped then
    r := r || jsonb_build_object(
      'pedidos_recebidos', (select count(*) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date between p_inicio and p_fim),
      'pedidos_producao', (select count(*) from public.pedidos where empresa_id = p_empresa and status = 'em_producao'),
      'pedidos_atrasados', (select count(*) from public.pedidos where empresa_id = p_empresa and status in ('orcamento','aprovado','em_producao','pronto') and data_entrega < current_date),
      'proximas_entregas', coalesce((select jsonb_agg(x order by x->>'data_entrega') from (
          select jsonb_build_object('id', p.id, 'numero', p.numero, 'descricao', p.descricao, 'cliente', cl.nome, 'data_entrega', p.data_entrega, 'status', p.status) x
            from public.pedidos p left join public.clientes cl on cl.id = p.cliente_id
           where p.empresa_id = p_empresa and p.status in ('aprovado','em_producao','pronto') and p.data_entrega is not null
           order by p.data_entrega limit 6) s), '[]'::jsonb),
      'mais_vendidos', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('nome', coalesce(pr.nome, pi.descricao), 'quantidade', sum(pi.quantidade)) x
            from public.pedido_itens pi join public.pedidos p on p.id = pi.pedido_id left join public.produtos pr on pr.id = pi.produto_id
           where pi.empresa_id = p_empresa and p.status <> 'cancelado' and p.created_at::date between p_inicio and p_fim
             and pi.valor_unitario > 0 and pi.descricao not in ('Frete','Desconto')
           group by coalesce(pr.nome, pi.descricao) order by sum(pi.quantidade) desc limit 5) s), '[]'::jsonb),
      'ordens_ativas', (select count(*) from public.ordens_producao where empresa_id = p_empresa and status in ('na_fila','imprimindo','pausada','acabamento','qualidade')),
      'producao_mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
          'entregues', (select count(*) from public.pedidos where empresa_id = p_empresa and status = 'entregue' and date_trunc('month', updated_at) = m)) order by m)
          from generate_series(date_trunc('month', p_fim::timestamp) - interval '11 months', date_trunc('month', p_fim::timestamp), interval '1 month') m), '[]'::jsonb));
  end if;

  if v_fin then
    select coalesce(sum(valor_total), 0), coalesce(sum((case when custo_real > 0 then custo_real else coalesce(custo_estimado, 0) end)), 0) into v_fat, v_custo
      from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date between p_inicio and p_fim;
    select coalesce(sum(valor), 0) into v_desp from public.gastos where empresa_id = p_empresa and data between p_inicio and p_fim;
    select coalesce(sum(valor_pago), 0) into v_receb from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date between p_inicio and p_fim;
    r := r || jsonb_build_object(
      'faturamento_dia', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date = current_date),
      'faturamento_periodo', v_fat,
      'faturamento_mes', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = date_trunc('month', now())),
      -- lucro bruto: vendas − custo estimado de produção dos pedidos
      'lucro_bruto', v_fat - v_custo,
      -- líquido estimado: bruto − custos fixos proporcionais ao período (compras de material já estão no custo dos pedidos)
      'lucro_liquido_estimado', round(v_fat - v_custo - coalesce(c.custos_fixos_mensais, 0) * v_dias / 30, 2),
      'custos_fixos_periodo', round(coalesce(c.custos_fixos_mensais, 0) * v_dias / 30, 2),
      -- caixa: o que entrou − o que saiu (diferente de lucro)
      'recebido_periodo', v_receb,
      'despesas_periodo', v_desp,
      'caixa_periodo', v_receb - v_desp,
      'contas_pagar', (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and not pago and not cancelado),
      'contas_receber', (select coalesce(sum(valor_total - valor_pago), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and valor_total > valor_pago),
      'vendas_diarias', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'valor',
          (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date = d::date)) order by d)
          from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d), '[]'::jsonb),
      'mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
          'faturamento', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m),
          'lucro', (select coalesce(sum(valor_total - (case when custo_real > 0 then custo_real else coalesce(custo_estimado, 0) end)), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m)
            - coalesce(c.custos_fixos_mensais, 0)) order by m)
          from generate_series(date_trunc('month', p_fim::timestamp) - interval '11 months', date_trunc('month', p_fim::timestamp), interval '1 month') m), '[]'::jsonb),
      'custos_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', v) order by v desc) from (
          select categoria, sum(valor) v from public.gastos where empresa_id = p_empresa and data between p_inicio and p_fim group by categoria) s), '[]'::jsonb));
  end if;

  if v_orc then
    r := r || jsonb_build_object(
      'orcamentos_aguardando', (select count(*) from public.orcamentos where empresa_id = p_empresa and status = 'enviado' and validade >= current_date),
      'orcamentos_aprovados_periodo', (select count(*) from public.orcamentos where empresa_id = p_empresa and status in ('aprovado','convertido') and respondido_em::date between p_inicio and p_fim),
      'orcamentos_enviados_periodo', (select count(*) from public.orcamentos where empresa_id = p_empresa and enviado_em::date between p_inicio and p_fim));
  end if;

  if v_imp then
    r := r || jsonb_build_object('impressoras', (select jsonb_build_object(
      'disponiveis', count(*) filter (where status = 'disponivel'),
      'funcionando', count(*) filter (where status in ('imprimindo','reservada')),
      'manutencao', count(*) filter (where status = 'manutencao'),
      'paradas', count(*) filter (where status in ('pausada','inativa')),
      'total', count(*)) from public.impressoras where empresa_id = p_empresa));
  end if;

  if v_mat then
    r := r || jsonb_build_object(
      'alertas_estoque', (select count(*) from public.materiais where empresa_id = p_empresa and ativo and estoque_minimo > 0 and quantidade - quantidade_reservada <= estoque_minimo),
      'consumo_materia', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('nome', m.nome || coalesce(' ' || m.cor, ''), 'unidade', m.unidade, 'quantidade', sum(mv.quantidade),
                                    'valor', round(sum(mv.quantidade) * m.custo_medio, 2)) x
            from public.movimentacoes_estoque mv join public.materiais m on m.id = mv.material_id
           where mv.empresa_id = p_empresa and mv.tipo = 'saida' and mv.estorno_de is null and mv.created_at::date between p_inicio and p_fim
             and not exists (select 1 from public.movimentacoes_estoque e where e.estorno_de = mv.id)
           group by m.id, m.nome, m.cor, m.unidade, m.custo_medio order by sum(mv.quantidade) * m.custo_medio desc limit 5) s), '[]'::jsonb));
  end if;

  return r || jsonb_build_object('permissoes', jsonb_build_object('financeiro', v_fin, 'pedidos', v_ped, 'materia', v_mat, 'impressoras', v_imp, 'orcamentos', v_orc));
end; $$;

create or replace function private.pode_enviar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or not private.is_membro(v_emp) then return false; end if;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then return false; end if;
  -- só extensões esperadas (modelos, imagens e documentos); nada executável
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','gcode','png','jpg','jpeg','webp','pdf') then return false; end if;
  if split_part(p_nome, '/', 2) not in ('logo','produtos','orcamentos','impressoras','clientes','producao','financeiro','pedidos') then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

create or replace function public.minhas_notificacoes(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := '[]'::jsonb; a record;
begin
  if not private.is_membro(p_empresa) then raise exception 'Sem acesso'; end if;
  if private.tem_permissao(p_empresa, 'materia_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'estoque-' || id, 'tipo', 'estoque', 'nivel', 'alerta',
              'titulo', 'Matéria-prima abaixo do mínimo', 'texto', nome || coalesce(' ' || cor, '') || ': ' || round(quantidade - quantidade_reservada, 2) || ' ' || unidade || ' disponível',
              'link', '/materia-prima/')) from public.materiais
             where empresa_id = p_empresa and ativo and estoque_minimo > 0 and quantidade - quantidade_reservada <= estoque_minimo), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'pedidos_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'atraso-' || id, 'tipo', 'pedido', 'nivel', 'erro', 'titulo', 'Pedido atrasado',
              'texto', '#' || numero || ' ' || coalesce(descricao, '') || ' — entrega era ' || to_char(data_entrega, 'DD/MM'), 'link', '/pedidos/')) from public.pedidos
             where empresa_id = p_empresa and status in ('aprovado','em_producao','pronto') and data_entrega < current_date), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'orcamentos_ver') or private.tem_permissao(p_empresa, 'orcamentos_criar') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'orc-' || id || '-' || status, 'tipo', 'orcamento',
              'nivel', case when status = 'aprovado' then 'sucesso' when status = 'rejeitado' then 'alerta' else 'info' end,
              'titulo', case when status = 'aprovado' then 'Orçamento aprovado' when status = 'rejeitado' then 'Orçamento recusado' else 'Orçamento vence em breve' end,
              'texto', '#' || numero || ' ' || titulo, 'link', '/orcamentos/?id=' || id)) from public.orcamentos
             where empresa_id = p_empresa and ((status in ('aprovado','rejeitado') and respondido_em > now() - interval '7 days')
                or (status = 'enviado' and validade between current_date and current_date + 2))), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'impressoras_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'imp-' || id, 'tipo', 'impressora', 'nivel', 'info', 'titulo', 'Impressora em manutenção',
              'texto', nome, 'link', '/impressoras/')) from public.impressoras where empresa_id = p_empresa and status = 'manutencao'), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'producao_gerenciar') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'op-' || id || '-' || status, 'tipo', 'producao',
              'nivel', case when status = 'falha' then 'erro' else 'alerta' end,
              'titulo', case when status = 'falha' then 'Falha de impressão' else 'Ordem aguardando material' end,
              'texto', 'OP-' || numero || ' ' || descricao, 'link', '/producao/?id=' || id)) from public.ordens_producao
             where empresa_id = p_empresa and (status = 'aguardando_material' or (status = 'falha' and updated_at > now() - interval '3 days'))), '[]'::jsonb);
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'opok-' || id, 'tipo', 'producao', 'nivel', 'sucesso', 'titulo', 'Produção concluída',
              'texto', 'OP-' || numero || ' ' || descricao, 'link', '/producao/?id=' || id)) from public.ordens_producao
             where empresa_id = p_empresa and status = 'concluida' and concluida_em > now() - interval '1 day'), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'financeiro_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'conta-' || id, 'tipo', 'financeiro', 'nivel', 'erro', 'titulo', 'Conta vencida',
              'texto', descricao || ' — venceu ' || to_char(vencimento, 'DD/MM'), 'link', '/financeiro/?aba=pagar')) from public.lancamentos
             where empresa_id = p_empresa and tipo = 'despesa' and not pago and not cancelado and vencimento < current_date), '[]'::jsonb);
  end if;
  if private.is_admin(p_empresa) then
    select a2.status, a2.teste_ate, a2.proxima_cobranca into a from public.assinaturas a2 where a2.empresa_id = p_empresa order by a2.created_at desc limit 1;
    if a.status = 'teste' and a.teste_ate <= current_date + 5 then
      r := r || jsonb_build_array(jsonb_build_object('id', 'assin-teste-' || a.teste_ate, 'tipo', 'assinatura', 'nivel', 'alerta', 'titulo', 'Período de teste acabando',
             'texto', 'Seu teste vai até ' || to_char(a.teste_ate, 'DD/MM/YYYY'), 'link', '/assinatura/'));
    elsif a.status in ('atrasada','pendente') then
      r := r || jsonb_build_array(jsonb_build_object('id', 'assin-' || a.status, 'tipo', 'assinatura', 'nivel', 'erro', 'titulo', 'Assinatura com pagamento pendente',
             'texto', 'Regularize para não ter o acesso suspenso', 'link', '/assinatura/'));
    elsif a.status = 'ativa' and a.proxima_cobranca <= current_date + 3 then
      r := r || jsonb_build_array(jsonb_build_object('id', 'assin-cobr-' || a.proxima_cobranca, 'tipo', 'assinatura', 'nivel', 'info', 'titulo', 'Assinatura próxima do vencimento',
             'texto', 'Próxima cobrança em ' || to_char(a.proxima_cobranca, 'DD/MM/YYYY'), 'link', '/assinatura/'));
    end if;
  end if;
  return r;
end; $$;
