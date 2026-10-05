-- Restringe imagens privadas ao conteudo que o usuario pode consultar.
-- Execute este arquivo inteiro depois das migracoes 01, 02 e 03.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.exam_image_links (
  object_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('exam', 'question')),
  source_id UUID NOT NULL,
  PRIMARY KEY (object_name, source_kind, source_id)
);

ALTER TABLE private.exam_image_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.exam_image_links FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS exam_image_links_source_idx
  ON private.exam_image_links(source_kind, source_id);

CREATE OR REPLACE FUNCTION private.image_object_name(raw_value TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  IF raw_value LIKE 'storage://exam-images/%' THEN
    RETURN substring(raw_value FROM length('storage://exam-images/') + 1);
  END IF;

  result := substring(raw_value FROM '^(?:https?://[^/]+)?/storage/v1/object/sign/exam-images/([^?]+)(?:\?.*)?$');
  IF result IS NULL THEN
    result := substring(raw_value FROM '^(?:https?://[^/]+)?/object/sign/exam-images/([^?]+)(?:\?.*)?$');
  END IF;
  RETURN NULLIF(result, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.image_object_names(payload JSONB)
RETURNS TABLE(object_name TEXT) AS $$
DECLARE
  child JSONB;
  candidate TEXT;
BEGIN
  CASE jsonb_typeof(payload)
    WHEN 'array' THEN
      FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP
        RETURN QUERY SELECT nested.object_name FROM private.image_object_names(child) AS nested;
      END LOOP;
    WHEN 'object' THEN
      FOR child IN SELECT value FROM jsonb_each(payload) LOOP
        RETURN QUERY SELECT nested.object_name FROM private.image_object_names(child) AS nested;
      END LOOP;
    WHEN 'string' THEN
      candidate := private.image_object_name(payload #>> '{}');
      IF candidate IS NOT NULL THEN
        object_name := candidate;
        RETURN NEXT;
      END IF;
    ELSE
      NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.refresh_image_links(
  target_kind TEXT,
  target_id UUID,
  payload JSONB
)
RETURNS VOID AS $$
BEGIN
  DELETE FROM private.exam_image_links
  WHERE source_kind = target_kind AND source_id = target_id;

  INSERT INTO private.exam_image_links(object_name, source_kind, source_id)
  SELECT DISTINCT found.object_name, target_kind, target_id
  FROM private.image_object_names(payload) AS found
  WHERE found.object_name IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.sync_exam_image_links()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM private.exam_image_links WHERE source_kind = 'exam' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM private.refresh_image_links('exam', NEW.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.sync_question_image_links()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM private.exam_image_links WHERE source_kind = 'question' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM private.refresh_image_links('question', NEW.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS sync_exam_image_links_after_write ON public.exams;
CREATE TRIGGER sync_exam_image_links_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.exams
FOR EACH ROW EXECUTE FUNCTION private.sync_exam_image_links();

DROP TRIGGER IF EXISTS sync_question_image_links_after_write ON public.question_bank;
CREATE TRIGGER sync_question_image_links_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.question_bank
FOR EACH ROW EXECUTE FUNCTION private.sync_question_image_links();

INSERT INTO private.exam_image_links(object_name, source_kind, source_id)
SELECT DISTINCT found.object_name, 'exam', exam.id
FROM public.exams AS exam
CROSS JOIN LATERAL private.image_object_names(to_jsonb(exam)) AS found
ON CONFLICT DO NOTHING;

INSERT INTO private.exam_image_links(object_name, source_kind, source_id)
SELECT DISTINCT found.object_name, 'question', item.id
FROM public.question_bank AS item
CROSS JOIN LATERAL private.image_object_names(to_jsonb(item)) AS found
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.can_read_exam_image(target_object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    split_part(target_object_name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM private.exam_image_links link
      JOIN public.exams exam ON link.source_kind = 'exam' AND link.source_id = exam.id
      WHERE link.object_name = target_object_name
        AND (
          auth.uid() = exam.user_id
          OR public.can_review_exam(exam.id)
          OR public.can_print_exam(exam.id)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM private.exam_image_links link
      JOIN public.question_bank item ON link.source_kind = 'question' AND link.source_id = item.id
      WHERE link.object_name = target_object_name
        AND (
          auth.uid() = item.user_id
          OR item.is_public = TRUE
          OR public.is_master()
          OR (item.school_id IS NOT NULL AND public.is_school_staff(item.school_id))
        )
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

REVOKE ALL ON FUNCTION private.image_object_name(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.image_object_names(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_image_links(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_exam_image_links() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_question_image_links() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_exam_image(TEXT) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_exam_image(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Imagens de provas: leitura autenticada" ON storage.objects;
DROP POLICY IF EXISTS "Imagens de provas: leitura vinculada" ON storage.objects;
CREATE POLICY "Imagens de provas: leitura vinculada" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'exam-images' AND private.can_read_exam_image(name)
);

INSERT INTO public.schema_migrations(version)
VALUES ('20261005_04_controle_acesso_imagens')
ON CONFLICT DO NOTHING;

COMMIT;
