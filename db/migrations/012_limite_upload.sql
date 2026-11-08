-- Arquivos de projeto do Bambu Studio passam de 50 MB com frequência: limite por arquivo sobe para 200 MB.
-- (o espaço total continua limitado pelo plano da empresa)
update storage.buckets set file_size_limit = 209715200 where id = 'empresa';
