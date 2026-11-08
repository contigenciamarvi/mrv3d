-- =====================================================================
-- Integridade entre empresas e limpeza de regras de acesso antigas
-- =====================================================================

-- 1) Regras de acesso antigas: as políticas do Postgres somam permissões (OR).
--    Qualquer regra antiga com outro nome anularia as permissões por perfil, então
--    removemos tudo que não foi criado por estas migrações (mantendo as de suporte e da plataforma).
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('clientes','pedidos','pedido_itens','gastos','links_acesso','materiais','movimentacoes_estoque','membros')
              and policyname !~ '_(ler|inserir|alterar|excluir|suporte_leitura|admin_leitura)$'
              and policyname not in ('links_select','links_insert','links_update','links_delete','membros_select')
  loop
    raise notice 'removendo regra antiga % em %', r.policyname, r.tablename;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) Referências sempre da mesma empresa (impede apontar para cadastros de outra loja)
create or replace function private.checar_mesma_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i int; col text; tab text; v_ref uuid; v_emp uuid; j jsonb := to_jsonb(new);
begin
  for i in 0 .. tg_nargs - 1 loop
    col := split_part(tg_argv[i], ':', 1); tab := split_part(tg_argv[i], ':', 2);
    v_ref := nullif(j->>col, '')::uuid;
    if v_ref is not null then
      execute format('select empresa_id from public.%I where id = $1', tab) into v_emp using v_ref;
      if v_emp is distinct from new.empresa_id then
        raise exception 'Cadastro não encontrado (%)', col;
      end if;
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_mesma_empresa on public.produtos;
create trigger trg_mesma_empresa before insert or update on public.produtos for each row execute function private.checar_mesma_empresa('material_id:materiais', 'impressora_id:impressoras');
drop trigger if exists trg_mesma_empresa on public.produto_variantes;
create trigger trg_mesma_empresa before insert or update on public.produto_variantes for each row execute function private.checar_mesma_empresa('produto_id:produtos', 'material_id:materiais');
drop trigger if exists trg_mesma_empresa on public.produto_arquivos;
create trigger trg_mesma_empresa before insert or update on public.produto_arquivos for each row execute function private.checar_mesma_empresa('produto_id:produtos');
drop trigger if exists trg_mesma_empresa on public.crm_oportunidades;
create trigger trg_mesma_empresa before insert or update on public.crm_oportunidades for each row execute function private.checar_mesma_empresa('cliente_id:clientes');
drop trigger if exists trg_mesma_empresa on public.pedidos;
create trigger trg_mesma_empresa before insert or update on public.pedidos for each row execute function private.checar_mesma_empresa('cliente_id:clientes');
drop trigger if exists trg_mesma_empresa on public.pedido_itens;
create trigger trg_mesma_empresa before insert or update on public.pedido_itens for each row execute function private.checar_mesma_empresa('pedido_id:pedidos', 'produto_id:produtos');
drop trigger if exists trg_mesma_empresa on public.material_bobinas;
create trigger trg_mesma_empresa before insert or update on public.material_bobinas for each row execute function private.checar_mesma_empresa('material_id:materiais');
drop trigger if exists trg_mesma_empresa on public.gastos;
create trigger trg_mesma_empresa before insert or update on public.gastos for each row execute function private.checar_mesma_empresa('material_id:materiais', 'pedido_id:pedidos');
drop trigger if exists trg_mesma_empresa on public.movimentacoes_estoque;
create trigger trg_mesma_empresa before insert on public.movimentacoes_estoque for each row execute function private.checar_mesma_empresa('pedido_id:pedidos');
drop trigger if exists trg_mesma_empresa on public.reservas_materia_prima;
create trigger trg_mesma_empresa before insert or update on public.reservas_materia_prima for each row execute function private.checar_mesma_empresa('material_id:materiais', 'pedido_id:pedidos');
drop trigger if exists trg_mesma_empresa on public.impressoras;
create or replace function private.checar_operador() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.operador_id is not null and not exists (select 1 from public.membros where empresa_id = new.empresa_id and user_id = new.operador_id) then
    raise exception 'O operador precisa ser da equipe';
  end if;
  return new;
end; $$;
create trigger trg_mesma_empresa before insert or update on public.impressoras for each row execute function private.checar_operador();

-- 3) Margens especiais mexem no preço: só quem aprova descontos ou configura a empresa
create or replace function private.proteger_margem() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.margem_pct is not null or tg_op = 'UPDATE' and new.margem_pct is distinct from old.margem_pct)
     and (select auth.uid()) is not null
     and not (private.tem_permissao(new.empresa_id, 'descontos_aprovar') or private.tem_permissao(new.empresa_id, 'config_editar')) then
    raise exception 'Margem especial só pode ser definida por quem aprova descontos';
  end if;
  return new;
end; $$;
drop trigger if exists trg_proteger_margem on public.clientes;
create trigger trg_proteger_margem before insert or update on public.clientes for each row execute function private.proteger_margem();
drop trigger if exists trg_proteger_margem on public.produtos;
create trigger trg_proteger_margem before insert or update on public.produtos for each row execute function private.proteger_margem();
drop trigger if exists trg_proteger_margem on public.materiais;
create trigger trg_proteger_margem before insert or update on public.materiais for each row execute function private.proteger_margem();

-- 4) Número do pedido único por empresa (só cria o índice se os dados atuais permitirem)
do $$ begin
  if not exists (select 1 from public.pedidos where numero is not null group by empresa_id, numero having count(*) > 1) then
    create unique index if not exists pedidos_numero_uq on public.pedidos(empresa_id, numero);
  else
    raise notice 'Há pedidos com número repetido: índice único não criado';
  end if;
end $$;
