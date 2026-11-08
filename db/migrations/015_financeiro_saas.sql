-- Super Admin › Financeiro SaaS: receita recorrente, recebimentos, inadimplência e cancelamentos.
-- Só lê assinaturas e faturas da plataforma (nada das finanças internas das lojas).

-- valor mensal equivalente de uma assinatura (anual vira 1/12), já com o desconto
create or replace function private.mrr_assinatura(a public.assinaturas) returns numeric
language sql immutable set search_path = '' as $$
  select round(coalesce(a.valor, 0) * (1 - least(greatest(coalesce(a.desconto_percentual, 0), 0), 100) / 100)
               / case when a.periodicidade = 'anual' then 12 else 1 end, 2)
$$;
revoke all on function private.mrr_assinatura(public.assinaturas) from public, anon, authenticated;

create or replace function public.admin_financeiro(p_meses int default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_meses int := least(greatest(coalesce(p_meses, 12), 3), 36);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini_mes date := date_trunc('month', v_hoje)::date;
  r jsonb;
begin
  if not private.tem_papel('proprietario', 'administrador', 'financeiro') then raise exception 'Acesso restrito ao financeiro da plataforma'; end if;

  with ass as (
    select a.*, private.mrr_assinatura(a) as mrr, e.nome as empresa, p.nome as plano
      from public.assinaturas a join public.empresas e on e.id = a.empresa_id left join public.planos p on p.id = a.plano_id
  ),
  pagantes as (select * from ass where status in ('ativa', 'pendente', 'atrasada')),
  fat as (
    select f.*, e.nome as empresa, (f.status = 'vencida' or (f.status = 'aberta' and f.vencimento < v_hoje)) as atrasada
      from public.faturas f join public.empresas e on e.id = f.empresa_id
  ),
  meses as (select generate_series(v_ini_mes - make_interval(months => v_meses - 1), v_ini_mes, interval '1 month')::date as mes)
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'mrr', (select coalesce(sum(mrr), 0) from pagantes),
      'arr', (select coalesce(sum(mrr), 0) * 12 from pagantes),
      'pagantes', (select count(*) from pagantes),
      'ticket_medio', (select coalesce(round(avg(mrr), 2), 0) from pagantes),
      'mrr_em_risco', (select coalesce(sum(mrr), 0) from pagantes where status = 'atrasada'),
      'em_teste', (select count(*) from ass where status = 'teste'),
      'testes_7d', (select count(*) from ass where status = 'teste' and teste_ate between v_hoje and v_hoje + 7),
      'mrr_potencial_testes', (select coalesce(sum(mrr), 0) from ass where status = 'teste'),
      'recebido_mes', (select coalesce(sum(coalesce(valor_pago, valor)), 0) from fat where status = 'paga' and pago_em >= v_ini_mes),
      'a_receber_30d', (select coalesce(sum(valor), 0) from fat where status = 'aberta' and vencimento between v_hoje and v_hoje + 30),
      'em_atraso', (select coalesce(sum(valor), 0) from fat where atrasada),
      'faturas_em_atraso', (select count(*) from fat where atrasada),
      'empresas_inadimplentes', (select count(distinct empresa_id) from fat where atrasada),
      'cancelamentos_30d', (select count(*) from ass where status = 'cancelada' and cancelada_em >= now() - interval '30 days'),
      'mrr_perdido_30d', (select coalesce(sum(mrr), 0) from ass where status = 'cancelada' and cancelada_em >= now() - interval '30 days'),
      -- cancelamentos dos últimos 30 dias sobre a base pagante de 30 dias atrás (aproximação)
      'churn_30d_pct', (select case when base > 0 then round(canc * 100.0 / base, 1) end from (
          select (select count(*) from ass where status = 'cancelada' and cancelada_em >= now() - interval '30 days') as canc,
                 (select count(*) from pagantes) + (select count(*) from ass where status = 'cancelada' and cancelada_em >= now() - interval '30 days') as base) x)
    ),
    'por_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status::text, count(*) as n from ass group by status) s),
    'por_plano', (select coalesce(jsonb_agg(jsonb_build_object('plano', coalesce(plano, 'Sem plano'), 'assinaturas', n, 'mrr', mrr) order by mrr desc), '[]')
                    from (select plano, count(*) as n, sum(mrr) as mrr from pagantes group by plano) s),
    'mensal', (select jsonb_agg(jsonb_build_object(
        'mes', to_char(m.mes, 'YYYY-MM'),
        'faturado', (select coalesce(sum(valor), 0) from fat where status <> 'cancelada' and date_trunc('month', vencimento) = m.mes),
        'recebido', (select coalesce(sum(coalesce(valor_pago, valor)), 0) from fat where status = 'paga' and date_trunc('month', pago_em at time zone 'America/Sao_Paulo') = m.mes),
        'novas', (select count(*) from ass where status <> 'teste' and date_trunc('month', inicio) = m.mes),
        'cancelamentos', (select count(*) from ass where status = 'cancelada' and date_trunc('month', cancelada_em at time zone 'America/Sao_Paulo') = m.mes)
      ) order by m.mes) from meses m),
    'inadimplentes', (select coalesce(jsonb_agg(x order by (x->>'dias_atraso')::int desc), '[]') from (
        select jsonb_build_object('empresa_id', f.empresa_id, 'empresa', min(f.empresa), 'valor', sum(f.valor), 'faturas', count(*),
               'vencimento_mais_antigo', min(f.vencimento), 'dias_atraso', v_hoje - min(f.vencimento),
               'status_assinatura', (select status from public.assinaturas where empresa_id = f.empresa_id order by created_at desc limit 1)) as x
          from fat f where f.atrasada group by f.empresa_id) s),
    'proximas', (select coalesce(jsonb_agg(jsonb_build_object('empresa', empresa, 'valor', valor, 'vencimento', vencimento, 'descricao', descricao) order by vencimento), '[]')
                   from (select * from fat where status = 'aberta' and vencimento between v_hoje and v_hoje + 30 order by vencimento limit 100) s),
    'testes', (select coalesce(jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'empresa', empresa, 'plano', plano, 'teste_ate', teste_ate, 'mrr', mrr) order by teste_ate), '[]')
                 from (select * from ass where status = 'teste' and teste_ate <= v_hoje + 14 order by teste_ate limit 100) s),
    'cancelados', (select coalesce(jsonb_agg(jsonb_build_object('empresa', empresa, 'plano', plano, 'mrr', mrr, 'cancelada_em', cancelada_em, 'motivo', motivo_cancelamento) order by cancelada_em desc), '[]')
                     from (select * from ass where status = 'cancelada' and cancelada_em >= now() - interval '90 days' order by cancelada_em desc limit 100) s)
  ) into r;
  return r;
end; $$;
revoke all on function public.admin_financeiro(int) from public, anon;
grant execute on function public.admin_financeiro(int) to authenticated;
