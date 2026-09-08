BEGIN;
-- =============================================
-- EXECUTE ESTE SQL NO SUPABASE
-- Supabase > SQL Editor > New Query > Cole tudo > Run
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabela de perfis dos professores
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'professor',
  force_password_change BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'professor';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles DROP COLUMN IF EXISTS school_name;

CREATE TABLE IF NOT EXISTS schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  admin_email TEXT,
  classes JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_grade TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disciplines JSONB DEFAULT '[]';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Funções auxiliares para evitar recursão nas policies de RLS
CREATE OR REPLACE FUNCTION public.normalized_role(raw_role TEXT)
RETURNS TEXT AS $$
  SELECT CASE COALESCE(raw_role, 'professor')
    WHEN 'admin' THEN 'master'
    WHEN 'coordenadora' THEN 'coordinator'
    WHEN 'professor' THEN 'teacher'
    WHEN 'impressao' THEN 'print_operator'
    ELSE raw_role
  END;
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_manager_roles_require_school;
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_manager_roles_require_school
CHECK (
  public.normalized_role(role) NOT IN ('school_owner', 'coordinator', 'print_operator')
  OR school_id IS NOT NULL
) NOT VALID;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT public.normalized_role(role)
  FROM public.profiles
  WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.is_coordinator_or_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_role() IN ('master', 'school_owner', 'coordinator'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.current_user_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_role() = 'master', FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.is_school_owner(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.current_user_role() = 'school_owner'
    AND public.current_user_school_id() = target_school_id,
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.is_school_staff(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.current_user_role() IN ('school_owner', 'coordinator', 'teacher', 'print_operator')
    AND public.current_user_school_id() = target_school_id,
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.can_manage_school(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.is_master() OR public.is_school_owner(target_school_id), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.grade_list_contains_class(grade_list TEXT, target_class_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM regexp_split_to_table(COALESCE(grade_list, ''), '\s*[,;|/]\s*') AS grade(raw_grade)
    WHERE btrim(raw_grade) <> ''
      AND btrim(COALESCE(target_class_name, '')) <> ''
      AND (
        lower(btrim(target_class_name)) = lower(btrim(raw_grade))
        OR lower(btrim(target_class_name)) LIKE lower(btrim(raw_grade)) || ' %'
        OR lower(btrim(target_class_name)) LIKE lower(btrim(raw_grade)) || ' -%'
      )
  ), FALSE);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.can_manage_profile(target_profile_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.is_master()
    OR EXISTS (
      SELECT 1
      FROM public.profiles target_profile
      WHERE target_profile.id = target_profile_id
        AND public.current_user_school_id() IS NOT NULL
        AND public.current_user_school_id() = target_profile.school_id
        AND (
          (
            public.current_user_role() = 'school_owner'
            AND public.normalized_role(target_profile.role) IN ('coordinator', 'teacher', 'print_operator')
          )
          OR (
            public.current_user_role() = 'coordinator'
            AND public.normalized_role(target_profile.role) = 'teacher'
          )
        )
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

-- Redefinicao de senha usa recuperacao do Auth.
DROP FUNCTION IF EXISTS public.admin_reset_user_password(UUID);

DROP POLICY IF EXISTS "Perfil próprio: ver" ON profiles;
CREATE POLICY "Perfil próprio: ver" ON profiles
  FOR SELECT USING (auth.uid() = id OR public.is_master() OR public.can_manage_profile(id));

DROP POLICY IF EXISTS "Perfil próprio: criar" ON profiles;
CREATE POLICY "Perfil próprio: criar" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Perfil próprio: editar" ON profiles;
CREATE POLICY "Perfil próprio: editar" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Coordenadora edita professores" ON profiles;
CREATE POLICY "Coordenadora edita professores" ON profiles
  FOR UPDATE USING (public.is_master() OR public.can_manage_profile(id))
  WITH CHECK (public.is_master() OR public.can_manage_profile(id));

-- Campos de vinculo escolar sao gerenciados pela coordenacao/admin.
-- Quando o proprio professor atualiza o perfil, preserva os campos protegidos.
CREATE OR REPLACE FUNCTION public.protect_profile_managed_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() = OLD.id
    AND NOT public.is_master()
    AND COALESCE(current_setting('app.accepting_invite', TRUE), '') <> 'true'
  THEN
    NEW.role = OLD.role;
    NEW.school_id = OLD.school_id;
    NEW.school_grade = OLD.school_grade;
    NEW.disciplines = OLD.disciplines;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS protect_profile_managed_fields_before_update ON profiles;
CREATE TRIGGER protect_profile_managed_fields_before_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_managed_fields();

-- 2. Tabela de provas
CREATE TABLE IF NOT EXISTS exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Sem título',
  school_name TEXT,
  subject TEXT,
  class_name TEXT,
  teacher TEXT,
  term TEXT,
  date TEXT,
  total_value TEXT,
  instructions TEXT,
  questions JSONB DEFAULT '[]',
  logo_data_url TEXT,
  is_draft BOOLEAN DEFAULT TRUE,
  is_published BOOLEAN DEFAULT FALSE,
  review_status TEXT DEFAULT 'rascunho',
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users,
  reviewed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  print_status TEXT DEFAULT 'nao_enviada',
  print_copies INTEGER,
  print_notes TEXT,
  print_requested_by UUID REFERENCES auth.users,
  print_requested_at TIMESTAMPTZ,
  printed_by UUID REFERENCES auth.users,
  printed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'rascunho';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS print_status TEXT DEFAULT 'nao_enviada';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS print_copies INTEGER;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS print_notes TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS print_requested_by UUID REFERENCES auth.users;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS print_requested_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS printed_by UUID REFERENCES auth.users;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.exam_questions_count(raw_questions JSONB)
RETURNS INTEGER AS $$
  SELECT CASE
    WHEN jsonb_typeof(COALESCE(raw_questions, '[]'::jsonb)) = 'array'
      THEN jsonb_array_length(COALESCE(raw_questions, '[]'::jsonb))
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.parse_score_value(raw_value TEXT)
RETURNS NUMERIC AS $$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := regexp_replace(replace(replace(COALESCE(raw_value, ''), '.', ''), ',', '.'), '[^0-9.\-]', '', 'g');
  IF cleaned = '' OR cleaned = '-' THEN
    RETURN 0;
  END IF;
  RETURN cleaned::NUMERIC;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.exam_questions_score_total(raw_questions JSONB)
RETURNS NUMERIC AS $$
DECLARE
  total NUMERIC;
BEGIN
  IF jsonb_typeof(COALESCE(raw_questions, '[]'::jsonb)) <> 'array' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(public.parse_score_value(item->>'points')), 0)
  INTO total
  FROM jsonb_array_elements(COALESCE(raw_questions, '[]'::jsonb)) AS item;

  RETURN total;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.prevent_empty_exam_review()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.review_status, 'rascunho') IN ('enviada', 'em_revisao', 'aprovada')
    AND public.exam_questions_count(NEW.questions) = 0
  THEN
    RAISE EXCEPTION 'Adicione pelo menos uma questao antes de enviar para revisao.';
  END IF;

  IF COALESCE(NEW.review_status, 'rascunho') IN ('enviada', 'em_revisao', 'aprovada')
    AND ABS(public.exam_questions_score_total(NEW.questions) - public.parse_score_value(NEW.total_value)) >= 0.05
  THEN
    RAISE EXCEPTION 'Ha divergencia entre o valor total da prova e a soma das questoes.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE exams
SET review_status = 'rascunho',
    is_published = FALSE,
    is_draft = TRUE,
    updated_at = NOW()
WHERE COALESCE(review_status, 'rascunho') IN ('enviada', 'em_revisao', 'aprovada')
  AND public.exam_questions_count(questions) = 0;
DROP TRIGGER IF EXISTS prevent_empty_exam_review_before_write ON exams;
CREATE TRIGGER prevent_empty_exam_review_before_write
  BEFORE INSERT OR UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_empty_exam_review();
CREATE OR REPLACE FUNCTION public.can_review_exam(target_exam_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.is_master()
    OR EXISTS (
      SELECT 1
      FROM public.exams exam
      JOIN public.profiles owner_profile ON owner_profile.id = exam.user_id
      JOIN public.profiles current_profile ON current_profile.id = auth.uid()
      WHERE exam.id = target_exam_id
        AND current_profile.school_id IS NOT NULL
        AND current_profile.school_id = owner_profile.school_id
        AND (
          public.normalized_role(current_profile.role) = 'school_owner'
          OR (
            public.normalized_role(current_profile.role) = 'coordinator'
            AND public.grade_list_contains_class(current_profile.school_grade, exam.class_name)
          )
        )
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

UPDATE exams
SET print_status = 'nao_enviada',
    print_copies = NULL,
    print_notes = NULL,
    print_requested_by = NULL,
    print_requested_at = NULL,
    printed_by = NULL,
    printed_at = NULL,
    updated_at = NOW()
WHERE COALESCE(print_status, 'nao_enviada') IN ('enviada', 'impressa')
  AND COALESCE(review_status, 'rascunho') <> 'aprovada';

CREATE OR REPLACE FUNCTION public.prevent_invalid_print_request()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.print_status, 'nao_enviada') IN ('enviada', 'impressa')
    AND COALESCE(NEW.review_status, 'rascunho') <> 'aprovada'
  THEN
    RAISE EXCEPTION 'Apenas provas aprovadas podem ser enviadas para impressao.';
  END IF;

  IF COALESCE(NEW.print_status, 'nao_enviada') = 'enviada' THEN
    NEW.print_copies = GREATEST(1, COALESCE(NEW.print_copies, 1));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_invalid_print_request_before_write ON exams;
CREATE TRIGGER prevent_invalid_print_request_before_write
  BEFORE INSERT OR UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_invalid_print_request();
CREATE OR REPLACE FUNCTION public.can_print_exam(target_exam_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.is_master()
    OR EXISTS (
      SELECT 1
      FROM public.exams exam
      JOIN public.profiles owner_profile ON owner_profile.id = exam.user_id
      JOIN public.profiles current_profile ON current_profile.id = auth.uid()
      WHERE exam.id = target_exam_id
        AND public.normalized_role(current_profile.role) IN ('school_owner', 'print_operator')
        AND current_profile.school_id IS NOT NULL
        AND current_profile.school_id = owner_profile.school_id
        AND COALESCE(exam.print_status, 'nao_enviada') IN ('enviada', 'impressa')
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.mark_exam_printed(target_exam_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT public.can_print_exam(target_exam_id) THEN
    RAISE EXCEPTION 'Apenas usuarios de impressao autorizados podem marcar esta prova.';
  END IF;

  UPDATE public.exams
  SET print_status = 'impressa',
      printed_by = auth.uid(),
      printed_at = NOW(),
      updated_at = NOW()
  WHERE id = target_exam_id
    AND COALESCE(print_status, 'nao_enviada') = 'enviada';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prova nao esta pendente de impressao.';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

DROP POLICY IF EXISTS "Provas próprias: ver" ON exams;
CREATE POLICY "Provas próprias: ver" ON exams
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.can_review_exam(id)
    OR public.can_print_exam(id)
  );

DROP POLICY IF EXISTS "Provas próprias: criar" ON exams;
CREATE POLICY "Provas próprias: criar" ON exams
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Provas próprias: editar" ON exams;
CREATE POLICY "Provas próprias: editar" ON exams
  FOR UPDATE USING (
    (
      auth.uid() = user_id
      AND COALESCE(review_status, 'rascunho') NOT IN ('aprovada', 'bloqueada')
    )
    OR public.can_review_exam(id)
  );

DROP POLICY IF EXISTS "Provas próprias: deletar" ON exams;
DROP POLICY IF EXISTS "Provas prÃ³prias: deletar" ON exams;
DROP POLICY IF EXISTS "exams_delete_own_unlocked" ON exams;
CREATE POLICY "exams_delete_own_unlocked" ON exams
  FOR DELETE USING (
    public.is_master()
    OR (
      auth.uid() = user_id
      AND COALESCE(review_status, 'rascunho') NOT IN ('aprovada', 'bloqueada')
    )
    OR (
      public.current_user_role() = 'school_owner'
      AND public.can_review_exam(id)
    )
  );

-- 3. Banco de questões
CREATE TABLE IF NOT EXISTS question_bank (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Questão sem título',
  subject TEXT,
  grade TEXT,
  skill TEXT,
  difficulty TEXT DEFAULT 'media',
  question_type TEXT,
  question JSONB NOT NULL DEFAULT '{}',
  school_id UUID REFERENCES schools(id),
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Banco de questões: ver próprias ou públicas" ON question_bank;
CREATE POLICY "Banco de questões: ver próprias ou públicas" ON question_bank
  FOR SELECT USING (
    auth.uid() = user_id
    OR is_public = TRUE
    OR public.is_master()
    OR (school_id IS NOT NULL AND public.is_school_staff(school_id))
  );

DROP POLICY IF EXISTS "Banco de questões: criar próprias" ON question_bank;
CREATE POLICY "Banco de questões: criar próprias" ON question_bank
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      school_id IS NULL
      OR public.is_master()
      OR public.can_manage_school(school_id)
      OR public.is_school_staff(school_id)
    )
  );

DROP POLICY IF EXISTS "Banco de questões: editar próprias" ON question_bank;
CREATE POLICY "Banco de questões: editar próprias" ON question_bank
  FOR UPDATE USING (
    auth.uid() = user_id
    OR public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
  );

DROP POLICY IF EXISTS "Banco de questões: deletar próprias" ON question_bank;
CREATE POLICY "Banco de questões: deletar próprias" ON question_bank
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
  );

-- 4. Criar perfil automaticamente quando usuário se cadastra
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 5. Histórico de revisões nas provas
ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_history JSONB DEFAULT '[]';

-- 6. Tabela de escolas (para organização escolar)
CREATE TABLE IF NOT EXISTS schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  admin_email TEXT,
  classes JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Escolas: ver" ON schools;
CREATE POLICY "Escolas: ver" ON schools
  FOR SELECT USING (public.is_master() OR public.is_school_staff(id));

DROP POLICY IF EXISTS "Escolas: admin gerencia" ON schools;
DROP POLICY IF EXISTS "Escolas: master cria" ON schools;
CREATE POLICY "Escolas: master cria" ON schools
  FOR INSERT WITH CHECK (public.is_master());

DROP POLICY IF EXISTS "Escolas: master ou dono edita" ON schools;
CREATE POLICY "Escolas: master ou dono edita" ON schools
  FOR UPDATE USING (public.can_manage_school(id))
  WITH CHECK (public.can_manage_school(id));

DROP POLICY IF EXISTS "Escolas: master exclui" ON schools;
CREATE POLICY "Escolas: master exclui" ON schools
  FOR DELETE USING (public.is_master());

-- 7. Vincular professores à escola e série
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_grade TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disciplines JSONB DEFAULT '[]';

-- 8. Colunas de logo e disciplinas na tabela de escolas
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS disciplines JSONB DEFAULT '[]';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS classes JSONB DEFAULT '[]';

-- 9. Convites de usuarios para escolas
CREATE TABLE IF NOT EXISTS user_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher',
  school_id UUID REFERENCES schools(id),
  school_grade TEXT,
  disciplines JSONB DEFAULT '[]',
  token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by UUID REFERENCES auth.users,
  accepted_by UUID REFERENCES auth.users,
  accepted_at TIMESTAMPTZ,
  canceled_by UUID REFERENCES auth.users,
  canceled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'teacher';
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS school_grade TEXT;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS disciplines JSONB DEFAULT '[]';
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES auth.users;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS canceled_by UUID REFERENCES auth.users;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days');

ALTER TABLE public.user_invites DROP CONSTRAINT IF EXISTS user_invites_school_roles_require_school;
ALTER TABLE public.user_invites
ADD CONSTRAINT user_invites_school_roles_require_school
CHECK (
  role NOT IN ('teacher', 'coordinator', 'school_owner', 'print_operator', 'impressao')
  OR school_id IS NOT NULL
) NOT VALID;

ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Convites: ver gerenciaveis" ON user_invites;
CREATE POLICY "Convites: ver gerenciaveis" ON user_invites
  FOR SELECT USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
    OR (
      school_id IS NOT NULL
      AND public.current_user_role() = 'coordinator'
      AND public.current_user_school_id() = school_id
      AND public.normalized_role(role) = 'teacher'
    )
    OR lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
  );

DROP POLICY IF EXISTS "Convites: criar gerenciaveis" ON user_invites;
CREATE POLICY "Convites: criar gerenciaveis" ON user_invites
  FOR INSERT WITH CHECK (
    public.is_master()
    OR (
      school_id IS NOT NULL
      AND public.can_manage_school(school_id)
      AND public.normalized_role(role) IN ('teacher', 'coordinator', 'print_operator')
    )
    OR (
      school_id IS NOT NULL
      AND public.current_user_role() = 'coordinator'
      AND public.current_user_school_id() = school_id
      AND public.normalized_role(role) = 'teacher'
    )
  );

DROP POLICY IF EXISTS "Convites: editar gerenciaveis" ON user_invites;
CREATE POLICY "Convites: editar gerenciaveis" ON user_invites
  FOR UPDATE USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
    OR (
      school_id IS NOT NULL
      AND public.current_user_role() = 'coordinator'
      AND public.current_user_school_id() = school_id
      AND public.normalized_role(role) = 'teacher'
    )
  )
  WITH CHECK (
    public.is_master()
    OR (
      school_id IS NOT NULL
      AND public.can_manage_school(school_id)
      AND public.normalized_role(role) IN ('teacher', 'coordinator', 'print_operator')
    )
    OR (
      school_id IS NOT NULL
      AND public.current_user_role() = 'coordinator'
      AND public.current_user_school_id() = school_id
      AND public.normalized_role(role) = 'teacher'
    )
  );

DROP POLICY IF EXISTS "Convites: excluir gerenciaveis" ON user_invites;
CREATE POLICY "Convites: excluir gerenciaveis" ON user_invites
  FOR DELETE USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
    OR (
      school_id IS NOT NULL
      AND public.current_user_role() = 'coordinator'
      AND public.current_user_school_id() = school_id
      AND public.normalized_role(role) = 'teacher'
    )
  );

CREATE OR REPLACE FUNCTION public.accept_user_invite(invite_token TEXT)
RETURNS VOID AS $$
DECLARE
  invite_row public.user_invites%ROWTYPE;
  current_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.';
  END IF;

  current_email := lower(COALESCE(auth.jwt()->>'email', ''));

  SELECT *
  INTO invite_row
  FROM public.user_invites
  WHERE token = invite_token
    AND accepted_at IS NULL
    AND canceled_at IS NULL
    AND COALESCE(expires_at, NOW()) >= NOW()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite invalido ou expirado.';
  END IF;

  IF lower(invite_row.email) <> current_email THEN
    RAISE EXCEPTION 'Este convite pertence a outro e-mail.';
  END IF;

  PERFORM set_config('app.accepting_invite', 'true', TRUE);

  INSERT INTO public.profiles (id, email, role, school_id, school_grade, disciplines)
  VALUES (
    auth.uid(),
    invite_row.email,
    invite_row.role,
    invite_row.school_id,
    invite_row.school_grade,
    COALESCE(invite_row.disciplines, '[]'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role,
      school_id = EXCLUDED.school_id,
      school_grade = EXCLUDED.school_grade,
      disciplines = EXCLUDED.disciplines;

  UPDATE public.user_invites
  SET accepted_at = NOW(),
      accepted_by = auth.uid()
  WHERE id = invite_row.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Provisionar o master inicial por UUID autenticado, fora das migracoes recorrentes.

-- Migracao 20260908_01 (identica ao arquivo dedicado)
-- Aplicar depois de backup. Usa o schema existente; nao altera provas antigas.

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

-- Migracao 20260908_02_escola_da_prova
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id);

-- Fotografia unica do vinculo disponivel. Nomes impressos nao sao identificadores.
-- Provas pessoais (NULL) nao devem adquirir uma escola ao reaplicar a migracao.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '20260908_02_escola_da_prova') THEN
    UPDATE public.exams exam
    SET school_id = owner_profile.school_id
    FROM public.profiles owner_profile
    WHERE owner_profile.id = exam.user_id AND exam.school_id IS NULL
      AND owner_profile.school_id IS NOT NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_exam_school()
RETURNS TRIGGER AS $$
DECLARE
  owner_school UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT school_id INTO owner_school FROM public.profiles WHERE id = NEW.user_id;
    IF auth.uid() IS NOT NULL AND NEW.school_id IS NOT NULL
      AND NEW.school_id IS DISTINCT FROM owner_school THEN
      RAISE EXCEPTION 'A prova deve pertencer a escola atual do autor.';
    END IF;
    -- Clientes antigos omitem school_id. A atribuicao sempre ocorre no servidor.
    NEW.school_id := COALESCE(NEW.school_id, owner_school);
  ELSIF auth.uid() IS NOT NULL AND NEW.school_id IS DISTINCT FROM OLD.school_id THEN
    RAISE EXCEPTION 'A escola da prova nao pode ser alterada pelo aplicativo.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS protect_exam_school_before_write ON public.exams;
CREATE TRIGGER protect_exam_school_before_write BEFORE INSERT OR UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.protect_exam_school();

CREATE OR REPLACE FUNCTION public.can_review_exam(target_exam_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.is_master() OR EXISTS (
    SELECT 1 FROM public.exams exam
    JOIN public.profiles current_profile ON current_profile.id = auth.uid()
    WHERE exam.id = target_exam_id
      AND exam.school_id IS NOT NULL
      AND exam.school_id = current_profile.school_id
      AND (
        public.normalized_role(current_profile.role) = 'school_owner'
        OR (public.normalized_role(current_profile.role) = 'coordinator'
          AND public.grade_list_contains_class(current_profile.school_grade, exam.class_name))
      )
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION public.can_print_exam(target_exam_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.is_master() OR EXISTS (
    SELECT 1 FROM public.exams exam
    JOIN public.profiles current_profile ON current_profile.id = auth.uid()
    WHERE exam.id = target_exam_id
      AND exam.school_id IS NOT NULL
      AND exam.school_id = current_profile.school_id
      AND public.normalized_role(current_profile.role) IN ('school_owner', 'print_operator')
      AND COALESCE(exam.print_status, 'nao_enviada') IN ('enviada', 'impressa')
  ), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

CREATE INDEX IF NOT EXISTS exams_school_review_updated_idx
  ON public.exams(school_id, review_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS exams_school_print_requested_idx
  ON public.exams(school_id, print_status, print_requested_at DESC);

INSERT INTO public.schema_migrations(version) VALUES ('20260908_02_escola_da_prova') ON CONFLICT DO NOTHING;

COMMIT;
