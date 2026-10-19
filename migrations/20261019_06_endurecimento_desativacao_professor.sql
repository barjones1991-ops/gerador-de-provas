-- Impede a chamada direta da função interna de gatilho criada na migração 05
-- e adiciona o índice recomendado para a referência de auditoria.
BEGIN;

REVOKE ALL ON FUNCTION public.protect_profile_activation_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_activation_fields() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_activation_fields() FROM authenticated;

CREATE INDEX IF NOT EXISTS profiles_deactivated_by_idx
  ON public.profiles (deactivated_by)
  WHERE deactivated_by IS NOT NULL;

INSERT INTO public.schema_migrations (version)
VALUES ('20261019_06_endurecimento_desativacao_professor')
ON CONFLICT (version) DO NOTHING;

COMMIT;
