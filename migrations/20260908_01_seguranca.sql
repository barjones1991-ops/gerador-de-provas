-- Aplicar depois de backup. Usa o schema existente; nao altera provas antigas.
BEGIN;

-- Remove o mecanismo de senha compartilhada; recuperacao passa pelo Supabase Auth.
DROP FUNCTION IF EXISTS public.admin_reset_user_password(UUID);

CREATE OR REPLACE FUNCTION public.protect_profile_managed_fields()
RETURNS TRIGGER AS $$
DECLARE
  actor_role TEXT := public.current_user_role();
  accepting BOOLEAN := COALESCE(current_setting('app.accepting_invite', TRUE), '') = 'true';
BEGIN
  -- SQL administrativo/trigger de Auth nao tem uid; nunca ha acesso anonimo por RLS.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT accepting AND NOT public.is_master() THEN
      IF NEW.id <> auth.uid() OR public.normalized_role(NEW.role) <> 'teacher'
        OR NEW.school_id IS NOT NULL THEN
        RAISE EXCEPTION 'Perfil inicial deve ser de professor sem vinculo.';
      END IF;
    END IF;
    NEW.email := (SELECT email FROM auth.users WHERE id = NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Identidade do perfil nao pode mudar.'; END IF;
  -- O email autenticado e a unica fonte de identidade; nunca confiar em email editavel.
  NEW.email := (SELECT email FROM auth.users WHERE id = OLD.id);
  IF auth.uid() = OLD.id AND NOT public.is_master() AND NOT accepting THEN
    NEW.role = OLD.role;
    NEW.school_id = OLD.school_id;
    NEW.school_grade = OLD.school_grade;
    NEW.disciplines = OLD.disciplines;
  ELSIF NOT public.is_master() AND NOT accepting THEN
    IF OLD.school_id IS DISTINCT FROM public.current_user_school_id()
      OR (NEW.school_id IS NOT NULL AND NEW.school_id IS DISTINCT FROM OLD.school_id) THEN
      RAISE EXCEPTION 'Nao e permitido mover perfis entre escolas.';
    END IF;
    IF actor_role = 'coordinator' THEN
      IF public.normalized_role(OLD.role) <> 'teacher' OR public.normalized_role(NEW.role) <> 'teacher' THEN
        RAISE EXCEPTION 'Coordenacao gerencia somente vinculos de professores.';
      END IF;
    ELSIF actor_role = 'school_owner' THEN
      IF public.normalized_role(OLD.role) NOT IN ('teacher', 'coordinator', 'print_operator')
        OR public.normalized_role(NEW.role) NOT IN ('teacher', 'coordinator', 'print_operator') THEN
        RAISE EXCEPTION 'Este perfil exige administracao geral.';
      END IF;
    ELSE
      RAISE EXCEPTION 'Sem permissao para gerenciar este perfil.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS protect_profile_initial_fields ON public.profiles;
CREATE TRIGGER protect_profile_initial_fields BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_managed_fields();

-- Professores nunca criam provas ja aprovadas; datas e proprietario sao protegidos.
CREATE OR REPLACE FUNCTION public.protect_exam_workflow()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF public.current_user_role() NOT IN ('master', 'school_owner', 'coordinator', 'teacher') THEN
      RAISE EXCEPTION 'Este perfil nao pode criar provas.';
    END IF;
    IF COALESCE(NEW.review_status, 'rascunho') <> 'rascunho'
      OR COALESCE(NEW.print_status, 'nao_enviada') <> 'nao_enviada'
      OR COALESCE(NEW.review_history, '[]'::jsonb) <> '[]'::jsonb
      OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.locked_at IS NOT NULL
      OR NEW.printed_by IS NOT NULL OR NEW.printed_at IS NOT NULL
      OR NEW.print_requested_by IS NOT NULL OR NEW.print_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'Uma nova prova deve iniciar como rascunho sem revisao ou impressao.';
    END IF;
    NEW.is_draft := TRUE;
    NEW.is_published := FALSE;
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'O proprietario da prova nao pode ser alterado.';
    END IF;
    IF public.current_user_role() = 'print_operator' THEN
      IF (to_jsonb(NEW) - ARRAY['print_status', 'printed_by', 'printed_at', 'updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['print_status', 'printed_by', 'printed_at', 'updated_at'])
        OR OLD.print_status <> 'enviada' OR NEW.print_status <> 'impressa'
        OR NEW.printed_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Operador so pode concluir trabalhos de impressao autorizados.';
      END IF;
    ELSIF NOT public.can_review_exam(OLD.id) THEN
      IF NEW.review_status NOT IN ('rascunho', 'enviada', 'em_revisao', 'devolvida')
        OR (NEW.review_status IN ('em_revisao', 'devolvida') AND NEW.review_status IS DISTINCT FROM OLD.review_status) THEN
        RAISE EXCEPTION 'Esta transicao exige coordenacao.';
      END IF;
      IF ROW(NEW.print_status, NEW.print_copies, NEW.print_notes, NEW.print_requested_by, NEW.print_requested_at, NEW.printed_by, NEW.printed_at)
        IS DISTINCT FROM ROW(OLD.print_status, OLD.print_copies, OLD.print_notes, OLD.print_requested_by, OLD.print_requested_at, OLD.printed_by, OLD.printed_at) THEN
        RAISE EXCEPTION 'Impressao exige usuario autorizado.';
      END IF;
      -- A devolucao pode voltar a rascunho, mas nao pode inventar uma revisao.
      IF NOT (OLD.review_status = 'devolvida' AND NEW.review_status = 'rascunho')
        AND ROW(NEW.review_notes, NEW.reviewed_by, NEW.reviewed_at, NEW.locked_at)
        IS DISTINCT FROM ROW(OLD.review_notes, OLD.reviewed_by, OLD.reviewed_at, OLD.locked_at) THEN
        RAISE EXCEPTION 'Campos de revisao sao gerenciados pela coordenacao.';
      END IF;
    END IF;
  END IF;
  IF jsonb_typeof(NEW.questions) IS DISTINCT FROM 'array' OR octet_length(NEW.questions::text) + octet_length(COALESCE(NEW.logo_data_url, '')) > 8388608 THEN
    RAISE EXCEPTION 'Formato invalido ou prova acima do limite de 8 MB.';
  END IF;
  IF NEW.review_status IS NULL OR NEW.review_status NOT IN ('rascunho', 'enviada', 'em_revisao', 'devolvida', 'aprovada', 'bloqueada')
    OR NEW.print_status IS NULL OR NEW.print_status NOT IN ('nao_enviada', 'enviada', 'impressa') THEN
    RAISE EXCEPTION 'Status de prova invalido.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS protect_exam_workflow_before_write ON public.exams;
CREATE TRIGGER protect_exam_workflow_before_write BEFORE INSERT OR UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.protect_exam_workflow();

CREATE OR REPLACE FUNCTION public.protect_question_scope()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'O autor da questao nao pode mudar.';
  END IF;
  IF NEW.school_id IS NOT NULL AND NOT public.is_master()
    AND NEW.school_id IS DISTINCT FROM public.current_user_school_id() THEN
    RAISE EXCEPTION 'A questao so pode ser compartilhada com sua escola.';
  END IF;
  IF jsonb_typeof(NEW.question) IS DISTINCT FROM 'object' OR octet_length(NEW.question::text) > 8388608 THEN
    RAISE EXCEPTION 'Questao invalida ou acima do limite de tamanho.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
DROP TRIGGER IF EXISTS protect_question_scope_before_write ON public.question_bank;
CREATE TRIGGER protect_question_scope_before_write BEFORE INSERT OR UPDATE ON public.question_bank
FOR EACH ROW EXECUTE FUNCTION public.protect_question_scope();

-- O destinatario precisa possuir o link: nao pode descobrir seu token pelo email.
DROP POLICY IF EXISTS "Convites: ver gerenciaveis" ON public.user_invites;
CREATE POLICY "Convites: ver gerenciaveis" ON public.user_invites
FOR SELECT TO authenticated USING (
  public.is_master() OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
  OR (public.current_user_role() = 'coordinator' AND public.current_user_school_id() = school_id
    AND public.normalized_role(role) = 'teacher')
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
  INSERT INTO public.profiles (id, email, role, school_id, school_grade, disciplines)
  VALUES (auth.uid(), current_email, invite_row.role, invite_row.school_id, invite_row.school_grade, COALESCE(invite_row.disciplines, '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, school_id = EXCLUDED.school_id,
    school_grade = EXCLUDED.school_grade, disciplines = EXCLUDED.disciplines;
  PERFORM set_config('app.accepting_invite', 'false', TRUE);
  UPDATE public.user_invites SET accepted_at = NOW(), accepted_by = auth.uid() WHERE id = invite_row.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.accept_user_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_user_invite(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_exam_printed(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_exam_printed(UUID) TO authenticated;

-- Indices usados pelas listagens e verificacoes de acesso.
CREATE INDEX IF NOT EXISTS exams_user_created_idx ON public.exams(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exams_review_updated_idx ON public.exams(review_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS profiles_school_role_idx ON public.profiles(school_id, role);
CREATE INDEX IF NOT EXISTS question_bank_school_created_idx ON public.question_bank(school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
INSERT INTO public.schema_migrations(version) VALUES ('20260908_01_seguranca') ON CONFLICT DO NOTHING;
COMMIT;
