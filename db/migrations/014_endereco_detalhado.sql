-- Endereço com número, complemento e bairro em campos próprios (o CEP preenche rua, bairro, cidade e estado)
alter table public.empresas
  add column if not exists numero_endereco text check (length(numero_endereco) <= 20),
  add column if not exists complemento text check (length(complemento) <= 100),
  add column if not exists bairro text check (length(bairro) <= 100);
alter table public.clientes
  add column if not exists numero_endereco text check (length(numero_endereco) <= 20),
  add column if not exists complemento text check (length(complemento) <= 100),
  add column if not exists bairro text check (length(bairro) <= 100);
alter table public.envios
  add column if not exists numero_endereco text check (length(numero_endereco) <= 20),
  add column if not exists complemento text check (length(complemento) <= 100),
  add column if not exists bairro text check (length(bairro) <= 100);
alter table public.fornecedores
  add column if not exists numero_endereco text check (length(numero_endereco) <= 20),
  add column if not exists complemento text check (length(complemento) <= 100),
  add column if not exists bairro text check (length(bairro) <= 100);

-- o envio leva o endereço completo do cliente
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
  insert into public.envios(empresa_id, numero, pedido_id, modalidade, destinatario, telefone, endereco, numero_endereco, complemento, bairro, cidade, uf, cep, previsao_entrega, transportadora, codigo_rastreio)
  values (p.empresa_id, private.proximo_numero(p.empresa_id, 'envio'), p.id, coalesce(p_modalidade, 'correios'), left(c.nome, 150),
          left(coalesce(c.whatsapp, c.telefone), 30), c.endereco, c.numero_endereco, c.complemento, c.bairro, c.cidade, c.uf, c.cep, p.data_entrega,
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
