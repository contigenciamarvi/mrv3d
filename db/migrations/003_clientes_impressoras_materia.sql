-- =====================================================================
-- FASE 2 — Clientes/CRM, Impressoras, Matéria-prima transacional
-- =====================================================================

-- ---------- Clientes ---------------------------------------------------
alter table public.clientes
  add column if not exists tipo_pessoa text not null default 'fisica' check (tipo_pessoa in ('fisica','juridica')),
  add column if not exists documento text check (length(documento) <= 20),
  add column if not exists whatsapp text check (length(whatsapp) <= 30),
  add column if not exists endereco text check (length(endereco) <= 300),
  add column if not exists cidade text check (length(cidade) <= 100),
  add column if not exists uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column if not exists cep text check (length(cep) <= 10),
  add column if not exists etiquetas text[] not null default '{}',
  add column if not exists observacoes_internas text check (length(observacoes_internas) <= 5000),
  add column if not exists margem_pct numeric(5,2) check (margem_pct >= 0 and margem_pct < 100),
  add column if not exists arquivado boolean not null default false;
create index if not exists clientes_empresa_nome_idx on public.clientes(empresa_id, lower(nome));
create index if not exists clientes_etiquetas_idx on public.clientes using gin(etiquetas);
create index if not exists pedidos_cliente_idx on public.pedidos(cliente_id);

do $$ begin
  create type public.etapa_crm as enum ('novo_contato','aguardando_arquivo','em_orcamento','orcamento_enviado','negociacao','aprovado','perdido');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 200),
  etapa public.etapa_crm not null default 'novo_contato',
  valor_estimado numeric(12,2) check (valor_estimado >= 0),
  motivo_perda text check (length(motivo_perda) <= 1000),
  observacoes text check (length(observacoes) <= 5000),
  responsavel_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_motivo_perda check (etapa <> 'perdido' or length(trim(coalesce(motivo_perda, ''))) >= 3)
);
create index if not exists crm_empresa_etapa_idx on public.crm_oportunidades(empresa_id, etapa);
alter table public.crm_oportunidades enable row level security;
create trigger trg_crm_upd before update on public.crm_oportunidades for each row execute function public.set_updated_at();
create policy crm_ler on public.crm_oportunidades for select using (private.tem_permissao(empresa_id, 'clientes_ver') or private.tem_acesso_suporte(empresa_id));
create policy crm_inserir on public.crm_oportunidades for insert with check (private.pode(empresa_id, 'clientes_editar'));
create policy crm_alterar on public.crm_oportunidades for update using (private.pode(empresa_id, 'clientes_editar')) with check (private.pode(empresa_id, 'clientes_editar'));
create policy crm_excluir on public.crm_oportunidades for delete using (private.pode(empresa_id, 'clientes_editar'));

-- Resumo comercial por cliente (respeita RLS de quem consulta)
create or replace view public.clientes_resumo with (security_invoker = true) as
select c.id as cliente_id, c.empresa_id,
       count(p.id) filter (where p.status <> 'cancelado') as pedidos,
       coalesce(sum(p.valor_total) filter (where p.status <> 'cancelado'), 0) as total_comprado,
       coalesce(sum(p.valor_pago) filter (where p.status <> 'cancelado'), 0) as total_pago,
       case when count(p.id) filter (where p.status <> 'cancelado') > 0
            then round(sum(p.valor_total) filter (where p.status <> 'cancelado') / count(p.id) filter (where p.status <> 'cancelado'), 2) end as ticket_medio,
       max(p.created_at) filter (where p.status <> 'cancelado') as ultima_compra
  from public.clientes c left join public.pedidos p on p.cliente_id = c.id
 group by c.id, c.empresa_id;
grant select on public.clientes_resumo to authenticated;

-- ---------- Impressoras ------------------------------------------------
do $$ begin
  create type public.tecnologia_impressao as enum ('fdm','sla','msla','outra');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.status_impressora as enum ('disponivel','reservada','imprimindo','pausada','manutencao','inativa');
exception when duplicate_object then null; end $$;

create table if not exists public.impressoras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 100),
  fabricante text check (length(fabricante) <= 100),
  modelo text check (length(modelo) <= 100),
  numero_serie text check (length(numero_serie) <= 100),
  tecnologia public.tecnologia_impressao not null default 'fdm',
  volume_x numeric(8,1) check (volume_x >= 0),
  volume_y numeric(8,1) check (volume_y >= 0),
  volume_z numeric(8,1) check (volume_z >= 0),
  materiais_compativeis text[] not null default '{}',
  diametro_filamento numeric(4,2) check (diametro_filamento > 0),
  extrusores integer not null default 1 check (extrusores between 1 and 16),
  potencia_w numeric(8,1) not null default 0 check (potencia_w >= 0),
  custo_aquisicao numeric(12,2) not null default 0 check (custo_aquisicao >= 0),
  data_aquisicao date,
  vida_util_horas numeric(10,1) not null default 5000 check (vida_util_horas > 0),
  custo_manutencao_hora numeric(10,4) not null default 0 check (custo_manutencao_hora >= 0),
  custo_hora numeric(10,4) generated always as (round(custo_aquisicao / vida_util_horas + custo_manutencao_hora, 4)) stored,
  horas_acumuladas numeric(12,2) not null default 0 check (horas_acumuladas >= 0),
  localizacao text check (length(localizacao) <= 100),
  operador_id uuid references auth.users(id) on delete set null,
  status public.status_impressora not null default 'disponivel',
  observacoes text check (length(observacoes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists impressoras_empresa_idx on public.impressoras(empresa_id, status);
alter table public.impressoras enable row level security;
create trigger trg_impressoras_upd before update on public.impressoras for each row execute function public.set_updated_at();
create policy impressoras_ler on public.impressoras for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_acesso_suporte(empresa_id));
create policy impressoras_inserir on public.impressoras for insert with check (private.pode(empresa_id, 'impressoras_editar'));
create policy impressoras_alterar on public.impressoras for update using (private.pode(empresa_id, 'impressoras_editar')) with check (private.pode(empresa_id, 'impressoras_editar'));
create policy impressoras_excluir on public.impressoras for delete using (private.pode(empresa_id, 'impressoras_editar'));
create trigger trg_audemp_impressoras after insert or update or delete on public.impressoras for each row execute function private.auditar_empresa();

-- Limite de impressoras do plano (inativas não contam)
create or replace function private.checar_limite_impressoras() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int; v_qtd int;
begin
  if new.status = 'inativa' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'inativa' then return new; end if;
  v_lim := (private.plano_empresa(new.empresa_id)).limite_impressoras;
  select count(*) into v_qtd from public.impressoras where empresa_id = new.empresa_id and status <> 'inativa' and id <> new.id;
  if v_lim is not null and v_qtd >= v_lim then
    raise exception 'Seu plano permite até % impressora(s) ativa(s). Faça upgrade em Minha Assinatura ou marque outra como inativa.', v_lim;
  end if;
  return new;
end; $$;
create trigger trg_impressoras_limite before insert or update of status on public.impressoras for each row execute function private.checar_limite_impressoras();

-- Histórico de status (utilização, manutenção, paradas)
create table if not exists public.impressora_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  impressora_id uuid not null references public.impressoras(id) on delete cascade,
  status_anterior public.status_impressora,
  status_novo public.status_impressora not null,
  observacao text,
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists impressora_eventos_idx on public.impressora_eventos(impressora_id, created_at desc);
alter table public.impressora_eventos enable row level security;
create policy impressora_eventos_ler on public.impressora_eventos for select using (private.tem_permissao(empresa_id, 'impressoras_ver'));

create or replace function private.registrar_status_impressora() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.impressora_eventos(empresa_id, impressora_id, status_anterior, status_novo)
    values (new.empresa_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status);
  end if;
  return new;
end; $$;
create trigger trg_impressoras_eventos after insert or update of status on public.impressoras for each row execute function private.registrar_status_impressora();

-- ---------- Matéria-prima ---------------------------------------------
alter table public.materiais
  add column if not exists codigo text check (length(codigo) <= 40),
  add column if not exists fabricante text check (length(fabricante) <= 100),
  add column if not exists material text check (length(material) <= 40),
  add column if not exists diametro numeric(4,2) check (diametro > 0),
  add column if not exists peso_liquido_g numeric(10,2) check (peso_liquido_g > 0),
  add column if not exists peso_carretel_g numeric(10,2) check (peso_carretel_g >= 0),
  add column if not exists quantidade_reservada numeric(14,3) not null default 0 check (quantidade_reservada >= 0),
  add column if not exists custo_medio numeric(14,4) not null default 0 check (custo_medio >= 0),
  add column if not exists fornecedor text check (length(fornecedor) <= 150),
  add column if not exists lote text check (length(lote) <= 60),
  add column if not exists localizacao text check (length(localizacao) <= 100),
  add column if not exists margem_pct numeric(5,2) check (margem_pct >= 0 and margem_pct < 100),
  add column if not exists data_entrada date,
  add column if not exists permite_negativo boolean not null default false;
update public.materiais set custo_medio = coalesce(custo_unitario, 0) where custo_medio = 0 and coalesce(custo_unitario, 0) > 0;
create unique index if not exists materiais_codigo_uq on public.materiais(empresa_id, lower(codigo)) where codigo is not null;

-- Saldo nunca negativo, a menos que um administrador libere explicitamente
create or replace function private.proteger_material() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.permite_negativo is distinct from coalesce(old.permite_negativo, false) and new.permite_negativo
     and not private.is_admin(new.empresa_id) then
    raise exception 'Somente o proprietário ou administrador pode liberar saldo negativo';
  end if;
  if new.quantidade < 0 and not new.permite_negativo then
    raise exception 'Saldo insuficiente de "%": a operação deixaria o estoque negativo', new.nome;
  end if;
  return new;
end; $$;
drop trigger if exists trg_material_proteger on public.materiais;
create trigger trg_material_proteger before insert or update on public.materiais for each row execute function private.proteger_material();

-- Conversão para gramas (bobinas e consumo de impressão)
create or replace function private.fator_gramas(p_unidade text, p_peso_liquido_g numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_unidade, ''))
    when 'kg' then 1000 when 'g' then 1 when 'l' then 1000 when 'ml' then 1
    when 'bobina' then p_peso_liquido_g when 'un' then p_peso_liquido_g when 'rolo' then p_peso_liquido_g
    else null end;
$$;
-- Preço por kg usado na calculadora de orçamentos
create or replace function private.preco_kg(p_custo numeric, p_unidade text, p_peso_liquido_g numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when private.fator_gramas(p_unidade, p_peso_liquido_g) > 0
              then round(p_custo / private.fator_gramas(p_unidade, p_peso_liquido_g) * 1000, 4)
              else p_custo end;
$$;

-- Movimentações: custo, justificativa, estorno, saldo antes/depois
alter table public.movimentacoes_estoque
  add column if not exists custo_unitario numeric(14,4) check (custo_unitario >= 0),
  add column if not exists justificativa text check (length(justificativa) <= 1000),
  add column if not exists estorno_de uuid references public.movimentacoes_estoque(id) on delete restrict,
  add column if not exists bobina_id uuid,
  add column if not exists reserva_id uuid,
  add column if not exists saldo_antes numeric(14,3),
  add column if not exists saldo_apos numeric(14,3);
create unique index if not exists mov_estorno_uq on public.movimentacoes_estoque(estorno_de) where estorno_de is not null;
create index if not exists mov_material_idx on public.movimentacoes_estoque(material_id, created_at desc);
create index if not exists mov_empresa_data_idx on public.movimentacoes_estoque(empresa_id, created_at desc);
do $$ begin
  alter table public.movimentacoes_estoque add constraint mov_quantidade_valida check (quantidade >= 0);
exception when duplicate_object then null; end $$;

-- Aplica a movimentação com bloqueio da linha do material (evita corrida)
drop trigger if exists trg_mov_aplicar on public.movimentacoes_estoque;
create or replace function public.aplicar_movimentacao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.materiais; v_novo numeric; v_disp numeric;
begin
  select * into m from public.materiais where id = new.material_id and empresa_id = new.empresa_id for update;
  if not found then raise exception 'Matéria-prima não encontrada'; end if;
  if new.tipo in ('entrada','saida') and new.quantidade <= 0 then raise exception 'A quantidade precisa ser maior que zero'; end if;
  new.saldo_antes := m.quantidade;
  if new.tipo = 'entrada' then
    v_novo := m.quantidade + new.quantidade;
    if new.custo_unitario is not null then
      update public.materiais
         set custo_medio = case when m.quantidade > 0 and m.custo_medio > 0
                                then round((m.quantidade * m.custo_medio + new.quantidade * new.custo_unitario) / (m.quantidade + new.quantidade), 4)
                                else new.custo_unitario end,
             custo_unitario = new.custo_unitario
       where id = m.id;
    end if;
  elsif new.tipo = 'saida' then
    v_novo := m.quantidade - new.quantidade;
    -- saída manual não pode consumir material reservado para produção
    if new.reserva_id is null and new.estorno_de is null then
      v_disp := m.quantidade - m.quantidade_reservada;
      if new.quantidade > v_disp and not m.permite_negativo then
        raise exception 'Disponível de "%": % % (há % reservado para produção)', m.nome, greatest(v_disp, 0), m.unidade, m.quantidade_reservada;
      end if;
    end if;
  else
    if length(trim(coalesce(new.justificativa, new.observacao, ''))) < 3 then
      raise exception 'Informe a justificativa do ajuste';
    end if;
    v_novo := new.quantidade;
  end if;
  update public.materiais set quantidade = v_novo where id = m.id; -- trg_material_proteger barra negativo
  new.saldo_apos := v_novo;
  if new.created_by is null then new.created_by := (select auth.uid()); end if;
  return new;
end; $$;
create trigger trg_mov_aplicar before insert on public.movimentacoes_estoque for each row execute function public.aplicar_movimentacao();

-- Movimentações são um livro-razão: não se altera nem apaga, só se estorna
drop policy if exists movimentacoes_estoque_alterar on public.movimentacoes_estoque;
drop policy if exists movimentacoes_estoque_excluir on public.movimentacoes_estoque;
drop policy if exists movimentacoes_estoque_inserir on public.movimentacoes_estoque;
drop policy if exists movimentacoes_estoque_ler on public.movimentacoes_estoque;
create policy movimentacoes_estoque_ler on public.movimentacoes_estoque for select using (private.tem_permissao(empresa_id, 'materia_ver'));
create policy movimentacoes_estoque_inserir on public.movimentacoes_estoque for insert
  with check (private.pode(empresa_id, 'materia_movimentar') and estorno_de is null and reserva_id is null);

-- materiais: permissões
drop policy if exists materiais_ler on public.materiais;
drop policy if exists materiais_inserir on public.materiais;
drop policy if exists materiais_alterar on public.materiais;
drop policy if exists materiais_excluir on public.materiais;
create policy materiais_ler on public.materiais for select using (private.tem_permissao(empresa_id, 'materia_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_permissao(empresa_id, 'compras_gerenciar'));
create policy materiais_inserir on public.materiais for insert with check (private.pode(empresa_id, 'materia_editar'));
create policy materiais_alterar on public.materiais for update using (private.pode(empresa_id, 'materia_editar')) with check (private.pode(empresa_id, 'materia_editar'));
create policy materiais_excluir on public.materiais for delete using (private.pode(empresa_id, 'materia_editar'));
-- quantidade e reserva só mudam por movimentação (as funções rodam como definer)
create or replace function private.proteger_saldo_material() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.quantidade is distinct from old.quantidade or new.quantidade_reservada is distinct from old.quantidade_reservada
      or new.custo_medio is distinct from old.custo_medio)
     and pg_trigger_depth() = 1 and current_setting('app.mov_interna', true) is distinct from '1' then
    raise exception 'O saldo só pode ser alterado por entrada, saída, ajuste ou inventário';
  end if;
  return new;
end; $$;
drop trigger if exists trg_material_saldo on public.materiais;
create trigger trg_material_saldo before update on public.materiais for each row execute function private.proteger_saldo_material();
-- material novo começa zerado; saldo inicial entra como movimentação
create or replace function private.material_saldo_inicial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.quantidade <> 0 or new.quantidade_reservada <> 0 then
    if current_setting('app.mov_interna', true) is distinct from '1' then
      raise exception 'Cadastre com saldo zero e lance a quantidade inicial como entrada';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_material_inicial on public.materiais;
create trigger trg_material_inicial before insert on public.materiais for each row execute function private.material_saldo_inicial();

-- Cadastro com quantidade inicial em uma única transação
create or replace function public.cadastrar_materia_prima(p_empresa uuid, p_dados jsonb, p_quantidade_inicial numeric, p_custo_unitario numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.pode(p_empresa, 'materia_editar') then raise exception 'Sem permissão para cadastrar matéria-prima'; end if;
  if coalesce(trim(p_dados->>'nome'), '') = '' then raise exception 'Informe o nome'; end if;
  insert into public.materiais(empresa_id, nome, codigo, categoria, tipo_compra, fabricante, material, cor, diametro, unidade,
                               peso_liquido_g, peso_carretel_g, estoque_minimo, fornecedor, lote, localizacao, margem_pct, data_entrada, custo_unitario)
  values (p_empresa, trim(p_dados->>'nome'), nullif(trim(p_dados->>'codigo'), ''),
          coalesce(nullif(p_dados->>'categoria', ''), 'outro')::public.categoria_material,
          case coalesce(p_dados->>'categoria', '') when 'filamento' then 'filamento' when 'embalagem' then 'embalagem'
               when 'peca_reposicao' then 'manutencao' when 'componente' then 'acessorio' when 'consumivel' then 'insumo' else 'materia_prima' end::public.tipo_compra,
          nullif(trim(p_dados->>'fabricante'), ''), nullif(trim(p_dados->>'material'), ''), nullif(trim(p_dados->>'cor'), ''),
          nullif(p_dados->>'diametro', '')::numeric, coalesce(nullif(trim(p_dados->>'unidade'), ''), 'un'),
          nullif(p_dados->>'peso_liquido_g', '')::numeric, nullif(p_dados->>'peso_carretel_g', '')::numeric,
          coalesce(nullif(p_dados->>'estoque_minimo', '')::numeric, 0),
          nullif(trim(p_dados->>'fornecedor'), ''), nullif(trim(p_dados->>'lote'), ''), nullif(trim(p_dados->>'localizacao'), ''),
          nullif(p_dados->>'margem_pct', '')::numeric, coalesce(nullif(p_dados->>'data_entrada', '')::date, current_date),
          p_custo_unitario)
  returning id into v_id;
  if coalesce(p_quantidade_inicial, 0) > 0 then
    perform set_config('app.mov_interna', '1', true);
    insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, custo_unitario, observacao)
    values (p_empresa, v_id, 'entrada', p_quantidade_inicial, p_custo_unitario, 'Saldo inicial');
    perform set_config('app.mov_interna', '0', true);
  elsif p_custo_unitario is not null then
    perform set_config('app.mov_interna', '1', true);
    update public.materiais set custo_medio = p_custo_unitario where id = v_id;
    perform set_config('app.mov_interna', '0', true);
  end if;
  return v_id;
end; $$;

-- Movimentação manual (entrada / saída / ajuste) com permissão
create or replace function public.movimentar_materia_prima(p_material uuid, p_tipo public.tipo_movimentacao, p_quantidade numeric, p_custo_unitario numeric, p_justificativa text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_mov public.movimentacoes_estoque;
begin
  select empresa_id into v_emp from public.materiais where id = p_material;
  if v_emp is null or not private.pode(v_emp, 'materia_movimentar') then raise exception 'Sem permissão para movimentar matéria-prima'; end if;
  if p_tipo = 'ajuste' and length(trim(coalesce(p_justificativa, ''))) < 3 then raise exception 'Informe a justificativa do ajuste'; end if;
  perform set_config('app.mov_interna', '1', true);
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, custo_unitario, justificativa, observacao)
  values (v_emp, p_material, p_tipo, p_quantidade, case when p_tipo = 'entrada' then p_custo_unitario end, nullif(trim(p_justificativa), ''),
          case p_tipo when 'entrada' then 'Entrada manual' when 'saida' then 'Saída manual' else 'Ajuste' end)
  returning * into v_mov;
  perform set_config('app.mov_interna', '0', true);
  return jsonb_build_object('id', v_mov.id, 'saldo', v_mov.saldo_apos);
end; $$;

-- Inventário: informa a contagem física; o sistema lança o ajuste
create or replace function public.inventariar_materia_prima(p_material uuid, p_contagem numeric, p_justificativa text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_contagem is null or p_contagem < 0 then raise exception 'Contagem inválida'; end if;
  return public.movimentar_materia_prima(p_material, 'ajuste', p_contagem, null, coalesce(nullif(trim(p_justificativa), ''), 'Inventário'));
end; $$;

-- Estorno controlado: lança a movimentação inversa, uma única vez
create or replace function public.estornar_movimentacao(p_mov uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.movimentacoes_estoque; v_id uuid; v_tipo public.tipo_movimentacao; v_qtd numeric;
begin
  select * into o from public.movimentacoes_estoque where id = p_mov;
  if o.id is null or not private.pode(o.empresa_id, 'materia_movimentar') then raise exception 'Movimentação não encontrada'; end if;
  if o.estorno_de is not null then raise exception 'Não é possível estornar um estorno'; end if;
  if o.reserva_id is not null then raise exception 'Consumo de produção é estornado pela ordem de produção'; end if;
  if exists (select 1 from public.movimentacoes_estoque where estorno_de = p_mov) then raise exception 'Esta movimentação já foi estornada'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno'; end if;
  if o.tipo = 'entrada' then v_tipo := 'saida'; v_qtd := o.quantidade;
  elsif o.tipo = 'saida' then v_tipo := 'entrada'; v_qtd := o.quantidade;
  else v_tipo := 'ajuste'; v_qtd := o.saldo_antes;
    if v_qtd is null then raise exception 'Ajuste antigo sem saldo anterior registrado: faça um novo inventário'; end if;
  end if;
  perform set_config('app.mov_interna', '1', true);
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, justificativa, observacao, estorno_de)
  values (o.empresa_id, o.material_id, v_tipo, v_qtd, trim(p_motivo), 'Estorno', o.id)
  returning id into v_id;
  perform set_config('app.mov_interna', '0', true);
  return v_id;
end; $$;

-- ---------- Bobinas individuais ---------------------------------------
create table if not exists public.material_bobinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  material_id uuid not null references public.materiais(id) on delete cascade,
  codigo text not null check (length(trim(codigo)) between 1 and 40),
  peso_inicial_g numeric(10,2) not null check (peso_inicial_g > 0),
  consumido_g numeric(10,2) not null default 0 check (consumido_g >= 0),
  reservado_g numeric(10,2) not null default 0 check (reservado_g >= 0),
  saldo_fisico_g numeric(10,2) generated always as (peso_inicial_g - consumido_g) stored,
  disponivel_g numeric(10,2) generated always as (peso_inicial_g - consumido_g - reservado_g) stored,
  lote text, data_abertura date,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint bobina_saldo_valido check (consumido_g + reservado_g <= peso_inicial_g),
  unique (material_id, codigo)
);
alter table public.material_bobinas enable row level security;
create policy bobinas_ler on public.material_bobinas for select using (private.tem_permissao(empresa_id, 'materia_ver'));
create policy bobinas_inserir on public.material_bobinas for insert with check (private.pode(empresa_id, 'materia_editar') and consumido_g = 0 and reservado_g = 0);
create policy bobinas_alterar on public.material_bobinas for update using (private.pode(empresa_id, 'materia_editar')) with check (private.pode(empresa_id, 'materia_editar'));
create or replace function private.proteger_bobina() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.consumido_g is distinct from old.consumido_g or new.reservado_g is distinct from old.reservado_g or new.peso_inicial_g is distinct from old.peso_inicial_g)
     and current_setting('app.mov_interna', true) is distinct from '1' then
    raise exception 'O saldo da bobina só muda por consumo, reserva ou liberação';
  end if;
  return new;
end; $$;
create trigger trg_bobina_proteger before update on public.material_bobinas for each row execute function private.proteger_bobina();

-- ---------- Reservas para produção (atômicas) --------------------------
create table if not exists public.reservas_materia_prima (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  material_id uuid not null references public.materiais(id) on delete restrict,
  bobina_id uuid references public.material_bobinas(id) on delete set null,
  quantidade numeric(14,3) not null check (quantidade > 0),
  quantidade_consumida numeric(14,3),
  referencia text check (length(referencia) <= 200),
  pedido_id uuid references public.pedidos(id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa','consumida','liberada')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  finalizada_em timestamptz
);
create index if not exists reservas_material_idx on public.reservas_materia_prima(material_id, status);
alter table public.reservas_materia_prima enable row level security;
create policy reservas_ler on public.reservas_materia_prima for select using (private.tem_permissao(empresa_id, 'materia_ver'));

create or replace function public.reservar_materia_prima(p_material uuid, p_quantidade numeric, p_referencia text, p_pedido uuid, p_bobina uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.materiais; v_id uuid; v_g numeric; b public.material_bobinas;
begin
  select * into m from public.materiais where id = p_material for update;   -- bloqueio: reservas simultâneas esperam
  if m.id is null or not (private.pode(m.empresa_id, 'materia_movimentar') or private.pode(m.empresa_id, 'producao_gerenciar')) then
    raise exception 'Sem permissão para reservar matéria-prima';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;
  if p_quantidade > m.quantidade - m.quantidade_reservada and not m.permite_negativo then
    raise exception 'Disponível de "%": % % — não é possível reservar %', m.nome, greatest(m.quantidade - m.quantidade_reservada, 0), m.unidade, p_quantidade;
  end if;
  perform set_config('app.mov_interna', '1', true);
  if p_bobina is not null then
    select * into b from public.material_bobinas where id = p_bobina and material_id = p_material for update;
    if b.id is null then raise exception 'Bobina não encontrada'; end if;
    v_g := p_quantidade * private.fator_gramas(m.unidade, m.peso_liquido_g);
    if v_g is null then raise exception 'Defina a unidade (g, kg) ou o peso líquido para usar bobinas'; end if;
    if v_g > b.disponivel_g then raise exception 'A bobina % tem só % g disponíveis', b.codigo, b.disponivel_g; end if;
    update public.material_bobinas set reservado_g = reservado_g + v_g where id = b.id;
  end if;
  update public.materiais set quantidade_reservada = quantidade_reservada + p_quantidade where id = m.id;
  insert into public.reservas_materia_prima(empresa_id, material_id, bobina_id, quantidade, referencia, pedido_id)
  values (m.empresa_id, m.id, p_bobina, p_quantidade, nullif(trim(p_referencia), ''), p_pedido) returning id into v_id;
  perform set_config('app.mov_interna', '0', true);
  return v_id;
end; $$;

create or replace function public.liberar_reserva(p_reserva uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reservas_materia_prima; m public.materiais;
begin
  select * into r from public.reservas_materia_prima where id = p_reserva for update;
  if r.id is null or not (private.pode(r.empresa_id, 'materia_movimentar') or private.pode(r.empresa_id, 'producao_gerenciar')) then raise exception 'Reserva não encontrada'; end if;
  if r.status <> 'ativa' then raise exception 'Esta reserva já foi %', r.status; end if;
  select * into m from public.materiais where id = r.material_id for update;
  perform set_config('app.mov_interna', '1', true);
  update public.materiais set quantidade_reservada = greatest(quantidade_reservada - r.quantidade, 0) where id = m.id;
  if r.bobina_id is not null then
    update public.material_bobinas set reservado_g = greatest(reservado_g - r.quantidade * private.fator_gramas(m.unidade, m.peso_liquido_g), 0) where id = r.bobina_id;
  end if;
  update public.reservas_materia_prima set status = 'liberada', finalizada_em = now() where id = r.id;
  perform set_config('app.mov_interna', '0', true);
end; $$;

-- Consome a reserva com a quantidade real (não duplica baixa: só reservas ativas)
create or replace function public.consumir_reserva(p_reserva uuid, p_quantidade_real numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.reservas_materia_prima; m public.materiais; v_mov uuid; v_g numeric;
begin
  select * into r from public.reservas_materia_prima where id = p_reserva for update;
  if r.id is null or not (private.pode(r.empresa_id, 'materia_movimentar') or private.pode(r.empresa_id, 'producao_gerenciar')) then raise exception 'Reserva não encontrada'; end if;
  if r.status <> 'ativa' then raise exception 'Esta reserva já foi %', r.status; end if;
  if p_quantidade_real is null or p_quantidade_real < 0 then raise exception 'Quantidade real inválida'; end if;
  select * into m from public.materiais where id = r.material_id for update;
  perform set_config('app.mov_interna', '1', true);
  update public.materiais set quantidade_reservada = greatest(quantidade_reservada - r.quantidade, 0) where id = m.id;
  if p_quantidade_real > 0 then
    insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, observacao, pedido_id, reserva_id, bobina_id)
    values (r.empresa_id, r.material_id, 'saida', p_quantidade_real, coalesce('Consumo: ' || r.referencia, 'Consumo de produção'), r.pedido_id, r.id, r.bobina_id)
    returning id into v_mov;
  end if;
  if r.bobina_id is not null then
    v_g := private.fator_gramas(m.unidade, m.peso_liquido_g);
    update public.material_bobinas
       set reservado_g = greatest(reservado_g - r.quantidade * v_g, 0),
           consumido_g = least(consumido_g + p_quantidade_real * v_g, peso_inicial_g)
     where id = r.bobina_id;
  end if;
  update public.reservas_materia_prima set status = 'consumida', quantidade_consumida = p_quantidade_real, finalizada_em = now() where id = r.id;
  perform set_config('app.mov_interna', '0', true);
  return v_mov;
end; $$;

-- Consumo direto de uma bobina (sem reserva)
create or replace function public.consumir_bobina(p_bobina uuid, p_gramas numeric, p_observacao text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.material_bobinas; m public.materiais; v_f numeric;
begin
  select * into b from public.material_bobinas where id = p_bobina for update;
  if b.id is null or not private.pode(b.empresa_id, 'materia_movimentar') then raise exception 'Bobina não encontrada'; end if;
  if p_gramas is null or p_gramas <= 0 then raise exception 'Informe os gramas consumidos'; end if;
  if p_gramas > b.disponivel_g then raise exception 'A bobina % tem só % g disponíveis', b.codigo, b.disponivel_g; end if;
  select * into m from public.materiais where id = b.material_id;
  v_f := private.fator_gramas(m.unidade, m.peso_liquido_g);
  if v_f is null then raise exception 'Defina a unidade (g, kg) ou o peso líquido do material'; end if;
  perform set_config('app.mov_interna', '1', true);
  update public.material_bobinas set consumido_g = consumido_g + p_gramas where id = b.id;
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, observacao, bobina_id)
  values (b.empresa_id, b.material_id, 'saida', round(p_gramas / v_f, 3), coalesce(nullif(trim(p_observacao), ''), 'Consumo da bobina ' || b.codigo), b.id);
  perform set_config('app.mov_interna', '0', true);
end; $$;

-- Lista de reposição / alertas
create or replace view public.materia_prima_reposicao with (security_invoker = true) as
select id, empresa_id, nome, codigo, cor, unidade, quantidade, quantidade_reservada,
       quantidade - quantidade_reservada as disponivel, estoque_minimo,
       greatest(estoque_minimo * 2 - (quantidade - quantidade_reservada), 0) as sugestao_compra,
       custo_medio, fornecedor
  from public.materiais
 where ativo and estoque_minimo > 0 and (quantidade - quantidade_reservada) <= estoque_minimo;
grant select on public.materia_prima_reposicao to authenticated;

-- ---------- Compras: custo médio pela movimentação, com permissão -------
create or replace function public.registrar_compra(p_empresa uuid, p_tipo public.tipo_compra, p_nome text, p_quantidade numeric, p_valor_total numeric,
  p_unidade text default 'un', p_detalhe text default null, p_data date default current_date, p_estoque_minimo numeric default null, p_lancar_gasto boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_gasto uuid; v_cat public.categoria_gasto; v_saldo numeric;
begin
  if not (private.pode(p_empresa, 'compras_gerenciar') or private.pode(p_empresa, 'materia_movimentar')) then raise exception 'Sem permissão para registrar compras'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do item'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;
  if p_valor_total is null or p_valor_total < 0 then raise exception 'Valor inválido'; end if;

  select id into v_item from public.materiais
   where empresa_id = p_empresa and tipo_compra = p_tipo and ativo
     and lower(trim(nome)) = lower(trim(p_nome))
     and lower(coalesce(trim(cor), '')) = lower(coalesce(trim(p_detalhe), ''))
     and unidade = coalesce(nullif(trim(p_unidade), ''), 'un')
   limit 1;

  if v_item is null then
    insert into public.materiais(empresa_id, nome, cor, tipo_compra, categoria, unidade, quantidade, estoque_minimo, data_entrada)
    values (p_empresa, trim(p_nome), nullif(trim(p_detalhe), ''), p_tipo,
            case p_tipo when 'filamento' then 'filamento' when 'embalagem' then 'embalagem' when 'manutencao' then 'peca_reposicao'
                        when 'acessorio' then 'componente' when 'insumo' then 'consumivel' else 'outro' end::public.categoria_material,
            coalesce(nullif(trim(p_unidade), ''), 'un'), 0, coalesce(p_estoque_minimo, 0), coalesce(p_data, current_date))
    returning id into v_item;
  elsif p_estoque_minimo is not null then
    update public.materiais set estoque_minimo = p_estoque_minimo where id = v_item;
  end if;

  perform set_config('app.mov_interna', '1', true);
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, custo_unitario, observacao, created_by)
  values (p_empresa, v_item, 'entrada', p_quantidade, case when p_valor_total > 0 then round(p_valor_total / p_quantidade, 4) end, 'Compra', auth.uid());
  perform set_config('app.mov_interna', '0', true);

  if p_lancar_gasto and p_valor_total > 0 then
    v_cat := case p_tipo when 'ferramenta' then 'equipamento' when 'manutencao' then 'manutencao'
                         when 'escritorio_limpeza' then 'outro' when 'outro' then 'outro' else 'material' end;
    insert into public.gastos(empresa_id, descricao, categoria, valor, data, material_id, created_by)
    values (p_empresa, 'Compra: ' || trim(p_nome) || coalesce(' · ' || nullif(trim(p_detalhe), ''), '') || ' (' || p_quantidade::text || ' ' || coalesce(nullif(trim(p_unidade), ''), 'un') || ')',
            v_cat, p_valor_total, coalesce(p_data, current_date), v_item, auth.uid())
    returning id into v_gasto;
  end if;

  select quantidade into v_saldo from public.materiais where id = v_item;
  return jsonb_build_object('item_id', v_item, 'gasto_id', v_gasto, 'saldo', v_saldo);
end; $$;

-- link de acesso: movimentação passa a usar a mesma regra (ajuste exige justificativa)
create or replace function public.link_movimentar_estoque(p_token text, p_material_id uuid, p_tipo public.tipo_movimentacao, p_quantidade numeric, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare l public.links_acesso; v_saldo numeric;
begin
  l := private.validar_link(p_token, 'estoque');
  if not exists (select 1 from public.materiais where id = p_material_id and empresa_id = l.empresa_id) then raise exception 'Material não encontrado'; end if;
  if p_quantidade is null or p_quantidade < 0 or (p_tipo <> 'ajuste' and p_quantidade = 0) then raise exception 'Quantidade inválida'; end if;
  insert into public.movimentacoes_estoque(empresa_id, material_id, tipo, quantidade, observacao, justificativa, link_id)
  values (l.empresa_id, p_material_id, p_tipo, p_quantidade, left(coalesce(nullif(trim(p_observacao), ''), 'Pelo link: ' || l.nome), 500),
          case when p_tipo = 'ajuste' then left(coalesce(nullif(trim(p_observacao), ''), 'Ajuste pelo link ' || l.nome), 500) end, l.id);
  select quantidade into v_saldo from public.materiais where id = p_material_id;
  return v_saldo;
end; $$;

-- Grants
revoke all on function public.cadastrar_materia_prima(uuid, jsonb, numeric, numeric), public.movimentar_materia_prima(uuid, public.tipo_movimentacao, numeric, numeric, text),
  public.inventariar_materia_prima(uuid, numeric, text), public.estornar_movimentacao(uuid, text),
  public.reservar_materia_prima(uuid, numeric, text, uuid, uuid), public.liberar_reserva(uuid), public.consumir_reserva(uuid, numeric),
  public.consumir_bobina(uuid, numeric, text),
  public.registrar_compra(uuid, public.tipo_compra, text, numeric, numeric, text, text, date, numeric, boolean) from public, anon;
grant execute on function public.cadastrar_materia_prima(uuid, jsonb, numeric, numeric), public.movimentar_materia_prima(uuid, public.tipo_movimentacao, numeric, numeric, text),
  public.inventariar_materia_prima(uuid, numeric, text), public.estornar_movimentacao(uuid, text),
  public.reservar_materia_prima(uuid, numeric, text, uuid, uuid), public.liberar_reserva(uuid), public.consumir_reserva(uuid, numeric),
  public.consumir_bobina(uuid, numeric, text),
  public.registrar_compra(uuid, public.tipo_compra, text, numeric, numeric, text, text, date, numeric, boolean) to authenticated;
