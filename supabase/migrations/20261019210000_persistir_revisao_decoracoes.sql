-- Mantém o aviso de revisão da decoração entre sessões do editor.
BEGIN;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS decorations_need_review BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_11_persistir_revisao_decoracoes')
ON CONFLICT DO NOTHING;

COMMIT;
