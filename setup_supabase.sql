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
  school_name TEXT,
  role TEXT DEFAULT 'professor',
  force_password_change BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'professor';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  admin_email TEXT,
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
    ELSE raw_role
  END;
$$ LANGUAGE sql IMMUTABLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_manager_roles_require_school'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_manager_roles_require_school
    CHECK (
      public.normalized_role(role) NOT IN ('school_owner', 'coordinator')
      OR school_id IS NOT NULL
    ) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT public.normalized_role(role)
  FROM public.profiles
  WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_coordinator_or_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_role() IN ('master', 'school_owner', 'coordinator'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.current_user_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_role() = 'master', FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_school_owner(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.current_user_role() = 'school_owner'
    AND public.current_user_school_id() = target_school_id,
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_school_staff(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.current_user_role() IN ('school_owner', 'coordinator', 'teacher')
    AND public.current_user_school_id() = target_school_id,
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.can_manage_school(target_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.is_master() OR public.is_school_owner(target_school_id), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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
            AND public.normalized_role(target_profile.role) IN ('coordinator', 'teacher')
          )
          OR (
            public.current_user_role() = 'coordinator'
            AND public.normalized_role(target_profile.role) = 'teacher'
          )
        )
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(target_profile_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT (public.is_master() OR public.can_manage_profile(target_profile_id)) THEN
    RAISE EXCEPTION 'Apenas usuarios autorizados podem resetar senhas.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_profile_id) THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"force_password_change": true}'::jsonb,
      updated_at = NOW()
  WHERE id = target_profile_id;

  UPDATE public.profiles
  SET force_password_change = TRUE
  WHERE id = target_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

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
    NEW.school_name = OLD.school_name;
    NEW.school_id = OLD.school_id;
    NEW.school_grade = OLD.school_grade;
    NEW.disciplines = OLD.disciplines;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'rascunho';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_review_exam(target_exam_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    public.is_master()
    OR EXISTS (
      SELECT 1
      FROM public.exams exam
      JOIN public.profiles owner_profile ON owner_profile.id = exam.user_id
      WHERE exam.id = target_exam_id
        AND public.current_user_role() IN ('school_owner', 'coordinator')
        AND public.current_user_school_id() IS NOT NULL
        AND public.current_user_school_id() = owner_profile.school_id
    ),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "Provas próprias: ver" ON exams;
CREATE POLICY "Provas próprias: ver" ON exams
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.can_review_exam(id)
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
  INSERT INTO public.profiles (id, email, full_name, school_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'school_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_invites_school_roles_require_school'
      AND conrelid = 'public.user_invites'::regclass
  ) THEN
    ALTER TABLE public.user_invites
    ADD CONSTRAINT user_invites_school_roles_require_school
    CHECK (
      role NOT IN ('teacher', 'coordinator', 'school_owner')
      OR school_id IS NOT NULL
    ) NOT VALID;
  END IF;
END $$;

ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Convites: ver gerenciaveis" ON user_invites;
CREATE POLICY "Convites: ver gerenciaveis" ON user_invites
  FOR SELECT USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
    OR lower(email) = lower(COALESCE(auth.jwt()->>'email', ''))
  );

DROP POLICY IF EXISTS "Convites: criar gerenciaveis" ON user_invites;
CREATE POLICY "Convites: criar gerenciaveis" ON user_invites
  FOR INSERT WITH CHECK (
    public.is_master()
    OR (
      school_id IS NOT NULL
      AND public.can_manage_school(school_id)
      AND role IN ('teacher', 'coordinator')
    )
  );

DROP POLICY IF EXISTS "Convites: editar gerenciaveis" ON user_invites;
CREATE POLICY "Convites: editar gerenciaveis" ON user_invites
  FOR UPDATE USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
  )
  WITH CHECK (
    public.is_master()
    OR (
      school_id IS NOT NULL
      AND public.can_manage_school(school_id)
      AND role IN ('teacher', 'coordinator')
    )
  );

DROP POLICY IF EXISTS "Convites: excluir gerenciaveis" ON user_invites;
CREATE POLICY "Convites: excluir gerenciaveis" ON user_invites
  FOR DELETE USING (
    public.is_master()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
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

-- 10. Definir usuário master inicial
UPDATE profiles
SET role = 'master'
WHERE email = 'yesley@msn.com';
