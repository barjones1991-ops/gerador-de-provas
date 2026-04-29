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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Perfil próprio: ver" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Perfil próprio: criar" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Provas próprias: ver" ON exams
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Provas próprias: criar" ON exams
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Provas próprias: editar" ON exams
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Provas próprias: deletar" ON exams
  FOR DELETE USING (auth.uid() = user_id);

-- 3. Criar perfil automaticamente quando usuário se cadastra
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
