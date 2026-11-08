-- Novos valores de enum (precisam ficar numa migração separada)
alter type public.papel_membro add value if not exists 'comercial';
alter type public.papel_membro add value if not exists 'producao';
alter type public.papel_membro add value if not exists 'estoque';
alter type public.papel_membro add value if not exists 'financeiro';
alter type public.papel_membro add value if not exists 'expedicao';
alter type public.categoria_material add value if not exists 'consumivel';
alter type public.categoria_material add value if not exists 'componente';
alter type public.categoria_material add value if not exists 'peca_reposicao';
