-- Aplicar depois de 20260908_01_seguranca.sql e de conferir o vinculo legado.
BEGIN;

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
