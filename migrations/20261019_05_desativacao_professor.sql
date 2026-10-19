-- Remove o acesso do professor sem apagar conta, autoria ou acervo.
-- Aplicar depois de 20261005_04_controle_acesso_imagens.sql.
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_inactive_without_school;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_inactive_without_school CHECK (
  is_active OR (
    school_id IS NULL
    AND school_grade IS NULL
    AND COALESCE(jsonb_array_length(disciplines), 0) = 0
  )
);

CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((
    SELECT profile.is_active
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_activation_fields()
RETURNS TRIGGER AS $$
DECLARE
  accepting BOOLEAN := COALESCE(current_setting('app.accepting_invite', TRUE), '') = 'true';
  actor_role TEXT := public.current_user_role();
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF accepting THEN
    NEW.is_active := TRUE;
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.id AND NOT public.is_master() THEN
    NEW.is_active := OLD.is_active;
    NEW.deactivated_at := OLD.deactivated_at;
    NEW.deactivated_by := OLD.deactivated_by;
    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT public.is_master() THEN
    IF OLD.is_active
      AND NOT NEW.is_active
      AND public.normalized_role(OLD.role) = 'teacher'
      AND OLD.school_id = public.current_user_school_id()
      AND actor_role IN ('school_owner', 'coordinator') THEN
      NEW.deactivated_at := clock_timestamp();
      NEW.deactivated_by := auth.uid();
    ELSE
      RAISE EXCEPTION 'Este acesso nao pode ser reativado ou desativado por este perfil.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS protect_profile_activation_before_update ON public.profiles;
CREATE TRIGGER protect_profile_activation_before_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_activation_fields();

CREATE OR REPLACE FUNCTION public.teacher_removal_preview(target_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  actor_role TEXT := public.current_user_role();
  review_pending INTEGER;
  print_pending INTEGER;
  editable_exams INTEGER;
  preserved_exams INTEGER;
  shared_questions INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado.'; END IF;

  SELECT * INTO target_profile
  FROM public.profiles
  WHERE id = target_profile_id;

  IF NOT FOUND OR public.normalized_role(target_profile.role) <> 'teacher' THEN
    RAISE EXCEPTION 'Professor nao encontrado.';
  END IF;
  IF NOT target_profile.is_active OR target_profile.school_id IS NULL THEN
    RAISE EXCEPTION 'Este professor ja foi removido da escola.';
  END IF;
  IF NOT public.is_master() AND NOT (
    actor_role IN ('school_owner', 'coordinator')
    AND target_profile.school_id = public.current_user_school_id()
  ) THEN
    RAISE EXCEPTION 'Sem permissao para remover este professor.';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE COALESCE(review_status, 'rascunho') IN ('enviada', 'em_revisao')),
    COUNT(*) FILTER (WHERE COALESCE(print_status, 'nao_enviada') = 'enviada'),
    COUNT(*) FILTER (WHERE COALESCE(review_status, 'rascunho') IN ('rascunho', 'devolvida')),
    COUNT(*) FILTER (WHERE COALESCE(review_status, 'rascunho') IN ('aprovada', 'bloqueada'))
  INTO review_pending, print_pending, editable_exams, preserved_exams
  FROM public.exams
  WHERE user_id = target_profile_id
    AND school_id = target_profile.school_id;

  SELECT COUNT(*) INTO shared_questions
  FROM public.question_bank
  WHERE user_id = target_profile_id
    AND school_id = target_profile.school_id;

  RETURN jsonb_build_object(
    'review_pending', review_pending,
    'print_pending', print_pending,
    'editable_exams', editable_exams,
    'preserved_exams', preserved_exams,
    'shared_questions', shared_questions,
    'can_remove', review_pending = 0 AND print_pending = 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.deactivate_teacher_profile(target_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  actor_role TEXT := public.current_user_role();
  blocking_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado.'; END IF;

  SELECT * INTO target_profile
  FROM public.profiles
  WHERE id = target_profile_id
  FOR UPDATE;

  IF NOT FOUND OR public.normalized_role(target_profile.role) <> 'teacher' THEN
    RAISE EXCEPTION 'Professor nao encontrado.';
  END IF;
  IF NOT target_profile.is_active OR target_profile.school_id IS NULL THEN
    RAISE EXCEPTION 'Este professor ja foi removido da escola.';
  END IF;
  IF NOT public.is_master() AND NOT (
    actor_role IN ('school_owner', 'coordinator')
    AND target_profile.school_id = public.current_user_school_id()
  ) THEN
    RAISE EXCEPTION 'Sem permissao para remover este professor.';
  END IF;

  SELECT COUNT(*) INTO blocking_count
  FROM public.exams
  WHERE user_id = target_profile_id
    AND school_id = target_profile.school_id
    AND (
      COALESCE(review_status, 'rascunho') IN ('enviada', 'em_revisao')
      OR COALESCE(print_status, 'nao_enviada') = 'enviada'
    );

  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'O professor possui provas em revisao ou impressao. Conclua essas pendencias antes da remocao.';
  END IF;

  UPDATE public.profiles
  SET is_active = FALSE,
      deactivated_at = clock_timestamp(),
      deactivated_by = auth.uid(),
      school_id = NULL,
      school_grade = NULL,
      disciplines = '[]'::jsonb
  WHERE id = target_profile_id;

  RETURN jsonb_build_object('removed', TRUE, 'profile_id', target_profile_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.teacher_removal_preview(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_teacher_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_removal_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_teacher_profile(UUID) TO authenticated;

DROP POLICY IF EXISTS "Provas próprias: ver" ON public.exams;
CREATE POLICY "Provas próprias: ver" ON public.exams
FOR SELECT TO authenticated USING (
  public.current_user_is_active()
  AND (auth.uid() = user_id OR public.can_review_exam(id) OR public.can_print_exam(id))
);

DROP POLICY IF EXISTS "Provas próprias: criar" ON public.exams;
CREATE POLICY "Provas próprias: criar" ON public.exams
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_is_active() AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "Provas próprias: editar" ON public.exams;
CREATE POLICY "Provas próprias: editar" ON public.exams
FOR UPDATE TO authenticated USING (
  public.current_user_is_active()
  AND (
    (auth.uid() = user_id AND COALESCE(review_status, 'rascunho') NOT IN ('aprovada', 'bloqueada'))
    OR public.can_review_exam(id)
  )
);

DROP POLICY IF EXISTS "exams_delete_own_unlocked" ON public.exams;
CREATE POLICY "exams_delete_own_unlocked" ON public.exams
FOR DELETE TO authenticated USING (
  public.current_user_is_active()
  AND (
    public.is_master()
    OR (auth.uid() = user_id AND COALESCE(review_status, 'rascunho') NOT IN ('aprovada', 'bloqueada'))
    OR (public.current_user_role() = 'school_owner' AND public.can_review_exam(id))
  )
);

DROP POLICY IF EXISTS "Banco de questões: ver próprias ou públicas" ON public.question_bank;
CREATE POLICY "Banco de questões: ver próprias ou públicas" ON public.question_bank
FOR SELECT TO authenticated USING (
  public.current_user_is_active()
  AND (
    auth.uid() = user_id OR is_public = TRUE OR public.is_master()
    OR (school_id IS NOT NULL AND public.is_school_staff(school_id))
  )
);

DROP POLICY IF EXISTS "Banco de questões: criar próprias" ON public.question_bank;
CREATE POLICY "Banco de questões: criar próprias" ON public.question_bank
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_is_active()
  AND auth.uid() = user_id
  AND (
    school_id IS NULL OR public.is_master() OR public.can_manage_school(school_id)
    OR public.is_school_staff(school_id)
  )
);

DROP POLICY IF EXISTS "Banco de questões: editar próprias" ON public.question_bank;
CREATE POLICY "Banco de questões: editar próprias" ON public.question_bank
FOR UPDATE TO authenticated USING (
  public.current_user_is_active()
  AND (auth.uid() = user_id OR public.is_master() OR (school_id IS NOT NULL AND public.can_manage_school(school_id)))
);

DROP POLICY IF EXISTS "Banco de questões: deletar próprias" ON public.question_bank;
CREATE POLICY "Banco de questões: deletar próprias" ON public.question_bank
FOR DELETE TO authenticated USING (
  public.current_user_is_active()
  AND (auth.uid() = user_id OR public.is_master() OR (school_id IS NOT NULL AND public.can_manage_school(school_id)))
);

CREATE OR REPLACE FUNCTION public.accept_user_invite(invite_token TEXT)
RETURNS VOID AS $$
DECLARE
  invite_row public.user_invites%ROWTYPE;
  current_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado.'; END IF;
  SELECT lower(email) INTO current_email FROM auth.users
  WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF current_email IS NULL THEN RAISE EXCEPTION 'Confirme seu email antes de aceitar o convite.'; END IF;
  SELECT * INTO invite_row FROM public.user_invites
  WHERE token = invite_token AND accepted_at IS NULL AND canceled_at IS NULL
    AND expires_at >= NOW()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Convite invalido, usado, cancelado ou expirado.'; END IF;
  IF lower(invite_row.email) <> current_email THEN RAISE EXCEPTION 'Este convite pertence a outro e-mail.'; END IF;
  IF public.normalized_role(invite_row.role) NOT IN ('teacher', 'coordinator', 'school_owner', 'print_operator')
    OR invite_row.school_id IS NULL THEN RAISE EXCEPTION 'Perfil ou escola do convite invalido.'; END IF;
  PERFORM set_config('app.accepting_invite', 'true', TRUE);
  INSERT INTO public.profiles (id, email, role, school_id, school_grade, disciplines, is_active)
  VALUES (auth.uid(), current_email, invite_row.role, invite_row.school_id, invite_row.school_grade, COALESCE(invite_row.disciplines, '[]'::jsonb), TRUE)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, school_id = EXCLUDED.school_id,
    school_grade = EXCLUDED.school_grade, disciplines = EXCLUDED.disciplines,
    is_active = TRUE, deactivated_at = NULL, deactivated_by = NULL;
  PERFORM set_config('app.accepting_invite', 'false', TRUE);
  UPDATE public.user_invites SET accepted_at = NOW(), accepted_by = auth.uid() WHERE id = invite_row.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.accept_user_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_user_invite(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_read_exam_image(target_object_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_is_active() AND (
    split_part(target_object_name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM private.exam_image_links link
      JOIN public.exams exam ON link.source_kind = 'exam' AND link.source_id = exam.id
      WHERE link.object_name = target_object_name
        AND (auth.uid() = exam.user_id OR public.can_review_exam(exam.id) OR public.can_print_exam(exam.id))
    )
    OR EXISTS (
      SELECT 1
      FROM private.exam_image_links link
      JOIN public.question_bank item ON link.source_kind = 'question' AND link.source_id = item.id
      WHERE link.object_name = target_object_name
        AND (
          auth.uid() = item.user_id OR item.is_public = TRUE OR public.is_master()
          OR (item.school_id IS NOT NULL AND public.is_school_staff(item.school_id))
        )
    )
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

REVOKE ALL ON FUNCTION private.can_read_exam_image(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_exam_image(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Imagens de provas: criar na propria pasta" ON storage.objects;
CREATE POLICY "Imagens de provas: criar na propria pasta" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_is_active()
  AND bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Imagens de provas: atualizar proprias" ON storage.objects;
CREATE POLICY "Imagens de provas: atualizar proprias" ON storage.objects
FOR UPDATE TO authenticated USING (
  public.current_user_is_active()
  AND bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
) WITH CHECK (
  public.current_user_is_active()
  AND bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Imagens de provas: excluir proprias" ON storage.objects;
CREATE POLICY "Imagens de provas: excluir proprias" ON storage.objects
FOR DELETE TO authenticated USING (
  public.current_user_is_active()
  AND bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text
);

INSERT INTO public.schema_migrations(version)
VALUES ('20261019_05_desativacao_professor')
ON CONFLICT DO NOTHING;

COMMIT;
