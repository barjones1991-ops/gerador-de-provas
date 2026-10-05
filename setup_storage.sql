-- Execute no SQL Editor do Supabase depois de setup_supabase.sql.
-- O bucket permanece privado; o aplicativo entrega URLs assinadas com validade curta.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exam-images', 'exam-images', FALSE, 5242880, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Imagens de provas: leitura autenticada" ON storage.objects;
CREATE POLICY "Imagens de provas: leitura autenticada" ON storage.objects
FOR SELECT TO authenticated USING (bucket_id = 'exam-images');

DROP POLICY IF EXISTS "Imagens de provas: criar na propria pasta" ON storage.objects;
CREATE POLICY "Imagens de provas: criar na propria pasta" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Imagens de provas: atualizar proprias" ON storage.objects;
CREATE POLICY "Imagens de provas: atualizar proprias" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
) WITH CHECK (
  bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Imagens de provas: excluir proprias" ON storage.objects;
CREATE POLICY "Imagens de provas: excluir proprias" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

COMMIT;
