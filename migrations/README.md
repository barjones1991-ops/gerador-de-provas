# Migração de segurança — 08/09/2026

Esta entrega não foi aplicada automaticamente ao projeto Supabase real. O ambiente disponível não tem CLI autenticada, acesso administrativo ou navegador conectado ao painel.

## Atualizar um ambiente existente

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

## Verificação local

```bash
npm ci --ignore-scripts
npm test
```

Os testes executam o schema duas vezes e a migração em um PostgreSQL/PGlite temporário, com usuários fictícios nos cinco papéis e duas escolas. Esse teste não substitui conferir as policies legadas, grants e configurações efetivamente presentes no Supabase.
