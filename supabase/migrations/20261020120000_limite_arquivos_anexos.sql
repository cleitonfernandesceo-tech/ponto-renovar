-- Seguranca (revisao 20/10/2026).
-- O bucket privado "anexos" nao tinha limite de tamanho nem de tipo no servidor: o limite de 8 MB
-- e os formatos aceitos so existiam na tela. Quem falasse direto com o servidor poderia enviar
-- arquivos enormes ou de qualquer tipo. Aqui o servidor passa a exigir o mesmo que a tela.
-- Nao apaga nem altera arquivos ja guardados; vale so para novos envios.
update storage.buckets
   set file_size_limit = 8 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
 where id = 'anexos';
