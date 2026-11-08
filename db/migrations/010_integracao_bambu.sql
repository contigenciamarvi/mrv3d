-- =====================================================================
-- MÓDULO — Integração Bambu Lab e biblioteca de projetos 3D
-- Biblioteca com upload manual (funcional), referências do MakerWorld com licença,
-- agente local opcional (LAN, somente leitura) e base para sincronização oficial futura.
-- Nenhuma senha da conta Bambu Lab é pedida ou guardada.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- Integrações: situação por empresa e provedor ---------------
create table if not exists public.integracoes (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  provedor text not null check (provedor in ('bambu_lab')),
  status text not null default 'nao_configurada' check (status in ('nao_configurada','conectada','erro','desconectada')),
  modo text not null default 'manual' check (modo in ('manual','agente_lan','nuvem')),
  conta_rotulo text check (length(conta_rotulo) <= 150),
  ultima_sincronizacao timestamptz,
  ultimo_erro text check (length(ultimo_erro) <= 1000),
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (empresa_id, provedor)
);
alter table public.integracoes enable row level security;
create policy integracoes_ler on public.integracoes for select using (private.is_membro(empresa_id) or private.tem_acesso_suporte(empresa_id));
-- sem escrita direta: situação só muda pelas funções (nunca "conectada" sem conexão real)

-- ---------- Credenciais (tokens) criptografadas, fora da API ------------
-- A chave de criptografia fica num segredo interno; tokens nunca voltam para o navegador.
create table if not exists private.segredos (nome text primary key, valor text not null);
insert into private.segredos(nome, valor) values ('chave_integracoes', encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;
revoke all on private.segredos from public, anon, authenticated;

create table if not exists private.integracao_credenciais (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  provedor text not null,
  token_cifrado bytea not null,
  refresh_cifrado bytea,
  expira_em timestamptz,
  criado_em timestamptz not null default now(),
  primary key (empresa_id, provedor)
);
revoke all on private.integracao_credenciais from public, anon, authenticated;

-- usadas apenas por funções do servidor (futura conexão oficial); não expostas à API
create or replace function private.salvar_credencial(p_empresa uuid, p_provedor text, p_token text, p_refresh text, p_expira timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare k text := (select valor from private.segredos where nome = 'chave_integracoes');
begin
  insert into private.integracao_credenciais(empresa_id, provedor, token_cifrado, refresh_cifrado, expira_em)
  values (p_empresa, p_provedor, extensions.pgp_sym_encrypt(p_token, k), case when p_refresh is not null then extensions.pgp_sym_encrypt(p_refresh, k) end, p_expira)
  on conflict (empresa_id, provedor) do update set token_cifrado = excluded.token_cifrado, refresh_cifrado = excluded.refresh_cifrado, expira_em = excluded.expira_em, criado_em = now();
end; $$;
create or replace function private.ler_credencial(p_empresa uuid, p_provedor text) returns text
language sql stable security definer set search_path = '' as $$
  select extensions.pgp_sym_decrypt(token_cifrado, (select valor from private.segredos where nome = 'chave_integracoes'))
    from private.integracao_credenciais where empresa_id = p_empresa and provedor = p_provedor;
$$;
revoke all on function private.salvar_credencial(uuid, text, text, text, timestamptz), private.ler_credencial(uuid, text) from public, anon, authenticated;

-- ---------- Histórico de importações, atualizações e erros --------------
create table if not exists public.integracao_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  provedor text not null default 'bambu_lab',
  tipo text not null check (tipo in ('importacao','atualizacao','exclusao','erro','duplicado','vinculo','conexao','desconexao','agente')),
  mensagem text not null check (length(mensagem) <= 500),
  dados jsonb,
  autor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists integracao_eventos_idx on public.integracao_eventos(empresa_id, id desc);
alter table public.integracao_eventos enable row level security;
create policy integracao_eventos_ler on public.integracao_eventos for select using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_permissao(empresa_id, 'produtos_ver'));

create or replace function private.registrar_evento(p_empresa uuid, p_tipo text, p_msg text, p_dados jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.integracao_eventos(empresa_id, tipo, mensagem, dados) values (p_empresa, p_tipo, left(p_msg, 500), p_dados);
$$;

-- erros de leitura no navegador e tentativas de duplicar ficam no histórico
create or replace function public.registrar_evento_importacao(p_empresa uuid, p_tipo text, p_mensagem text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.pode(p_empresa, 'produtos_editar') or private.pode(p_empresa, 'orcamentos_criar') or private.pode(p_empresa, 'producao_gerenciar')) then raise exception 'Sem permissão'; end if;
  if p_tipo not in ('erro','duplicado') then raise exception 'Tipo inválido'; end if;
  -- evita encher o histórico
  if (select count(*) from public.integracao_eventos where empresa_id = p_empresa and autor_id = (select auth.uid()) and created_at > now() - interval '1 minute') >= 30 then return; end if;
  perform private.registrar_evento(p_empresa, p_tipo, coalesce(nullif(trim(p_mensagem), ''), 'Erro'), null);
end; $$;

-- ---------- Biblioteca de projetos 3D -----------------------------------
create table if not exists public.projetos_3d (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 200),
  origem text not null default 'upload' check (origem in ('upload','makerworld','sincronizado')),
  arquivo_path text check (arquivo_path is null or arquivo_path like empresa_id::text || '/projetos/%'),
  arquivo_nome text check (length(arquivo_nome) <= 200),
  formato text check (formato in ('stl','3mf','gcode.3mf','gcode','obj','step')),
  tamanho_bytes bigint check (tamanho_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  miniatura_path text check (miniatura_path is null or miniatura_path like empresa_id::text || '/projetos/%'),
  pecas integer check (pecas >= 0),
  placas integer check (placas >= 0),
  tempo_estimado_min numeric(10,1) check (tempo_estimado_min >= 0),
  peso_g numeric(10,2) check (peso_g >= 0),
  materiais text[] not null default '{}',
  cores text[] not null default '{}',
  impressora_modelo text check (length(impressora_modelo) <= 100),
  bico_mm numeric(4,2),
  altura_camada_mm numeric(4,2),
  preenchimento text check (length(preenchimento) <= 20),
  fatiador text check (length(fatiador) <= 100),
  volume_cm3 numeric(12,3),
  dimensoes_mm numeric[],
  metadados jsonb not null default '{}',
  makerworld_url text check (makerworld_url is null or makerworld_url ~* '^https://(www\.)?makerworld\.com(\.cn)?/'),
  autor text check (length(autor) <= 150),
  licenca text check (licenca in ('propria','cc0','cc_by','cc_by_sa','cc_by_nd','cc_by_nc','cc_by_nc_sa','cc_by_nc_nd','sdfl','licenca_comercial','outra')),
  uso_comercial text not null default 'verificar' check (uso_comercial in ('permitido','proibido','verificar')),
  descricao text check (length(descricao) <= 5000),
  tags text[] not null default '{}',
  produto_id uuid references public.produtos(id) on delete set null,
  arquivado boolean not null default false,
  -- versões: todas apontam para o projeto raiz; cópia = mesmo arquivo importado de propósito como outro projeto
  projeto_raiz_id uuid references public.projetos_3d(id) on delete set null,
  versao integer not null default 1 check (versao between 1 and 9999),
  copia_de uuid references public.projetos_3d(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projeto_tem_fonte check (arquivo_path is not null or makerworld_url is not null)
);
create index if not exists projetos_sha_idx on public.projetos_3d(empresa_id, sha256) where sha256 is not null;
create unique index if not exists projetos_mw_uq on public.projetos_3d(empresa_id, lower(makerworld_url)) where makerworld_url is not null;
create index if not exists projetos_empresa_idx on public.projetos_3d(empresa_id, created_at desc);
alter table public.projetos_3d enable row level security;
create policy projetos_ler on public.projetos_3d for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar')
  or private.tem_permissao(empresa_id, 'producao_gerenciar') or private.tem_acesso_suporte(empresa_id));
create policy projetos_inserir on public.projetos_3d for insert with check (private.pode(empresa_id, 'produtos_editar') or private.pode(empresa_id, 'orcamentos_criar') or private.pode(empresa_id, 'producao_gerenciar'));
create policy projetos_alterar on public.projetos_3d for update using (private.pode(empresa_id, 'produtos_editar') or private.pode(empresa_id, 'orcamentos_criar') or private.pode(empresa_id, 'producao_gerenciar'))
  with check (private.pode(empresa_id, 'produtos_editar') or private.pode(empresa_id, 'orcamentos_criar') or private.pode(empresa_id, 'producao_gerenciar'));
create policy projetos_excluir on public.projetos_3d for delete using (private.pode(empresa_id, 'produtos_editar') or private.pode(empresa_id, 'producao_gerenciar'));
create trigger trg_projetos_upd before update on public.projetos_3d for each row execute function public.set_updated_at();
create trigger trg_mesma_empresa before insert or update on public.projetos_3d for each row execute function private.checar_mesma_empresa('produto_id:produtos', 'projeto_raiz_id:projetos_3d', 'copia_de:projetos_3d');
create trigger trg_audemp_projetos after insert or update or delete on public.projetos_3d for each row execute function private.auditar_empresa();

-- licença decide o uso comercial; origem "sincronizado" só pela integração oficial
create or replace function private.projeto_antes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_int boolean := coalesce(current_setting('app.sync_interno', true), '') = '1' or (select auth.uid()) is null;
begin
  if not v_int then
    if tg_op = 'INSERT' then
      if new.origem = 'sincronizado' then raise exception 'Projetos sincronizados só chegam pela integração oficial'; end if;
      new.created_by := (select auth.uid());
    else
      if new.origem is distinct from old.origem or new.sha256 is distinct from old.sha256 or new.arquivo_path is distinct from old.arquivo_path
         or new.created_by is distinct from old.created_by then
        raise exception 'Arquivo e origem do projeto não mudam: importe uma nova versão';
      end if;
    end if;
    if new.origem = 'makerworld' and new.makerworld_url is null then raise exception 'Informe o link do modelo no MakerWorld'; end if;
  end if;
  -- mesmo arquivo na mesma empresa: só como cópia declarada (o usuário escolheu "importar como novo")
  if tg_op = 'INSERT' and new.sha256 is not null then
    perform pg_advisory_xact_lock(hashtext('projeto:' || new.empresa_id::text || new.sha256));
    if new.copia_de is null and exists (select 1 from public.projetos_3d where empresa_id = new.empresa_id and sha256 = new.sha256) then
      raise exception 'Este arquivo já está na biblioteca: reutilize o projeto existente ou importe como cópia';
    end if;
  end if;
  -- nova versão: número sequencial dentro do projeto raiz
  if tg_op = 'INSERT' and new.projeto_raiz_id is not null then
    select coalesce(projeto_raiz_id, id) into new.projeto_raiz_id from public.projetos_3d where id = new.projeto_raiz_id;
    perform pg_advisory_xact_lock(hashtext('versao:' || new.projeto_raiz_id::text));
    new.versao := 1 + coalesce((select max(versao) from public.projetos_3d where id = new.projeto_raiz_id or projeto_raiz_id = new.projeto_raiz_id), 0);
  elsif tg_op = 'INSERT' then new.versao := 1;
  elsif new.versao is distinct from old.versao or new.projeto_raiz_id is distinct from old.projeto_raiz_id or new.copia_de is distinct from old.copia_de then
    if not v_int then raise exception 'Versão do projeto não muda'; end if;
  end if;
  if new.origem = 'upload' and new.licenca is null then new.licenca := 'propria'; end if;
  new.uso_comercial := case
    when new.licenca in ('propria','cc0','cc_by','cc_by_sa','cc_by_nd','licenca_comercial') then 'permitido'
    when new.licenca in ('cc_by_nc','cc_by_nc_sa','cc_by_nc_nd','sdfl') then 'proibido'
    else 'verificar' end;
  return new;
end; $$;
create trigger trg_projeto_antes before insert or update on public.projetos_3d for each row execute function private.projeto_antes();

-- histórico automático
create or replace function private.projeto_historico() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.registrar_evento(new.empresa_id, 'importacao',
      case new.origem when 'makerworld' then 'Referência do MakerWorld: ' when 'sincronizado' then 'Sincronizado: ' else 'Importado: ' end || new.nome,
      jsonb_build_object('projeto_id', new.id, 'origem', new.origem, 'formato', new.formato, 'arquivo', new.arquivo_nome));
  elsif tg_op = 'DELETE' then
    perform private.registrar_evento(old.empresa_id, 'exclusao', 'Projeto excluído: ' || old.nome, jsonb_build_object('projeto_id', old.id));
  elsif (to_jsonb(new) - array['updated_at']) <> (to_jsonb(old) - array['updated_at']) then
    perform private.registrar_evento(new.empresa_id, 'atualizacao', 'Projeto atualizado: ' || new.nome, jsonb_build_object('projeto_id', new.id));
  end if;
  return null;
end; $$;
create trigger trg_projeto_historico after insert or update or delete on public.projetos_3d for each row execute function private.projeto_historico();

-- vínculos com produtos, orçamentos, pedidos e ordens de produção
create table if not exists public.projeto_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  projeto_id uuid not null references public.projetos_3d(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete cascade,
  orcamento_id uuid references public.orcamentos(id) on delete cascade,
  pedido_id uuid references public.pedidos(id) on delete cascade,
  ordem_id uuid references public.ordens_producao(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vinculo_um_alvo check (num_nonnulls(produto_id, orcamento_id, pedido_id, ordem_id) = 1)
);
create unique index if not exists vinc_uq on public.projeto_vinculos(projeto_id, coalesce(produto_id, orcamento_id, pedido_id, ordem_id));
create index if not exists vinc_projeto_idx on public.projeto_vinculos(projeto_id);
alter table public.projeto_vinculos enable row level security;
create policy vinc_ler on public.projeto_vinculos for select using (private.tem_permissao(empresa_id, 'produtos_ver') or private.tem_permissao(empresa_id, 'orcamentos_criar') or private.tem_permissao(empresa_id, 'producao_gerenciar'));
create policy vinc_excluir on public.projeto_vinculos for delete using (private.pode(empresa_id, 'produtos_editar') or private.pode(empresa_id, 'orcamentos_criar') or private.pode(empresa_id, 'producao_gerenciar'));
create trigger trg_mesma_empresa before insert or update on public.projeto_vinculos for each row execute function private.checar_mesma_empresa(
  'projeto_id:projetos_3d', 'produto_id:produtos', 'orcamento_id:orcamentos', 'pedido_id:pedidos', 'ordem_id:ordens_producao');

create or replace function private.projeto_carregar(p_projeto uuid, p_uso_comercial boolean) returns public.projetos_3d
language plpgsql security definer set search_path = '' as $$
declare p public.projetos_3d;
begin
  select * into p from public.projetos_3d where id = p_projeto;
  if p.id is null or not (private.tem_permissao(p.empresa_id, 'produtos_ver') or private.tem_permissao(p.empresa_id, 'orcamentos_criar') or private.tem_permissao(p.empresa_id, 'producao_gerenciar')) then
    raise exception 'Projeto não encontrado';
  end if;
  if p_uso_comercial and p.uso_comercial = 'proibido' then
    raise exception 'A licença deste modelo (%) não permite uso comercial. Compre uma licença comercial do autor e atualize a licença do projeto.', p.licenca;
  end if;
  return p;
end; $$;

-- vincula a um cadastro existente
create or replace function public.projeto_vincular(p_projeto uuid, p_tipo text, p_ref uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.projetos_3d;
begin
  p := private.projeto_carregar(p_projeto, p_tipo <> 'ordem');
  if p_tipo = 'produto' then
    if not private.pode(p.empresa_id, 'produtos_editar') then raise exception 'Sem permissão para editar produtos'; end if;
    update public.projetos_3d set produto_id = p_ref where id = p.id;
    insert into public.projeto_vinculos(empresa_id, projeto_id, produto_id) values (p.empresa_id, p.id, p_ref) on conflict do nothing;
  elsif p_tipo = 'orcamento' then
    if not private.pode(p.empresa_id, 'orcamentos_criar') then raise exception 'Sem permissão para orçamentos'; end if;
    insert into public.projeto_vinculos(empresa_id, projeto_id, orcamento_id) values (p.empresa_id, p.id, p_ref) on conflict do nothing;
  elsif p_tipo = 'pedido' then
    if not private.pode(p.empresa_id, 'pedidos_editar') then raise exception 'Sem permissão para pedidos'; end if;
    insert into public.projeto_vinculos(empresa_id, projeto_id, pedido_id) values (p.empresa_id, p.id, p_ref) on conflict do nothing;
  elsif p_tipo = 'ordem' then
    if not private.pode(p.empresa_id, 'producao_gerenciar') then raise exception 'Sem permissão para produção'; end if;
    insert into public.projeto_vinculos(empresa_id, projeto_id, ordem_id) values (p.empresa_id, p.id, p_ref) on conflict do nothing;
  else raise exception 'Tipo inválido'; end if;
  perform private.registrar_evento(p.empresa_id, 'vinculo', 'Projeto ' || p.nome || ' vinculado (' || p_tipo || ')', jsonb_build_object('projeto_id', p.id, 'tipo', p_tipo, 'ref', p_ref));
end; $$;

-- reutiliza o projeto num novo orçamento
create or replace function public.projeto_criar_orcamento(p_projeto uuid, p_cliente uuid, p_quantidade numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.projetos_3d; v_orc uuid; pr public.produtos;
begin
  p := private.projeto_carregar(p_projeto, true);
  if not private.pode(p.empresa_id, 'orcamentos_criar') then raise exception 'Sem permissão para criar orçamentos'; end if;
  if coalesce(p_quantidade, 1) <= 0 then raise exception 'Quantidade inválida'; end if;
  if p_cliente is not null and not exists (select 1 from public.clientes where id = p_cliente and empresa_id = p.empresa_id) then raise exception 'Cliente não encontrado'; end if;
  select * into pr from public.produtos where id = p.produto_id;
  insert into public.orcamentos(empresa_id, cliente_id, titulo, descricao) values (p.empresa_id, p_cliente, left(p.nome, 200), left(p.descricao, 5000)) returning id into v_orc;
  insert into public.orcamento_itens(empresa_id, orcamento_id, descricao, produto_id, material_id, impressora_id, cor, quantidade, peso_g, tempo_h, arquivo_path, arquivo_nome, volume_cm3)
  values (p.empresa_id, v_orc, left(p.nome, 300), pr.id, pr.material_id, pr.impressora_id, coalesce(pr.cor, p.cores[1]), coalesce(p_quantidade, 1),
          coalesce(p.peso_g, pr.peso_g, 0), coalesce(round(p.tempo_estimado_min / 60, 2), pr.tempo_h, 0), p.arquivo_path, p.arquivo_nome, p.volume_cm3);
  insert into public.projeto_vinculos(empresa_id, projeto_id, orcamento_id) values (p.empresa_id, p.id, v_orc);
  perform private.registrar_evento(p.empresa_id, 'vinculo', 'Orçamento criado a partir de ' || p.nome, jsonb_build_object('projeto_id', p.id, 'orcamento_id', v_orc));
  return v_orc;
end; $$;

-- reutiliza o projeto numa nova ordem de produção
create or replace function public.projeto_criar_ordem(p_projeto uuid, p_quantidade numeric, p_pedido uuid, p_impressora uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.projetos_3d; v_op uuid; pr public.produtos; q numeric := coalesce(p_quantidade, 1);
begin
  p := private.projeto_carregar(p_projeto, true);
  if not private.pode(p.empresa_id, 'producao_gerenciar') then raise exception 'Sem permissão para criar ordens de produção'; end if;
  if q <= 0 then raise exception 'Quantidade inválida'; end if;
  select * into pr from public.produtos where id = p.produto_id;
  insert into public.ordens_producao(empresa_id, pedido_id, produto_id, descricao, quantidade, impressora_id, material_id, cor, arquivo_path, peso_previsto_g, tempo_previsto_h)
  values (p.empresa_id, p_pedido, pr.id, left(p.nome, 300), q, coalesce(p_impressora, pr.impressora_id), pr.material_id, coalesce(pr.cor, p.cores[1]), p.arquivo_path,
          coalesce(p.peso_g, pr.peso_g, 0) * q, coalesce(round(p.tempo_estimado_min / 60, 2), pr.tempo_h, 0) * q)
  returning id into v_op;
  insert into public.projeto_vinculos(empresa_id, projeto_id, ordem_id) values (p.empresa_id, p.id, v_op);
  perform private.registrar_evento(p.empresa_id, 'vinculo', 'Ordem de produção criada a partir de ' || p.nome, jsonb_build_object('projeto_id', p.id, 'ordem_id', v_op));
  return v_op;
end; $$;

-- ---------- Impressoras: identificação Bambu e telemetria ---------------
alter table public.impressoras
  add column if not exists bambu_serial text check (bambu_serial is null or bambu_serial ~ '^[A-Za-z0-9]{6,32}$'),
  add column if not exists bambu_modelo text check (length(bambu_modelo) <= 60);
create unique index if not exists impressoras_serial_uq on public.impressoras(empresa_id, upper(bambu_serial)) where bambu_serial is not null;
-- telemetria em tabela própria (não mexe na impressora, não enche a auditoria); só a integração escreve
create table if not exists public.impressora_telemetria (
  impressora_id uuid primary key references public.impressoras(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dados jsonb not null,
  fonte text not null check (fonte in ('agente_lan','nuvem')),
  atualizado_em timestamptz not null default now()
);
alter table public.impressora_telemetria enable row level security;
create policy telemetria_ler on public.impressora_telemetria for select using (private.tem_permissao(empresa_id, 'impressoras_ver'));
-- trocar o número de série descarta a telemetria antiga
create or replace function private.serial_mudou() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.bambu_serial is distinct from old.bambu_serial then delete from public.impressora_telemetria where impressora_id = new.id; end if;
  return null;
end; $$;
drop trigger if exists trg_impressoras_serial on public.impressoras;
create trigger trg_impressoras_serial after update of bambu_serial on public.impressoras for each row execute function private.serial_mudou();

-- ---------- Agente local opcional (rede da loja, somente leitura) ------
create table if not exists public.agentes_locais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 80),
  token_hash text not null unique,
  token_prefixo text not null,
  ativo boolean not null default true,
  versao text check (length(versao) <= 30),
  ultimo_contato timestamptz,
  impressoras_detectadas jsonb not null default '[]',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  revogado_em timestamptz
);
alter table public.agentes_locais enable row level security;
create policy agentes_ler on public.agentes_locais for select using (private.tem_permissao(empresa_id, 'integracoes_config') or private.tem_acesso_suporte(empresa_id));
-- token_hash não é segredo útil (sha-256), mas também não precisa ir para a tela
revoke all on public.agentes_locais from authenticated, anon;
grant select (id, empresa_id, nome, token_prefixo, ativo, versao, ultimo_contato, impressoras_detectadas, created_by, created_at, revogado_em) on public.agentes_locais to authenticated;

create or replace function public.criar_agente(p_empresa uuid, p_nome text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := 'mrv3d_ag_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração configura integrações'; end if;
  if (select count(*) from public.agentes_locais where empresa_id = p_empresa and ativo) >= 5 then raise exception 'Limite de 5 agentes ativos: revogue um antes'; end if;
  insert into public.agentes_locais(empresa_id, nome, token_hash, token_prefixo)
  values (p_empresa, left(trim(p_nome), 80), encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 14));
  insert into public.integracoes(empresa_id, provedor, modo, status) values (p_empresa, 'bambu_lab', 'agente_lan', 'nao_configurada')
  on conflict (empresa_id, provedor) do update set modo = case when public.integracoes.modo = 'nuvem' then 'nuvem' else 'agente_lan' end, updated_at = now();
  perform private.registrar_evento(p_empresa, 'conexao', 'Agente local criado: ' || trim(p_nome), null);
  return v_token; -- mostrado uma única vez
end; $$;

create or replace function public.revogar_agente(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locais;
begin
  select * into a from public.agentes_locais where id = p_id for update;
  if a.id is null or not private.pode(a.empresa_id, 'integracoes_config') then raise exception 'Agente não encontrado'; end if;
  update public.agentes_locais set ativo = false, revogado_em = now() where id = a.id;
  perform private.registrar_evento(a.empresa_id, 'desconexao', 'Agente local revogado: ' || a.nome, null);
end; $$;

-- o agente envia o estado das impressoras (nunca recebe comandos)
create or replace function public.agente_reportar(p_token text, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.agentes_locais; i jsonb; v_serial text; v_tel jsonb; v_det jsonb := '[]'::jsonb; v_n int := 0; v_id uuid;
  num_ok constant text := '^-?[0-9]{1,6}(\.[0-9]{1,3})?$';
begin
  if p_token is null or p_token !~ '^mrv3d_ag_[0-9a-f]{64}$' then raise exception 'Token inválido'; end if;
  select * into a from public.agentes_locais where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if a.id is null or not a.ativo then raise exception 'Token inválido ou revogado'; end if;
  if not exists (select 1 from public.empresas where id = a.empresa_id and status not in ('suspensa','cancelada')) then raise exception 'Empresa indisponível'; end if;
  if jsonb_typeof(p_dados->'impressoras') is distinct from 'array' or jsonb_array_length(p_dados->'impressoras') > 50 or length(p_dados::text) > 200000 then raise exception 'Dados inválidos'; end if;
  -- no máximo um envio a cada 5 segundos
  if a.ultimo_contato > now() - interval '5 seconds' then return jsonb_build_object('ok', true, 'ignorado', true); end if;
  if a.ultimo_contato is null or a.ultimo_contato < now() - interval '10 minutes' then
    perform private.registrar_evento(a.empresa_id, 'agente', 'Agente ' || a.nome || ' conectado', jsonb_build_object('versao', left(p_dados->>'versao', 30)));
  end if;
  for i in select * from jsonb_array_elements(p_dados->'impressoras') loop
    v_serial := upper(left(i->>'serial', 32));
    if v_serial is null or v_serial !~ '^[A-Z0-9]{6,32}$' then continue; end if;
    -- só campos conhecidos, com tipo conferido (nada do agente é executado ou exibido como HTML)
    select coalesce(jsonb_object_agg(k, case when k in ('estado','arquivo','material','cor','erro','etapa') then to_jsonb(left(i->>k, 120)) else i->k end), '{}'::jsonb) into v_tel
      from unnest(array['online','estado','etapa','progresso','camada','total_camadas','restante_min','temp_bico','temp_bico_alvo','temp_mesa','temp_mesa_alvo','temp_camara',
                        'arquivo','material','cor','erro','ams']) k
     where i ? k and (
       (k in ('estado','arquivo','material','cor','erro','etapa') and jsonb_typeof(i->k) = 'string')
       or (k = 'online' and jsonb_typeof(i->k) = 'boolean')
       or (k = 'ams' and jsonb_typeof(i->k) = 'array' and jsonb_array_length(i->k) <= 16 and length((i->k)::text) <= 4000)
       or (k not in ('estado','arquivo','material','cor','erro','etapa','online','ams') and jsonb_typeof(i->k) = 'number' and (i->>k) ~ num_ok));
    select id into v_id from public.impressoras where empresa_id = a.empresa_id and upper(bambu_serial) = v_serial;
    if v_id is not null then
      insert into public.impressora_telemetria(impressora_id, empresa_id, dados, fonte, atualizado_em) values (v_id, a.empresa_id, v_tel, 'agente_lan', now())
      on conflict (impressora_id) do update set dados = excluded.dados, fonte = excluded.fonte, atualizado_em = now();
    end if;
    if v_id is null then
      v_det := v_det || jsonb_build_array(jsonb_build_object('serial', v_serial, 'nome', left(i->>'nome', 80), 'modelo', left(i->>'modelo', 60)));
    else v_n := v_n + 1; end if;
    v_id := null;
  end loop;
  update public.agentes_locais set ultimo_contato = now(), versao = left(p_dados->>'versao', 30), impressoras_detectadas = v_det where id = a.id;
  update public.integracoes set status = 'conectada', ultima_sincronizacao = now(), ultimo_erro = null, updated_at = now()
   where empresa_id = a.empresa_id and provedor = 'bambu_lab' and modo = 'agente_lan';
  return jsonb_build_object('ok', true, 'atualizadas', v_n, 'nao_vinculadas', jsonb_array_length(v_det));
end; $$;

-- desconectar: apaga credenciais, revoga agentes e limpa a telemetria
create or replace function public.desconectar_integracao(p_empresa uuid, p_provedor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração configura integrações'; end if;
  if p_provedor <> 'bambu_lab' then raise exception 'Integração desconhecida'; end if;
  delete from private.integracao_credenciais where empresa_id = p_empresa and provedor = p_provedor;
  update public.agentes_locais set ativo = false, revogado_em = coalesce(revogado_em, now()) where empresa_id = p_empresa and ativo;
  delete from public.impressora_telemetria where empresa_id = p_empresa;
  insert into public.integracoes(empresa_id, provedor, status, modo) values (p_empresa, p_provedor, 'desconectada', 'manual')
  on conflict (empresa_id, provedor) do update set status = 'desconectada', modo = 'manual', conta_rotulo = null, ultimo_erro = null, updated_at = now();
  perform private.registrar_evento(p_empresa, 'desconexao', 'Integração desconectada e credenciais excluídas', null);
end; $$;

create or replace function public.salvar_config_integracao(p_empresa uuid, p_config jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.pode(p_empresa, 'integracoes_config') then raise exception 'Só a administração configura integrações'; end if;
  -- só opções conhecidas
  select coalesce(jsonb_object_agg(k, p_config->k), '{}'::jsonb) into v from unnest(array['mostrar_telemetria','telemetria_validade_min','material_padrao_id','alertar_licenca']) k
   where p_config ? k and jsonb_typeof(p_config->k) in ('boolean','number','string') and length(p_config->>k) <= 60;
  insert into public.integracoes(empresa_id, provedor, config) values (p_empresa, 'bambu_lab', v)
  on conflict (empresa_id, provedor) do update set config = v, updated_at = now();
end; $$;

-- ---------- Arquivos: pasta de projetos ---------------------------------
create or replace function private.pode_enviar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or not private.is_membro(v_emp) then return false; end if;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then return false; end if;
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','gcode','png','jpg','jpeg','webp','pdf') then return false; end if;
  if split_part(p_nome, '/', 2) not in ('logo','produtos','orcamentos','impressoras','clientes','producao','financeiro','pedidos','compras','manutencao','expedicao','projetos') then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%' and name not like v_emp::text || '/portal/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

revoke all on function public.registrar_evento_importacao(uuid, text, text), public.projeto_vincular(uuid, text, uuid), public.projeto_criar_orcamento(uuid, uuid, numeric),
  public.projeto_criar_ordem(uuid, numeric, uuid, uuid), public.criar_agente(uuid, text), public.revogar_agente(uuid), public.agente_reportar(text, jsonb),
  public.desconectar_integracao(uuid, text), public.salvar_config_integracao(uuid, jsonb) from public, anon;
grant execute on function public.registrar_evento_importacao(uuid, text, text), public.projeto_vincular(uuid, text, uuid), public.projeto_criar_orcamento(uuid, uuid, numeric),
  public.projeto_criar_ordem(uuid, numeric, uuid, uuid), public.criar_agente(uuid, text), public.revogar_agente(uuid),
  public.desconectar_integracao(uuid, text), public.salvar_config_integracao(uuid, jsonb) to authenticated;
-- o agente local usa a chave pública (anon) + o token próprio
grant execute on function public.agente_reportar(text, jsonb) to anon, authenticated;

-- =====================================================================
-- Orçamento automático a partir do Bambu Studio
-- =====================================================================
alter table public.empresa_config add column if not exists horas_produtivas_mes numeric(8,1) not null default 0 check (horas_produtivas_mes >= 0 and horas_produtivas_mes <= 744);
alter table public.orcamento_itens
  add column if not exists filamentos_extras jsonb not null default '[]',
  add column if not exists custo_fixo numeric(12,4) not null default 0,
  add column if not exists projeto_id uuid references public.projetos_3d(id) on delete set null,
  add column if not exists placa integer check (placa between 1 and 999),
  add column if not exists pecas_por_impressao integer check (pecas_por_impressao between 1 and 10000);
drop trigger if exists trg_mesma_empresa on public.orcamento_itens;
create trigger trg_mesma_empresa before insert or update on public.orcamento_itens for each row execute function private.checar_mesma_empresa('projeto_id:projetos_3d');

create or replace function private.calcular_item_orcamento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; c public.empresa_config; m public.materiais; i public.impressoras; cli public.clientes; pr public.produtos;
        v_margem numeric; v_imp numeric; v_tax numeric; v_desp numeric; v_den numeric; v_margem_padrao numeric; v_den_padrao numeric;
        v_extras jsonb := '[]'::jsonb; v_extra_g_custo numeric := 0; e jsonb; mx public.materiais; v_pk numeric; v_fixo_h numeric := 0;
begin
  if tg_op = 'UPDATE' and (new.orcamento_id <> old.orcamento_id or new.empresa_id <> old.empresa_id) then
    raise exception 'Um item não pode mudar de orçamento';
  end if;
  select * into o from public.orcamentos where id = coalesce(new.orcamento_id, old.orcamento_id);
  if o.status in ('aprovado','convertido','cancelado') and coalesce(current_setting('app.orcamento_rpc', true), '') <> '1' then
    raise exception 'Orçamento %: os itens não podem mais ser alterados. Duplique para criar um novo.', o.status;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.empresa_id <> o.empresa_id then raise exception 'Item de outra empresa'; end if;
  if new.variante_id is not null and not exists (select 1 from public.produto_variantes where id = new.variante_id and empresa_id = new.empresa_id) then
    raise exception 'Variação não encontrada';
  end if;

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
  v_margem_padrao := coalesce(cli.margem_pct, pr.margem_pct, m.margem_pct, c.margem_pct, 0);
  v_margem := coalesce(new.margem_pct, v_margem_padrao);
  v_imp := coalesce(new.impostos_pct, c.impostos_pct, 0);
  v_tax := coalesce(new.taxas_pct, c.taxas_pct, 0);
  v_desp := coalesce(new.desperdicio_pct, c.desperdicio_pct, 0);
  new.margem_efetiva := v_margem; new.impostos_efetivo := v_imp; new.taxas_efetiva := v_tax; new.desperdicio_efetivo := v_desp;
  v_den := 1 - (v_margem + v_imp + v_tax) / 100;
  if v_den <= 0 then raise exception 'A soma de margem, impostos e taxas precisa ser menor que 100%%'; end if;

  -- outros filamentos do mesmo item (peças multicoloridas/multimaterial): cada um com o próprio preço/kg, congelado no item
  if jsonb_typeof(coalesce(new.filamentos_extras, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.filamentos_extras, '[]'::jsonb)) > 16 then
    raise exception 'Filamentos adicionais inválidos';
  end if;
  for e in select * from jsonb_array_elements(coalesce(new.filamentos_extras, '[]'::jsonb)) loop
    if coalesce((e->>'peso_g')::numeric, -1) < 0 or (e->>'peso_g')::numeric > 1000000 then raise exception 'Peso de filamento inválido'; end if;
    v_pk := 0; mx := null;
    if nullif(e->>'material_id', '') is not null then
      select * into mx from public.materiais where id = (e->>'material_id')::uuid and empresa_id = new.empresa_id;
      if mx.id is null then raise exception 'Matéria-prima não encontrada'; end if;
      v_pk := private.preco_kg(mx.custo_medio, mx.unidade, mx.peso_liquido_g);
    end if;
    v_extras := v_extras || jsonb_build_array(jsonb_build_object('material_id', mx.id, 'nome', coalesce(mx.nome || coalesce(' · ' || mx.cor, ''), left(e->>'nome', 80)),
                  'peso_g', (e->>'peso_g')::numeric, 'preco_kg', v_pk));
    v_extra_g_custo := v_extra_g_custo + (e->>'peso_g')::numeric / 1000 * v_pk;
  end loop;
  new.filamentos_extras := v_extras;
  -- Custo de material = (peso/1000) × preço/kg × (1 + perdas), somando os filamentos adicionais
  new.custo_material := round((new.peso_g / 1000 * new.preco_kg + v_extra_g_custo) * (1 + v_desp / 100), 4);
  -- custos fixos rateados pelas horas produtivas do mês (opcional na configuração)
  if coalesce(c.horas_produtivas_mes, 0) > 0 then v_fixo_h := coalesce(c.custos_fixos_mensais, 0) / c.horas_produtivas_mes; end if;
  new.custo_fixo := round(new.tempo_h * v_fixo_h, 4);
  -- Custo de energia = kW × horas × tarifa
  new.custo_energia := round(new.potencia_w / 1000 * new.tempo_h * new.energia_kwh, 4);
  -- Custo de máquina = horas × custo/hora (depreciação + manutenção)
  new.custo_maquina := round(new.tempo_h * new.custo_hora_maquina, 4);
  new.custo_mao_obra := round(new.mao_obra_h * new.mao_obra_hora, 4);
  -- Custo total (unitário)
  -- custo de fabricação direto + reserva para falhas (um método só) + frete pago pela loja
  new.custo_falha := round(case coalesce(c.falha_metodo, 'nenhum')
      when 'percentual' then (new.custo_material + new.custo_energia + new.custo_maquina + new.custo_mao_obra + new.suportes_custo + new.acabamento_custo
                              + new.pintura_custo + new.embalagem_custo + new.outros_custos) * coalesce(c.falha_pct, 0) / 100
      -- custo médio esperado com tentativas independentes: custo por tentativa / probabilidade de sucesso (só a parte da impressão)
      when 'sucesso' then (new.custo_material + new.custo_energia + new.custo_maquina) * (100 / greatest(coalesce(c.taxa_sucesso_pct, 100), 1) - 1)
      else 0 end, 4);
  new.versao_calculo := 2;
  new.custo_unitario := round(new.custo_material + new.custo_energia + new.custo_maquina + new.custo_mao_obra
                        + new.suportes_custo + new.acabamento_custo + new.pintura_custo + new.embalagem_custo
                        + new.outros_custos + new.custo_falha + new.frete_assumido, 4);
  if new.desconto_terceiros > new.custo_unitario then raise exception 'Desconto de terceiros maior que o custo do item'; end if;
  -- Preço = (custo − descontos de terceiros) / (1 − margem − impostos − taxas)
  -- o preço recupera também a parte dos custos fixos (que não entra no custo variável do pedido)
  new.preco_unitario := coalesce(new.preco_manual, round((new.custo_unitario + new.custo_fixo - new.desconto_terceiros) / v_den, 2));
  -- preço de tabela: mesmas entradas, mas com os percentuais e perdas padrão e sem descontos/preço manual
  v_den_padrao := 1 - (v_margem_padrao + coalesce(c.impostos_pct, 0) + coalesce(c.taxas_pct, 0)) / 100;
  new.preco_tabela := round((new.custo_unitario + new.custo_fixo - new.custo_material + (new.peso_g / 1000 * new.preco_kg + v_extra_g_custo) * (1 + coalesce(c.desperdicio_pct, 0) / 100)) / greatest(v_den_padrao, 0.01), 2);
  -- vender abaixo da tabela (margem/impostos/taxas/perdas menores, desconto de terceiros ou preço manual) exige permissão
  if new.preco_unitario < new.preco_tabela - 0.005 and (select auth.uid()) is not null
     and (tg_op = 'INSERT' or new.preco_manual is distinct from old.preco_manual or new.margem_pct is distinct from old.margem_pct
          or new.impostos_pct is distinct from old.impostos_pct or new.taxas_pct is distinct from old.taxas_pct
          or new.desperdicio_pct is distinct from old.desperdicio_pct or new.desconto_terceiros is distinct from old.desconto_terceiros)
     and not private.tem_permissao(new.empresa_id, 'descontos_aprovar') then
    raise exception 'Preço de % abaixo do calculado (%) precisa de quem pode aprovar descontos', new.preco_unitario, new.preco_tabela;
  end if;
  new.preco_total := round(new.preco_unitario * new.quantidade, 2);
  new.custo_total := round((new.custo_unitario - new.desconto_terceiros) * new.quantidade, 2);
  new.impostos_valor := round(new.preco_total * v_imp / 100, 2);
  new.taxas_valor := round(new.preco_total * v_tax / 100, 2);
  new.lucro := new.preco_total - new.custo_total - new.impostos_valor - new.taxas_valor;
  return new;
end; $$;

-- duplicar leva também filamentos adicionais, projeto e placa (com os preços atuais)
create or replace function public.duplicar_orcamento(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos; v_id uuid;
begin
  select * into o from public.orcamentos where id = p_id;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  insert into public.orcamentos(empresa_id, cliente_id, oportunidade_id, titulo, descricao, prazo_entrega_dias, frete_cobrado, observacoes, condicoes)
  values (o.empresa_id, o.cliente_id, null, left(o.titulo || ' (cópia)', 200), o.descricao, o.prazo_entrega_dias, o.frete_cobrado, o.observacoes, o.condicoes)
  returning id into v_id;
  insert into public.orcamento_itens(empresa_id, orcamento_id, ordem, produto_id, variante_id, descricao, tecnologia, impressora_id, material_id, cor, quantidade,
      peso_g, tempo_h, desperdicio_pct, suportes_custo, mao_obra_h, acabamento_custo, pintura_custo, embalagem_custo, frete_assumido, outros_custos,
      desconto_terceiros, margem_pct, impostos_pct, taxas_pct, preco_manual, arquivo_path, arquivo_nome, volume_cm3, filamentos_extras, projeto_id, placa, pecas_por_impressao)
  select empresa_id, v_id, ordem, produto_id, variante_id, descricao, tecnologia, impressora_id, material_id, cor, quantidade,
      peso_g, tempo_h, desperdicio_pct, suportes_custo, mao_obra_h, acabamento_custo, pintura_custo, embalagem_custo, frete_assumido, outros_custos,
      desconto_terceiros, margem_pct, impostos_pct, taxas_pct, preco_manual, arquivo_path, arquivo_nome, volume_cm3,
      (select coalesce(jsonb_agg(jsonb_build_object('material_id', x->>'material_id', 'nome', x->>'nome', 'peso_g', x->'peso_g')), '[]'::jsonb) from jsonb_array_elements(filamentos_extras) x),
      projeto_id, placa, pecas_por_impressao
    from public.orcamento_itens where orcamento_id = o.id order by ordem;
  insert into public.projeto_vinculos(empresa_id, projeto_id, orcamento_id)
  select distinct o.empresa_id, projeto_id, v_id from public.orcamento_itens where orcamento_id = v_id and projeto_id is not null on conflict do nothing;
  return v_id;
end; $$;

-- vínculo automático quando um item de orçamento usa um projeto da biblioteca
create or replace function private.item_vincular_projeto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.projeto_id is not null and (tg_op = 'INSERT' or new.projeto_id is distinct from old.projeto_id) then
    insert into public.projeto_vinculos(empresa_id, projeto_id, orcamento_id) values (new.empresa_id, new.projeto_id, new.orcamento_id) on conflict do nothing;
  end if;
  return null;
end; $$;
drop trigger if exists trg_item_projeto on public.orcamento_itens;
create trigger trg_item_projeto after insert or update of projeto_id on public.orcamento_itens for each row execute function private.item_vincular_projeto();


-- =====================================================================
-- Complementos do MVP: custo da máquina, reserva para falhas, visualização e compartilhamento
-- =====================================================================
-- custo/hora técnico = (aquisição − residual) / vida útil + manutenção + custo operacional adicional (energia é calculada à parte)
alter table public.impressoras
  add column if not exists valor_residual numeric(12,2) not null default 0 check (valor_residual >= 0),
  add column if not exists custo_operacional_hora numeric(10,4) not null default 0 check (custo_operacional_hora >= 0);
do $$ begin
  alter table public.impressoras add constraint residual_menor_aquisicao check (valor_residual <= custo_aquisicao);
exception when duplicate_object then null; end $$;
alter table public.impressoras drop column if exists custo_hora;
alter table public.impressoras add column custo_hora numeric(10,4)
  generated always as (round((custo_aquisicao - valor_residual) / vida_util_horas + custo_manutencao_hora + custo_operacional_hora, 4)) stored;

-- reserva para falhas: percentual sobre o custo de fabricação OU custo esperado pela taxa de sucesso (nunca os dois)
alter table public.empresa_config
  add column if not exists falha_metodo text not null default 'nenhum' check (falha_metodo in ('nenhum','percentual','sucesso')),
  add column if not exists falha_pct numeric(5,2) not null default 0 check (falha_pct >= 0 and falha_pct <= 100),
  add column if not exists taxa_sucesso_pct numeric(5,2) not null default 100 check (taxa_sucesso_pct > 0 and taxa_sucesso_pct <= 100);
alter table public.orcamento_itens
  add column if not exists custo_falha numeric(12,4) not null default 0,
  add column if not exists versao_calculo integer not null default 2;

-- o comprador abriu o link do orçamento
alter table public.orcamentos add column if not exists visualizado_em timestamptz;
create or replace function public.orcamento_visualizado(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos;
begin
  if p_token is null or length(p_token) < 32 then return; end if;
  select * into o from public.orcamentos where token_publico = p_token for update;
  if o.id is null or o.status <> 'enviado' or o.visualizado_em is not null then return; end if;
  perform set_config('app.orcamento_rpc', '1', true);
  update public.orcamentos set visualizado_em = now() where id = o.id;
  perform set_config('app.orcamento_rpc', '0', true);
  insert into public.orcamento_revisoes(empresa_id, orcamento_id, revisao, evento, dados) values (o.empresa_id, o.id, o.revisao, 'visualizado', '{}'::jsonb);
end; $$;
-- quem não é da plataforma não marca visualização direto
create or replace function private.proteger_visualizado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.visualizado_em is distinct from old.visualizado_em and coalesce(current_setting('app.orcamento_rpc', true), '') <> '1' and (select auth.uid()) is not null then
    raise exception 'A visualização é registrada pelo link do comprador';
  end if;
  return new;
end; $$;
drop trigger if exists trg_orc_visualizado on public.orcamentos;
create trigger trg_orc_visualizado before update on public.orcamentos for each row execute function private.proteger_visualizado();

-- intenção de compartilhar (não significa que a mensagem foi entregue)
create or replace function public.registrar_compartilhamento(p_orcamento uuid, p_canal text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orcamentos;
begin
  select * into o from public.orcamentos where id = p_orcamento;
  if o.id is null or not private.pode(o.empresa_id, 'orcamentos_criar') then raise exception 'Orçamento não encontrado'; end if;
  if p_canal not in ('whatsapp','link','pdf') then raise exception 'Canal inválido'; end if;
  if exists (select 1 from public.orcamento_revisoes where orcamento_id = o.id and evento = 'compartilhado_' || p_canal and created_at > now() - interval '1 minute') then return; end if;
  insert into public.orcamento_revisoes(empresa_id, orcamento_id, revisao, evento, dados) values (o.empresa_id, o.id, o.revisao, 'compartilhado_' || p_canal, jsonb_build_object('total', o.total));
end; $$;

-- métricas agregadas para o Super Admin (sem dados de clientes, projetos ou finanças das empresas)
create or replace function public.admin_uso_empresas()
returns table(empresa_id uuid, nome text, status public.status_empresa, usuarios bigint, impressoras bigint, projetos bigint, orcamentos_30d bigint, armazenamento_mb numeric, erros_integracao_7d bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin_plataforma() then raise exception 'Acesso restrito à plataforma'; end if;
  return query
  select e.id, e.nome, e.status,
    (select count(*) from public.membros m where m.empresa_id = e.id and m.ativo),
    (select count(*) from public.impressoras i where i.empresa_id = e.id and i.status <> 'inativa'),
    (select count(*) from public.projetos_3d p where p.empresa_id = e.id),
    (select count(*) from public.orcamentos o where o.empresa_id = e.id and o.created_at > now() - interval '30 days'),
    round(coalesce((select sum((s.metadata->>'size')::numeric) from storage.objects s where s.bucket_id = 'empresa' and s.name like e.id::text || '/%'), 0) / 1048576, 1),
    (select count(*) from public.integracao_eventos v where v.empresa_id = e.id and v.tipo = 'erro' and v.created_at > now() - interval '7 days')
  from public.empresas e order by e.nome;
end; $$;

revoke all on function public.orcamento_visualizado(text), public.registrar_compartilhamento(uuid, text), public.admin_uso_empresas() from public, anon;
grant execute on function public.orcamento_visualizado(text) to anon, authenticated;
grant execute on function public.registrar_compartilhamento(uuid, text), public.admin_uso_empresas() to authenticated;
