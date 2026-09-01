# Seguranca, Backup e Escala

Este arquivo registra as regras minimas da Etapa 8 para manter o Gerador de Provas operavel com dados reais de escolas.

## Seguranca

- Nunca commitar `.env`, service role key, senhas, tokens privados ou exports com dados reais de alunos/professores.
- A anon key do Supabase e publica por natureza, mas deve depender das policies RLS. Ela nao substitui regra de seguranca no banco.
- Toda funcao `SECURITY DEFINER` precisa ter uma verificacao explicita de permissao antes de alterar dados sensiveis.
- Alteracoes em `profiles.role`, `profiles.school_id`, `profiles.school_grade`, `profiles.disciplines`, `exams.review_status`, `exams.print_status` e `user_invites` precisam de teste ou revisao manual antes de publicar.
- O reset administrativo de senha deve continuar marcando `force_password_change = TRUE` e proibindo manter `123456` como senha definitiva.

## Backup

- Antes de mexer em schema, RLS ou funcoes RPC, salvar uma copia do `setup_supabase.sql` no historico do Git.
- No Supabase, antes de grandes mudancas, exportar o schema pelo painel ou CLI e guardar fora do navegador.
- Depois de aplicar SQL no Supabase, validar login, convite, revisao, impressao e dashboard com pelo menos um perfil real.
- Para restaurar rapidamente a estrutura do projeto, usar o ultimo commit estavel do GitHub e reaplicar `setup_supabase.sql` no SQL Editor.

## Escala

- Evitar consultas com `select=*` em telas que podem crescer muito; preferir colunas explicitas e paginacao.
- Manter imagens comprimidas. Logos e imagens de questoes em base64 aumentam o tamanho das linhas no banco.
- Se muitas provas com imagens forem usadas, mover imagens para Supabase Storage e salvar apenas URLs no banco.
- Listagens de provas, banco de questoes, convites e usuarios devem ganhar `limit`/paginacao antes de uso com muitas escolas.
- O painel Master deve ser usado para monitorar escolas sem dono, sem coordenacao, sem professor ou com convites pendentes/cancelados.

## Criterio de Pronto da Etapa 8

- `.env.example` sem credenciais reais.
- `.gitignore` protege `.env` e variantes locais.
- Testes impedem service role key e JWT real em arquivos de exemplo.
- Guia operacional documenta seguranca, backup e escala.
- `npm test` aprovado antes de publicar.