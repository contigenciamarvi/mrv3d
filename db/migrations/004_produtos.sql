-- =====================================================================
-- FASE 2 — Produtos e catálogo (variações, kits, ficha técnica, estoque de acabados)
-- =====================================================================
do $$ begin
  create type public.tipo_produto as enum ('simples','variacoes','kit','sob_encomenda','pronta_entrega');
exception when duplicate_object then null; end $$;

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text check (length(codigo) <= 40),
  nome text not null check (length(trim(nome)) between 1 and 200),
  categoria text check (length(categoria) <= 80),
  descricao text check (length(descricao) <= 5000),
  tipo public.tipo_produto not null default 'simples',
  material_id uuid references public.materiais(id) on delete set null,
  cor text check (length(cor) <= 60),
  peso_g numeric(10,2) check (peso_g >= 0),
  tempo_h numeric(8,2) check (tempo_h >= 0),
  impressora_id uuid references public.impressoras(id) on delete set null,
  custo_padrao numeric(12,2) not null default 0 check (custo_padrao >= 0),
  preco_venda numeric(12,2) not null default 0 check (preco_venda >= 0),
  margem_pct numeric(5,2) check (margem_pct >= 0 and margem_pct < 100),
  personalizavel boolean not null default false,
  controla_estoque boolean not null default false,
  estoque_qtd numeric(12,2) not null default 0,
  estoque_minimo numeric(12,2) not null default 0 check (estoque_minimo >= 0),
  ficha_tecnica text check (length(ficha_tecnica) <= 10000),
  foto_path text,
  status text not null default 'ativo' check (status in ('ativo','inativo','rascunho')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produto_estoque_nao_negativo check (estoque_qtd >= 0)
);
create unique index if not exists produtos_codigo_uq on public.produtos(empresa_id, lower(codigo)) where codigo is not null;
create index if not exists produtos_empresa_nome_idx on public.produtos(empresa_id, lower(nome));
alter table public.produtos enable row level security;
create trigger trg_produtos_upd before update on public.produtos for each row execute function public.set_updated_at();
create trigger trg_audemp_produtos after insert or update or delete on public.produtos for each row execute function private.auditar_empresa();
create policy produtos_ler on public.produtos for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_acesso_suporte(empresa_id));
create policy produtos_inserir on public.produtos for insert with check (private.pode(empresa_id, 'produtos_editar') and estoque_qtd = 0);
create policy produtos_alterar on public.produtos for update using (private.pode(empresa_id, 'produtos_editar')) with check (private.pode(empresa_id, 'produtos_editar'));
create policy produtos_excluir on public.produtos for delete using (private.pode(empresa_id, 'produtos_editar'));

create table if not exists public.produto_variantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 120),
  sku text check (length(sku) <= 60),
  cor text, material_id uuid references public.materiais(id) on delete set null,
  peso_g numeric(10,2) check (peso_g >= 0), tempo_h numeric(8,2) check (tempo_h >= 0),
  custo_padrao numeric(12,2) check (custo_padrao >= 0), preco_venda numeric(12,2) check (preco_venda >= 0),
  estoque_qtd numeric(12,2) not null default 0 check (estoque_qtd >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists variantes_produto_idx on public.produto_variantes(produto_id);
alter table public.produto_variantes enable row level security;
create policy variantes_ler on public.produto_variantes for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar'));
create policy variantes_inserir on public.produto_variantes for insert with check (private.pode(empresa_id, 'produtos_editar') and estoque_qtd = 0);
create policy variantes_alterar on public.produto_variantes for update using (private.pode(empresa_id, 'produtos_editar')) with check (private.pode(empresa_id, 'produtos_editar'));
create policy variantes_excluir on public.produto_variantes for delete using (private.pode(empresa_id, 'produtos_editar'));

-- Ficha técnica / composição: materiais e (para kits) outros produtos
create table if not exists public.produto_componentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  material_id uuid references public.materiais(id) on delete restrict,
  componente_produto_id uuid references public.produtos(id) on delete restrict,
  quantidade numeric(12,3) not null check (quantidade > 0),
  observacao text check (length(observacao) <= 300),
  constraint componente_um_tipo check ((material_id is null) <> (componente_produto_id is null)),
  constraint componente_nao_ele_mesmo check (componente_produto_id is distinct from produto_id)
);
create index if not exists componentes_produto_idx on public.produto_componentes(produto_id);
alter table public.produto_componentes enable row level security;
create policy componentes_ler on public.produto_componentes for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar'));
create policy componentes_inserir on public.produto_componentes for insert with check (private.pode(empresa_id, 'produtos_editar'));
create policy componentes_alterar on public.produto_componentes for update using (private.pode(empresa_id, 'produtos_editar')) with check (private.pode(empresa_id, 'produtos_editar'));
create policy componentes_excluir on public.produto_componentes for delete using (private.pode(empresa_id, 'produtos_editar'));
-- componente precisa ser da mesma empresa
create or replace function private.checar_componente() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.material_id is not null and not exists (select 1 from public.materiais where id = new.material_id and empresa_id = new.empresa_id) then
    raise exception 'Matéria-prima não encontrada'; end if;
  if new.componente_produto_id is not null and not exists (select 1 from public.produtos where id = new.componente_produto_id and empresa_id = new.empresa_id) then
    raise exception 'Produto componente não encontrado'; end if;
  if not exists (select 1 from public.produtos where id = new.produto_id and empresa_id = new.empresa_id) then raise exception 'Produto não encontrado'; end if;
  return new;
end; $$;
create trigger trg_componente_checar before insert or update on public.produto_componentes for each row execute function private.checar_componente();

-- Arquivos do produto (fotos, STL/3MF, documentos) — conteúdo no Storage privado
create table if not exists public.produto_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  tipo text not null check (tipo in ('foto','modelo','documento')),
  path text not null check (path like empresa_id::text || '/%'),
  nome text not null check (length(nome) <= 255),
  tamanho bigint check (tamanho >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists arquivos_produto_idx on public.produto_arquivos(produto_id);
alter table public.produto_arquivos enable row level security;
create policy arquivos_ler on public.produto_arquivos for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar'));
create policy arquivos_inserir on public.produto_arquivos for insert with check (private.pode(empresa_id, 'produtos_editar'));
create policy arquivos_excluir on public.produto_arquivos for delete using (private.pode(empresa_id, 'produtos_editar'));

-- Histórico de preços
create table if not exists public.produto_precos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  preco_anterior numeric(12,2), preco_novo numeric(12,2),
  custo_anterior numeric(12,2), custo_novo numeric(12,2),
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists produto_precos_idx on public.produto_precos(produto_id, created_at desc);
alter table public.produto_precos enable row level security;
create policy produto_precos_ler on public.produto_precos for select using (private.tem_permissao(empresa_id, 'produtos_ver'));
create or replace function private.historico_preco_produto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.preco_venda is distinct from old.preco_venda or new.custo_padrao is distinct from old.custo_padrao then
    insert into public.produto_precos(empresa_id, produto_id, preco_anterior, preco_novo, custo_anterior, custo_novo)
    values (new.empresa_id, new.id, case when tg_op = 'UPDATE' then old.preco_venda end, new.preco_venda,
            case when tg_op = 'UPDATE' then old.custo_padrao end, new.custo_padrao);
  end if;
  return new;
end; $$;
create trigger trg_produto_precos after insert or update of preco_venda, custo_padrao on public.produtos for each row execute function private.historico_preco_produto();

-- Estoque de produtos acabados (pronta entrega): só por movimentação
create table if not exists public.produto_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  variante_id uuid references public.produto_variantes(id) on delete cascade,
  tipo public.tipo_movimentacao not null,
  quantidade numeric(12,2) not null check (quantidade >= 0),
  saldo_apos numeric(12,2),
  observacao text check (length(observacao) <= 500),
  pedido_id uuid references public.pedidos(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists produto_mov_idx on public.produto_movimentacoes(produto_id, created_at desc);
alter table public.produto_movimentacoes enable row level security;
create policy produto_mov_ler on public.produto_movimentacoes for select using (private.tem_permissao(empresa_id, 'produtos_ver'));

create or replace function public.movimentar_produto(p_produto uuid, p_variante uuid, p_tipo public.tipo_movimentacao, p_quantidade numeric, p_observacao text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare p public.produtos; v public.produto_variantes; v_atual numeric; v_novo numeric;
begin
  select * into p from public.produtos where id = p_produto for update;
  if p.id is null or not (private.pode(p.empresa_id, 'produtos_editar') or private.pode(p.empresa_id, 'expedicao_gerenciar')) then raise exception 'Produto não encontrado'; end if;
  if p_quantidade is null or p_quantidade < 0 or (p_tipo <> 'ajuste' and p_quantidade = 0) then raise exception 'Quantidade inválida'; end if;
  if p_tipo = 'ajuste' and length(trim(coalesce(p_observacao, ''))) < 3 then raise exception 'Informe a justificativa do ajuste'; end if;
  if p_variante is not null then
    select * into v from public.produto_variantes where id = p_variante and produto_id = p.id for update;
    if v.id is null then raise exception 'Variação não encontrada'; end if;
    v_atual := v.estoque_qtd;
  else
    v_atual := p.estoque_qtd;
  end if;
  v_novo := case p_tipo when 'entrada' then v_atual + p_quantidade when 'saida' then v_atual - p_quantidade else p_quantidade end;
  if v_novo < 0 then raise exception 'Estoque insuficiente: há % unidade(s)', v_atual; end if;
  perform set_config('app.mov_interna', '1', true);
  if p_variante is not null then
    update public.produto_variantes set estoque_qtd = v_novo where id = p_variante;
  else
    update public.produtos set estoque_qtd = v_novo where id = p.id;
  end if;
  perform set_config('app.mov_interna', '0', true);
  insert into public.produto_movimentacoes(empresa_id, produto_id, variante_id, tipo, quantidade, saldo_apos, observacao)
  values (p.empresa_id, p.id, p_variante, p_tipo, p_quantidade, v_novo, nullif(trim(p_observacao), ''));
  return v_novo;
end; $$;

create or replace function private.proteger_estoque_produto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estoque_qtd is distinct from old.estoque_qtd and current_setting('app.mov_interna', true) is distinct from '1' then
    raise exception 'O estoque do produto só muda por movimentação';
  end if;
  return new;
end; $$;
create trigger trg_produto_estoque before update on public.produtos for each row execute function private.proteger_estoque_produto();
create or replace function private.proteger_estoque_variante() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estoque_qtd is distinct from old.estoque_qtd and current_setting('app.mov_interna', true) is distinct from '1' then
    raise exception 'O estoque da variação só muda por movimentação';
  end if;
  return new;
end; $$;
create trigger trg_variante_estoque before update on public.produto_variantes for each row execute function private.proteger_estoque_variante();

-- Custo estimado do produto a partir da ficha técnica (materiais) + máquina/energia
create or replace function public.calcular_custo_produto(p_produto uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.produtos; c public.empresa_config; i public.impressoras; v_mat numeric := 0; v_comp numeric := 0; v_energia numeric := 0; v_maquina numeric := 0; v_peso_mat numeric := 0;
begin
  select * into p from public.produtos where id = p_produto;
  if p.id is null or not (private.tem_permissao(p.empresa_id, 'produtos_ver') or private.tem_permissao(p.empresa_id, 'orcamentos_criar')) then raise exception 'Produto não encontrado'; end if;
  select * into c from public.empresa_config where empresa_id = p.empresa_id;
  select coalesce(sum(pc.quantidade * m.custo_medio), 0) into v_mat
    from public.produto_componentes pc join public.materiais m on m.id = pc.material_id where pc.produto_id = p.id;
  select coalesce(sum(pc.quantidade * pp.custo_padrao), 0) into v_comp
    from public.produto_componentes pc join public.produtos pp on pp.id = pc.componente_produto_id where pc.produto_id = p.id;
  -- sem ficha técnica: usa material padrão × peso
  if v_mat = 0 and p.material_id is not null and coalesce(p.peso_g, 0) > 0 then
    select p.peso_g / 1000 * private.preco_kg(m.custo_medio, m.unidade, m.peso_liquido_g) * (1 + coalesce(c.desperdicio_pct, 0) / 100)
      into v_mat from public.materiais m where m.id = p.material_id;
    v_peso_mat := p.peso_g;
  end if;
  if p.impressora_id is not null and coalesce(p.tempo_h, 0) > 0 then
    select * into i from public.impressoras where id = p.impressora_id;
    v_energia := i.potencia_w / 1000 * p.tempo_h * coalesce(c.energia_kwh, 0);
    v_maquina := p.tempo_h * i.custo_hora;
  end if;
  return jsonb_build_object('material', round(coalesce(v_mat, 0), 2), 'componentes', round(v_comp, 2), 'energia', round(v_energia, 2),
                            'maquina', round(v_maquina, 2), 'total', round(coalesce(v_mat, 0) + v_comp + v_energia + v_maquina, 2));
end; $$;

revoke all on function public.movimentar_produto(uuid, uuid, public.tipo_movimentacao, numeric, text), public.calcular_custo_produto(uuid) from public, anon;
grant execute on function public.movimentar_produto(uuid, uuid, public.tipo_movimentacao, numeric, text), public.calcular_custo_produto(uuid) to authenticated;

-- pedidos passam a guardar o produto do item (relatórios de mais vendidos)
alter table public.pedido_itens add column if not exists produto_id uuid references public.produtos(id) on delete set null;
