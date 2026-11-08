-- =====================================================================
-- FASE 2 — Orçamentos inteligentes (cálculo no servidor, revisões, aprovação por link)
-- =====================================================================
do $$ begin
  create type public.status_orcamento as enum ('rascunho','enviado','aprovado','rejeitado','convertido','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  oportunidade_id uuid references public.crm_oportunidades(id) on delete set null,
  titulo text not null check (length(trim(titulo)) between 1 and 200),
  descricao text check (length(descricao) <= 5000),
  status public.status_orcamento not null default 'rascunho',
  validade date,
  prazo_entrega_dias integer check (prazo_entrega_dias between 0 and 365),
  desconto_valor numeric(12,2) not null default 0 check (desconto_valor >= 0),
  frete_cobrado numeric(12,2) not null default 0 check (frete_cobrado >= 0),
  observacoes text check (length(observacoes) <= 5000),
  condicoes text check (length(condicoes) <= 5000),
  -- totais (calculados pelo banco)
  subtotal numeric(12,2) not null default 0,
  custo_total numeric(12,2) not null default 0,
  impostos_total numeric(12,2) not null default 0,
  taxas_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0 check (total >= 0),
  lucro_estimado numeric(12,2) not null default 0,
  revisao integer not null default 0,
  token_publico text unique,
  enviado_em timestamptz, respondido_em timestamptz,
  aprovado_por text check (length(aprovado_por) <= 200),
  motivo_rejeicao text check (length(motivo_rejeicao) <= 2000),
  pedido_id uuid references public.pedidos(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists orcamentos_empresa_idx on public.orcamentos(empresa_id, created_at desc);
create index if not exists orcamentos_cliente_idx on public.orcamentos(cliente_id);
alter table public.orcamentos enable row level security;
create policy orcamentos_ler on public.orcamentos for select using (private.tem_permissao(empresa_id, 'orcamentos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_acesso_suporte(empresa_id));
create policy orcamentos_inserir on public.orcamentos for insert with check (private.pode(empresa_id, 'orcamentos_criar') and status = 'rascunho');
create policy orcamentos_alterar on public.orcamentos for update using (private.pode(empresa_id, 'orcamentos_criar')) with check (private.pode(empresa_id, 'orcamentos_criar'));
create policy orcamentos_excluir on public.orcamentos for delete using (private.pode(empresa_id, 'orcamentos_criar') and status in ('rascunho','cancelado'));
create trigger trg_audemp_orcamentos after insert or update or delete on public.orcamentos for each row execute function private.auditar_empresa();

create table if not exists public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  ordem integer not null default 0,
  produto_id uuid references public.produtos(id) on delete set null,
  variante_id uuid references public.produto_variantes(id) on delete set null,
  descricao text not null check (length(trim(descricao)) between 1 and 300),
  tecnologia public.tecnologia_impressao not null default 'fdm',
  impressora_id uuid references public.impressoras(id) on delete set null,
  material_id uuid references public.materiais(id) on delete set null,
  cor text check (length(cor) <= 60),
  quantidade numeric(12,2) not null default 1 check (quantidade > 0),
  -- entradas por unidade
  peso_g numeric(10,2) not null default 0 check (peso_g >= 0),
  tempo_h numeric(8,2) not null default 0 check (tempo_h >= 0),
  desperdicio_pct numeric(5,2) check (desperdicio_pct >= 0 and desperdicio_pct <= 200),
  suportes_custo numeric(12,2) not null default 0 check (suportes_custo >= 0),
  mao_obra_h numeric(8,2) not null default 0 check (mao_obra_h >= 0),
  acabamento_custo numeric(12,2) not null default 0 check (acabamento_custo >= 0),
  pintura_custo numeric(12,2) not null default 0 check (pintura_custo >= 0),
  embalagem_custo numeric(12,2) not null default 0 check (embalagem_custo >= 0),
  frete_assumido numeric(12,2) not null default 0 check (frete_assumido >= 0),
  outros_custos numeric(12,2) not null default 0 check (outros_custos >= 0),
  desconto_terceiros numeric(12,2) not null default 0 check (desconto_terceiros >= 0),
  margem_pct numeric(5,2) check (margem_pct >= 0 and margem_pct < 100),
  impostos_pct numeric(5,2) check (impostos_pct >= 0 and impostos_pct < 100),
  taxas_pct numeric(5,2) check (taxas_pct >= 0 and taxas_pct < 100),
  preco_manual numeric(12,2) check (preco_manual >= 0),
  arquivo_path text, arquivo_nome text, volume_cm3 numeric(12,3) check (volume_cm3 >= 0),
  -- parâmetros usados no cálculo (congelados no item)
  preco_kg numeric(14,4), energia_kwh numeric(10,4), potencia_w numeric(8,1), custo_hora_maquina numeric(10,4), mao_obra_hora numeric(12,2),
  -- resultado por unidade
  custo_material numeric(12,4), custo_energia numeric(12,4), custo_maquina numeric(12,4), custo_mao_obra numeric(12,4),
  custo_unitario numeric(12,4), preco_unitario numeric(12,2),
  -- resultado do item
  preco_total numeric(12,2), custo_total numeric(12,2), impostos_valor numeric(12,2), taxas_valor numeric(12,2), lucro numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_percentuais check (coalesce(margem_pct, 0) + coalesce(impostos_pct, 0) + coalesce(taxas_pct, 0) < 100)
);
create index if not exists orcamento_itens_idx on public.orcamento_itens(orcamento_id, ordem);
alter table public.orcamento_itens enable row level security;
create policy orc_itens_ler on public.orcamento_itens for select using (private.tem_permissao(empresa_id, 'orcamentos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_acesso_suporte(empresa_id));
create policy orc_itens_inserir on public.orcamento_itens for insert with check (private.pode(empresa_id, 'orcamentos_criar'));
create policy orc_itens_alterar on public.orcamento_itens for update using (private.pode(empresa_id, 'orcamentos_criar')) with check (private.pode(empresa_id, 'orcamentos_criar'));
create policy orc_itens_excluir on public.orcamento_itens for delete using (private.pode(empresa_id, 'orcamentos_criar'));

create table if not exists public.orcamento_revisoes (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  revisao integer not null,
  evento text not null,
  dados jsonb not null,
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists orc_revisoes_idx on public.orcamento_revisoes(orcamento_id, id desc);
alter table public.orcamento_revisoes enable row level security;
create policy orc_revisoes_ler on public.orcamento_revisoes for select using (private.tem_permissao(empresa_id, 'orcamentos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar'));

-- ---------- Numeração e regras do cabeçalho ---------------------------
create or replace function private.orcamento_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.empresa_config; v_rpc boolean := coalesce(current_setting('app.orcamento_rpc', true), '') = '1';
        v_sub numeric; v_custo numeric; v_imp numeric; v_tax numeric; v_lucro numeric;
begin
  select * into c from public.empresa_config where empresa_id = new.empresa_id;
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' and not v_rpc then raise exception 'Orçamento novo começa como rascunho'; end if;
    new.numero := private.proximo_numero(new.empresa_id, 'orcamento');
    new.validade := coalesce(new.validade, current_date + coalesce(c.validade_orcamento_dias, 15));
    new.prazo_entrega_dias := coalesce(new.prazo_entrega_dias, c.prazo_padrao_dias);
    new.token_publico := null; new.revisao := 0; new.pedido_id := null;
    new.enviado_em := null; new.respondido_em := null; new.aprovado_por := null;
  else
    if new.empresa_id <> old.empresa_id or new.numero <> old.numero then raise exception 'Campo não pode ser alterado'; end if;
    -- status, token, revisão e vínculo com pedido só mudam pelas funções de fluxo
    if not v_rpc and (new.status is distinct from old.status or new.token_publico is distinct from old.token_publico
        or new.revisao is distinct from old.revisao or new.pedido_id is distinct from old.pedido_id
        or new.enviado_em is distinct from old.enviado_em or new.respondido_em is distinct from old.respondido_em
        or new.aprovado_por is distinct from old.aprovado_por) then
      raise exception 'Use os botões Enviar, Aprovar, Rejeitar ou Converter para mudar a situação do orçamento';
    end if;
    -- aprovado/convertido/cancelado: valores congelados
    if old.status in ('aprovado','convertido','cancelado') and not v_rpc and
       (new.desconto_valor <> old.desconto_valor or new.frete_cobrado <> old.frete_cobrado or new.cliente_id is distinct from old.cliente_id
        or new.titulo <> old.titulo or new.validade is distinct from old.validade or new.prazo_entrega_dias is distinct from old.prazo_entrega_dias) then
      raise exception 'Orçamento %: valores preservados. Duplique para criar um novo.', old.status;
    end if;
  end if;
  if new.cliente_id is not null and not exists (select 1 from public.clientes where id = new.cliente_id and empresa_id = new.empresa_id) then
    raise exception 'Cliente não encontrado';
  end if;

  -- totais a partir dos itens (o item já guarda o cálculo congelado)
  select coalesce(sum(preco_total), 0), coalesce(sum(custo_total), 0), coalesce(sum(impostos_valor), 0), coalesce(sum(taxas_valor), 0), coalesce(sum(lucro), 0)
    into v_sub, v_custo, v_imp, v_tax, v_lucro
    from public.orcamento_itens where orcamento_id = new.id;
  if tg_op = 'UPDATE' and old.status in ('aprovado','convertido','cancelado') then
    return new; -- não recalcula valores aprovados
  end if;
  if new.desconto_valor > v_sub then raise exception 'O desconto (R$ %) é maior que o subtotal (R$ %)', new.desconto_valor, v_sub; end if;
  -- desconto acima do limite livre exige permissão de aprovar descontos
  if new.desconto_valor > 0 and (tg_op = 'INSERT' or new.desconto_valor > old.desconto_valor)
     and v_sub > 0 and new.desconto_valor / v_sub * 100 > coalesce(c.desconto_livre_pct, 0)
     and not private.tem_permissao(new.empresa_id, 'descontos_aprovar') then
    raise exception 'Desconto acima de % %% precisa ser aprovado por quem tem permissão de aprovar descontos', coalesce(c.desconto_livre_pct, 0);
  end if;
  new.subtotal := v_sub;
  new.custo_total := v_custo;
  new.impostos_total := round(v_imp * case when v_sub > 0 then (v_sub - new.desconto_valor) / v_sub else 1 end, 2);
  new.taxas_total := round(v_tax * case when v_sub > 0 then (v_sub - new.desconto_valor) / v_sub else 1 end, 2);
  new.total := v_sub - new.desconto_valor + new.frete_cobrado;
  -- lucro: receita líquida de desconto − custos − impostos/taxas sobre o valor efetivamente vendido (frete cobrado repassa o frete)
  new.lucro_estimado := round(v_sub - new.desconto_valor - v_custo - new.impostos_total - new.taxas_total, 2);
  return new;
end; $$;
create trigger trg_orcamento_antes before insert or update on public.orcamentos for each row execute function private.orcamento_antes();
create trigger trg_orcamento_upd before update on public.orcamentos for each row execute function public.set_updated_at();

-- ---------- Cálculo do item (fórmulas do prompt) ----------------------
create or replace function private.calcular_item_orcamento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; c public.empresa_config; m public.materiais; i public.impressoras; cli public.clientes; pr public.produtos;
        v_margem numeric; v_imp numeric; v_tax numeric; v_desp numeric; v_den numeric;
begin
  select * into o from public.orcamentos where id = coalesce(new.orcamento_id, old.orcamento_id);
  if o.status in ('aprovado','convertido','cancelado') and current_setting('app.orcamento_rpc', true) is distinct from '1' then
    raise exception 'Orçamento %: os itens não podem mais ser alterados. Duplique para criar um novo.', o.status;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.empresa_id <> o.empresa_id then raise exception 'Item de outra empresa'; end if;

  select * into c from public.empresa_config where empresa_id = new.empresa_id;
  if new.material_id is not null then
    select * into m from public.materiais where id = new.material_id and empresa_id = new.empresa_id;
    if m.id is null then raise exception 'Matéria-prima não encontrada'; end if;
  end if;
  if new.impressora_id is not null then
    select * into i from public.impressoras where id = new.impressora_id and empresa_id = new.empresa_id;
    if i.id is null then raise exception 'Impressora não encontrada'; end if;
  end if;
  if new.produto_id is not null then
    select * into pr from public.produtos where id = new.produto_id and empresa_id = new.empresa_id;
    if pr.id is null then raise exception 'Produto não encontrado'; end if;
  end if;
  if o.cliente_id is not null then select * into cli from public.clientes where id = o.cliente_id; end if;

  -- parâmetros: valores atuais do cadastro, congelados no item
  new.preco_kg := case when m.id is not null then private.preco_kg(m.custo_medio, m.unidade, m.peso_liquido_g) else 0 end;
  new.energia_kwh := coalesce(c.energia_kwh, 0);
  new.potencia_w := coalesce(i.potencia_w, 0);
  new.custo_hora_maquina := coalesce(i.custo_hora, 0);
  new.mao_obra_hora := coalesce(c.mao_obra_hora, 0);
  -- margem: item > cliente > produto > material > configuração
  v_margem := coalesce(new.margem_pct, cli.margem_pct, pr.margem_pct, m.margem_pct, c.margem_pct, 0);
  v_imp := coalesce(new.impostos_pct, c.impostos_pct, 0);
  v_tax := coalesce(new.taxas_pct, c.taxas_pct, 0);
  v_desp := coalesce(new.desperdicio_pct, c.desperdicio_pct, 0);
  new.margem_pct := v_margem; new.impostos_pct := v_imp; new.taxas_pct := v_tax; new.desperdicio_pct := v_desp;
  v_den := 1 - (v_margem + v_imp + v_tax) / 100;
  if v_den <= 0 then raise exception 'A soma de margem, impostos e taxas precisa ser menor que 100%%'; end if;

  -- Custo de material = (peso/1000) × preço/kg × (1 + perdas)
  new.custo_material := round(new.peso_g / 1000 * new.preco_kg * (1 + v_desp / 100), 4);
  -- Custo de energia = kW × horas × tarifa
  new.custo_energia := round(new.potencia_w / 1000 * new.tempo_h * new.energia_kwh, 4);
  -- Custo de máquina = horas × custo/hora (depreciação + manutenção)
  new.custo_maquina := round(new.tempo_h * new.custo_hora_maquina, 4);
  new.custo_mao_obra := round(new.mao_obra_h * new.mao_obra_hora, 4);
  -- Custo total (unitário)
  new.custo_unitario := round(new.custo_material + new.custo_energia + new.custo_maquina + new.custo_mao_obra
                        + new.suportes_custo + new.acabamento_custo + new.pintura_custo + new.embalagem_custo
                        + new.frete_assumido + new.outros_custos, 4);
  if new.desconto_terceiros > new.custo_unitario then raise exception 'Desconto de terceiros maior que o custo do item'; end if;
  -- Preço = (custo − descontos de terceiros) / (1 − margem − impostos − taxas)
  new.preco_unitario := coalesce(new.preco_manual, round((new.custo_unitario - new.desconto_terceiros) / v_den, 2));
  new.preco_total := round(new.preco_unitario * new.quantidade, 2);
  new.custo_total := round((new.custo_unitario - new.desconto_terceiros) * new.quantidade, 2);
  new.impostos_valor := round(new.preco_total * v_imp / 100, 2);
  new.taxas_valor := round(new.preco_total * v_tax / 100, 2);
  new.lucro := new.preco_total - new.custo_total - new.impostos_valor - new.taxas_valor;
  return new;
end; $$;
create trigger trg_item_calcular before insert or update on public.orcamento_itens for each row execute function private.calcular_item_orcamento();
create trigger trg_item_excluir before delete on public.orcamento_itens for each row execute function private.calcular_item_orcamento();
create trigger trg_item_upd before update on public.orcamento_itens for each row execute function public.set_updated_at();

-- após mudar itens, recalcula o cabeçalho
create or replace function private.atualizar_totais_orcamento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.orcamentos set updated_at = now() where id = coalesce(new.orcamento_id, old.orcamento_id);
  return null;
end; $$;
create trigger trg_item_totais after insert or update or delete on public.orcamento_itens for each row execute function private.atualizar_totais_orcamento();

-- ---------- Fluxo ------------------------------------------------------
create or replace function private.snapshot_orcamento(p_id uuid, p_evento text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos;
begin
  select * into o from public.orcamentos where id = p_id;
  insert into public.orcamento_revisoes(empresa_id, orcamento_id, revisao, evento, dados)
  values (o.empresa_id, o.id, o.revisao, p_evento, jsonb_build_object('orcamento', to_jsonb(o),
          'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.ordem, i.created_at) from public.orcamento_itens i where i.orcamento_id = o.id), '[]'::jsonb)));
end; $$;

create or replace function public.enviar_orcamento(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; v_token text;
begin
  select * into o from public.orcamentos where id = p_id for update;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  if o.status not in ('rascunho','enviado','rejeitado') then raise exception 'Orçamento % não pode ser reenviado', o.status; end if;
  if not exists (select 1 from public.orcamento_itens where orcamento_id = o.id) then raise exception 'Adicione pelo menos um item'; end if;
  v_token := coalesce(o.token_publico, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = 'enviado', token_publico = v_token, revisao = revisao + 1, enviado_em = now(),
         respondido_em = null, motivo_rejeicao = null, aprovado_por = null,
         validade = greatest(coalesce(validade, current_date), current_date)
   where id = o.id;
  perform private.snapshot_orcamento(o.id, 'enviado');
  if o.oportunidade_id is not null then
    update public.crm_oportunidades set etapa = 'orcamento_enviado', valor_estimado = (select total from public.orcamentos where id = o.id)
     where id = o.oportunidade_id and etapa not in ('aprovado','perdido');
  end if;
  perform set_config('app.orcamento_rpc', '0', true);
  return v_token;
end; $$;

create or replace function public.decidir_orcamento(p_id uuid, p_aprovar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; v_nome text;
begin
  select * into o from public.orcamentos where id = p_id for update;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  if o.status not in ('rascunho','enviado') then raise exception 'Orçamento já está %', o.status; end if;
  if not exists (select 1 from public.orcamento_itens where orcamento_id = o.id) then raise exception 'Orçamento sem itens'; end if;
  if not p_aprovar and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da rejeição'; end if;
  select email into v_nome from auth.users where id = (select auth.uid());
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = case when p_aprovar then 'aprovado' else 'rejeitado' end::public.status_orcamento,
         respondido_em = now(), aprovado_por = case when p_aprovar then 'Interno: ' || coalesce(v_nome, 'usuário') end,
         motivo_rejeicao = case when not p_aprovar then trim(p_motivo) end
   where id = o.id;
  perform private.snapshot_orcamento(o.id, case when p_aprovar then 'aprovado' else 'rejeitado' end);
  if o.oportunidade_id is not null then
    update public.crm_oportunidades set etapa = case when p_aprovar then 'aprovado' else 'perdido' end::public.etapa_crm,
           motivo_perda = case when not p_aprovar then trim(p_motivo) end
     where id = o.oportunidade_id;
  end if;
  perform set_config('app.orcamento_rpc', '0', true);
end; $$;

create or replace function public.cancelar_orcamento(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos;
begin
  select * into o from public.orcamentos where id = p_id for update;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  if o.status = 'convertido' then raise exception 'Orçamento já virou pedido: cancele o pedido'; end if;
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = 'cancelado' where id = o.id;
  perform private.snapshot_orcamento(o.id, 'cancelado');
  perform set_config('app.orcamento_rpc', '0', true);
end; $$;

create or replace function public.duplicar_orcamento(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; v_id uuid;
begin
  select * into o from public.orcamentos where id = p_id;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  insert into public.orcamentos(empresa_id, cliente_id, oportunidade_id, titulo, descricao, prazo_entrega_dias, frete_cobrado, observacoes, condicoes)
  values (o.empresa_id, o.cliente_id, null, left(o.titulo || ' (cópia)', 200), o.descricao, o.prazo_entrega_dias, o.frete_cobrado, o.observacoes, o.condicoes)
  returning id into v_id;
  -- itens recalculados com os custos atuais
  insert into public.orcamento_itens(empresa_id, orcamento_id, ordem, produto_id, variante_id, descricao, tecnologia, impressora_id, material_id, cor, quantidade,
      peso_g, tempo_h, desperdicio_pct, suportes_custo, mao_obra_h, acabamento_custo, pintura_custo, embalagem_custo, frete_assumido, outros_custos,
      desconto_terceiros, margem_pct, impostos_pct, taxas_pct, preco_manual, arquivo_path, arquivo_nome, volume_cm3)
  select empresa_id, v_id, ordem, produto_id, variante_id, descricao, tecnologia, impressora_id, material_id, cor, quantidade,
      peso_g, tempo_h, desperdicio_pct, suportes_custo, mao_obra_h, acabamento_custo, pintura_custo, embalagem_custo, frete_assumido, outros_custos,
      desconto_terceiros, margem_pct, impostos_pct, taxas_pct, preco_manual, arquivo_path, arquivo_nome, volume_cm3
    from public.orcamento_itens where orcamento_id = o.id order by ordem;
  return v_id;
end; $$;

-- Orçamento aprovado → pedido (idempotente)
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
  insert into public.pedidos(empresa_id, cliente_id, status, tipo_servico, descricao, valor_total, valor_pago, custo_estimado, data_entrega, origem, created_by)
  values (o.empresa_id, o.cliente_id, 'aprovado', 'impressao_3d', o.titulo, o.total, 0, o.custo_total,
          current_date + coalesce(o.prazo_entrega_dias, 0), 'orcamento', (select auth.uid()))
  returning id into v_ped;
  insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario, produto_id)
  select o.empresa_id, v_ped, i.descricao || coalesce(' · ' || nullif(i.cor, ''), ''), i.quantidade, i.preco_unitario, i.produto_id
    from public.orcamento_itens i where i.orcamento_id = o.id order by i.ordem;
  if o.frete_cobrado > 0 then insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario) values (o.empresa_id, v_ped, 'Frete', 1, o.frete_cobrado); end if;
  if o.desconto_valor > 0 then insert into public.pedido_itens(empresa_id, pedido_id, descricao, quantidade, valor_unitario) values (o.empresa_id, v_ped, 'Desconto', 1, -o.desconto_valor); end if;
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = 'convertido', pedido_id = v_ped where id = o.id;
  perform private.snapshot_orcamento(o.id, 'convertido');
  perform set_config('app.orcamento_rpc', '0', true);
  return v_ped;
end; $$;

-- ---------- Link público de aprovação ---------------------------------
create or replace function public.orcamento_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orcamentos; e public.empresas;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Link inválido'; end if;
  select * into o from public.orcamentos where token_publico = p_token;
  if o.id is null or o.status in ('rascunho','cancelado') then raise exception 'Orçamento não encontrado ou cancelado'; end if;
  select * into e from public.empresas where id = o.empresa_id;
  return jsonb_build_object(
    'empresa', jsonb_build_object('nome', e.nome, 'whatsapp', e.whatsapp, 'email', e.email, 'cidade', e.cidade, 'uf', e.uf),
    'orcamento', jsonb_build_object('numero', o.numero, 'prefixo', (select prefixo_orcamento from public.empresa_config where empresa_id = o.empresa_id),
        'titulo', o.titulo, 'descricao', o.descricao, 'status', o.status,
        'expirado', (o.status = 'enviado' and o.validade < current_date), 'validade', o.validade, 'prazo_entrega_dias', o.prazo_entrega_dias,
        'subtotal', o.subtotal, 'desconto', o.desconto_valor, 'frete', o.frete_cobrado, 'total', o.total,
        'observacoes', o.observacoes, 'condicoes', o.condicoes, 'revisao', o.revisao, 'enviado_em', o.enviado_em,
        'respondido_em', o.respondido_em, 'cliente', (select nome from public.clientes where id = o.cliente_id)),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'cor', i.cor, 'material', m.nome, 'quantidade', i.quantidade,
                         'preco_unitario', i.preco_unitario, 'preco_total', i.preco_total) order by i.ordem, i.created_at)
                       from public.orcamento_itens i left join public.materiais m on m.id = i.material_id where i.orcamento_id = o.id), '[]'::jsonb));
end; $$;

create or replace function public.responder_orcamento_publico(p_token text, p_aprovar boolean, p_nome text, p_motivo text)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Link inválido'; end if;
  select * into o from public.orcamentos where token_publico = p_token for update;
  if o.id is null then raise exception 'Orçamento não encontrado'; end if;
  if o.status <> 'enviado' then raise exception 'Este orçamento já foi respondido ou não está disponível'; end if;
  if o.validade < current_date then raise exception 'Este orçamento venceu em %. Peça um novo à empresa.', to_char(o.validade, 'DD/MM/YYYY'); end if;
  if not exists (select 1 from public.empresas where id = o.empresa_id and status not in ('suspensa','cancelada')) then raise exception 'Empresa indisponível no momento'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Informe seu nome'; end if;
  if not p_aprovar and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Conte o motivo para a empresa'; end if;
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set status = case when p_aprovar then 'aprovado' else 'rejeitado' end::public.status_orcamento,
         respondido_em = now(), aprovado_por = case when p_aprovar then left('Cliente: ' || trim(p_nome), 200) end,
         motivo_rejeicao = case when not p_aprovar then left(trim(p_motivo), 2000) end
   where id = o.id;
  perform private.snapshot_orcamento(o.id, case when p_aprovar then 'aprovado_cliente' else 'rejeitado_cliente' end);
  if o.oportunidade_id is not null then
    update public.crm_oportunidades set etapa = case when p_aprovar then 'aprovado' else 'perdido' end::public.etapa_crm,
           motivo_perda = case when not p_aprovar then left(trim(p_motivo), 1000) end
     where id = o.oportunidade_id;
  end if;
  perform set_config('app.orcamento_rpc', '0', true);
  return case when p_aprovar then 'aprovado' else 'rejeitado' end;
end; $$;

revoke all on function public.enviar_orcamento(uuid), public.decidir_orcamento(uuid, boolean, text), public.cancelar_orcamento(uuid),
  public.duplicar_orcamento(uuid), public.converter_orcamento_em_pedido(uuid), public.orcamento_publico(text),
  public.responder_orcamento_publico(text, boolean, text, text) from public;
grant execute on function public.enviar_orcamento(uuid), public.decidir_orcamento(uuid, boolean, text), public.cancelar_orcamento(uuid),
  public.duplicar_orcamento(uuid), public.converter_orcamento_em_pedido(uuid) to authenticated;
grant execute on function public.orcamento_publico(text), public.responder_orcamento_publico(text, boolean, text, text) to anon, authenticated;
