-- Modelos 3D chegam zipados (MakerWorld, Printables, clientes): .zip passa a ser aceito nos anexos da equipe e no portal do comprador.
-- (limites de tamanho, espaço e quantidade continuam os mesmos)

create or replace function private.pode_enviar_arquivo(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_lim numeric; v_uso numeric;
begin
  if v_emp is null or not private.is_membro(v_emp) then return false; end if;
  if not exists (select 1 from public.empresas where id = v_emp and status not in ('suspensa','cancelada')) then return false; end if;
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','gcode','zip','png','jpg','jpeg','webp','pdf') then return false; end if;
  if split_part(p_nome, '/', 2) not in ('logo','produtos','orcamentos','impressoras','clientes','producao','financeiro','pedidos','compras','manutencao','expedicao','projetos') then return false; end if;
  v_lim := (private.plano_empresa(v_emp)).armazenamento_mb;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/%' and name not like v_emp::text || '/portal/%';
  return v_lim is null or v_uso < v_lim;
end; $$;

create or replace function private.pode_enviar_portal(p_nome text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_emp uuid := private.uuid_ou_nulo(split_part(p_nome, '/', 1)); v_uso numeric;
begin
  if v_emp is null or split_part(p_nome, '/', 2) <> 'portal' or private.uuid_ou_nulo(split_part(p_nome, '/', 3)) is null
     or split_part(p_nome, '/', 4) = '' or split_part(p_nome, '/', 5) <> '' then return false; end if;
  if lower(reverse(split_part(reverse(p_nome), '.', 1))) not in ('stl','3mf','obj','step','stp','zip') then return false; end if;
  if not exists (select 1 from public.portal_config pc join public.empresas e on e.id = pc.empresa_id
                  where pc.empresa_id = v_emp and pc.ativo and pc.aceitar_arquivos and e.status not in ('suspensa','cancelada')) then return false; end if;
  -- envios anônimos: 60 por hora e um espaço próprio de 2 GB (não consome o espaço da equipe)
  perform pg_advisory_xact_lock(hashtext('portal-up:' || v_emp::text));
  if (select count(*) from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/portal/%' and created_at > now() - interval '1 hour') >= 60 then return false; end if;
  select coalesce(sum((metadata->>'size')::numeric), 0) / 1048576 into v_uso from storage.objects where bucket_id = 'empresa' and name like v_emp::text || '/portal/%';
  return v_uso < 2048;
end; $$;
