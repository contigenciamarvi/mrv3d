-- =====================================================================
-- FASE 2 — Dashboard, busca global, notificações, Minha Assinatura, arquivos
-- =====================================================================

-- ---------- Dashboard -------------------------------------------------
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
      'producao_mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
          'entregues', (select count(*) from public.pedidos where empresa_id = p_empresa and status = 'entregue' and date_trunc('month', updated_at) = m)) order by m)
          from generate_series(date_trunc('month', p_fim::timestamp) - interval '11 months', date_trunc('month', p_fim::timestamp), interval '1 month') m), '[]'::jsonb));
  end if;

  if v_fin then
    select coalesce(sum(valor_total), 0), coalesce(sum(coalesce(custo_estimado, 0)), 0) into v_fat, v_custo
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
      'contas_receber', (select coalesce(sum(valor_total - valor_pago), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and valor_total > valor_pago),
      'vendas_diarias', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'valor',
          (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and created_at::date = d::date)) order by d)
          from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') d), '[]'::jsonb),
      'mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
          'faturamento', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m),
          'lucro', (select coalesce(sum(valor_total - coalesce(custo_estimado, 0)), 0) from public.pedidos where empresa_id = p_empresa and status <> 'cancelado' and date_trunc('month', created_at) = m)
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

-- ---------- Busca global (usa as permissões de quem busca) -------------
create or replace function public.busca_global(p_empresa uuid, p_termo text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare t text := '%' || replace(replace(trim(coalesce(p_termo, '')), '%', ''), '_', '') || '%';
begin
  if length(trim(coalesce(p_termo, ''))) < 2 then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', nome, 'sub', coalesce(whatsapp, telefone, email))) from (
        select * from public.clientes where empresa_id = p_empresa and (nome ilike t or email ilike t or telefone ilike t or whatsapp ilike t or documento ilike t) order by nome limit 5) s), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', nome, 'sub', codigo)) from (
        select * from public.produtos where empresa_id = p_empresa and (nome ilike t or codigo ilike t or categoria ilike t) order by nome limit 5) s), '[]'::jsonb),
    'orcamentos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', '#' || numero || ' ' || titulo, 'sub', status)) from (
        select * from public.orcamentos where empresa_id = p_empresa and (titulo ilike t or numero::text = trim(p_termo)) order by created_at desc limit 5) s), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', '#' || numero || ' ' || coalesce(descricao, ''), 'sub', status)) from (
        select * from public.pedidos where empresa_id = p_empresa and (descricao ilike t or numero::text = trim(p_termo)) order by created_at desc limit 5) s), '[]'::jsonb),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', nome || coalesce(' · ' || cor, ''), 'sub', codigo)) from (
        select * from public.materiais where empresa_id = p_empresa and ativo and (nome ilike t or codigo ilike t or cor ilike t) order by nome limit 5) s), '[]'::jsonb),
    'impressoras', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'titulo', nome, 'sub', modelo)) from (
        select * from public.impressoras where empresa_id = p_empresa and (nome ilike t or modelo ilike t or numero_serie ilike t) order by nome limit 5) s), '[]'::jsonb));
end; $$;

-- ---------- Notificações (calculadas na hora, respeitando permissões) --
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

-- ---------- Minha Assinatura ------------------------------------------
create or replace function public.minha_assinatura(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.assinaturas; p public.planos; v_uso_mb numeric;
begin
  if not private.is_membro(p_empresa) then raise exception 'Sem acesso'; end if;
  select * into a from public.assinaturas where empresa_id = p_empresa order by (status in ('ativa','teste','pendente','atrasada')) desc, created_at desc limit 1;
  select * into p from public.planos where id = a.plano_id;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso_mb from storage.objects
   where bucket_id = 'empresa' and name like p_empresa::text || '/%';
  return jsonb_build_object(
    'assinatura', case when a.id is null then null else jsonb_build_object('status', a.status, 'periodicidade', a.periodicidade, 'valor', a.valor,
                   'desconto_percentual', a.desconto_percentual, 'inicio', a.inicio, 'teste_ate', a.teste_ate, 'proxima_cobranca', a.proxima_cobranca,
                   'cancelada_em', a.cancelada_em) end,
    'plano', case when p.id is null then null else jsonb_build_object('id', p.id, 'nome', p.nome, 'preco_mensal', p.preco_mensal, 'preco_anual', p.preco_anual,
                   'limite_impressoras', p.limite_impressoras, 'limite_usuarios', p.limite_usuarios, 'armazenamento_mb', p.armazenamento_mb, 'recursos', p.recursos) end,
    'uso', jsonb_build_object(
       'impressoras', (select count(*) from public.impressoras where empresa_id = p_empresa and status <> 'inativa'),
       'usuarios', (select count(*) from public.membros where empresa_id = p_empresa and ativo),
       'armazenamento_mb', round(v_uso_mb, 2)),
    'pode_gerenciar', private.is_admin(p_empresa),
    'solicitacoes', case when private.is_admin(p_empresa) then coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from (
        select id, tipo, status, motivo, resposta, created_at, resolvido_em, (select nome from public.planos where id = sa.plano_id) as plano
          from public.solicitacoes_assinatura sa where empresa_id = p_empresa order by created_at desc limit 10) s), '[]'::jsonb) else '[]'::jsonb end);
end; $$;

-- ---------- Arquivos (Storage privado por empresa) ----------------------
insert into storage.buckets(id, name, public, file_size_limit)
values ('empresa', 'empresa', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create or replace function private.uuid_ou_nulo(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return p::uuid; exception when others then return null; end; $$;

create or replace function private.pode_enviar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or not private.is_membro(v_emp) then return false; end if;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then return false; end if;
  -- só extensões esperadas (modelos, imagens e documentos); nada executável
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','gcode','png','jpg','jpeg','webp','pdf') then return false; end if;
  if split_part(p_nome, '/', 2) not in ('logo','produtos','orcamentos','impressoras','clientes') then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

do $$ begin
  drop policy if exists empresa_arquivos_ler on storage.objects;
  drop policy if exists empresa_arquivos_enviar on storage.objects;
  drop policy if exists empresa_arquivos_apagar on storage.objects;
  create policy empresa_arquivos_ler on storage.objects for select to authenticated
    using (bucket_id = 'empresa' and (private.is_membro(private.uuid_ou_nulo(split_part(name, '/', 1))) or private.tem_acesso_suporte(private.uuid_ou_nulo(split_part(name, '/', 1)))));
  create policy empresa_arquivos_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'empresa' and private.pode_enviar_arquivo(name));
  create policy empresa_arquivos_apagar on storage.objects for delete to authenticated
    using (bucket_id = 'empresa' and private.pode_escrever(private.uuid_ou_nulo(split_part(name, '/', 1))));
end $$;

revoke all on function public.painel_dashboard(uuid, date, date), public.busca_global(uuid, text), public.minhas_notificacoes(uuid), public.minha_assinatura(uuid) from public, anon;
grant execute on function public.painel_dashboard(uuid, date, date), public.busca_global(uuid, text), public.minhas_notificacoes(uuid), public.minha_assinatura(uuid) to authenticated;
