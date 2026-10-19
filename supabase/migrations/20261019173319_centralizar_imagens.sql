-- Centraliza a identidade das imagens e impede que copias compartilhem o mesmo arquivo.
-- As referencias storage:// antigas continuam validas; novos registros usam asset://UUID.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  bucket_id TEXT NOT NULL DEFAULT 'exam-images' CHECK (bucket_id = 'exam-images'),
  object_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/jpg','image/webp','image/gif')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  original_name TEXT,
  source_asset_id UUID REFERENCES public.image_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_referenced_at TIMESTAMPTZ,
  orphaned_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT image_assets_owner_path CHECK (split_part(object_name, '/', 1) = owner_id::text)
);
CREATE INDEX IF NOT EXISTS image_assets_owner_idx ON public.image_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS image_assets_source_idx ON public.image_assets(source_asset_id) WHERE source_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS image_assets_orphan_idx ON public.image_assets(orphaned_at) WHERE orphaned_at IS NOT NULL;
ALTER TABLE public.image_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS private.image_asset_links (
  asset_id UUID NOT NULL REFERENCES public.image_assets(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('exam','question','school')),
  source_id UUID NOT NULL,
  PRIMARY KEY (asset_id, source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS image_asset_links_source_idx
  ON private.image_asset_links(source_kind, source_id);
ALTER TABLE private.image_asset_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.image_asset_links FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.image_asset_id(raw_value TEXT)
RETURNS UUID AS $$
DECLARE candidate TEXT;
BEGIN
  IF raw_value NOT LIKE 'asset://%' THEN RETURN NULL; END IF;
  candidate := substring(raw_value FROM length('asset://') + 1);
  IF candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN candidate::UUID;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.image_asset_ids(payload JSONB)
RETURNS TABLE(asset_id UUID) AS $$
DECLARE child JSONB; candidate UUID;
BEGIN
  CASE jsonb_typeof(payload)
    WHEN 'array' THEN
      FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP
        RETURN QUERY SELECT nested.asset_id FROM private.image_asset_ids(child) AS nested;
      END LOOP;
    WHEN 'object' THEN
      FOR child IN SELECT value FROM jsonb_each(payload) LOOP
        RETURN QUERY SELECT nested.asset_id FROM private.image_asset_ids(child) AS nested;
      END LOOP;
    WHEN 'string' THEN
      candidate := private.image_asset_id(payload #>> '{}');
      IF candidate IS NOT NULL THEN asset_id := candidate; RETURN NEXT; END IF;
    ELSE NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.can_read_image_asset(target_asset_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_is_active() AND (
    public.is_master()
    OR EXISTS (
      SELECT 1 FROM public.image_assets asset
      WHERE asset.id = target_asset_id AND asset.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM private.image_asset_links link
      JOIN public.exams exam ON link.source_kind = 'exam' AND link.source_id = exam.id
      WHERE link.asset_id = target_asset_id
        AND (auth.uid() = exam.user_id OR public.can_review_exam(exam.id) OR public.can_print_exam(exam.id))
    )
    OR EXISTS (
      SELECT 1
      FROM private.image_asset_links link
      JOIN public.question_bank item ON link.source_kind = 'question' AND link.source_id = item.id
      WHERE link.asset_id = target_asset_id
        AND (auth.uid() = item.user_id OR item.is_public = TRUE OR public.is_master()
          OR (item.school_id IS NOT NULL AND public.is_school_staff(item.school_id)))
    )
    OR EXISTS (
      SELECT 1
      FROM private.image_asset_links link
      JOIN public.schools school ON link.source_kind = 'school' AND link.source_id = school.id
      WHERE link.asset_id = target_asset_id
        AND (public.is_master() OR public.is_school_staff(school.id))
    )
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.can_delete_orphan_image(target_object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_is_active() AND EXISTS (
    SELECT 1
    FROM public.image_assets asset
    WHERE asset.object_name = target_object_name
      AND NOT EXISTS (SELECT 1 FROM private.image_asset_links link WHERE link.asset_id = asset.id)
      AND (
        asset.owner_id = auth.uid()
        OR (public.is_master() AND asset.orphaned_at < now() - interval '7 days')
      )
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION private.refresh_image_asset_links(
  target_kind TEXT, target_id UUID, payload JSONB
)
RETURNS VOID AS $$
DECLARE
  old_ids UUID[];
  new_ids UUID[];
  invalid_count INTEGER;
BEGIN
  SELECT COALESCE(array_agg(link.asset_id), ARRAY[]::UUID[]) INTO old_ids
  FROM private.image_asset_links link
  WHERE link.source_kind = target_kind AND link.source_id = target_id;

  SELECT COALESCE(array_agg(DISTINCT found.asset_id), ARRAY[]::UUID[]) INTO new_ids
  FROM private.image_asset_ids(payload) AS found;

  SELECT count(*) INTO invalid_count
  FROM unnest(new_ids) AS requested(asset_id)
  LEFT JOIN public.image_assets asset ON asset.id = requested.asset_id
  WHERE asset.id IS NULL
     OR (
       auth.uid() IS NOT NULL
       AND NOT (requested.asset_id = ANY(old_ids))
       AND asset.owner_id IS DISTINCT FROM auth.uid()
     );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'A imagem informada nao existe ou nao pertence ao usuario. Crie uma copia independente.';
  END IF;

  DELETE FROM private.image_asset_links
  WHERE source_kind = target_kind AND source_id = target_id;

  INSERT INTO private.image_asset_links(asset_id, source_kind, source_id)
  SELECT requested.asset_id, target_kind, target_id FROM unnest(new_ids) AS requested(asset_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.image_assets asset
  SET last_referenced_at = CASE
        WHEN EXISTS (SELECT 1 FROM private.image_asset_links link WHERE link.asset_id = asset.id)
          THEN clock_timestamp()
        ELSE asset.last_referenced_at
      END,
      orphaned_at = CASE
        WHEN EXISTS (SELECT 1 FROM private.image_asset_links link WHERE link.asset_id = asset.id)
          THEN NULL
        ELSE COALESCE(asset.orphaned_at, clock_timestamp())
      END
  WHERE asset.id = ANY(old_ids || new_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.remove_image_asset_links(target_kind TEXT, target_id UUID)
RETURNS VOID AS $$
DECLARE removed_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(link.asset_id), ARRAY[]::UUID[]) INTO removed_ids
  FROM private.image_asset_links link
  WHERE link.source_kind = target_kind AND link.source_id = target_id;
  DELETE FROM private.image_asset_links WHERE source_kind = target_kind AND source_id = target_id;
  UPDATE public.image_assets asset
  SET orphaned_at = COALESCE(asset.orphaned_at, clock_timestamp())
  WHERE asset.id = ANY(removed_ids)
    AND NOT EXISTS (SELECT 1 FROM private.image_asset_links link WHERE link.asset_id = asset.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.sync_exam_image_assets()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.remove_image_asset_links('exam', OLD.id); RETURN OLD;
  END IF;
  PERFORM private.refresh_image_asset_links('exam', NEW.id, to_jsonb(NEW)); RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.sync_question_image_assets()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.remove_image_asset_links('question', OLD.id); RETURN OLD;
  END IF;
  PERFORM private.refresh_image_asset_links('question', NEW.id, to_jsonb(NEW)); RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION private.sync_school_image_assets()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.remove_image_asset_links('school', OLD.id); RETURN OLD;
  END IF;
  PERFORM private.refresh_image_asset_links('school', NEW.id, to_jsonb(NEW)); RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS sync_exam_image_assets_after_write ON public.exams;
CREATE TRIGGER sync_exam_image_assets_after_write AFTER INSERT OR UPDATE OR DELETE ON public.exams
FOR EACH ROW EXECUTE FUNCTION private.sync_exam_image_assets();
DROP TRIGGER IF EXISTS sync_question_image_assets_after_write ON public.question_bank;
CREATE TRIGGER sync_question_image_assets_after_write AFTER INSERT OR UPDATE OR DELETE ON public.question_bank
FOR EACH ROW EXECUTE FUNCTION private.sync_question_image_assets();
DROP TRIGGER IF EXISTS sync_school_image_assets_after_write ON public.schools;
CREATE TRIGGER sync_school_image_assets_after_write AFTER INSERT OR UPDATE OR DELETE ON public.schools
FOR EACH ROW EXECUTE FUNCTION private.sync_school_image_assets();

REVOKE ALL ON public.image_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.image_assets TO authenticated;

DROP POLICY IF EXISTS "Imagens centralizadas: leitura autorizada" ON public.image_assets;
CREATE POLICY "Imagens centralizadas: leitura autorizada" ON public.image_assets
FOR SELECT TO authenticated USING (private.can_read_image_asset(id));
DROP POLICY IF EXISTS "Imagens centralizadas: registrar proprias" ON public.image_assets;
CREATE POLICY "Imagens centralizadas: registrar proprias" ON public.image_assets
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_is_active()
  AND owner_id = (select auth.uid())
  AND bucket_id = 'exam-images'
  AND split_part(object_name, '/', 1) = (select auth.uid())::text
);
DROP POLICY IF EXISTS "Imagens centralizadas: excluir orfas proprias" ON public.image_assets;
CREATE POLICY "Imagens centralizadas: excluir orfas proprias" ON public.image_assets
FOR DELETE TO authenticated USING (
  NOT EXISTS (SELECT 1 FROM private.image_asset_links link WHERE link.asset_id = id)
  AND (owner_id = (select auth.uid()) OR (public.is_master() AND orphaned_at < now() - interval '7 days'))
);

CREATE OR REPLACE FUNCTION private.can_read_exam_image(target_object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_is_active() AND (
    EXISTS (
      SELECT 1 FROM public.image_assets asset
      WHERE asset.object_name = target_object_name AND private.can_read_image_asset(asset.id)
    )
    OR split_part(target_object_name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM private.exam_image_links link
      JOIN public.exams exam ON link.source_kind = 'exam' AND link.source_id = exam.id
      WHERE link.object_name = target_object_name
        AND (auth.uid() = exam.user_id OR public.can_review_exam(exam.id) OR public.can_print_exam(exam.id))
    )
    OR EXISTS (
      SELECT 1 FROM private.exam_image_links link
      JOIN public.question_bank item ON link.source_kind = 'question' AND link.source_id = item.id
      WHERE link.object_name = target_object_name
        AND (auth.uid() = item.user_id OR item.is_public = TRUE OR public.is_master()
          OR (item.school_id IS NOT NULL AND public.is_school_staff(item.school_id)))
    )
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

REVOKE ALL ON FUNCTION private.image_asset_id(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.image_asset_ids(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_image_asset(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_delete_orphan_image(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_image_asset_links(TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.remove_image_asset_links(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_exam_image_assets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_question_image_assets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_school_image_assets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_exam_image(TEXT) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_image_asset(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_delete_orphan_image(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_exam_image(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Imagens de provas: excluir proprias" ON storage.objects;
CREATE POLICY "Imagens de provas: excluir proprias" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'exam-images'
  AND (
    (
      NOT EXISTS (SELECT 1 FROM public.image_assets asset WHERE asset.object_name = name)
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    OR private.can_delete_orphan_image(name)
  )
);

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_07_centralizacao_imagens')
ON CONFLICT DO NOTHING;

COMMIT;
