-- Restaura o reset administrativo temporario solicitado pela operacao.
-- A senha fixa deve ser trocada pelo usuario no primeiro acesso.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(target_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_users INTEGER := 0;
  affected_profiles INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.';
  END IF;

  IF target_profile_id IS NULL OR target_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Use a troca de senha da propria conta.';
  END IF;

  IF NOT public.can_manage_profile(target_profile_id) THEN
    RAISE EXCEPTION 'Voce nao tem permissao para resetar a senha deste usuario.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = target_profile_id;
  GET DIAGNOSTICS affected_users = ROW_COUNT;

  IF affected_users <> 1 THEN
    RAISE EXCEPTION 'Usuario de autenticacao nao encontrado.';
  END IF;

  UPDATE public.profiles
  SET force_password_change = TRUE
  WHERE id = target_profile_id;
  GET DIAGNOSTICS affected_profiles = ROW_COUNT;

  IF affected_profiles <> 1 THEN
    RAISE EXCEPTION 'Perfil de acesso nao encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_user_password(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(UUID) TO authenticated;

INSERT INTO public.schema_migrations (version)
VALUES ('20261022_12_restaurar_reset_senha_temporaria')
ON CONFLICT (version) DO NOTHING;

COMMIT;
