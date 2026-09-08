BEGIN;
-- Professor acompanha a revisão; edição e exclusão retornam após devolução.
CREATE OR REPLACE FUNCTION public.protect_teacher_review_stage()
RETURNS TRIGGER AS $$
BEGIN
  IF public.current_user_role() = 'teacher'
    AND OLD.review_status IN ('enviada', 'em_revisao', 'aprovada', 'bloqueada') THEN
    RAISE EXCEPTION 'A prova esta com a coordenacao. Aguarde a devolucao para editar.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
DROP TRIGGER IF EXISTS protect_teacher_review_stage_before_write ON public.exams;
CREATE TRIGGER protect_teacher_review_stage_before_write
BEFORE UPDATE OR DELETE ON public.exams FOR EACH ROW
EXECUTE FUNCTION public.protect_teacher_review_stage();
INSERT INTO public.schema_migrations(version) VALUES ('20260908_03_fluxo_professor') ON CONFLICT DO NOTHING;
COMMIT;
