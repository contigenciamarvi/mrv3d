-- =====================================================================
-- Monitoramento de impressoras: agente local (pareamento por código), conexões
-- Bambu LAN / Moonraker / OctoPrint (somente leitura), telemetria normalizada,
-- eventos deduplicados, trabalhos de impressão ligados às ordens de produção.
-- Credenciais das impressoras (código LAN, chave de API) ficam só no agente local.
-- =====================================================================

-- ---------- Limites do plano --------------------------------------------
alter table public.planos
  add column if not exists limite_agentes integer check (limite_agentes >= 0),
  add column if not exists limite_impressoras_conectadas integer check (limite_impressoras_conectadas >= 0),
  add column if not exists telemetria_dias integer not null default 90 check (telemetria_dias between 1 and 3650);

-- ---------- Agentes locais ----------------------------------------------
create table if not exists public.agentes_locais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 80),
  token_hash text not null unique,
  token_prefixo text not null,
  ativo boolean not null default true,
  versao text check (length(versao) <= 30),
  maquina text check (length(maquina) <= 100),
  sistema text check (length(sistema) <= 60),
  ultimo_contato timestamptz,
  dispositivos_detectados jsonb not null default '[]',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_por text check (revogado_por in ('empresa','plataforma'))
);
create index if not exists agentes_empresa_idx on public.agentes_locais(empresa_id) where ativo;
alter table public.agentes_locais enable row level security;
create policy agentes_ler on public.agentes_locais for select using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_acesso_suporte(empresa_id));
-- o hash do token não vai para a tela
revoke all on public.agentes_locais from authenticated, anon;
grant select (id, empresa_id, nome, token_prefixo, ativo, versao, maquina, sistema, ultimo_contato, dispositivos_detectados, created_at, revogado_em, revogado_por) on public.agentes_locais to authenticated;

-- código de pareamento: curto, uso único, vale 15 minutos; o token do agente nunca aparece no navegador
create table if not exists public.agente_pareamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  codigo_hash text not null unique,
  expira_em timestamptz not null,
  usado_em timestamptz,
  agente_id uuid references public.agentes_locais(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.agente_pareamentos enable row level security;
create policy pareamentos_ler on public.agente_pareamentos for select using (private.tem_permissao(empresa_id, 'integracoes_config'));
revoke all on public.agente_pareamentos from authenticated, anon;
grant select (id, empresa_id, nome, expira_em, usado_em, agente_id, created_at) on public.agente_pareamentos to authenticated;

create or replace function public.criar_pareamento(p_empresa uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_alf constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_cod text := ''; b bytea := extensions.gen_random_bytes(10); i int; v_lim int;
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração conecta agentes'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Dê um nome ao agente (ex.: PC da oficina)'; end if;
  v_lim := (private.plano_empresa(p_empresa)).limite_agentes;
  if v_lim is not null and (select count(*) from public.agentes_locais where empresa_id = p_empresa and ativo) >= v_lim then
    raise exception 'Seu plano permite % agente(s) ativo(s). Revogue um ou faça upgrade.', v_lim;
  end if;
  if (select count(*) from public.agente_pareamentos where empresa_id = p_empresa and usado_em is null and expira_em > now()) >= 5 then
    raise exception 'Há códigos de pareamento demais em aberto: use um deles ou aguarde 15 minutos';
  end if;
  for i in 0 .. 9 loop v_cod := v_cod || substr(v_alf, (get_byte(b, i) % length(v_alf)) + 1, 1); end loop;
  v_cod := substr(v_cod, 1, 5) || '-' || substr(v_cod, 6, 5);
  insert into public.agente_pareamentos(empresa_id, nome, codigo_hash, expira_em)
  values (p_empresa, left(trim(p_nome), 80), encode(extensions.digest(v_cod, 'sha256'), 'hex'), now() + interval '15 minutes');
  return jsonb_build_object('codigo', v_cod, 'expira_em', now() + interval '15 minutes');
end; $$;

-- chamado pelo agente (chave pública + código): devolve a credencial própria do agente
create or replace function public.agente_parear(p_codigo text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pa public.agente_pareamentos; v_token text := 'mrv3d_ag_' || encode(extensions.gen_random_bytes(32), 'hex'); v_ag uuid; v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if length(v_cod) <> 10 then raise exception 'Código de pareamento inválido'; end if;
  v_cod := substr(v_cod, 1, 5) || '-' || substr(v_cod, 6, 5);
  select * into pa from public.agente_pareamentos where codigo_hash = encode(extensions.digest(v_cod, 'sha256'), 'hex') for update;
  if pa.id is null or pa.usado_em is not null or pa.expira_em < now() then raise exception 'Código inválido, já usado ou expirado: gere outro no painel'; end if;
  if not exists (select 1 from public.empresas where id = pa.empresa_id and status not in ('suspensa','cancelada')) then raise exception 'Empresa indisponível'; end if;
  insert into public.agentes_locais(empresa_id, nome, token_hash, token_prefixo, versao, maquina, sistema, created_by)
  values (pa.empresa_id, pa.nome, encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 14), left(p_dados->>'versao', 30), left(p_dados->>'maquina', 100), left(p_dados->>'sistema', 60), pa.created_by)
  returning id into v_ag;
  update public.agente_pareamentos set usado_em = now(), agente_id = v_ag where id = pa.id;
  perform private.registrar_evento(pa.empresa_id, 'conexao', 'Agente local pareado: ' || pa.nome, jsonb_build_object('maquina', left(p_dados->>'maquina', 100), 'versao', left(p_dados->>'versao', 30)));
  return jsonb_build_object('token', v_token, 'agente_id', v_ag, 'empresa', (select nome from public.empresas where id = pa.empresa_id));
end; $$;

create or replace function public.revogar_agente(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locais;
begin
  select * into a from public.agentes_locais where id = p_id for update;
  if a.id is null or not private.pode(a.empresa_id, 'integracoes_config') then raise exception 'Agente não encontrado'; end if;
  update public.agentes_locais set ativo = false, revogado_em = now(), revogado_por = 'empresa' where id = a.id;
  perform private.registrar_evento(a.empresa_id, 'desconexao', 'Agente local revogado: ' || a.nome, null);
end; $$;

-- ---------- Conexão de cada impressora ----------------------------------
alter table public.impressoras
  add column if not exists conexao_tipo text not null default 'nenhuma' check (conexao_tipo in ('nenhuma','bambu_lan','moonraker','octoprint')),
  add column if not exists dispositivo_id text check (dispositivo_id is null or dispositivo_id ~ '^[A-Za-z0-9._-]{3,64}$'),
  add column if not exists agente_id uuid references public.agentes_locais(id) on delete set null;
create unique index if not exists impressoras_dispositivo_uq on public.impressoras(empresa_id, conexao_tipo, upper(dispositivo_id)) where dispositivo_id is not null;
-- número de série Bambu é físico: não pode estar ligado a duas empresas
create unique index if not exists impressoras_serial_bambu_uq on public.impressoras(upper(dispositivo_id)) where conexao_tipo = 'bambu_lan' and dispositivo_id is not null;

create or replace function private.checar_conexao_impressora() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lim int;
begin
  if new.conexao_tipo = 'nenhuma' then new.dispositivo_id := null; new.agente_id := null; end if;
  if new.dispositivo_id is not null and new.conexao_tipo = 'nenhuma' then raise exception 'Escolha o tipo de conexão'; end if;
  if new.agente_id is not null and not exists (select 1 from public.agentes_locais where id = new.agente_id and empresa_id = new.empresa_id and ativo) then
    raise exception 'Agente não encontrado ou revogado';
  end if;
  if new.dispositivo_id is not null and (tg_op = 'INSERT' or old.dispositivo_id is null) then
    if new.conexao_tipo = 'bambu_lan' and exists (select 1 from public.impressoras where conexao_tipo = 'bambu_lan' and upper(dispositivo_id) = upper(new.dispositivo_id) and empresa_id <> new.empresa_id) then
      raise exception 'Este número de série já está ligado a outra conta. Para transferir a impressora, fale com o suporte.';
    end if;
    v_lim := (private.plano_empresa(new.empresa_id)).limite_impressoras_conectadas;
    if v_lim is not null and (select count(*) from public.impressoras where empresa_id = new.empresa_id and dispositivo_id is not null and id <> new.id) >= v_lim then
      raise exception 'Seu plano permite % impressora(s) conectada(s) ao monitoramento.', v_lim;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_impressoras_conexao on public.impressoras;
create trigger trg_impressoras_conexao before insert or update of conexao_tipo, dispositivo_id, agente_id on public.impressoras for each row execute function private.checar_conexao_impressora();

-- ---------- Telemetria atual (uma linha por impressora) -----------------
create table if not exists public.impressora_telemetria (
  impressora_id uuid primary key references public.impressoras(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  agente_id uuid references public.agentes_locais(id) on delete set null,
  conexao text not null check (conexao in ('online','offline','erro_autenticacao')),
  estado text not null check (estado in ('disponivel','preparando','imprimindo','pausada','finalizando','concluida','cancelada','falha','erro','desconhecido')),
  trabalho_id text, arquivo text,
  progresso numeric(5,2), decorrido_s integer, restante_s integer, camada integer, total_camadas integer,
  temp_bico numeric(5,1), temp_bico_alvo numeric(5,1), temp_mesa numeric(5,1), temp_mesa_alvo numeric(5,1), temp_camara numeric(5,1),
  material text, erro_codigo text, extras jsonb not null default '{}',
  fonte text not null check (fonte in ('bambu_lan','moonraker','octoprint')),
  medido_em timestamptz not null,
  recebido_em timestamptz not null default now()
);
alter table public.impressora_telemetria enable row level security;
create policy telemetria_ler on public.impressora_telemetria for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_permissao(empresa_id, 'producao_gerenciar'));

-- ---------- Eventos (só transições; deduplicados pelo id do agente) ------
create table if not exists public.impressora_eventos_integracao (
  id uuid primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  impressora_id uuid not null references public.impressoras(id) on delete cascade,
  agente_id uuid references public.agentes_locais(id) on delete set null,
  tipo text not null check (tipo in ('conectada','desconectada','erro_autenticacao','impressao_iniciada','impressao_pausada','impressao_retomada','impressao_concluida',
                                     'impressao_falhou','impressao_cancelada','temperatura_anormal','erro')),
  ocorrido_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  trabalho_id uuid,
  dados jsonb not null default '{}'
);
create index if not exists ev_int_impressora_idx on public.impressora_eventos_integracao(impressora_id, ocorrido_em desc);
create index if not exists ev_int_empresa_idx on public.impressora_eventos_integracao(empresa_id, ocorrido_em desc);
alter table public.impressora_eventos_integracao enable row level security;
create policy ev_int_ler on public.impressora_eventos_integracao for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_permissao(empresa_id, 'producao_gerenciar'));

-- ---------- Trabalhos de impressão detectados ----------------------------
create table if not exists public.impressora_trabalhos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  impressora_id uuid not null references public.impressoras(id) on delete cascade,
  chave text not null check (length(chave) <= 200),
  arquivo text check (length(arquivo) <= 200),
  status text not null default 'imprimindo' check (status in ('imprimindo','pausado','concluido','falhou','cancelado')),
  iniciado_em timestamptz not null,
  finalizado_em timestamptz,
  duracao_s integer check (duracao_s >= 0),
  progresso numeric(5,2),
  ordem_id uuid references public.ordens_producao(id) on delete set null,
  sugestao_ordem_id uuid references public.ordens_producao(id) on delete set null,
  vinculado_por uuid references auth.users(id) on delete set null,
  vinculado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (impressora_id, chave)
);
create index if not exists trabalhos_empresa_idx on public.impressora_trabalhos(empresa_id, iniciado_em desc);
create index if not exists trabalhos_ordem_idx on public.impressora_trabalhos(ordem_id) where ordem_id is not null;
alter table public.impressora_trabalhos enable row level security;
create policy trabalhos_ler on public.impressora_trabalhos for select using (private.tem_permissao(empresa_id, 'impressoras_ver') or private.tem_permissao(empresa_id, 'producao_gerenciar'));
alter table public.impressora_eventos_integracao drop constraint if exists ev_trabalho_fk;
alter table public.impressora_eventos_integracao add constraint ev_trabalho_fk foreign key (trabalho_id) references public.impressora_trabalhos(id) on delete set null;

-- sugere a ordem de produção, sem vincular sozinho quando há dúvida
create or replace function private.sugerir_ordem(t public.impressora_trabalhos) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_base text := lower(regexp_replace(coalesce(t.arquivo, ''), '^.*/|(\.gcode)?(\.3mf)?$', '', 'g')); v uuid[];
begin
  -- 1) ordens abertas nesta impressora cujo arquivo/projeto tem o mesmo nome
  if v_base <> '' then
    select array_agg(o.id) into v from public.ordens_producao o
     where o.empresa_id = t.empresa_id and o.impressora_id = t.impressora_id and o.status in ('na_fila','imprimindo','pausada')
       and (lower(regexp_replace(coalesce(o.arquivo_path, ''), '^.*/([0-9a-f-]{36}-)?|(\.gcode)?(\.3mf)?$', '', 'g')) = v_base
            or lower(o.descricao) = v_base
            or exists (select 1 from public.projeto_vinculos pv join public.projetos_3d p on p.id = pv.projeto_id
                        where pv.ordem_id = o.id and (lower(p.nome) = v_base or lower(regexp_replace(coalesce(p.arquivo_nome, ''), '(\.gcode)?(\.3mf)?$', '', 'g')) = v_base)));
    if array_length(v, 1) = 1 then return v[1]; end if;
    if array_length(v, 1) > 1 then return null; end if; -- nomes repetidos: o operador escolhe
  end if;
  -- 2) uma única ordem na fila/imprimindo nesta impressora
  select array_agg(o.id) into v from public.ordens_producao o
   where o.empresa_id = t.empresa_id and o.impressora_id = t.impressora_id and o.status in ('na_fila','imprimindo');
  return case when array_length(v, 1) = 1 then v[1] end;
end; $$;

-- aplica um evento de impressão ao trabalho correspondente
create or replace function private.aplicar_evento_trabalho(p_emp uuid, p_imp uuid, p_tipo text, p_em timestamptz, p_chave text, p_arquivo text, p_dados jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.impressora_trabalhos; v_dec int := nullif(p_dados->>'decorrido_s', '')::int;
begin
  if p_tipo = 'impressao_iniciada' then
    insert into public.impressora_trabalhos(empresa_id, impressora_id, chave, arquivo, iniciado_em)
    values (p_emp, p_imp, coalesce(p_chave, coalesce(p_arquivo, 'sem-nome') || '@' || to_char(p_em, 'YYYYMMDDHH24MISS')), left(p_arquivo, 200), p_em)
    on conflict (impressora_id, chave) do update set status = case when public.impressora_trabalhos.status = 'pausado' then 'imprimindo' else public.impressora_trabalhos.status end
    returning * into t;
    if t.sugestao_ordem_id is null and t.ordem_id is null then update public.impressora_trabalhos set sugestao_ordem_id = private.sugerir_ordem(t) where id = t.id; end if;
    return t.id;
  end if;
  -- demais eventos: o trabalho pela chave ou o último aberto da impressora
  select * into t from public.impressora_trabalhos where impressora_id = p_imp and (chave = p_chave or (p_chave is null and status in ('imprimindo','pausado')))
   order by iniciado_em desc limit 1 for update;
  if t.id is null then return null; end if;
  if p_tipo = 'impressao_pausada' and t.status = 'imprimindo' then update public.impressora_trabalhos set status = 'pausado' where id = t.id;
  elsif p_tipo = 'impressao_retomada' and t.status = 'pausado' then update public.impressora_trabalhos set status = 'imprimindo' where id = t.id;
  elsif p_tipo in ('impressao_concluida','impressao_falhou','impressao_cancelada') and t.status in ('imprimindo','pausado') then
    update public.impressora_trabalhos set status = case p_tipo when 'impressao_concluida' then 'concluido' when 'impressao_falhou' then 'falhou' else 'cancelado' end,
           finalizado_em = greatest(p_em, t.iniciado_em), duracao_s = coalesce(v_dec, extract(epoch from greatest(p_em, t.iniciado_em) - t.iniciado_em)::int),
           progresso = coalesce(nullif(p_dados->>'progresso', '')::numeric, case when p_tipo = 'impressao_concluida' then 100 end, progresso)
     where id = t.id;
  end if;
  return t.id;
end; $$;

-- valor numérico dentro de limites (fora disso: descartado)
create or replace function private.num_faixa(v jsonb, lo numeric, hi numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then return null; end if;
  n := (v #>> '{}')::numeric;
  return case when n between lo and hi then n end;
exception when others then return null; end; $$;

-- ---------- Envio do agente: estado atual + eventos ----------------------
create or replace function public.agente_reportar(p_token text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locais; i jsonb; e jsonb; v_imp public.impressoras; v_det jsonb := '[]'::jsonb; v_n int := 0; v_ev int := 0; v_tr uuid; v_em timestamptz; v_med timestamptz;
  v_tipos constant text[] := array['bambu_lan','moonraker','octoprint']; v_dias int; v_ok boolean;
begin
  if p_token is null or p_token !~ '^mrv3d_ag_[0-9a-f]{64}$' then raise exception 'Token inválido'; end if;
  select * into a from public.agentes_locais where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if a.id is null or not a.ativo then raise exception 'Token inválido ou revogado'; end if;
  if not exists (select 1 from public.empresas where id = a.empresa_id and status not in ('suspensa','cancelada')) then raise exception 'Empresa indisponível'; end if;
  if jsonb_typeof(coalesce(p_dados->'impressoras', '[]')) <> 'array' or jsonb_array_length(coalesce(p_dados->'impressoras', '[]')) > 50
     or jsonb_typeof(coalesce(p_dados->'eventos', '[]')) <> 'array' or jsonb_array_length(coalesce(p_dados->'eventos', '[]')) > 200 or length(p_dados::text) > 300000 then
    raise exception 'Dados inválidos';
  end if;
  -- no máximo um envio a cada 5 segundos (o agente acumula e manda junto)
  if a.ultimo_contato > now() - interval '5 seconds' then return jsonb_build_object('ok', true, 'ignorado', true, 'aguarde_s', 5); end if;

  -- 1) eventos (fila do agente, inclusive os guardados durante queda de internet)
  for e in select * from jsonb_array_elements(coalesce(p_dados->'eventos', '[]')) loop
    begin
      v_em := (e->>'em')::timestamptz;
    exception when others then continue; end;
    if v_em is null or v_em > now() + interval '5 minutes' or v_em < now() - interval '30 days' then continue; end if;
    if (e->>'id') !~ '^[0-9a-f-]{36}$' or (e->>'tipo') not in ('conectada','desconectada','erro_autenticacao','impressao_iniciada','impressao_pausada','impressao_retomada',
        'impressao_concluida','impressao_falhou','impressao_cancelada','temperatura_anormal','erro') then continue; end if;
    select * into v_imp from public.impressoras where empresa_id = a.empresa_id and conexao_tipo = (e->>'tipo_conexao') and upper(dispositivo_id) = upper(left(e->>'dispositivo_id', 64));
    if v_imp.id is null then continue; end if;
    insert into public.impressora_eventos_integracao(id, empresa_id, impressora_id, agente_id, tipo, ocorrido_em, dados)
    values ((e->>'id')::uuid, a.empresa_id, v_imp.id, a.id, e->>'tipo', v_em,
            jsonb_strip_nulls(jsonb_build_object('arquivo', left(e#>>'{trabalho,arquivo}', 200), 'progresso', private.num_faixa(e#>'{dados,progresso}', 0, 100),
              'decorrido_s', private.num_faixa(e#>'{dados,decorrido_s}', 0, 2592000), 'codigo', left(e#>>'{dados,codigo}', 60), 'mensagem', left(e#>>'{dados,mensagem}', 200),
              'temp_bico', private.num_faixa(e#>'{dados,temp_bico}', -40, 600), 'temp_mesa', private.num_faixa(e#>'{dados,temp_mesa}', -40, 300))))
    on conflict (id) do nothing returning true into v_ok;
    if v_ok then
      v_ev := v_ev + 1;
      v_tr := private.aplicar_evento_trabalho(a.empresa_id, v_imp.id, e->>'tipo', v_em, left(e#>>'{trabalho,id}', 200), left(e#>>'{trabalho,arquivo}', 200),
                jsonb_build_object('decorrido_s', private.num_faixa(e#>'{dados,decorrido_s}', 0, 2592000), 'progresso', private.num_faixa(e#>'{dados,progresso}', 0, 100)));
      if v_tr is not null then update public.impressora_eventos_integracao set trabalho_id = v_tr where id = (e->>'id')::uuid; end if;
    end if;
    v_ok := null;
  end loop;

  -- 2) estado atual de cada impressora (descarta medição mais antiga que a guardada)
  for i in select * from jsonb_array_elements(coalesce(p_dados->'impressoras', '[]')) loop
    if not ((i->>'tipo_conexao') = any(v_tipos)) or coalesce(i->>'dispositivo_id', '') !~ '^[A-Za-z0-9._-]{3,64}$' then continue; end if;
    select * into v_imp from public.impressoras where empresa_id = a.empresa_id and conexao_tipo = i->>'tipo_conexao' and upper(dispositivo_id) = upper(i->>'dispositivo_id');
    if v_imp.id is null then
      v_det := v_det || jsonb_build_array(jsonb_build_object('tipo_conexao', i->>'tipo_conexao', 'dispositivo_id', i->>'dispositivo_id', 'nome', left(i->>'nome', 80), 'modelo', left(i->>'modelo', 60)));
      continue;
    end if;
    begin v_med := coalesce((i->>'medido_em')::timestamptz, now()); exception when others then v_med := now(); end;
    if v_med > now() + interval '5 minutes' then v_med := now(); end if;
    insert into public.impressora_telemetria(impressora_id, empresa_id, agente_id, conexao, estado, trabalho_id, arquivo, progresso, decorrido_s, restante_s, camada, total_camadas,
      temp_bico, temp_bico_alvo, temp_mesa, temp_mesa_alvo, temp_camara, material, erro_codigo, extras, fonte, medido_em, recebido_em)
    values (v_imp.id, a.empresa_id, a.id,
      case when i->>'conexao' in ('online','offline','erro_autenticacao') then i->>'conexao' else 'online' end,
      case when i->>'estado' in ('disponivel','preparando','imprimindo','pausada','finalizando','concluida','cancelada','falha','erro') then i->>'estado' else 'desconhecido' end,
      left(i->>'trabalho_id', 200), left(i->>'arquivo', 200),
      private.num_faixa(i->'progresso', 0, 100), private.num_faixa(i->'decorrido_s', 0, 2592000)::int, private.num_faixa(i->'restante_s', 0, 2592000)::int,
      private.num_faixa(i->'camada', 0, 100000)::int, private.num_faixa(i->'total_camadas', 0, 100000)::int,
      private.num_faixa(i->'temp_bico', -40, 600), private.num_faixa(i->'temp_bico_alvo', 0, 600), private.num_faixa(i->'temp_mesa', -40, 300), private.num_faixa(i->'temp_mesa_alvo', 0, 300),
      private.num_faixa(i->'temp_camara', -40, 150), left(i->>'material', 60), left(i->>'erro_codigo', 60),
      case when jsonb_typeof(i->'ams') = 'array' and jsonb_array_length(i->'ams') <= 16 and length((i->'ams')::text) <= 4000 then jsonb_build_object('ams', i->'ams') else '{}'::jsonb end,
      i->>'tipo_conexao', v_med, now())
    on conflict (impressora_id) do update set agente_id = excluded.agente_id, conexao = excluded.conexao, estado = excluded.estado, trabalho_id = excluded.trabalho_id, arquivo = excluded.arquivo,
      progresso = excluded.progresso, decorrido_s = excluded.decorrido_s, restante_s = excluded.restante_s, camada = excluded.camada, total_camadas = excluded.total_camadas,
      temp_bico = excluded.temp_bico, temp_bico_alvo = excluded.temp_bico_alvo, temp_mesa = excluded.temp_mesa, temp_mesa_alvo = excluded.temp_mesa_alvo, temp_camara = excluded.temp_camara,
      material = excluded.material, erro_codigo = excluded.erro_codigo, extras = excluded.extras, fonte = excluded.fonte, medido_em = excluded.medido_em, recebido_em = now()
    where public.impressora_telemetria.medido_em <= excluded.medido_em;
    if v_imp.agente_id is distinct from a.id then update public.impressoras set agente_id = a.id where id = v_imp.id; end if;
    v_n := v_n + 1;
    -- progresso do trabalho aberto
    update public.impressora_trabalhos set progresso = private.num_faixa(i->'progresso', 0, 100)
     where impressora_id = v_imp.id and status in ('imprimindo','pausado') and private.num_faixa(i->'progresso', 0, 100) is not null;
  end loop;

  update public.agentes_locais set ultimo_contato = now(), versao = coalesce(left(p_dados->>'versao', 30), versao), dispositivos_detectados = v_det where id = a.id;
  if exists (select 1 from public.impressoras where empresa_id = a.empresa_id and conexao_tipo = 'bambu_lan' and agente_id = a.id) then
    insert into public.integracoes(empresa_id, provedor, status, modo, ultima_sincronizacao) values (a.empresa_id, 'bambu_lab', 'conectada', 'agente_lan', now())
    on conflict (empresa_id, provedor) do update set status = 'conectada', modo = case when public.integracoes.modo = 'nuvem' then 'nuvem' else 'agente_lan' end, ultima_sincronizacao = now(), ultimo_erro = null, updated_at = now();
  end if;
  -- retenção do histórico conforme o plano (aos poucos)
  v_dias := coalesce((private.plano_empresa(a.empresa_id)).telemetria_dias, 90);
  delete from public.impressora_eventos_integracao where id in (select id from public.impressora_eventos_integracao where empresa_id = a.empresa_id and ocorrido_em < now() - make_interval(days => v_dias) limit 500);
  return jsonb_build_object('ok', true, 'impressoras', v_n, 'eventos_novos', v_ev, 'nao_vinculadas', jsonb_array_length(v_det));
end; $$;

-- ---------- Ações do usuário ----------------------------------------------
-- vincula um trabalho detectado a uma ordem de produção (confirmação do operador)
create or replace function public.vincular_trabalho_ordem(p_trabalho uuid, p_ordem uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.impressora_trabalhos; o public.ordens_producao; v_msg text := 'vinculado';
begin
  select * into t from public.impressora_trabalhos where id = p_trabalho for update;
  if t.id is null or not private.pode(t.empresa_id, 'producao_gerenciar') then raise exception 'Trabalho não encontrado'; end if;
  if p_ordem is null then
    update public.impressora_trabalhos set ordem_id = null, vinculado_por = (select auth.uid()), vinculado_em = now() where id = t.id;
    return 'desvinculado';
  end if;
  select * into o from public.ordens_producao where id = p_ordem and empresa_id = t.empresa_id;
  if o.id is null then raise exception 'Ordem de produção não encontrada'; end if;
  if o.status in ('concluida','cancelada') then raise exception 'Ordem %', o.status; end if;
  update public.impressora_trabalhos set ordem_id = o.id, sugestao_ordem_id = null, vinculado_por = (select auth.uid()), vinculado_em = now() where id = t.id;
  if o.impressora_id is null or o.impressora_id <> t.impressora_id then
    perform set_config('app.op_interno', '1', true);
    update public.ordens_producao set impressora_id = t.impressora_id where id = o.id;
    perform set_config('app.op_interno', '0', true);
  end if;
  -- impressão em andamento: a ordem passa a "imprimindo" com o início real detectado
  if t.status in ('imprimindo','pausado') and o.status in ('planejada','aguardando_material','na_fila','pausada') then
    begin
      perform public.iniciar_ordem(o.id);
      perform set_config('app.op_interno', '1', true);
      update public.ordens_producao set iniciada_em = least(coalesce(iniciada_em, t.iniciado_em), t.iniciado_em) where id = o.id;
      perform set_config('app.op_interno', '0', true);
      v_msg := 'vinculado e ordem iniciada';
    exception when others then
      -- o vínculo vale; a ordem segue o fluxo manual (ex.: falta material para reservar)
      v_msg := 'vinculado; a ordem não foi iniciada: ' || sqlerrm;
    end;
  end if;
  return v_msg;
end; $$;

-- tira a impressora do monitoramento (o histórico continua)
create or replace function public.desconectar_impressora(p_impressora uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.impressoras;
begin
  select * into i from public.impressoras where id = p_impressora for update;
  if i.id is null or not (private.pode(i.empresa_id, 'impressoras_editar') or private.pode(i.empresa_id, 'integracoes_config')) then raise exception 'Impressora não encontrada'; end if;
  update public.impressoras set conexao_tipo = 'nenhuma', dispositivo_id = null, agente_id = null where id = i.id;
  delete from public.impressora_telemetria where impressora_id = i.id;
  perform private.registrar_evento(i.empresa_id, 'desconexao', 'Impressora desconectada do monitoramento: ' || i.nome, null);
end; $$;

-- trocar o identificador descarta o estado atual antigo
create or replace function private.dispositivo_mudou() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.dispositivo_id is distinct from old.dispositivo_id or new.conexao_tipo is distinct from old.conexao_tipo then delete from public.impressora_telemetria where impressora_id = new.id; end if;
  return null;
end; $$;
drop trigger if exists trg_impressoras_dispositivo on public.impressoras;
create trigger trg_impressoras_dispositivo after update of dispositivo_id, conexao_tipo on public.impressoras for each row execute function private.dispositivo_mudou();

-- desconectar a integração Bambu: apaga credenciais, revoga agentes e limpa o estado
create or replace function public.desconectar_integracao(p_empresa uuid, p_provedor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração configura integrações'; end if;
  if p_provedor <> 'bambu_lab' then raise exception 'Integração desconhecida'; end if;
  delete from private.integracao_credenciais where empresa_id = p_empresa and provedor = p_provedor;
  delete from public.impressora_telemetria t using public.impressoras i where i.id = t.impressora_id and i.empresa_id = p_empresa and i.conexao_tipo = 'bambu_lan';
  update public.impressoras set conexao_tipo = 'nenhuma' where empresa_id = p_empresa and conexao_tipo = 'bambu_lan';
  insert into public.integracoes(empresa_id, provedor, status, modo) values (p_empresa, p_provedor, 'desconectada', 'manual')
  on conflict (empresa_id, provedor) do update set status = 'desconectada', modo = 'manual', conta_rotulo = null, ultimo_erro = null, updated_at = now();
  perform private.registrar_evento(p_empresa, 'desconexao', 'Integração Bambu Lab desconectada e credenciais excluídas', null);
end; $$;

create or replace function public.salvar_config_integracao(p_empresa uuid, p_config jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração configura integrações'; end if;
  select coalesce(jsonb_object_agg(k, p_config->k), '{}'::jsonb) into v from unnest(array['alerta_temperatura_bico','alerta_temperatura_mesa','avisar_sem_ordem','agente_offline_min']) k
   where p_config ? k and jsonb_typeof(p_config->k) in ('boolean','number') and length(p_config->>k) <= 20;
  insert into public.integracoes(empresa_id, provedor, config) values (p_empresa, 'bambu_lab', v)
  on conflict (empresa_id, provedor) do update set config = v, updated_at = now();
end; $$;

-- ---------- Alertas na central de notificações ---------------------------
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'minhas_notificacoes_fase4') then
    alter function public.minhas_notificacoes(uuid) rename to minhas_notificacoes_fase4;
  end if;
end $$;
create or replace function public.minhas_notificacoes(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := public.minhas_notificacoes_fase4(p_empresa);
begin
  if private.tem_permissao(p_empresa, 'impressoras_ver') or private.tem_permissao(p_empresa, 'producao_gerenciar') then
    -- uma notificação por impressora e tipo nas últimas 24 h (sem repetir alertas)
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'evimp-' || x.id, 'tipo', 'impressora',
              'nivel', case when x.tipo in ('impressao_falhou','erro','erro_autenticacao','temperatura_anormal') then 'erro' when x.tipo = 'desconectada' then 'alerta' when x.tipo = 'impressao_concluida' then 'sucesso' else 'info' end,
              'titulo', case x.tipo when 'impressao_concluida' then 'Impressão concluída: confirme a peça na ordem' when 'impressao_falhou' then 'Falha de impressão detectada' when 'erro' then 'Erro na impressora'
                         when 'erro_autenticacao' then 'Erro de autenticação com a impressora' when 'temperatura_anormal' then 'Temperatura anormal reportada' when 'desconectada' then 'Impressora desconectada' else 'Impressora' end,
              'texto', x.nome || coalesce(' · ' || (x.dados->>'arquivo'), ''), 'link', '/impressoras/monitoramento/'))
             from (select distinct on (e.impressora_id, e.tipo) e.id, e.tipo, e.dados, i.nome from public.impressora_eventos_integracao e join public.impressoras i on i.id = e.impressora_id
                    where e.empresa_id = p_empresa and e.ocorrido_em > now() - interval '24 hours'
                      and e.tipo in ('impressao_concluida','impressao_falhou','erro','erro_autenticacao','temperatura_anormal','desconectada')
                      and not exists (select 1 from public.impressora_eventos_integracao d where d.impressora_id = e.impressora_id and d.tipo = 'conectada' and d.ocorrido_em > e.ocorrido_em and e.tipo = 'desconectada')
                    order by e.impressora_id, e.tipo, e.ocorrido_em desc) x), '[]'::jsonb);
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'semop-' || t.id, 'tipo', 'producao', 'nivel', 'alerta', 'titulo', 'Impressão sem ordem de produção',
              'texto', i.nome || coalesce(' · ' || t.arquivo, ''), 'link', '/impressoras/monitoramento/?trabalho=' || t.id))
             from public.impressora_trabalhos t join public.impressoras i on i.id = t.impressora_id
            where t.empresa_id = p_empresa and t.ordem_id is null and t.iniciado_em > now() - interval '3 days' and t.status <> 'cancelado'), '[]'::jsonb);
  end if;
  if private.tem_permissao(p_empresa, 'integracoes_config') then
    r := r || coalesce((select jsonb_agg(jsonb_build_object('id', 'agoff-' || id || '-' || to_char(ultimo_contato, 'YYYYMMDDHH24'), 'tipo', 'impressora', 'nivel', 'alerta', 'titulo', 'Agente local offline',
              'texto', nome || ' · último contato ' || to_char(ultimo_contato at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'link', '/integracoes/bambu/?aba=config'))
             from public.agentes_locais where empresa_id = p_empresa and ativo and ultimo_contato < now() - interval '5 minutes' and ultimo_contato > now() - interval '7 days'), '[]'::jsonb);
  end if;
  return r;
end; $$;
revoke all on function public.minhas_notificacoes_fase4(uuid) from public, anon, authenticated;

-- ---------- Super Admin: métricas técnicas agregadas e revogação ---------
create or replace function public.admin_uso_empresas()
returns table(empresa_id uuid, nome text, status public.status_empresa, usuarios bigint, impressoras bigint, impressoras_conectadas bigint, agentes_ativos bigint,
              agentes_online bigint, versoes_agente text, projetos bigint, orcamentos_30d bigint, armazenamento_mb numeric, erros_integracao_7d bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  return query
  select e.id, e.nome, e.status,
    (select count(*) from public.membros m where m.empresa_id = e.id and m.ativo),
    (select count(*) from public.impressoras i where i.empresa_id = e.id and i.status <> 'inativa'),
    (select count(*) from public.impressoras i where i.empresa_id = e.id and i.dispositivo_id is not null),
    (select count(*) from public.agentes_locais a where a.empresa_id = e.id and a.ativo),
    (select count(*) from public.agentes_locais a where a.empresa_id = e.id and a.ativo and a.ultimo_contato > now() - interval '5 minutes'),
    (select string_agg(distinct a.versao, ', ') from public.agentes_locais a where a.empresa_id = e.id and a.ativo),
    (select count(*) from public.projetos_3d p where p.empresa_id = e.id),
    (select count(*) from public.orcamentos o where o.empresa_id = e.id and o.created_at > now() - interval '30 days'),
    round(coalesce((select sum((s.metadata->>'size')::numeric) from storage.objects s where s.bucket_id = 'empresa' and s.name like e.id::text || '/%'), 0) / 1048576, 1),
    (select count(*) from public.integracao_eventos v where v.empresa_id = e.id and v.tipo = 'erro' and v.created_at > now() - interval '7 days')
      + (select count(*) from public.impressora_eventos_integracao v where v.empresa_id = e.id and v.tipo in ('erro','erro_autenticacao') and v.ocorrido_em > now() - interval '7 days')
  from public.empresas e order by e.nome;
end; $$;

create or replace function public.admin_agentes(p_empresa uuid)
returns table(id uuid, nome text, ativo boolean, versao text, sistema text, ultimo_contato timestamptz, created_at timestamptz, revogado_em timestamptz, revogado_por text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  return query select a.id, a.nome, a.ativo, a.versao, a.sistema, a.ultimo_contato, a.created_at, a.revogado_em, a.revogado_por from public.agentes_locais a where a.empresa_id = p_empresa order by a.created_at desc;
end; $$;

create or replace function public.admin_revogar_agente(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locais;
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  select * into a from public.agentes_locais where id = p_id for update;
  if a.id is null then raise exception 'Agente não encontrado'; end if;
  update public.agentes_locais set ativo = false, revogado_em = now(), revogado_por = 'plataforma' where id = a.id;
  perform private.registrar_evento(a.empresa_id, 'desconexao', 'Agente revogado pela plataforma: ' || a.nome || ' (' || trim(p_motivo) || ')', null);
  perform private.registrar_auditoria('revogar_agente', 'agentes_locais', a.id::text, a.empresa_id, jsonb_build_object('motivo', trim(p_motivo)));
end; $$;

revoke all on function public.criar_pareamento(uuid, text), public.agente_parear(text, jsonb), public.revogar_agente(uuid), public.agente_reportar(text, jsonb),
  public.vincular_trabalho_ordem(uuid, uuid), public.desconectar_impressora(uuid), public.desconectar_integracao(uuid, text), public.salvar_config_integracao(uuid, jsonb),
  public.admin_uso_empresas(), public.admin_agentes(uuid), public.admin_revogar_agente(uuid, text), public.minhas_notificacoes(uuid) from public, anon;
grant execute on function public.criar_pareamento(uuid, text), public.revogar_agente(uuid), public.vincular_trabalho_ordem(uuid, uuid), public.desconectar_impressora(uuid),
  public.desconectar_integracao(uuid, text), public.salvar_config_integracao(uuid, jsonb), public.admin_uso_empresas(), public.admin_agentes(uuid),
  public.admin_revogar_agente(uuid, text), public.minhas_notificacoes(uuid) to authenticated;
-- o agente usa só a chave pública + código de pareamento / token próprio
grant execute on function public.agente_parear(text, jsonb), public.agente_reportar(text, jsonb) to anon, authenticated;
