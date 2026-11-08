-- =====================================================================
-- FASE 4 — Expansão: fornecedores e compras, manutenção das impressoras,
-- expedição, relatórios avançados e portal do comprador
-- =====================================================================

-- ---------- Ligações com o financeiro e o estoque ----------------------
alter table public.lancamentos
  add column if not exists compra_id uuid,
  add column if not exists manutencao_id uuid,
  add column if not exists envio_id uuid;
alter table public.movimentacoes_estoque add column if not exists compra_id uuid;

-- quem lança no financeiro não muda os vínculos com compras/manutenção/envio
create or replace function private.proteger_vinculos_lancamento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.fin_interno', true), '') = '1' or (select auth.uid()) is null or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    if new.compra_id is not null or new.manutencao_id is not null or new.envio_id is not null then
      raise exception 'Lançamentos de compras, manutenção e fretes são criados pelos próprios módulos';
    end if;
  elsif new.compra_id is distinct from old.compra_id or new.manutencao_id is distinct from old.manutencao_id or new.envio_id is distinct from old.envio_id then
    raise exception 'O vínculo do lançamento com compra, manutenção ou envio não pode ser alterado';
  end if;
  return new;
end; $$;
drop trigger if exists trg_lanc_vinculos on public.lancamentos;
create trigger trg_lanc_vinculos before insert or update on public.lancamentos for each row execute function private.proteger_vinculos_lancamento();

-- lançamento interno (usado pelos módulos; não exige permissão de financeiro de quem opera)
create or replace function private.lancar_despesa(p_empresa uuid, p_categoria text, p_descricao text, p_valor numeric, p_vencimento date,
  p_compra uuid, p_manutencao uuid, p_envio uuid, p_conta uuid, p_forma text, p_parcela int, p_total int, p_grupo uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; v_antes text := coalesce(current_setting('app.fin_interno', true), '');
begin
  perform set_config('app.fin_interno', '1', true);
  insert into public.lancamentos(empresa_id, tipo, categoria, descricao, valor, vencimento, conta_id, forma, compra_id, manutencao_id, envio_id, parcela, total_parcelas, grupo_id)
  values (p_empresa, 'despesa', p_categoria, left(p_descricao, 200), p_valor, p_vencimento, p_conta, p_forma, p_compra, p_manutencao, p_envio, p_parcela, p_total, p_grupo)
  returning id into v;
  perform set_config('app.fin_interno', v_antes, true);
  return v;
end; $$;

-- quem pode gerar lançamentos a partir dos módulos
create or replace function private.pode_lancar(p_empresa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode(p_empresa, 'financeiro_ver') or (private.is_admin(p_empresa) and private.pode(p_empresa, 'compras_gerenciar'));
$$;

-- =====================================================================
-- 1) FORNECEDORES E COMPRAS
-- =====================================================================
create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 150),
  documento text check (length(documento) <= 20),
  contato text check (length(contato) <= 100),
  telefone text check (length(telefone) <= 30),
  email text check (length(email) <= 150),
  endereco text check (length(endereco) <= 300),
  cidade text check (length(cidade) <= 100),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  materiais_fornecidos text check (length(materiais_fornecidos) <= 1000),
  condicoes_pagamento text check (length(condicoes_pagamento) <= 200),
  prazo_medio_dias integer check (prazo_medio_dias between 0 and 365),
  observacoes text check (length(observacoes) <= 5000),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fornecedores_empresa_idx on public.fornecedores(empresa_id, lower(nome));
alter table public.fornecedores enable row level security;
create trigger trg_fornecedores_upd before update on public.fornecedores for each row execute function public.set_updated_at();
create trigger trg_audemp_fornecedores after insert or update or delete on public.fornecedores for each row execute function private.auditar_empresa();
create policy fornecedores_ler on public.fornecedores for select using (private.tem_permissao(empresa_id, 'compras_gerenciar') or private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_acesso_suporte(empresa_id));
create policy fornecedores_inserir on public.fornecedores for insert with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy fornecedores_alterar on public.fornecedores for update using (private.pode(empresa_id, 'compras_gerenciar')) with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy fornecedores_excluir on public.fornecedores for delete using (private.pode(empresa_id, 'compras_gerenciar'));

do $$ begin
  create type public.status_compra as enum ('rascunho','solicitado','aprovado','enviado','parcial','recebido','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists public.pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  status public.status_compra not null default 'rascunho',
  data_pedido date,
  previsao_entrega date,
  subtotal numeric(12,2) not null default 0,
  frete numeric(12,2) not null default 0 check (frete >= 0),
  desconto numeric(12,2) not null default 0 check (desconto >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  categoria_financeira text not null default 'filamentos' check (categoria_financeira in ('filamentos','resinas','energia','manutencao','equipamentos','embalagens','fretes',
                                 'mao_de_obra','impostos','taxas_financeiras','publicidade','aluguel','software','outros')),
  parcelas integer not null default 1 check (parcelas between 1 and 24),
  primeiro_vencimento date,
  forma_pagamento text check (length(forma_pagamento) <= 60),
  conta_id uuid references public.contas_financeiras(id) on delete set null,
  observacoes text check (length(observacoes) <= 5000),
  motivo_cancelamento text check (length(motivo_cancelamento) <= 1000),
  solicitado_por uuid references auth.users(id) on delete set null,
  aprovado_por uuid references auth.users(id) on delete set null,
  aprovado_em timestamptz, enviado_em timestamptz, recebido_em timestamptz, cancelado_em timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists pc_empresa_idx on public.pedidos_compra(empresa_id, status, created_at desc);
create index if not exists pc_fornecedor_idx on public.pedidos_compra(fornecedor_id);
alter table public.pedidos_compra enable row level security;
create policy pc_ler on public.pedidos_compra for select using (private.tem_permissao(empresa_id, 'compras_gerenciar') or private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_acesso_suporte(empresa_id));
create policy pc_inserir on public.pedidos_compra for insert with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy pc_alterar on public.pedidos_compra for update using (private.pode(empresa_id, 'compras_gerenciar')) with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy pc_excluir on public.pedidos_compra for delete using (private.pode(empresa_id, 'compras_gerenciar') and status in ('rascunho','cancelado')
  and not exists (select 1 from public.lancamentos l where l.compra_id = pedidos_compra.id and l.pago));
create trigger trg_pc_upd before update on public.pedidos_compra for each row execute function public.set_updated_at();
create trigger trg_mesma_empresa before insert or update on public.pedidos_compra for each row execute function private.checar_mesma_empresa('fornecedor_id:fornecedores', 'conta_id:contas_financeiras');
create trigger trg_audemp_pc after insert or update or delete on public.pedidos_compra for each row execute function private.auditar_empresa();

create or replace function private.pc_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_int boolean := coalesce(current_setting('app.pc_interno', true), '') = '1' or (select auth.uid()) is null or pg_trigger_depth() > 1;
  v_livres text[] := array['fornecedor_id','data_pedido','previsao_entrega','frete','desconto','categoria_financeira','parcelas','primeiro_vencimento',
                           'forma_pagamento','conta_id','observacoes','updated_at','total'];
begin
  if tg_op = 'INSERT' then
    new.numero := private.proximo_numero(new.empresa_id, 'compra');
    if not v_int then
      new.status := 'rascunho'; new.subtotal := 0; new.aprovado_por := null; new.aprovado_em := null; new.enviado_em := null;
      new.recebido_em := null; new.cancelado_em := null; new.motivo_cancelamento := null; new.solicitado_por := null;
      new.created_by := (select auth.uid());
    end if;
  elsif not v_int then
    if (to_jsonb(new) - v_livres) <> (to_jsonb(old) - v_livres) then
      raise exception 'Situação e aprovação da compra mudam pelos botões da compra';
    end if;
    if old.status not in ('rascunho','solicitado') and (to_jsonb(new) - array['observacoes','previsao_entrega','updated_at','total'])
                                                       <> (to_jsonb(old) - array['observacoes','previsao_entrega','updated_at','total']) then
      raise exception 'Compra já aprovada: só a previsão de entrega e as observações podem mudar';
    end if;
  end if;
  new.total := new.subtotal + new.frete - new.desconto;
  if new.total < 0 then raise exception 'O desconto não pode ser maior que o valor da compra'; end if;
  return new;
end; $$;
create trigger trg_pc_antes before insert or update on public.pedidos_compra for each row execute function private.pc_antes();

create table if not exists public.pedido_compra_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_compra_id uuid not null references public.pedidos_compra(id) on delete cascade,
  ordem integer not null default 0,
  material_id uuid references public.materiais(id) on delete set null,
  descricao text not null check (length(trim(descricao)) between 1 and 200),
  unidade text not null default 'un' check (length(unidade) <= 10),
  quantidade numeric(14,3) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null default 0 check (preco_unitario >= 0),
  total numeric(12,2) generated always as (round(quantidade * preco_unitario, 2)) stored,
  quantidade_recebida numeric(14,3) not null default 0 check (quantidade_recebida >= 0),
  created_at timestamptz not null default now()
);
create index if not exists pci_pedido_idx on public.pedido_compra_itens(pedido_compra_id, ordem);
create index if not exists pci_material_idx on public.pedido_compra_itens(material_id);
alter table public.pedido_compra_itens enable row level security;
create policy pci_ler on public.pedido_compra_itens for select using (private.tem_permissao(empresa_id, 'compras_gerenciar') or private.tem_permissao(empresa_id, 'financeiro_ver') or private.tem_acesso_suporte(empresa_id));
create policy pci_inserir on public.pedido_compra_itens for insert with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy pci_alterar on public.pedido_compra_itens for update using (private.pode(empresa_id, 'compras_gerenciar')) with check (private.pode(empresa_id, 'compras_gerenciar'));
create policy pci_excluir on public.pedido_compra_itens for delete using (private.pode(empresa_id, 'compras_gerenciar'));
create trigger trg_mesma_empresa before insert or update on public.pedido_compra_itens for each row execute function private.checar_mesma_empresa('pedido_compra_id:pedidos_compra', 'material_id:materiais');

create or replace function private.pci_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_int boolean := coalesce(current_setting('app.pc_interno', true), '') = '1' or (select auth.uid()) is null or pg_trigger_depth() > 1;
  v_st public.status_compra; v_un text;
begin
  select status into v_st from public.pedidos_compra where id = case when tg_op = 'DELETE' then old.pedido_compra_id else new.pedido_compra_id end;
  if not v_int and v_st is not null then
    if v_st not in ('rascunho','solicitado') then raise exception 'Itens só podem mudar enquanto a compra não foi aprovada'; end if;
    if tg_op = 'UPDATE' and (new.pedido_compra_id <> old.pedido_compra_id or new.quantidade_recebida <> old.quantidade_recebida) then
      raise exception 'O recebimento é registrado pelo botão Receber';
    end if;
    if tg_op = 'INSERT' then new.quantidade_recebida := 0; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- item ligado a uma matéria-prima usa a unidade do estoque (a entrada cai na unidade certa)
  if new.material_id is not null then
    select unidade into v_un from public.materiais where id = new.material_id;
    new.unidade := v_un;
  end if;
  return new;
end; $$;
create trigger trg_pci_antes before insert or update or delete on public.pedido_compra_itens for each row execute function private.pci_antes();

create or replace function private.pci_totais() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_pc uuid := case when tg_op = 'DELETE' then old.pedido_compra_id else new.pedido_compra_id end; v_antes text := coalesce(current_setting('app.pc_interno', true), '');
begin
  perform set_config('app.pc_interno', '1', true);
  update public.pedidos_compra set subtotal = coalesce((select sum(total) from public.pedido_compra_itens where pedido_compra_id = v_pc), 0) where id = v_pc;
  perform set_config('app.pc_interno', v_antes, true);
  return null;
end; $$;
create trigger trg_pci_totais after insert or update or delete on public.pedido_compra_itens for each row execute function private.pci_totais();

create table if not exists public.compra_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_compra_id uuid not null references public.pedidos_compra(id) on delete cascade,
  data date not null default current_date,
  nota_fiscal text check (length(nota_fiscal) <= 60),
  observacao text check (length(observacao) <= 1000),
  divergencia text check (length(divergencia) <= 1000),
  itens jsonb not null default '[]',
  conferido_por uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists receb_pc_idx on public.compra_recebimentos(pedido_compra_id);
alter table public.compra_recebimentos enable row level security;
create policy receb_ler on public.compra_recebimentos for select using (private.tem_permissao(empresa_id, 'compras_gerenciar') or private.tem_permissao(empresa_id, 'financeiro_ver'));

-- gera as contas a pagar da compra (uma por parcela)
create or replace function private.pc_gerar_contas(p public.pedidos_compra) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := greatest(p.parcelas, 1); i int; v numeric; v_grupo uuid := gen_random_uuid(); v_venc date; v_forn text; v_prazo int;
begin
  if p.total <= 0 or exists (select 1 from public.lancamentos where compra_id = p.id and not cancelado) then return 0; end if;
  select nome, prazo_medio_dias into v_forn, v_prazo from public.fornecedores where id = p.fornecedor_id;
  v_venc := coalesce(p.primeiro_vencimento, coalesce(p.data_pedido, current_date) + coalesce(v_prazo, 30));
  for i in 1 .. n loop
    v := case when i < n then round(p.total / n, 2) else p.total - round(p.total / n, 2) * (n - 1) end;
    perform private.lancar_despesa(p.empresa_id, p.categoria_financeira,
      'Compra #' || p.numero || coalesce(' · ' || v_forn, '') || case when n > 1 then ' (' || i || '/' || n || ')' else '' end,
      v, (v_venc + make_interval(months => i - 1))::date, p.id, null, null, p.conta_id, p.forma_pagamento,
      case when n > 1 then i end, case when n > 1 then n end, case when n > 1 then v_grupo end);
  end loop;
  return n;
end; $$;

create or replace function public.compra_mudar_status(p_id uuid, p_status public.status_compra, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos_compra;
begin
  select * into p from public.pedidos_compra where id = p_id for update;
  if p.id is null or not private.pode(p.empresa_id, 'compras_gerenciar') then raise exception 'Compra não encontrada'; end if;
  if p_status = p.status then return; end if;
  perform set_config('app.pc_interno', '1', true);
  if p_status = 'solicitado' then
    if p.status <> 'rascunho' then raise exception 'Só um rascunho vira solicitação'; end if;
    if not exists (select 1 from public.pedido_compra_itens where pedido_compra_id = p.id) then raise exception 'Adicione pelo menos um item'; end if;
    update public.pedidos_compra set status = 'solicitado', solicitado_por = (select auth.uid()) where id = p.id;
  elsif p_status = 'rascunho' then
    if p.status <> 'solicitado' then raise exception 'Só uma solicitação volta para rascunho'; end if;
    update public.pedidos_compra set status = 'rascunho' where id = p.id;
  elsif p_status = 'aprovado' then
    if p.status not in ('rascunho','solicitado') then raise exception 'Esta compra não está aguardando aprovação'; end if;
    if not (private.is_admin(p.empresa_id) or private.tem_permissao(p.empresa_id, 'financeiro_ver')) then
      raise exception 'Aprovar compras é da administração ou do financeiro';
    end if;
    if p.fornecedor_id is null then raise exception 'Escolha o fornecedor antes de aprovar'; end if;
    if not exists (select 1 from public.pedido_compra_itens where pedido_compra_id = p.id) then raise exception 'Adicione pelo menos um item'; end if;
    update public.pedidos_compra set status = 'aprovado', aprovado_por = (select auth.uid()), aprovado_em = now() where id = p.id;
  elsif p_status = 'enviado' then
    -- pedido feito ao fornecedor: nasce o compromisso (contas a pagar)
    if p.status <> 'aprovado' then raise exception 'Aprove a compra antes de enviá-la ao fornecedor'; end if;
    update public.pedidos_compra set status = 'enviado', enviado_em = now(), data_pedido = coalesce(data_pedido, current_date) where id = p.id returning * into p;
    perform private.pc_gerar_contas(p);
  elsif p_status = 'cancelado' then
    if p.status in ('recebido','parcial') or exists (select 1 from public.pedido_compra_itens where pedido_compra_id = p.id and quantidade_recebida > 0) then
      raise exception 'Compra com itens recebidos não pode ser cancelada';
    end if;
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
    if exists (select 1 from public.lancamentos where compra_id = p.id and pago and not cancelado) then
      raise exception 'Há parcela desta compra já paga: desmarque o pagamento no Financeiro antes de cancelar';
    end if;
    perform set_config('app.fin_interno', '1', true);
    update public.lancamentos set cancelado = true where compra_id = p.id and not pago;
    perform set_config('app.fin_interno', '0', true);
    update public.pedidos_compra set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = trim(p_motivo) where id = p.id;
  else
    raise exception 'Use o botão Receber para registrar o recebimento';
  end if;
  perform set_config('app.pc_interno', '0', true);
end; $$;

-- Recebimento e conferência: entrada no estoque com custo (frete e desconto rateados)
create or replace function public.receber_compra(p_id uuid, p_itens jsonb, p_data date, p_nota text, p_obs text, p_divergencia text)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.pedidos_compra; it public.pedido_compra_itens; e jsonb; v_qtd numeric; v_fator numeric; v_custo numeric; v_mov uuid;
  v_reg jsonb := '[]'::jsonb; v_status public.status_compra;
begin
  select * into p from public.pedidos_compra where id = p_id for update;
  if p.id is null or not private.pode(p.empresa_id, 'compras_gerenciar') then raise exception 'Compra não encontrada'; end if;
  if p.status not in ('enviado','parcial') then raise exception 'Só compras enviadas ao fornecedor podem ser recebidas'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe as quantidades recebidas'; end if;
  v_fator := case when p.subtotal > 0 then (p.subtotal + p.frete - p.desconto) / p.subtotal else 1 end;
  perform set_config('app.pc_interno', '1', true);
  perform set_config('app.mov_interna', '1', true);
  for e in select * from jsonb_array_elements(p_itens) loop
    v_qtd := nullif(e->>'quantidade', '')::numeric;
    if v_qtd is null or v_qtd = 0 then continue; end if;
    if v_qtd < 0 then raise exception 'Quantidade recebida não pode ser negativa'; end if;
    select * into it from public.pedido_compra_itens where id = (e->>'item_id')::uuid and pedido_compra_id = p.id for update;
    if it.id is null then raise exception 'Item não pertence a esta compra'; end if;
    if it.quantidade_recebida + v_qtd > it.quantidade + 0.0005 then
      raise exception '"%": recebendo % de % pendente(s). Registre a diferença como divergência.', it.descricao, v_qtd, it.quantidade - it.quantidade_recebida;
    end if;
    v_mov := null;
    v_custo := round(it.preco_unitario * v_fator, 4);
    if it.material_id is not null then
      insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, custo_unitario, observacao, compra_id)
      values (p.empresa_id, it.material_id, 'entrada', v_qtd, case when v_custo > 0 then v_custo end,
              'Compra #' || p.numero || coalesce(' · NF ' || nullif(trim(p_nota), ''), ''), p.id)
      returning id into v_mov;
    end if;
    update public.pedido_compra_itens set quantidade_recebida = quantidade_recebida + v_qtd where id = it.id;
    v_reg := v_reg || jsonb_build_array(jsonb_build_object('item_id', it.id, 'descricao', it.descricao, 'quantidade', v_qtd, 'custo_unitario', v_custo, 'movimentacao_id', v_mov));
  end loop;
  perform set_config('app.mov_interna', '0', true);
  if jsonb_array_length(v_reg) = 0 then raise exception 'Informe as quantidades recebidas'; end if;
  insert into public.compra_recebimentos(empresa_id, pedido_compra_id, data, nota_fiscal, observacao, divergencia, itens)
  values (p.empresa_id, p.id, coalesce(p_data, current_date), nullif(trim(p_nota), ''), nullif(trim(p_obs), ''), nullif(trim(p_divergencia), ''), v_reg);
  v_status := case when exists (select 1 from public.pedido_compra_itens where pedido_compra_id = p.id and quantidade_recebida < quantidade - 0.0005) then 'parcial' else 'recebido' end;
  update public.pedidos_compra set status = v_status, recebido_em = case when v_status = 'recebido' then now() end where id = p.id;
  perform set_config('app.pc_interno', '0', true);
  return v_status::text;
end; $$;

-- encerrar uma compra parcial (o fornecedor não vai mandar o resto)
create or replace function public.encerrar_compra(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos_compra;
begin
  select * into p from public.pedidos_compra where id = p_id for update;
  if p.id is null or not private.pode(p.empresa_id, 'compras_gerenciar') then raise exception 'Compra não encontrada'; end if;
  if p.status <> 'parcial' then raise exception 'Só compras recebidas em parte podem ser encerradas'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  perform set_config('app.pc_interno', '1', true);
  update public.pedidos_compra set status = 'recebido', recebido_em = now(),
         observacoes = left(coalesce(observacoes || E'\n', '') || 'Encerrada sem receber tudo: ' || trim(p_motivo), 5000) where id = p.id;
  perform set_config('app.pc_interno', '0', true);
end; $$;

-- entrada de compra não é estornada pelo estoque (desalinharia o recebimento)
create or replace function public.estornar_movimentacao(p_mov uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.movimentacoes_estoque; v_id uuid; v_tipo public.tipo_movimentacao; v_qtd numeric;
begin
  select * into o from public.movimentacoes_estoque where id = p_mov;
  if o.id is null or not private.pode(o.empresa_id, 'materia_movimentar') then raise exception 'Movimentação não encontrada'; end if;
  if o.estorno_de is not null then raise exception 'Não é possível estornar um estorno'; end if;
  if o.reserva_id is not null or o.ordem_id is not null then raise exception 'Consumo de produção não é estornado aqui: registre a correção na ordem de produção (ex.: entrada manual com justificativa)'; end if;
  if o.compra_id is not null then raise exception 'Entrada de compra não é estornada aqui: registre uma saída com justificativa (ex.: devolução ao fornecedor)'; end if;
  if exists (select 1 from public.movimentacoes_estoque where estorno_de = p_mov) then raise exception 'Esta movimentação já foi estornada'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
  if o.tipo = 'entrada' then v_tipo := 'saida'; v_qtd := o.quantidade;
  elsif o.tipo = 'saida' then v_tipo := 'entrada'; v_qtd := o.quantidade;
  else
    if o.saldo_antes is null then raise exception 'Ajuste antigo sem saldo anterior registrado: faça um novo inventário'; end if;
    v_qtd := abs(o.saldo_apos - o.saldo_antes);
    if v_qtd = 0 then raise exception 'Este ajuste não mudou o saldo'; end if;
    v_tipo := case when o.saldo_apos > o.saldo_antes then 'saida' else 'entrada' end;
  end if;
  perform set_config('app.mov_interna', '1', true);
  if o.bobina_id is not null and o.tipo = 'saida' then
    update public.material_bobinas b set consumido_g = greatest(b.consumido_g - o.quantidade * coalesce(private.fator_gramas(m.unidade, m.peso_liquido_g), 0), 0)
      from public.materiais m where b.id = o.bobina_id and m.id = o.material_id;
  end if;
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, justificativa, observacao, estorno_de)
  values (o.empresa_id, o.material_id, v_tipo, v_qtd, trim(p_motivo), 'Estorno', o.id)
  returning id into v_id;
  perform set_config('app.mov_interna', '0', true);
  return v_id;
end; $$;

-- =====================================================================
-- 2) MANUTENÇÃO DAS IMPRESSORAS
-- =====================================================================
create table if not exists public.manutencao_planos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  impressora_id uuid not null references public.impressoras(id) on delete cascade,
  servico text not null check (servico in ('troca_bico','troca_correia','lubrificacao','calibracao','limpeza','substituicao_componente','firmware','outro')),
  descricao text check (length(descricao) <= 300),
  intervalo_horas numeric(10,1) check (intervalo_horas > 0),
  intervalo_dias integer check (intervalo_dias between 1 and 3650),
  ultima_data date,
  ultima_horas numeric(12,2),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint plano_tem_intervalo check (intervalo_horas is not null or intervalo_dias is not null)
);
create index if not exists planos_impressora_idx on public.manutencao_planos(impressora_id);
alter table public.manutencao_planos enable row level security;
create policy planos_ler on public.manutencao_planos for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_acesso_suporte(empresa_id));
create policy planos_inserir on public.manutencao_planos for insert with check (private.pode(empresa_id, 'impressoras_editar'));
create policy planos_alterar on public.manutencao_planos for update using (private.pode(empresa_id, 'impressoras_editar')) with check (private.pode(empresa_id, 'impressoras_editar'));
create policy planos_excluir on public.manutencao_planos for delete using (private.pode(empresa_id, 'impressoras_editar'));
create trigger trg_mesma_empresa before insert or update on public.manutencao_planos for each row execute function private.checar_mesma_empresa('impressora_id:impressoras');
-- plano novo conta a partir das horas atuais da impressora
create or replace function private.plano_inicio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ultima_horas is null then new.ultima_horas := (select horas_acumuladas from public.impressoras where id = new.impressora_id); end if;
  if new.ultima_data is null then new.ultima_data := current_date; end if;
  return new;
end; $$;
create trigger trg_plano_inicio before insert on public.manutencao_planos for each row execute function private.plano_inicio();

create table if not exists public.manutencoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  impressora_id uuid not null references public.impressoras(id) on delete cascade,
  plano_id uuid references public.manutencao_planos(id) on delete set null,
  tipo text not null default 'preventiva' check (tipo in ('preventiva','corretiva')),
  servico text not null default 'outro' check (servico in ('troca_bico','troca_correia','lubrificacao','calibracao','limpeza','substituicao_componente','firmware','outro')),
  descricao text not null check (length(trim(descricao)) between 1 and 300),
  status text not null default 'agendada' check (status in ('agendada','em_andamento','concluida','cancelada')),
  agendada_para date,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  horas_maquina numeric(12,2),
  status_impressora_antes public.status_impressora,
  custo_pecas numeric(12,2) not null default 0 check (custo_pecas >= 0),
  custo_mao_obra numeric(12,2) not null default 0 check (custo_mao_obra >= 0),
  custo_total numeric(12,2) generated always as (custo_pecas + custo_mao_obra) stored,
  tempo_parado_h numeric(8,2) check (tempo_parado_h >= 0),
  material_id uuid references public.materiais(id) on delete set null,
  material_qtd numeric(14,3) check (material_qtd > 0),
  responsavel text check (length(responsavel) <= 100),
  observacoes text check (length(observacoes) <= 5000),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manut_impressora_idx on public.manutencoes(impressora_id, created_at desc);
create index if not exists manut_empresa_idx on public.manutencoes(empresa_id, status);
alter table public.manutencoes enable row level security;
create policy manut_ler on public.manutencoes for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_acesso_suporte(empresa_id));
create policy manut_inserir on public.manutencoes for insert with check (private.pode(empresa_id, 'impressoras_editar'));
create policy manut_alterar on public.manutencoes for update using (private.pode(empresa_id, 'impressoras_editar')) with check (private.pode(empresa_id, 'impressoras_editar'));
create policy manut_excluir on public.manutencoes for delete using (private.pode(empresa_id, 'impressoras_editar') and status in ('agendada','cancelada'));
create trigger trg_manut_upd before update on public.manutencoes for each row execute function public.set_updated_at();
create trigger trg_mesma_empresa before insert or update on public.manutencoes for each row execute function private.checar_mesma_empresa('impressora_id:impressoras', 'plano_id:manutencao_planos', 'material_id:materiais');
create trigger trg_audemp_manut after insert or update or delete on public.manutencoes for each row execute function private.auditar_empresa();

create or replace function private.manut_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_int boolean := coalesce(current_setting('app.manut_interno', true), '') = '1' or (select auth.uid()) is null or pg_trigger_depth() > 1;
  v_livres text[] := array['tipo','servico','descricao','agendada_para','responsavel','observacoes','custo_pecas','custo_mao_obra','material_id','material_qtd','plano_id','updated_at','custo_total'];
begin
  if v_int then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'agendada'; new.iniciada_em := null; new.concluida_em := null; new.horas_maquina := null; new.status_impressora_antes := null;
    new.tempo_parado_h := null; new.lancamento_id := null; new.created_by := (select auth.uid());
    return new;
  end if;
  if (to_jsonb(new) - v_livres) <> (to_jsonb(old) - v_livres) then raise exception 'Situação e custos finais da manutenção mudam pelos botões'; end if;
  if old.status in ('concluida','cancelada') and (to_jsonb(new) - array['observacoes','updated_at']) <> (to_jsonb(old) - array['observacoes','updated_at']) then
    raise exception 'Manutenção encerrada: só as observações podem mudar';
  end if;
  return new;
end; $$;
create trigger trg_manut_antes before insert or update on public.manutencoes for each row execute function private.manut_antes();

create table if not exists public.manutencao_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  manutencao_id uuid not null references public.manutencoes(id) on delete cascade,
  path text not null check (path like empresa_id::text || '/manutencao/%'),
  nome text not null check (length(nome) <= 200),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.manutencao_anexos enable row level security;
create policy manut_anexos_ler on public.manutencao_anexos for select using (private.tem_permissao(empresa_id, 'impressoras_ver'));
create policy manut_anexos_inserir on public.manutencao_anexos for insert with check (private.pode(empresa_id, 'impressoras_editar'));
create policy manut_anexos_excluir on public.manutencao_anexos for delete using (private.pode(empresa_id, 'impressoras_editar'));
create trigger trg_mesma_empresa before insert on public.manutencao_anexos for each row execute function private.checar_mesma_empresa('manutencao_id:manutencoes');

create or replace function private.manut_carregar(p_id uuid) returns public.manutencoes
language plpgsql security definer set search_path = '' as $$
declare m public.manutencoes;
begin
  select * into m from public.manutencoes where id = p_id for update;
  if m.id is null or not private.pode(m.empresa_id, 'impressoras_editar') then raise exception 'Manutenção não encontrada'; end if;
  return m;
end; $$;

-- devolve a impressora quando não há outra manutenção em andamento nela
create or replace function private.manut_liberar_impressora(m public.manutencoes) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.manutencoes where impressora_id = m.impressora_id and status = 'em_andamento' and id <> m.id) then return; end if;
  update public.impressoras set status = (case when m.status_impressora_antes = 'inativa' then 'inativa' else 'disponivel' end)::public.status_impressora
   where id = m.impressora_id and status = 'manutencao';
end; $$;

create or replace function public.iniciar_manutencao(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.manutencoes; i public.impressoras;
begin
  m := private.manut_carregar(p_id);
  if m.status <> 'agendada' then raise exception 'Esta manutenção está %', m.status; end if;
  select * into i from public.impressoras where id = m.impressora_id for update;
  if i.status in ('imprimindo','pausada') then raise exception 'A impressora está com uma impressão em andamento: finalize ou registre a falha na Produção antes'; end if;
  perform set_config('app.manut_interno', '1', true);
  update public.manutencoes set status = 'em_andamento', iniciada_em = now(), horas_maquina = i.horas_acumuladas,
         status_impressora_antes = case when i.status = 'manutencao' then coalesce(status_impressora_antes, 'disponivel') else i.status end
   where id = m.id;
  update public.impressoras set status = 'manutencao' where id = i.id;
  perform set_config('app.manut_interno', '0', true);
end; $$;

create or replace function public.concluir_manutencao(p_id uuid, p_custo_pecas numeric, p_custo_mao_obra numeric, p_tempo_parado_h numeric,
  p_material uuid, p_material_qtd numeric, p_obs text, p_lancar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.manutencoes; i public.impressoras; v_pecas numeric; v_mo numeric := coalesce(p_custo_mao_obra, 0); v_parado numeric; v_mat public.materiais;
  v_lanc uuid; v_valor_lanc numeric; v_qtd numeric := nullif(p_material_qtd, 0);
begin
  m := private.manut_carregar(p_id);
  if m.status not in ('agendada','em_andamento') then raise exception 'Esta manutenção já foi encerrada'; end if;
  if coalesce(p_custo_pecas, 0) < 0 or v_mo < 0 or coalesce(p_tempo_parado_h, 0) < 0 or coalesce(v_qtd, 0) < 0 then raise exception 'Valores não podem ser negativos'; end if;
  if coalesce(p_lancar, false) and not private.pode_lancar(m.empresa_id) then raise exception 'Lançar o custo no financeiro é da administração ou do financeiro (desmarque essa opção)'; end if;
  select * into i from public.impressoras where id = m.impressora_id for update;
  -- peça/consumível usado sai do estoque (já foi pago na compra: não entra de novo como despesa)
  if p_material is not null and v_qtd is not null then
    select * into v_mat from public.materiais where id = p_material and empresa_id = m.empresa_id;
    if v_mat.id is null then raise exception 'Peça não encontrada no estoque'; end if;
    perform set_config('app.mov_interna', '1', true);
    insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, observacao)
    values (m.empresa_id, v_mat.id, 'saida', v_qtd, left('Manutenção: ' || i.nome || ' · ' || m.descricao, 500));
    perform set_config('app.mov_interna', '0', true);
  end if;
  v_pecas := coalesce(p_custo_pecas, case when v_mat.id is not null then round(v_qtd * v_mat.custo_medio, 2) else m.custo_pecas end, 0);
  v_parado := coalesce(p_tempo_parado_h, case when m.iniciada_em is not null then round(extract(epoch from now() - m.iniciada_em)::numeric / 3600, 2) else 0 end);
  -- vai para o financeiro só o que não veio do estoque
  v_valor_lanc := v_mo + case when v_mat.id is not null then 0 else v_pecas end;
  perform set_config('app.manut_interno', '1', true);
  if coalesce(p_lancar, false) and v_valor_lanc > 0 then
    v_lanc := private.lancar_despesa(m.empresa_id, 'manutencao', 'Manutenção · ' || i.nome || ' · ' || m.descricao, v_valor_lanc, current_date,
                                     null, m.id, null, null, null, null, null, null);
  end if;
  update public.manutencoes set status = 'concluida', concluida_em = now(), iniciada_em = coalesce(iniciada_em, now()),
         horas_maquina = coalesce(horas_maquina, i.horas_acumuladas), custo_pecas = v_pecas, custo_mao_obra = v_mo, tempo_parado_h = v_parado,
         material_id = coalesce(v_mat.id, material_id), material_qtd = case when v_mat.id is not null then v_qtd else material_qtd end,
         observacoes = case when nullif(trim(p_obs), '') is null then observacoes else left(coalesce(observacoes || E'\n', '') || trim(p_obs), 5000) end,
         lancamento_id = coalesce(v_lanc, lancamento_id)
   where id = m.id returning * into m;
  if m.plano_id is not null then
    update public.manutencao_planos set ultima_data = current_date, ultima_horas = i.horas_acumuladas where id = m.plano_id;
  end if;
  perform private.manut_liberar_impressora(m);
  perform set_config('app.manut_interno', '0', true);
end; $$;

create or replace function public.cancelar_manutencao(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.manutencoes;
begin
  m := private.manut_carregar(p_id);
  if m.status not in ('agendada','em_andamento') then raise exception 'Esta manutenção já foi encerrada'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  perform set_config('app.manut_interno', '1', true);
  update public.manutencoes set status = 'cancelada', observacoes = left(coalesce(observacoes || E'\n', '') || 'Cancelada: ' || trim(p_motivo), 5000)
   where id = m.id returning * into m;
  if m.iniciada_em is not null then perform private.manut_liberar_impressora(m); end if;
  perform set_config('app.manut_interno', '0', true);
end; $$;

-- avisos por horas de uso ou por data
create or replace function public.manutencao_alertas(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.tem_permissao(p_empresa, 'impressoras_ver') then '[]'::jsonb else coalesce((
    select jsonb_agg(x order by x->>'nivel' desc, (x->>'faltam_horas')::numeric nulls last) from (
      select jsonb_build_object('plano_id', pl.id, 'impressora_id', i.id, 'impressora', i.nome, 'servico', pl.servico, 'descricao', pl.descricao,
        'faltam_horas', case when pl.intervalo_horas is not null then round(pl.intervalo_horas - (i.horas_acumuladas - coalesce(pl.ultima_horas, 0)), 1) end,
        'vence_em', case when pl.intervalo_dias is not null then pl.ultima_data + pl.intervalo_dias end,
        'nivel', case when (pl.intervalo_horas is not null and i.horas_acumuladas - coalesce(pl.ultima_horas, 0) >= pl.intervalo_horas)
                        or (pl.intervalo_dias is not null and pl.ultima_data + pl.intervalo_dias <= current_date) then 'vencida' else 'proxima' end,
        'agendada', exists (select 1 from public.manutencoes mm where mm.plano_id = pl.id and mm.status in ('agendada','em_andamento'))) x
        from public.manutencao_planos pl join public.impressoras i on i.id = pl.impressora_id
       where pl.empresa_id = p_empresa and pl.ativo and i.status <> 'inativa'
         and ((pl.intervalo_horas is not null and i.horas_acumuladas - coalesce(pl.ultima_horas, 0) >= pl.intervalo_horas * 0.9)
           or (pl.intervalo_dias is not null and pl.ultima_data + pl.intervalo_dias <= current_date + 7))) s), '[]'::jsonb) end;
$$;

-- =====================================================================
-- 3) EXPEDIÇÃO E ENTREGAS
-- =====================================================================
do $$ begin
  create type public.status_envio as enum ('separacao','conferencia','embalado','aguardando_coleta','enviado','em_transito','entregue','retirado','devolvido','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists public.envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  status public.status_envio not null default 'separacao',
  modalidade text not null default 'correios' check (modalidade in ('retirada','entrega_propria','correios','transportadora','melhor_envio')),
  destinatario text check (length(destinatario) <= 150),
  telefone text check (length(telefone) <= 30),
  endereco text check (length(endereco) <= 300),
  cidade text check (length(cidade) <= 100),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  cep text check (length(cep) <= 10),
  peso_g numeric(10,1) check (peso_g >= 0),
  altura_cm numeric(8,1) check (altura_cm >= 0),
  largura_cm numeric(8,1) check (largura_cm >= 0),
  comprimento_cm numeric(8,1) check (comprimento_cm >= 0),
  volumes integer not null default 1 check (volumes between 1 and 100),
  frete_custo numeric(12,2) not null default 0 check (frete_custo >= 0),
  frete_cobrado numeric(12,2) not null default 0 check (frete_cobrado >= 0),
  transportadora text check (length(transportadora) <= 100),
  servico text check (length(servico) <= 60),
  codigo_rastreio text check (length(codigo_rastreio) <= 100),
  data_postagem date,
  previsao_entrega date,
  entregue_em timestamptz,
  recebido_por text check (length(recebido_por) <= 150),
  comprovante_path text check (comprovante_path is null or comprovante_path like empresa_id::text || '/expedicao/%'),
  conferido_por uuid references auth.users(id) on delete set null,
  conferido_em timestamptz,
  observacoes text check (length(observacoes) <= 2000),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create unique index if not exists envio_ativo_uq on public.envios(pedido_id) where status not in ('cancelado','devolvido');
create index if not exists envios_empresa_idx on public.envios(empresa_id, status);
alter table public.envios enable row level security;
create policy envios_ler on public.envios for select using (private.tem_permissao(empresa_id, 'expedicao_gerenciar') or private.tem_permissao(empresa_id, 'pedidos_ver') or private.tem_acesso_suporte(empresa_id));
create policy envios_alterar on public.envios for update using (private.pode(empresa_id, 'expedicao_gerenciar')) with check (private.pode(empresa_id, 'expedicao_gerenciar'));
-- sem INSERT/DELETE direto: criar_envio e cancelamento pelo botão
create trigger trg_envios_upd before update on public.envios for each row execute function public.set_updated_at();
create trigger trg_audemp_envios after insert or update on public.envios for each row execute function private.auditar_empresa();

create or replace function private.envio_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_fixos text[] := array['id','empresa_id','numero','pedido_id','status','entregue_em','conferido_por','conferido_em','lancamento_id','created_by','created_at'];
begin
  if coalesce(current_setting('app.envio_interno', true), '') = '1' or (select auth.uid()) is null or pg_trigger_depth() > 1 then return new; end if;
  if (select jsonb_object_agg(k, to_jsonb(new)->k) from unnest(v_fixos) k) <> (select jsonb_object_agg(k, to_jsonb(old)->k) from unnest(v_fixos) k) then
    raise exception 'A situação do envio muda pelos botões da expedição';
  end if;
  if old.status in ('entregue','retirado','cancelado','devolvido') and (to_jsonb(new) - array['observacoes','comprovante_path','recebido_por','updated_at'])
                                                                     <> (to_jsonb(old) - array['observacoes','comprovante_path','recebido_por','updated_at']) then
    raise exception 'Envio encerrado: só observações e comprovante podem mudar';
  end if;
  return new;
end; $$;
create trigger trg_envio_antes before update on public.envios for each row execute function private.envio_antes();

create table if not exists public.envio_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  envio_id uuid not null references public.envios(id) on delete cascade,
  status_anterior public.status_envio,
  status_novo public.status_envio not null,
  observacao text,
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists envio_eventos_idx on public.envio_eventos(envio_id, id);
alter table public.envio_eventos enable row level security;
create policy envio_eventos_ler on public.envio_eventos for select using (private.tem_permissao(empresa_id, 'expedicao_gerenciar') or private.tem_permissao(empresa_id, 'pedidos_ver'));
create or replace function private.envio_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.envio_eventos(empresa_id, envio_id, status_anterior, status_novo, observacao)
    values (new.empresa_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, nullif(current_setting('app.envio_obs', true), ''));
  end if;
  return null;
end; $$;
create trigger trg_envio_evento after insert or update of status on public.envios for each row execute function private.envio_evento();

-- situação do envio → status de entrega do pedido
create or replace function private.envio_sincronizar_pedido(e public.envios) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.ped_interno', '1', true);
  update public.pedidos set
    status_entrega = case e.status when 'enviado' then 'enviado' when 'em_transito' then 'enviado' when 'entregue' then 'entregue'
                                    when 'retirado' then 'retirado' else 'pronto' end::public.status_entrega_pedido,
    transportadora = coalesce(e.transportadora, case e.modalidade when 'correios' then 'Correios' when 'retirada' then 'Retirada no local'
                                                                  when 'entrega_propria' then 'Entrega própria' when 'melhor_envio' then 'Melhor Envio' end, transportadora),
    codigo_rastreio = coalesce(e.codigo_rastreio, codigo_rastreio),
    entregue_em = case when e.status in ('entregue','retirado') then coalesce(e.entregue_em, now()) else entregue_em end
  where id = e.pedido_id and status <> 'cancelado';
  perform set_config('app.ped_interno', '0', true);
end; $$;

-- FLUXO D: pedido pronto → expedição
create or replace function public.criar_envio(p_pedido uuid, p_modalidade text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.pedidos; c public.clientes; v uuid;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not private.pode(p.empresa_id, 'expedicao_gerenciar') then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p.status_entrega in ('entregue','retirado') then raise exception 'Este pedido já foi entregue'; end if;
  if p.status_producao not in ('concluida','nao_aplica') and p.status_entrega = 'pendente' then
    raise exception 'A produção deste pedido ainda não terminou';
  end if;
  if exists (select 1 from public.envios where pedido_id = p.id and status not in ('cancelado','devolvido')) then raise exception 'Este pedido já está na expedição'; end if;
  if coalesce(p_modalidade, 'correios') not in ('retirada','entrega_propria','correios','transportadora','melhor_envio') then raise exception 'Modalidade inválida'; end if;
  select * into c from public.clientes where id = p.cliente_id;
  perform set_config('app.envio_interno', '1', true);
  insert into public.envios(empresa_id, numero, pedido_id, modalidade, destinatario, telefone, endereco, cidade, uf, cep, previsao_entrega, transportadora, codigo_rastreio)
  values (p.empresa_id, private.proximo_numero(p.empresa_id, 'envio'), p.id, coalesce(p_modalidade, 'correios'), left(c.nome, 150),
          left(coalesce(c.whatsapp, c.telefone), 30), c.endereco, c.cidade, c.uf, c.cep, p.data_entrega,
          case when coalesce(p_modalidade, 'correios') = 'correios' then 'Correios' end, null)
  returning id into v;
  perform set_config('app.envio_interno', '0', true);
  if p.status_entrega = 'pendente' then
    perform set_config('app.ped_interno', '1', true);
    update public.pedidos set status_entrega = 'pronto' where id = p.id;
    perform set_config('app.ped_interno', '0', true);
  end if;
  return v;
end; $$;

create or replace function public.mudar_status_envio(p_envio uuid, p_status public.status_envio, p_obs text, p_recebido_por text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.envios; v_ordem text[] := array['separacao','conferencia','embalado','aguardando_coleta','enviado','em_transito','entregue'];
  v_de int; v_para int; v_lanc uuid;
begin
  select * into e from public.envios where id = p_envio for update;
  if e.id is null or not private.pode(e.empresa_id, 'expedicao_gerenciar') then raise exception 'Envio não encontrado'; end if;
  if p_status = e.status then return; end if;
  if e.status in ('entregue','retirado','cancelado','devolvido') and not (p_status = 'devolvido' and e.status = 'entregue') then
    raise exception 'Este envio já foi encerrado (%)', e.status;
  end if;
  if exists (select 1 from public.pedidos where id = e.pedido_id and status = 'cancelado') and p_status not in ('cancelado','devolvido') then
    raise exception 'O pedido foi cancelado: cancele o envio';
  end if;
  v_de := array_position(v_ordem, e.status::text);
  v_para := coalesce(array_position(v_ordem, p_status::text), case p_status when 'retirado' then 7 else 0 end);
  if p_status = 'cancelado' then
    if e.status not in ('separacao','conferencia','embalado','aguardando_coleta') then raise exception 'Envio já saiu: use Devolvido'; end if;
    if length(trim(coalesce(p_obs, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  elsif p_status = 'devolvido' then
    if e.status not in ('enviado','em_transito','entregue') then raise exception 'Só envios que saíram podem voltar como devolvidos'; end if;
    if length(trim(coalesce(p_obs, ''))) < 3 then raise exception 'Informe o motivo da devolução'; end if;
  elsif p_status = 'retirado' then
    if e.modalidade <> 'retirada' then raise exception 'Retirado é só para retirada no local'; end if;
    if e.status not in ('embalado','aguardando_coleta') then raise exception 'Confira e embale antes de entregar ao cliente'; end if;
    if length(trim(coalesce(p_recebido_por, e.recebido_por, ''))) < 2 then raise exception 'Informe quem retirou'; end if;
  else
    -- etapas pré-envio podem voltar; depois de sair, só avançam
    if v_para < v_de and v_de >= 5 then raise exception 'Envio já saiu: não volta para %', p_status; end if;
    if e.modalidade = 'retirada' and v_para >= 5 then raise exception 'Retirada no local: use Retirado'; end if;
    if v_para >= 5 then
      if e.modalidade in ('correios','melhor_envio') and coalesce(trim(e.codigo_rastreio), '') = '' then raise exception 'Informe o código de rastreio antes de marcar como enviado'; end if;
      if e.modalidade = 'transportadora' and coalesce(trim(e.transportadora), '') = '' then raise exception 'Informe a transportadora antes de marcar como enviado'; end if;
    end if;
    if p_status = 'entregue' and e.modalidade = 'entrega_propria' and length(trim(coalesce(p_recebido_por, e.recebido_por, ''))) < 2 then
      raise exception 'Informe quem recebeu';
    end if;
  end if;
  perform set_config('app.envio_interno', '1', true);
  perform set_config('app.envio_obs', coalesce(p_obs, ''), true);
  update public.envios set status = p_status,
    conferido_por = case when conferido_em is null and v_para >= 3 then (select auth.uid()) else conferido_por end,
    conferido_em = case when conferido_em is null and v_para >= 3 then now() else conferido_em end,
    data_postagem = case when p_status in ('enviado','em_transito','entregue') and e.modalidade <> 'retirada' and data_postagem is null then current_date else data_postagem end,
    entregue_em = case when p_status in ('entregue','retirado') then now() else entregue_em end,
    recebido_por = coalesce(nullif(trim(p_recebido_por), ''), recebido_por),
    observacoes = case when p_status in ('cancelado','devolvido') then left(coalesce(observacoes || E'\n', '') || initcap(p_status::text) || ': ' || trim(p_obs), 2000) else observacoes end
   where id = e.id returning * into e;
  -- frete pago pela loja vira conta a pagar (uma vez), se quem opera pode lançar
  if e.status in ('enviado','em_transito','entregue','retirado') and e.frete_custo > 0 and e.lancamento_id is null and private.pode_lancar(e.empresa_id) then
    v_lanc := private.lancar_despesa(e.empresa_id, 'fretes', 'Frete envio #' || e.numero || ' · pedido #' || (select numero from public.pedidos where id = e.pedido_id),
                                     e.frete_custo, current_date, null, null, e.id, null, null, null, null, null);
    update public.envios set lancamento_id = v_lanc where id = e.id;
  end if;
  perform set_config('app.envio_interno', '0', true);
  perform set_config('app.envio_obs', '', true);
  perform private.envio_sincronizar_pedido(e);
end; $$;

-- marcar a conferência sem mudar de etapa
create or replace function public.conferir_envio(p_envio uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.envios;
begin
  select * into e from public.envios where id = p_envio for update;
  if e.id is null or not private.pode(e.empresa_id, 'expedicao_gerenciar') then raise exception 'Envio não encontrado'; end if;
  if e.status not in ('separacao','conferencia') then raise exception 'Este envio já passou da conferência'; end if;
  perform set_config('app.envio_interno', '1', true);
  perform set_config('app.envio_obs', 'Itens conferidos', true);
  update public.envios set conferido_por = (select auth.uid()), conferido_em = now(), status = 'conferencia' where id = e.id;
  perform set_config('app.envio_interno', '0', true);
  perform set_config('app.envio_obs', '', true);
end; $$;

-- com envio na expedição, a entrega do pedido é controlada por lá
create or replace function public.atualizar_entrega(p_pedido uuid, p_status public.status_entrega_pedido, p_transportadora text, p_rastreio text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pedidos;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or not (private.pode(p.empresa_id, 'pedidos_editar') or private.pode(p.empresa_id, 'expedicao_gerenciar')) then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if exists (select 1 from public.envios where pedido_id = p.id and status not in ('cancelado','devolvido')) then
    raise exception 'Este pedido está na Expedição: atualize a entrega por lá';
  end if;
  perform set_config('app.ped_interno', '1', true);
  update public.pedidos set status_entrega = p_status, transportadora = coalesce(nullif(trim(p_transportadora), ''), transportadora),
         codigo_rastreio = coalesce(nullif(trim(p_rastreio), ''), codigo_rastreio) where id = p.id;
  perform set_config('app.ped_interno', '0', true);
end; $$;

-- pedido cancelado leva junto o envio que ainda não saiu
create or replace function private.cancelar_envio_do_pedido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    perform set_config('app.envio_interno', '1', true);
    perform set_config('app.envio_obs', 'Pedido cancelado', true);
    update public.envios set status = 'cancelado' where pedido_id = new.id and status in ('separacao','conferencia','embalado','aguardando_coleta');
    perform set_config('app.envio_interno', '0', true);
    perform set_config('app.envio_obs', '', true);
  end if;
  return null;
end; $$;
drop trigger if exists trg_pedido_cancela_envio on public.pedidos;
create trigger trg_pedido_cancela_envio after update of status on public.pedidos for each row execute function private.cancelar_envio_do_pedido();

-- =====================================================================
-- 4) PORTAL DO COMPRADOR
-- =====================================================================
create table if not exists public.portal_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  slug text check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  titulo text check (length(titulo) <= 120),
  descricao text check (length(descricao) <= 2000),
  whatsapp text check (length(whatsapp) <= 30),
  mostrar_precos boolean not null default true,
  aceitar_arquivos boolean not null default true,
  materiais_ids uuid[] not null default '{}',
  cores text check (length(cores) <= 500),
  prazo_texto text check (length(prazo_texto) <= 200),
  mensagem_sucesso text check (length(mensagem_sucesso) <= 500),
  updated_at timestamptz not null default now(),
  constraint portal_ativo_slug check (not ativo or slug is not null)
);
create unique index if not exists portal_slug_uq on public.portal_config(slug) where slug is not null;
alter table public.portal_config enable row level security;
create trigger trg_portal_upd before update on public.portal_config for each row execute function public.set_updated_at();
create trigger trg_audemp_portal after insert or update on public.portal_config for each row execute function private.auditar_empresa();
create policy portal_ler on public.portal_config for select using (private.is_membro(empresa_id) or private.tem_acesso_suporte(empresa_id));
create policy portal_inserir on public.portal_config for insert with check (private.pode(empresa_id, 'config_editar'));
create policy portal_alterar on public.portal_config for update using (private.pode(empresa_id, 'config_editar')) with check (private.pode(empresa_id, 'config_editar'));
-- endereços que não podem ser usados por lojas
create or replace function private.portal_slug_valido() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.slug := nullif(lower(trim(new.slug)), '');
  if new.slug in ('admin','api','app','login','loja','www','suporte','ajuda','mrv3d','painel','portal','empresa','orcamento','pedido') then
    raise exception 'Este endereço é reservado: escolha outro';
  end if;
  if new.slug is not null and exists (select 1 from public.portal_config where slug = new.slug and empresa_id <> new.empresa_id) then
    raise exception 'Este endereço já está em uso por outra loja: escolha outro';
  end if;
  -- só materiais da própria empresa
  if exists (select 1 from unnest(new.materiais_ids) x where not exists (select 1 from public.materiais m where m.id = x and m.empresa_id = new.empresa_id)) then
    raise exception 'Material não encontrado';
  end if;
  return new;
end; $$;
create trigger trg_portal_slug before insert or update on public.portal_config for each row execute function private.portal_slug_valido();

alter table public.produtos add column if not exists no_portal boolean not null default false;

create table if not exists public.portal_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null,
  token text not null unique check (length(token) >= 48),
  status text not null default 'nova' check (status in ('nova','em_analise','orcada','recusada','cancelada')),
  nome text not null check (length(trim(nome)) between 2 and 150),
  email text check (length(email) <= 150),
  telefone text check (length(telefone) <= 30),
  cidade text check (length(cidade) <= 100),
  produto_id uuid references public.produtos(id) on delete set null,
  material_id uuid references public.materiais(id) on delete set null,
  cor text check (length(cor) <= 60),
  quantidade numeric(12,2) not null default 1 check (quantidade > 0 and quantidade <= 100000),
  observacoes text check (length(observacoes) <= 3000),
  arquivos jsonb not null default '[]',
  orcamento_id uuid references public.orcamentos(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  motivo_recusa text check (length(motivo_recusa) <= 1000),
  expira_em timestamptz not null default now() + interval '180 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists portal_sol_empresa_idx on public.portal_solicitacoes(empresa_id, created_at desc);
alter table public.portal_solicitacoes enable row level security;
create trigger trg_portal_sol_upd before update on public.portal_solicitacoes for each row execute function public.set_updated_at();
create policy portal_sol_ler on public.portal_solicitacoes for select using (private.tem_permissao(empresa_id, 'orcamentos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_acesso_suporte(empresa_id));
-- sem escrita direta: o comprador usa portal_solicitar e a equipe usa as funções abaixo

-- página pública da loja
create or replace function public.portal_publico(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pc public.portal_config; e public.empresas;
begin
  select * into pc from public.portal_config where slug = lower(trim(p_slug)) and ativo;
  if pc.empresa_id is null then raise exception 'Loja não encontrada'; end if;
  select * into e from public.empresas where id = pc.empresa_id and status not in ('suspensa','cancelada');
  if e.id is null then raise exception 'Loja indisponível no momento'; end if;
  return jsonb_build_object(
    'empresa_id', e.id, 'nome', e.nome, 'cidade', e.cidade, 'uf', e.uf, 'whatsapp', coalesce(pc.whatsapp, e.whatsapp),
    'titulo', coalesce(pc.titulo, e.nome), 'descricao', pc.descricao, 'prazo_texto', pc.prazo_texto, 'aceitar_arquivos', pc.aceitar_arquivos,
    'mostrar_precos', pc.mostrar_precos, 'mensagem_sucesso', pc.mensagem_sucesso,
    'logo_path', (select logo_path from public.empresa_config where empresa_id = e.id),
    'cores', coalesce((select jsonb_agg(trim(c)) from unnest(string_to_array(pc.cores, ',')) c where trim(c) <> ''), '[]'::jsonb),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'cor', m.cor, 'material', m.material) order by m.nome)
                  from public.materiais m where m.id = any(pc.materiais_ids) and m.empresa_id = e.id and m.ativo), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'descricao', left(p.descricao, 1000), 'categoria', p.categoria, 'cor', p.cor,
                  'preco', case when pc.mostrar_precos then p.preco_venda end, 'foto_path', p.foto_path, 'personalizavel', p.personalizavel,
                  'pronta_entrega', p.controla_estoque and p.estoque_qtd > 0) order by p.categoria nulls last, p.nome)
                  from public.produtos p where p.empresa_id = e.id and p.no_portal and p.status = 'ativo'), '[]'::jsonb));
end; $$;

-- arquivo enviado pelo comprador: <empresa>/portal/<pasta uuid>/<arquivo>
create or replace function private.pode_enviar_portal(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or split_part(p_nome, '/', 2) <> 'portal' or private.uuid_ou_nulo(split_part(p_nome, '/', 3)) is null
     or split_part(p_nome, '/', 4) = '' or split_part(p_nome, '/', 5) <> '' then return false; end if;
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp') then return false; end if;
  if not exists (select 1 from public.portal_config pc join public.empresas e on e.id = pc.empresa_id
                  where pc.empresa_id = v_emp and pc.ativo and pc.aceitar_arquivos and e.status not in ('suspensa','cancelada')) then return false; end if;
  -- limite de envios anônimos por hora e espaço do plano
  if (select count(*) from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/portal/%' and created_at > now() - interval '1 hour') >= 30 then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

-- foto de produto exibido no portal pode ser vista por qualquer visitante
create or replace function private.foto_publica_portal(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.produtos p join public.portal_config pc on pc.empresa_id = p.empresa_id
                  where p.foto_path = p_nome and p.no_portal and p.status = 'ativo' and pc.ativo)
      or exists (select 1 from public.empresa_config c join public.portal_config pc on pc.empresa_id = c.empresa_id
                  where c.logo_path = p_nome and pc.ativo);
$$;

do $$ begin
  drop policy if exists portal_arquivos_enviar on storage.objects;
  drop policy if exists portal_fotos_ler on storage.objects;
  create policy portal_arquivos_enviar on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'empresa' and private.pode_enviar_portal(name));
  create policy portal_fotos_ler on storage.objects for select to anon, authenticated
    using (bucket_id = 'empresa' and private.foto_publica_portal(name));
end $$;

create or replace function public.portal_solicitar(p_slug text, p_dados jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare pc public.portal_config; v_emp uuid; v_token text; v_arqs jsonb := '[]'::jsonb; a jsonb; v_path text; v_prod uuid; v_mat uuid;
  v_email text := lower(nullif(trim(p_dados->>'email'), '')); v_tel text := nullif(regexp_replace(coalesce(p_dados->>'telefone', ''), '[^0-9+]', '', 'g'), '');
  v_qtd numeric; v_pasta text;
begin
  select * into pc from public.portal_config where slug = lower(trim(p_slug)) and ativo;
  if pc.empresa_id is null then raise exception 'Loja não encontrada'; end if;
  v_emp := pc.empresa_id;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then raise exception 'Loja indisponível no momento'; end if;
  perform pg_advisory_xact_lock(hashtext('portal:' || v_emp::text));
  -- proteção contra abuso
  if (select count(*) from public.portal_solicitacoes where empresa_id = v_emp and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Muitas solicitações agora. Tente de novo mais tarde ou fale pelo WhatsApp.';
  end if;
  if (v_email is not null and (select count(*) from public.portal_solicitacoes where empresa_id = v_emp and email = v_email and created_at > now() - interval '1 hour') >= 3)
     or (v_tel is not null and (select count(*) from public.portal_solicitacoes where empresa_id = v_emp and telefone = v_tel and created_at > now() - interval '1 hour') >= 3) then
    raise exception 'Você já enviou várias solicitações agora. Aguarde o retorno da loja.';
  end if;
  if length(trim(coalesce(p_dados->>'nome', ''))) < 2 then raise exception 'Informe seu nome'; end if;
  if v_email is null and v_tel is null then raise exception 'Informe e-mail ou telefone para receber a proposta'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  v_qtd := coalesce(nullif(p_dados->>'quantidade', '')::numeric, 1);
  if v_qtd <= 0 or v_qtd > 100000 then raise exception 'Quantidade inválida'; end if;
  v_prod := nullif(p_dados->>'produto_id', '')::uuid;
  if v_prod is not null and not exists (select 1 from public.produtos where id = v_prod and empresa_id = v_emp and no_portal and status = 'ativo') then raise exception 'Produto não encontrado'; end if;
  v_mat := nullif(p_dados->>'material_id', '')::uuid;
  if v_mat is not null and not (v_mat = any(pc.materiais_ids)) then raise exception 'Material não disponível'; end if;
  -- arquivos: só os que acabaram de ser enviados para a pasta desta solicitação
  if jsonb_typeof(coalesce(p_dados->'arquivos', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_dados->'arquivos', '[]'::jsonb)) > 5 then raise exception 'Envie até 5 arquivos'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_dados->'arquivos', '[]'::jsonb)) loop
    v_path := a #>> '{}';
    if not pc.aceitar_arquivos then raise exception 'Esta loja não recebe arquivos pelo portal'; end if;
    if v_pasta is null then v_pasta := split_part(v_path, '/', 3); end if;
    if split_part(v_path, '/', 1) <> v_emp::text or split_part(v_path, '/', 2) <> 'portal' or split_part(v_path, '/', 3) <> v_pasta
       or not exists (select 1 from storage.objects where bucket_id = 'empresa' and name = v_path and created_at > now() - interval '2 hours') then
      raise exception 'Arquivo não encontrado: envie de novo';
    end if;
    if exists (select 1 from public.portal_solicitacoes s, jsonb_array_elements(s.arquivos) x where s.empresa_id = v_emp and x->>'path' = v_path) then
      raise exception 'Arquivo já usado em outra solicitação';
    end if;
    v_arqs := v_arqs || jsonb_build_array(jsonb_build_object('path', v_path, 'nome', split_part(v_path, '/', 4),
                 'tamanho', (select (metadata->>'size')::bigint from storage.objects where bucket_id = 'empresa' and name = v_path)));
  end loop;
  if v_prod is null and jsonb_array_length(v_arqs) = 0 and length(trim(coalesce(p_dados->>'observacoes', ''))) < 10 then
    raise exception 'Escolha um produto, envie o arquivo 3D ou descreva o que precisa';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.portal_solicitacoes(empresa_id, numero, token, nome, email, telefone, cidade, produto_id, material_id, cor, quantidade, observacoes, arquivos)
  values (v_emp, private.proximo_numero(v_emp, 'portal'), v_token, left(trim(p_dados->>'nome'), 150), left(v_email, 150), left(v_tel, 30),
          left(nullif(trim(p_dados->>'cidade'), ''), 100), v_prod, v_mat, left(nullif(trim(p_dados->>'cor'), ''), 60), v_qtd,
          left(nullif(trim(p_dados->>'observacoes'), ''), 3000), v_arqs);
  return v_token;
end; $$;

-- comprador acompanha só a própria solicitação (link secreto)
create or replace function public.portal_acompanhar(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.portal_solicitacoes; o public.orcamentos; p public.pedidos; e public.envios; emp public.empresas; pc public.portal_config;
begin
  if p_token is null or length(p_token) < 48 then raise exception 'Link inválido'; end if;
  select * into s from public.portal_solicitacoes where token = p_token;
  if s.id is null or s.expira_em < now() then raise exception 'Link inválido ou expirado'; end if;
  select * into emp from public.empresas where id = s.empresa_id;
  select * into pc from public.portal_config where empresa_id = s.empresa_id;
  if s.orcamento_id is not null then select * into o from public.orcamentos where id = s.orcamento_id; end if;
  if o.pedido_id is not null then select * into p from public.pedidos where id = o.pedido_id; end if;
  if p.id is not null then select * into e from public.envios where pedido_id = p.id and status not in ('cancelado') order by created_at desc limit 1; end if;
  return jsonb_build_object(
    'loja', jsonb_build_object('nome', emp.nome, 'whatsapp', coalesce(pc.whatsapp, emp.whatsapp), 'slug', case when pc.ativo then pc.slug end),
    'solicitacao', jsonb_build_object('numero', s.numero, 'status', s.status, 'criada_em', s.created_at, 'nome', s.nome, 'quantidade', s.quantidade, 'cor', s.cor,
        'observacoes', s.observacoes, 'motivo_recusa', s.motivo_recusa,
        'produto', (select nome from public.produtos where id = s.produto_id), 'material', (select nome from public.materiais where id = s.material_id),
        'arquivos', coalesce((select jsonb_agg(x->>'nome') from jsonb_array_elements(s.arquivos) x), '[]'::jsonb)),
    'orcamento', case when o.id is not null and o.status not in ('rascunho','cancelado') then jsonb_build_object('numero', o.numero, 'status', o.status, 'total', o.total,
        'validade', o.validade, 'prazo_entrega_dias', o.prazo_entrega_dias, 'token', o.token_publico) end,
    'pedido', case when p.id is not null then jsonb_build_object('numero', p.numero, 'status', p.status, 'status_producao', p.status_producao,
        'status_pagamento', p.status_pagamento, 'status_entrega', p.status_entrega, 'data_entrega', p.data_entrega, 'valor_total', p.valor_total,
        'valor_pago', p.valor_pago, 'transportadora', p.transportadora, 'codigo_rastreio', p.codigo_rastreio, 'entregue_em', p.entregue_em) end,
    'envio', case when e.id is not null then jsonb_build_object('status', e.status, 'modalidade', e.modalidade, 'codigo_rastreio', e.codigo_rastreio,
        'transportadora', e.transportadora, 'data_postagem', e.data_postagem, 'previsao_entrega', e.previsao_entrega, 'entregue_em', e.entregue_em) end);
end; $$;

create or replace function public.portal_mudar_status(p_id uuid, p_status text, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.portal_solicitacoes;
begin
  select * into s from public.portal_solicitacoes where id = p_id for update;
  if s.id is null or not private.pode(s.empresa_id, 'orcamentos_criar') then raise exception 'Solicitação não encontrada'; end if;
  if p_status not in ('nova','em_analise','recusada') then raise exception 'Situação inválida'; end if;
  if s.status in ('orcada','cancelada') then raise exception 'Esta solicitação já virou orçamento'; end if;
  if p_status = 'recusada' and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo para o comprador'; end if;
  update public.portal_solicitacoes set status = p_status, motivo_recusa = case when p_status = 'recusada' then left(trim(p_motivo), 1000) end where id = s.id;
end; $$;

-- transforma a solicitação em orçamento (cliente é encontrado ou cadastrado)
create or replace function public.portal_gerar_orcamento(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.portal_solicitacoes; pr public.produtos; v_cli uuid; v_orc uuid; v_arq jsonb;
begin
  select * into s from public.portal_solicitacoes where id = p_id for update;
  if s.id is null or not private.pode(s.empresa_id, 'orcamentos_criar') then raise exception 'Solicitação não encontrada'; end if;
  if s.orcamento_id is not null then return s.orcamento_id; end if;
  if s.status = 'recusada' then raise exception 'Solicitação recusada: reabra antes de orçar'; end if;
  select id into v_cli from public.clientes where empresa_id = s.empresa_id
     and ((s.email is not null and lower(email) = s.email) or (s.telefone is not null and regexp_replace(coalesce(whatsapp, telefone, ''), '[^0-9+]', '', 'g') = s.telefone))
   order by created_at limit 1;
  if v_cli is null then
    if not private.pode(s.empresa_id, 'clientes_editar') and not private.pode(s.empresa_id, 'orcamentos_criar') then raise exception 'Sem permissão para cadastrar o cliente'; end if;
    insert into public.clientes(empresa_id, nome, email, telefone, whatsapp, cidade, observacoes)
    values (s.empresa_id, s.nome, s.email, s.telefone, s.telefone, s.cidade, 'Cadastrado pelo portal (solicitação #' || s.numero || ')')
    returning id into v_cli;
  end if;
  select * into pr from public.produtos where id = s.produto_id;
  v_arq := s.arquivos->0;
  insert into public.orcamentos(empresa_id, cliente_id, titulo, descricao)
  values (s.empresa_id, v_cli, left('Portal #' || s.numero || ' · ' || coalesce(pr.nome, v_arq->>'nome', 'Peça sob encomenda'), 200),
          left(concat_ws(E'\n', s.observacoes,
               case when jsonb_array_length(s.arquivos) > 1 then 'Arquivos enviados: ' || (select string_agg(x->>'nome', ', ') from jsonb_array_elements(s.arquivos) x) end), 5000))
  returning id into v_orc;
  insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, produto_id, material_id, cor, quantidade, peso_g, tempo_h, impressora_id, arquivo_path, arquivo_nome)
  values (s.empresa_id, v_orc, left(coalesce(pr.nome, v_arq->>'nome', 'Peça sob encomenda'), 300), pr.id, coalesce(s.material_id, pr.material_id),
          coalesce(s.cor, pr.cor), s.quantidade, coalesce(pr.peso_g, 0), coalesce(pr.tempo_h, 0), pr.impressora_id, v_arq->>'path', v_arq->>'nome');
  update public.portal_solicitacoes set status = 'orcada', orcamento_id = v_orc, cliente_id = v_cli where id = s.id;
  return v_orc;
end; $$;

-- =====================================================================
-- 5) RELATÓRIOS AVANÇADOS (todos com período; exportação CSV na tela)
-- =====================================================================
create or replace function private.col(k text, t text, tipo text default 'texto') returns jsonb
language sql immutable set search_path = '' as $$ select jsonb_build_object('chave', k, 'titulo', t, 'tipo', tipo) $$;

create or replace function public.relatorio(p_empresa uuid, p_tipo text, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb; l jsonb;
begin
  if not private.tem_permissao(p_empresa, 'relatorios_ver') then raise exception 'Sem acesso aos relatórios'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 1830 then raise exception 'Período inválido (até 5 anos)'; end if;

  if p_tipo = 'faturamento' then
    c := jsonb_build_array(private.col('mes','Mês'), private.col('pedidos','Pedidos','numero'), private.col('faturamento','Faturamento','moeda'),
           private.col('recebido','Recebido no mês','moeda'), private.col('ticket','Ticket médio','moeda'), private.col('cancelados','Cancelados','numero'));
    select jsonb_agg(jsonb_build_object('mes', to_char(m, 'MM/YYYY'),
        'pedidos', (select count(*) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m and created_at::date between p_inicio and p_fim),
        'faturamento', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m and created_at::date between p_inicio and p_fim),
        'recebido', (select coalesce(sum(valor), 0) from public.pagamentos where empresa_id = p_empresa and not estornado and date_trunc('month', data) = m and data between p_inicio and p_fim),
        'ticket', (select coalesce(round(avg(valor_total), 2), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m and created_at::date between p_inicio and p_fim),
        'cancelados', (select count(*) from public.pedidos where empresa_id = p_empresa and status = 'cancelado' and date_trunc('month', created_at) = m and created_at::date between p_inicio and p_fim)) order by m)
      into l from generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') m;

  elsif p_tipo = 'lucro_pedido' then
    c := jsonb_build_array(private.col('numero','Pedido'), private.col('data','Data','data'), private.col('cliente','Cliente'), private.col('valor','Valor','moeda'),
           private.col('custo','Custo','moeda'), private.col('impostos','Impostos/taxas','moeda'), private.col('lucro','Lucro','moeda'), private.col('margem','Margem','pct'),
           private.col('custo_tipo','Custo'));
    select jsonb_agg(jsonb_build_object('numero', '#' || p.numero, 'data', p.created_at::date, 'cliente', cl.nome, 'valor', p.valor_total, 'custo', x.custo,
        'impostos', p.impostos_estimados, 'lucro', p.valor_total - x.custo - p.impostos_estimados,
        'margem', case when p.valor_total > 0 then round((p.valor_total - x.custo - p.impostos_estimados) / p.valor_total * 100, 1) end,
        'custo_tipo', case when x.real then 'real' else 'estimado' end) order by p.created_at desc)
      into l from public.pedidos p left join public.clientes cl on cl.id = p.cliente_id
      cross join lateral (select (p.status_producao = 'concluida' and p.custo_real > 0) as real,
                                 case when p.status_producao = 'concluida' and p.custo_real > 0 then p.custo_real else coalesce(p.custo_estimado, 0) end as custo) x
     where p.empresa_id = p_empresa and p.status <> 'cancelado' and p.created_at::date between p_inicio and p_fim;

  elsif p_tipo = 'lucro_produto' then
    c := jsonb_build_array(private.col('produto','Produto / item'), private.col('quantidade','Qtd. vendida','numero'), private.col('receita','Receita','moeda'),
           private.col('custo','Custo real produzido','moeda'), private.col('lucro','Lucro','moeda'), private.col('margem','Margem','pct'));
    select jsonb_agg(jsonb_build_object('produto', produto, 'quantidade', qtd, 'receita', receita, 'custo', custo, 'lucro', receita - custo,
        'margem', case when receita > 0 then round((receita - custo) / receita * 100, 1) end) order by receita - custo desc)
      into l from (
        select coalesce(pr.nome, i.descricao) produto, sum(i.quantidade) qtd, sum(i.quantidade * i.valor_unitario) receita,
               coalesce(sum((select sum(o.custo_real_total) from public.ordens_producao o where o.pedido_item_id = i.id and o.consumo_registrado)), 0)
             + coalesce(sum((select sum(r.custo_real_total) from public.ordens_producao o join public.ordens_producao r on r.reimpressao_de = o.id
                             where o.pedido_item_id = i.id and r.consumo_registrado)), 0) custo
          from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id left join public.produtos pr on pr.id = i.produto_id
         where p.empresa_id = p_empresa and p.status <> 'cancelado' and p.created_at::date between p_inicio and p_fim
         group by coalesce(pr.nome, i.descricao)) s;

  elsif p_tipo = 'lucro_impressora' then
    c := jsonb_build_array(private.col('impressora','Impressora'), private.col('ordens','Ordens','numero'), private.col('horas','Horas impressas','horas'),
           private.col('receita','Receita atribuída','moeda'), private.col('custo','Custo de produção','moeda'), private.col('lucro','Lucro','moeda'),
           private.col('lucro_hora','Lucro por hora','moeda'));
    select jsonb_agg(jsonb_build_object('impressora', nome, 'ordens', ordens, 'horas', horas, 'receita', receita, 'custo', custo, 'lucro', receita - custo,
        'lucro_hora', case when horas > 0 then round((receita - custo) / horas, 2) end) order by receita - custo desc)
      into l from (
        select coalesce(im.nome, 'Sem impressora') nome, count(*) ordens, coalesce(sum(o.horas_reais), 0) horas,
               coalesce(sum(case when o.reimpressao_de is null and o.status = 'concluida' then o.quantidade * coalesce(i.valor_unitario, 0) else 0 end), 0) receita,
               coalesce(sum(o.custo_real_total), 0) custo
          from public.ordens_producao o left join public.impressoras im on im.id = o.impressora_id left join public.pedido_itens i on i.id = o.pedido_item_id
         where o.empresa_id = p_empresa and o.consumo_registrado and coalesce(o.concluida_em, o.updated_at)::date between p_inicio and p_fim
         group by coalesce(im.nome, 'Sem impressora')) s;

  elsif p_tipo = 'rentabilidade_cliente' then
    c := jsonb_build_array(private.col('cliente','Cliente'), private.col('pedidos','Pedidos','numero'), private.col('faturamento','Faturamento','moeda'),
           private.col('custo','Custo','moeda'), private.col('lucro','Lucro','moeda'), private.col('margem','Margem','pct'), private.col('ticket','Ticket médio','moeda'),
           private.col('em_aberto','A receber','moeda'));
    select jsonb_agg(jsonb_build_object('cliente', cliente, 'pedidos', n, 'faturamento', fat, 'custo', custo, 'lucro', fat - custo - imp,
        'margem', case when fat > 0 then round((fat - custo - imp) / fat * 100, 1) end, 'ticket', round(fat / n, 2), 'em_aberto', aberto) order by fat - custo - imp desc)
      into l from (
        select coalesce(cl.nome, 'Sem cliente') cliente, count(*) n, sum(p.valor_total) fat, sum(p.impostos_estimados) imp,
               sum(case when p.status_producao = 'concluida' and p.custo_real > 0 then p.custo_real else coalesce(p.custo_estimado, 0) end) custo,
               sum(greatest(p.valor_total - p.valor_pago, 0)) aberto
          from public.pedidos p left join public.clientes cl on cl.id = p.cliente_id
         where p.empresa_id = p_empresa and p.status <> 'cancelado' and p.created_at::date between p_inicio and p_fim
         group by coalesce(cl.nome, 'Sem cliente')) s;

  elsif p_tipo = 'materiais_consumidos' then
    c := jsonb_build_array(private.col('material','Material'), private.col('quantidade','Consumido','numero'), private.col('unidade','Unid.'),
           private.col('custo','Custo aproximado','moeda'), private.col('movimentos','Saídas','numero'));
    select jsonb_agg(jsonb_build_object('material', m.nome || coalesce(' · ' || m.cor, ''), 'quantidade', round(q, 3), 'unidade', m.unidade,
        'custo', round(q * m.custo_medio, 2), 'movimentos', n) order by q * m.custo_medio desc)
      into l from (select material_id, sum(quantidade) q, count(*) n from public.movimentacoes_estoque
                    where empresa_id = p_empresa and tipo = 'saida' and estorno_de is null and created_at::date between p_inicio and p_fim
                      and not exists (select 1 from public.movimentacoes_estoque x where x.estorno_de = movimentacoes_estoque.id)
                    group by material_id) s join public.materiais m on m.id = s.material_id;

  elsif p_tipo = 'desperdicio' then
    c := jsonb_build_array(private.col('material','Material'), private.col('consumo_g','Usado nas peças (g)','numero'), private.col('perdas_g','Perdas (g)','numero'),
           private.col('falhas_g','Perdido em falhas (g)','numero'), private.col('desperdicio','Desperdício','pct'), private.col('custo_perdido','Custo perdido','moeda'));
    select jsonb_agg(jsonb_build_object('material', nome, 'consumo_g', ok_g, 'perdas_g', perdas, 'falhas_g', falhas,
        'desperdicio', case when ok_g + perdas + falhas > 0 then round((perdas + falhas) / (ok_g + perdas + falhas) * 100, 1) end,
        'custo_perdido', custo) order by perdas + falhas desc)
      into l from (
        select coalesce(m.nome || coalesce(' · ' || m.cor, ''), 'Sem material') nome,
               coalesce(sum(case when o.status <> 'falha' then o.consumo_real_g end), 0) ok_g,
               coalesce(sum(case when o.status <> 'falha' then o.perdas_g end), 0) perdas,
               coalesce(sum(case when o.status = 'falha' then coalesce(o.consumo_real_g, 0) + coalesce(o.perdas_g, 0) end), 0) falhas,
               coalesce(sum(case when o.status = 'falha' then o.custo_material
                                 when coalesce(o.consumo_real_g, 0) + coalesce(o.perdas_g, 0) > 0 then o.custo_material * o.perdas_g / (o.consumo_real_g + o.perdas_g) end), 0)::numeric(12,2) custo
          from public.ordens_producao o left join public.materiais m on m.id = o.material_id
         where o.empresa_id = p_empresa and o.consumo_registrado and coalesce(o.concluida_em, o.updated_at)::date between p_inicio and p_fim
         group by 1) s;

  elsif p_tipo = 'maquinas' then
    c := jsonb_build_array(private.col('impressora','Impressora'), private.col('horas','Horas impressas','horas'), private.col('concluidas','Ordens concluídas','numero'),
           private.col('falhas','Falhas','numero'), private.col('taxa_falha','Taxa de falha','pct'), private.col('parado_h','Parada em manutenção','horas'),
           private.col('custo_manut','Custo manutenção','moeda'), private.col('horas_total','Horas acumuladas','horas'));
    select jsonb_agg(jsonb_build_object('impressora', i.nome, 'horas', coalesce(o.horas, 0), 'concluidas', coalesce(o.ok, 0), 'falhas', coalesce(o.falhas, 0),
        'taxa_falha', case when coalesce(o.ok, 0) + coalesce(o.falhas, 0) > 0 then round(o.falhas::numeric / (o.ok + o.falhas) * 100, 1) end,
        'parado_h', coalesce(mt.parado, 0), 'custo_manut', coalesce(mt.custo, 0), 'horas_total', i.horas_acumuladas) order by coalesce(o.horas, 0) desc)
      into l from public.impressoras i
      left join lateral (select sum(horas_reais) horas, count(*) filter (where status = 'concluida') ok, count(*) filter (where status = 'falha') falhas
                           from public.ordens_producao where impressora_id = i.id and consumo_registrado and coalesce(concluida_em, updated_at)::date between p_inicio and p_fim) o on true
      left join lateral (select sum(tempo_parado_h) parado, sum(custo_total) custo from public.manutencoes
                          where impressora_id = i.id and status = 'concluida' and concluida_em::date between p_inicio and p_fim) mt on true
     where i.empresa_id = p_empresa;

  elsif p_tipo = 'falhas' then
    c := jsonb_build_array(private.col('motivo','Motivo da falha'), private.col('ocorrencias','Ocorrências','numero'), private.col('perdido_g','Material perdido (g)','numero'),
           private.col('horas','Horas perdidas','horas'), private.col('custo','Custo perdido','moeda'), private.col('reimpressoes','Reimpressões','numero'),
           private.col('custo_reimpressao','Custo das reimpressões','moeda'));
    select jsonb_agg(jsonb_build_object('motivo', motivo, 'ocorrencias', n, 'perdido_g', g, 'horas', h, 'custo', custo, 'reimpressoes', reimp, 'custo_reimpressao', custo_reimp) order by custo + custo_reimp desc)
      into l from (
        select coalesce(nullif(trim(o.motivo_falha), ''), 'Não informado') motivo, count(*) n,
               coalesce(sum(coalesce(o.consumo_real_g, 0) + coalesce(o.perdas_g, 0)), 0) g, coalesce(sum(o.horas_reais), 0) h, coalesce(sum(o.custo_real_total), 0) custo,
               count(r.id) reimp, coalesce(sum(r.custo_real_total), 0) custo_reimp
          from public.ordens_producao o left join public.ordens_producao r on r.reimpressao_de = o.id
         where o.empresa_id = p_empresa and o.status = 'falha' and o.updated_at::date between p_inicio and p_fim
         group by 1) s;

  elsif p_tipo = 'pedidos_atrasados' then
    c := jsonb_build_array(private.col('numero','Pedido'), private.col('cliente','Cliente'), private.col('prazo','Prazo','data'), private.col('entregue','Entregue em','data'),
           private.col('dias','Dias de atraso','numero'), private.col('situacao','Situação'), private.col('valor','Valor','moeda'));
    select jsonb_agg(jsonb_build_object('numero', '#' || p.numero, 'cliente', cl.nome, 'prazo', p.data_entrega, 'entregue', p.entregue_em::date,
        'dias', coalesce(p.entregue_em::date, current_date) - p.data_entrega, 'situacao', p.status, 'valor', p.valor_total)
        order by coalesce(p.entregue_em::date, current_date) - p.data_entrega desc)
      into l from public.pedidos p left join public.clientes cl on cl.id = p.cliente_id
     where p.empresa_id = p_empresa and p.status <> 'cancelado' and p.data_entrega between p_inicio and p_fim
       and p.data_entrega < coalesce(p.entregue_em::date, current_date);

  elsif p_tipo = 'orcamentos' then
    c := jsonb_build_array(private.col('mes','Mês'), private.col('criados','Criados','numero'), private.col('enviados','Enviados','numero'),
           private.col('aprovados','Aprovados','numero'), private.col('rejeitados','Recusados','numero'), private.col('conversao','Conversão','pct'),
           private.col('valor_aprovado','Valor aprovado','moeda'), private.col('ticket','Ticket médio aprovado','moeda'));
    select jsonb_agg(jsonb_build_object('mes', to_char(m, 'MM/YYYY'), 'criados', cr, 'enviados', env, 'aprovados', apr, 'rejeitados', rej,
        'conversao', case when env > 0 then round(apr::numeric / env * 100, 1) end, 'valor_aprovado', vapr,
        'ticket', case when apr > 0 then round(vapr / apr, 2) end) order by m)
      into l from (
        select m, count(o.id) cr, count(o.id) filter (where o.status not in ('rascunho','cancelado') or o.enviado_em is not null) env,
               count(o.id) filter (where o.status in ('aprovado','convertido')) apr, count(o.id) filter (where o.status = 'rejeitado') rej,
               coalesce(sum(o.total) filter (where o.status in ('aprovado','convertido')), 0) vapr
          from generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') m
          left join public.orcamentos o on o.empresa_id = p_empresa and date_trunc('month', o.created_at) = m and o.created_at::date between p_inicio and p_fim
         group by m) s;

  elsif p_tipo = 'estoque_valorizado' then
    c := jsonb_build_array(private.col('tipo','Tipo'), private.col('item','Item'), private.col('quantidade','Quantidade','numero'), private.col('unidade','Unid.'),
           private.col('custo','Custo unitário','moeda'), private.col('valor','Valor em estoque','moeda'));
    select jsonb_agg(x order by (x->>'valor')::numeric desc) into l from (
      select jsonb_build_object('tipo', 'Matéria-prima', 'item', nome || coalesce(' · ' || cor, ''), 'quantidade', quantidade, 'unidade', unidade,
             'custo', custo_medio, 'valor', round(quantidade * custo_medio, 2)) x
        from public.materiais where empresa_id = p_empresa and ativo and quantidade > 0
      union all
      select jsonb_build_object('tipo', 'Produto acabado', 'item', nome, 'quantidade', estoque_qtd, 'unidade', 'un', 'custo', custo_padrao, 'valor', round(estoque_qtd * custo_padrao, 2))
        from public.produtos where empresa_id = p_empresa and controla_estoque and estoque_qtd > 0) s;

  elsif p_tipo = 'fluxo_caixa' then
    c := jsonb_build_array(private.col('dia','Dia','data'), private.col('entradas','Entradas','moeda'), private.col('saidas','Saídas','moeda'),
           private.col('saldo','Saldo do dia','moeda'), private.col('acumulado','Acumulado no período','moeda'));
    select jsonb_agg(jsonb_build_object('dia', d, 'entradas', ent, 'saidas', sai, 'saldo', ent - sai, 'acumulado', acum) order by d)
      into l from (select *, sum(ent - sai) over (order by d) acum from (
        select d::date d,
          (select coalesce(sum(valor), 0) from public.pagamentos where empresa_id = p_empresa and not estornado and data = d::date)
          + (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'receita' and pago and not cancelado and data_pagamento = d::date) ent,
          (select coalesce(sum(valor), 0) from public.gastos where empresa_id = p_empresa and data = d::date)
          + (select coalesce(sum(valor), 0) from public.lancamentos where empresa_id = p_empresa and tipo = 'despesa' and pago and not cancelado and data_pagamento = d::date) sai
          from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d) s0) s
     where ent <> 0 or sai <> 0;

  elsif p_tipo = 'producao_operador' then
    c := jsonb_build_array(private.col('operador','Operador'), private.col('ordens','Ordens','numero'), private.col('concluidas','Concluídas','numero'),
           private.col('pecas','Peças','numero'), private.col('horas','Horas de impressão','horas'), private.col('falhas','Falhas','numero'),
           private.col('taxa_falha','Taxa de falha','pct'));
    select jsonb_agg(jsonb_build_object('operador', operador, 'ordens', n, 'concluidas', ok, 'pecas', pecas, 'horas', h, 'falhas', f,
        'taxa_falha', case when ok + f > 0 then round(f::numeric / (ok + f) * 100, 1) end) order by ok desc)
      into l from (
        select coalesce(u.email::text, 'Sem operador') operador, count(*) n, count(*) filter (where o.status = 'concluida') ok,
               coalesce(sum(o.quantidade) filter (where o.status = 'concluida'), 0) pecas, coalesce(sum(o.horas_reais), 0) h, count(*) filter (where o.status = 'falha') f
          from public.ordens_producao o left join auth.users u on u.id = coalesce(o.operador_id, o.concluida_por)
         where o.empresa_id = p_empresa and o.consumo_registrado and coalesce(o.concluida_em, o.updated_at)::date between p_inicio and p_fim
         group by 1) s;

  elsif p_tipo = 'compras_fornecedor' then
    c := jsonb_build_array(private.col('fornecedor','Fornecedor'), private.col('compras','Compras','numero'), private.col('total','Total comprado','moeda'),
           private.col('recebidas','Recebidas','numero'), private.col('prazo_real','Prazo real médio (dias)','numero'), private.col('prazo_informado','Prazo informado (dias)','numero'));
    select jsonb_agg(jsonb_build_object('fornecedor', f.nome, 'compras', n, 'total', total, 'recebidas', rec, 'prazo_real', prazo, 'prazo_informado', f.prazo_medio_dias) order by total desc)
      into l from (
        select fornecedor_id, count(*) n, sum(total) total, count(*) filter (where status = 'recebido') rec,
               round(avg(extract(epoch from recebido_em - enviado_em) / 86400) filter (where recebido_em is not null and enviado_em is not null), 1) prazo
          from public.pedidos_compra where empresa_id = p_empresa and status not in ('cancelado','rascunho')
           and coalesce(data_pedido, created_at::date) between p_inicio and p_fim group by fornecedor_id) s
      join public.fornecedores f on f.id = s.fornecedor_id;

  elsif p_tipo = 'manutencao' then
    c := jsonb_build_array(private.col('impressora','Impressora'), private.col('total','Manutenções','numero'), private.col('preventivas','Preventivas','numero'),
           private.col('corretivas','Corretivas','numero'), private.col('custo','Custo','moeda'), private.col('parado_h','Horas paradas','horas'));
    select jsonb_agg(jsonb_build_object('impressora', i.nome, 'total', n, 'preventivas', pv, 'corretivas', cr, 'custo', custo, 'parado_h', parado) order by custo desc)
      into l from (
        select impressora_id, count(*) n, count(*) filter (where tipo = 'preventiva') pv, count(*) filter (where tipo = 'corretiva') cr,
               coalesce(sum(custo_total), 0) custo, coalesce(sum(tempo_parado_h), 0) parado
          from public.manutencoes where empresa_id = p_empresa and status = 'concluida' and concluida_em::date between p_inicio and p_fim group by impressora_id) s
      join public.impressoras i on i.id = s.impressora_id;

  else
    raise exception 'Relatório desconhecido';
  end if;
  return jsonb_build_object('colunas', c, 'linhas', coalesce(l, '[]'::jsonb));
end; $$;

-- =====================================================================
-- 6) Arquivos, notificações e permissões de execução
-- =====================================================================
create or replace function private.pode_enviar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or not private.is_membro(v_emp) then return false; end if;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then return false; end if;
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','gcode','png','jpg','jpeg','webp','pdf') then return false; end if;
  if split_part(p_nome, '/', 2) not in ('logo','produtos','orcamentos','impressoras','clientes','producao','financeiro','pedidos','compras','manutencao','expedicao') then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

-- avisos da Fase 4 somados aos já existentes
alter function public.minhas_notificacoes(uuid) rename to minhas_notificacoes_base;
create or replace function public.minhas_notificacoes(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := public.minhas_notificacoes_base(p_empresa);
begin
  if private.tem_permissao(p_empresa, 'orcamentos_criar') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'portal-' || id, 'tipo', 'orcamento', 'nivel', 'info', 'titulo', 'Nova solicitação pelo portal',
              'texto', '#' || numero || ' · ' || nome, 'link', '/portal/?id=' || id)) from public.portal_solicitacoes
             where empresa_id = p_empresa and status = 'nova'), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'impressoras_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'manut-' || (x->>'plano_id') || '-' || (x->>'nivel'), 'tipo', 'impressora',
              'nivel', case when x->>'nivel' = 'vencida' then 'alerta' else 'info' end,
              'titulo', case when x->>'nivel' = 'vencida' then 'Manutenção vencida' else 'Manutenção se aproximando' end,
              'texto', (x->>'impressora') || ' · ' || replace(x->>'servico', '_', ' '), 'link', '/manutencao/'))
             from jsonb_array_elements(public.manutencao_alertas(p_empresa)) x where not (x->>'agendada')::boolean), '[]'::jsonb);
  end if;
  if private.is_admin(p_empresa) or private.tem_permissao(p_empresa, 'financeiro_ver') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'compra-' || id, 'tipo', 'compras', 'nivel', 'info', 'titulo', 'Compra aguardando aprovação',
              'texto', 'Compra #' || numero || ' · R$ ' || to_char(total, 'FM999G999G990D00'), 'link', '/compras/?id=' || id)) from public.pedidos_compra
             where empresa_id = p_empresa and status = 'solicitado'), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'expedicao_gerenciar') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'expedir-' || p.id, 'tipo', 'pedido', 'nivel', 'sucesso', 'titulo', 'Pedido pronto para expedição',
              'texto', '#' || p.numero || coalesce(' ' || p.descricao, ''), 'link', '/expedicao/')) from public.pedidos p
             where p.empresa_id = p_empresa and p.status <> 'cancelado' and p.status_entrega = 'pronto'
               and not exists (select 1 from public.envios e where e.pedido_id = p.id and e.status not in ('cancelado','devolvido'))), '[]'::jsonb);
  end if;
  return r;
end; $$;
revoke all on function public.minhas_notificacoes_base(uuid) from public, anon, authenticated;

revoke all on function public.compra_mudar_status(uuid, public.status_compra, text), public.receber_compra(uuid, jsonb, date, text, text, text),
  public.encerrar_compra(uuid, text), public.iniciar_manutencao(uuid),
  public.concluir_manutencao(uuid, numeric, numeric, numeric, uuid, numeric, text, boolean), public.cancelar_manutencao(uuid, text),
  public.manutencao_alertas(uuid), public.criar_envio(uuid, text), public.mudar_status_envio(uuid, public.status_envio, text, text),
  public.conferir_envio(uuid), public.portal_mudar_status(uuid, text, text), public.portal_gerar_orcamento(uuid),
  public.relatorio(uuid, text, date, date), public.minhas_notificacoes(uuid), public.estornar_movimentacao(uuid, text),
  public.atualizar_entrega(uuid, public.status_entrega_pedido, text, text), public.portal_publico(text), public.portal_solicitar(text, jsonb),
  public.portal_acompanhar(text) from public, anon;
grant execute on function public.compra_mudar_status(uuid, public.status_compra, text), public.receber_compra(uuid, jsonb, date, text, text, text),
  public.encerrar_compra(uuid, text), public.iniciar_manutencao(uuid),
  public.concluir_manutencao(uuid, numeric, numeric, numeric, uuid, numeric, text, boolean), public.cancelar_manutencao(uuid, text),
  public.manutencao_alertas(uuid), public.criar_envio(uuid, text), public.mudar_status_envio(uuid, public.status_envio, text, text),
  public.conferir_envio(uuid), public.portal_mudar_status(uuid, text, text), public.portal_gerar_orcamento(uuid),
  public.relatorio(uuid, text, date, date), public.minhas_notificacoes(uuid), public.estornar_movimentacao(uuid, text),
  public.atualizar_entrega(uuid, public.status_entrega_pedido, text, text) to authenticated;
grant execute on function public.portal_publico(text), public.portal_solicitar(text, jsonb), public.portal_acompanhar(text) to anon, authenticated;

-- vínculos dos lançamentos (depois que as tabelas existem)
do $$ begin
  alter table public.lancamentos add constraint lanc_compra_fk foreign key (compra_id) references public.pedidos_compra(id) on delete set null;
  alter table public.lancamentos add constraint lanc_manut_fk foreign key (manutencao_id) references public.manutencoes(id) on delete set null;
  alter table public.lancamentos add constraint lanc_envio_fk foreign key (envio_id) references public.envios(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists lanc_compra_idx on public.lancamentos(compra_id) where compra_id is not null;
