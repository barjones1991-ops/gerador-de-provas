-- Imagens decorativas pertencem à prova, sem vínculo artificial com uma questão.
BEGIN;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS decorative_images JSONB NOT NULL DEFAULT '[]'::JSONB;

UPDATE public.exams
SET decorative_images = '[]'::JSONB
WHERE decorative_images IS NULL OR jsonb_typeof(decorative_images) <> 'array';

ALTER TABLE public.exams DROP CONSTRAINT IF EXISTS exams_decorative_images_array;
ALTER TABLE public.exams
  ADD CONSTRAINT exams_decorative_images_array
  CHECK (jsonb_typeof(decorative_images) = 'array');

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_09_decoracoes_prova')
ON CONFLICT DO NOTHING;

COMMIT;
