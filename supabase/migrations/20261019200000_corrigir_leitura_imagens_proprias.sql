-- INSERT ... RETURNING precisa ler imediatamente a imagem recém-criada.
BEGIN;

DROP POLICY IF EXISTS "Imagens centralizadas: leitura autorizada" ON public.image_assets;
CREATE POLICY "Imagens centralizadas: leitura autorizada" ON public.image_assets
FOR SELECT TO authenticated USING (
  owner_id = (SELECT auth.uid())
  OR private.can_read_image_asset(id)
);

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_10_corrigir_leitura_imagens_proprias')
ON CONFLICT DO NOTHING;

COMMIT;
