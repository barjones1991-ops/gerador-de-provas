-- Complemento idempotente: indice da linhagem e RLS sem reavaliar auth.uid por linha.
BEGIN;

CREATE INDEX IF NOT EXISTS image_assets_source_idx
  ON public.image_assets(source_asset_id)
  WHERE source_asset_id IS NOT NULL;

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

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_08_otimizar_imagens')
ON CONFLICT DO NOTHING;

COMMIT;
