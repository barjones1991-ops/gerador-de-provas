# Migrações de segurança — 08/09/2026

Em 08/09/2026, o usuário informou que executou os scripts no Supabase e autorizou a publicação de todas as alterações. A execução foi manual pelo usuário; não houve verificação administrativa independente pelo agente.

A migração 01 acompanha o frontend publicado em `a518f8c`. A migração 02 integra o segundo lote autorizado para publicação. A execução do SQL não confirma, por si só, configurações de e-mail/SMTP nem testes com contas reais dos cinco perfis.

## Atualizar um ambiente existente

### Refinamento do fluxo do professor (migração 03)

Após as migrações 01/02, execute [20260908_03_fluxo_professor.sql](20260908_03_fluxo_professor.sql) inteiro no SQL Editor. Impede o professor de alterar ou excluir provas enviadas, em revisão, aprovadas ou bloqueadas. A coordenação mantém suas permissões; após devolução, o professor pode editar e reenviar. Não altera os dados das provas. Está incorporada ao setup para instalações novas. Execução no Supabase informada pelo usuário em 08/09/2026; sem verificação administrativa independente pelo agente.

Conferir com contas de teste: professor envia; tentativa de edição/exclusão é recusada; coordenação devolve; professor corrige e reenvia; coordenação aprova e encaminha para impressão.

### Procedimento inicial

1. Faça backup dos dados e do schema por uma ferramenta administrativa. Uma cópia do SQL do projeto não substitui backup de provas e usuários.
2. No SQL Editor do projeto correto, execute `20260908_01_seguranca.sql` inteiro. O script usa uma transação e registra a versão em `public.schema_migrations`.
3. Em Authentication, ative **Confirm email**. Configure SMTP e permita o retorno ao `login.html` do site publicado e ao endereço local usado na validação. A confirmação não é ativada por SQL.
4. Revise contas criadas enquanto a confirmação estava desativada e contas que receberam a antiga senha compartilhada. Não presuma que o indicador `email_confirmed_at` de uma conta antiga prova verificação de caixa postal.
5. Teste com contas controladas: acesso por escola, recuperação por e-mail, aceitar/cancelar convite, professor criar/enviar prova, coordenação aprovar e operador imprimir. Não use destinatários reais em testes de e-mail.
6. Valide o frontend local; publique o frontend somente depois dessa validação.

A migração remove a RPC de senha fixa, protege novos papéis/escopos e estados das provas, remove a leitura de tokens de convite pelo destinatário e impede reutilização concorrente de convites. Não promove contas, não apaga provas, não transfere escolas e não redefine senhas existentes.

Se a aplicação de uma instrução falhar, a transação deve ser revertida; não execute trechos restantes de forma avulsa. Corrija a causa e execute novamente o arquivo completo.

## Ambiente novo e primeiro master

Execute `setup_supabase.sql`, que inclui a migração. Crie e confirme a conta administrativa por Auth. Confira seu UUID e endereço no painel, sem confiar no campo de e-mail de `profiles`.

No SQL Editor administrativo, usando o UUID conferido:

```sql
-- Substitua o UUID de exemplo pelo UUID conferido em Authentication > Users.
UPDATE public.profiles AS profile
SET role = 'master'
FROM auth.users AS account
WHERE profile.id = account.id
  AND account.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND account.email_confirmed_at IS NOT NULL;
```

Confira que exatamente a conta pretendida foi alterada. Esse bootstrap é uma operação administrativa única, não deve ser acrescentado às migrações recorrentes.

## Migração 02: escola permanente da prova

Aplicar `20260908_02_escola_da_prova.sql` inteiro depois da migração 01 e da conferência abaixo. Novas instalações podem usar o `setup_supabase.sql` local, que contém ambas.

O servidor atribui `exams.school_id` na criação. Alterações desse campo pelo aplicativo são recusadas, inclusive para master. Coordenação e impressão consultam essa escola, mantendo os limites de turma e estado. Transferir ou desvincular um professor não desloca provas antigas. O autor conserva os direitos já existentes sobre suas próprias provas; a nova escola não recebe esse acesso. Cópias criadas como novas provas pertencem à escola atual do autor.

O sistema anterior não guardava a escola original por ID. Para provas existentes, a migração registra uma única vez a escola atual do autor; isso **não reconstrói transferências anteriores**. Antes de aplicar, confira o acervo com uma consulta administrativa:

```sql
SELECT exam.id, exam.title, exam.user_id, exam.school_name AS nome_impresso,
       profile.school_id AS escola_proposta, school.name AS nome_atual
FROM public.exams exam
LEFT JOIN public.profiles profile ON profile.id = exam.user_id
LEFT JOIN public.schools school ON school.id = profile.school_id
ORDER BY exam.user_id, exam.created_at;
```

O nome impresso é editável e serve apenas como apoio à conferência. Havendo divergências, prepare o mapeamento de UUIDs antes de migrar. No mesmo script/transação administrativa, depois do preenchimento inicial e antes do `COMMIT`, corrija os vínculos conferidos (inclusive `NULL` para prova pessoal). Isso evita uma janela de acesso à escola errada. Não aplique uma atribuição por semelhança de nomes.

Provas pessoais ficam com `school_id = NULL`. Reaplicar a migração ou o setup não vincula essas provas a uma escola adquirida posteriormente. O registro em `schema_migrations` controla esse preenchimento único; não remova esse registro para forçar reaplicação.

Depois da aplicação, confira que a escola A ainda acessa a prova antiga após transferir seu autor para B, que B não a acessa e que uma prova nova pertence a B. Confira também desvinculação, prova pessoal, limite de turma da coordenação e conclusão de impressão pela escola de origem.

## Verificação local

```bash
npm ci --ignore-scripts
npm test
```

Os testes executam as duas migrações sobre acervo fictício e reaplicam o setup completo duas vezes em PostgreSQL/PGlite temporário, com os cinco papéis e duas escolas. Incluem transferência, desvinculação, escola forjada por POST/PATCH, preservação de provas pessoais e acesso de revisão/impressão. Esse teste não substitui conferir as policies legadas, grants e configurações efetivamente presentes no Supabase.
