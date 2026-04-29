-- =============================================
-- EXECUTE ESTE SQL NO SUPABASE
-- Supabase > SQL Editor > New Query > Cole tudo > Run
-- =============================================

-- 1. Tabela de perfis dos professores
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  school_name TEXT,
  role TEXT DEFAULT 'professor',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'professor';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Funções auxiliares para evitar recursão nas policies de RLS
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_coordinator_or_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(public.current_user_role() IN ('coordenadora', 'admin'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "Perfil próprio: ver" ON profiles;
CREATE POLICY "Perfil próprio: ver" ON profiles
  FOR SELECT USING (auth.uid() = id OR public.is_coordinator_or_admin());

DROP POLICY IF EXISTS "Perfil próprio: criar" ON profiles;
CREATE POLICY "Perfil próprio: criar" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Perfil próprio: editar" ON profiles;
CREATE POLICY "Perfil próprio: editar" ON profiles
  FOR UPDATE USING (auth.uid() = id);

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

DROP POLICY IF EXISTS "Provas próprias: ver" ON exams;
CREATE POLICY "Provas próprias: ver" ON exams
  FOR SELECT USING (
    auth.uid() = user_id
    OR (
      review_status IN ('enviada', 'em_revisao', 'aprovada', 'devolvida', 'bloqueada')
      AND public.is_coordinator_or_admin()
    )
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
    OR public.is_coordinator_or_admin()
  );

DROP POLICY IF EXISTS "Provas próprias: deletar" ON exams;
CREATE POLICY "Provas próprias: deletar" ON exams
  FOR DELETE USING (auth.uid() = user_id);

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
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Banco de questões: ver próprias ou públicas" ON question_bank;
CREATE POLICY "Banco de questões: ver próprias ou públicas" ON question_bank
  FOR SELECT USING (auth.uid() = user_id OR is_public = TRUE);

DROP POLICY IF EXISTS "Banco de questões: criar próprias" ON question_bank;
CREATE POLICY "Banco de questões: criar próprias" ON question_bank
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Banco de questões: editar próprias" ON question_bank;
CREATE POLICY "Banco de questões: editar próprias" ON question_bank
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Banco de questões: deletar próprias" ON question_bank;
CREATE POLICY "Banco de questões: deletar próprias" ON question_bank
  FOR DELETE USING (auth.uid() = user_id);

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

-- 5. Definir usuÃ¡rio coordenador inicial
UPDATE profiles
SET role = 'coordenadora'
WHERE email = 'yesley@msn.com';
