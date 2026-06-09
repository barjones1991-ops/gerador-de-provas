# GERADOR DE PROVAS - Guia Operacional

## Objetivo do Projeto

Plataforma web para professores criarem, salvarem, revisarem e imprimirem provas escolares.

- Frontend em HTML, CSS e JavaScript puro.
- Backend, autenticação e banco de dados via Supabase.
- Sem framework, sem build step e sem SDK do Supabase.
- Hospedagem prevista no GitHub Pages.

Links:

- Site: https://barjones1991-ops.github.io/gerador-de-provas/
- Repositório: https://github.com/barjones1991-ops/gerador-de-provas

## Estado Atual

O projeto já tem a base principal implementada:

- Login, cadastro, recuperação de senha e sessão local.
- Dashboard do professor.
- Editor visual de provas.
- Impressão/PDF com e sem gabarito.
- Banco de questões.
- Fluxo de coordenação pedagógica.
- Gestão de escolas, vínculo de professores, séries e disciplinas.
- Testes automatizados em `tests/run-tests.js`.

Este arquivo não deve virar histórico de tudo que já foi feito. Use-o como mapa rápido para próximas sessões.

## Como Retomar uma Sessão

Antes de alterar qualquer coisa:

```bash
git status --short --branch
npm test
```

Para conferir o remoto:

```bash
git remote -v
git fetch --dry-run --verbose origin
```

Para publicar:

```bash
git add -A
git commit -m "descrição objetiva da alteração"
git push
```

Regra de publicação: sempre verificar se a alteração também exige atualização no Supabase. Se envolver tabelas, colunas, policies RLS, Auth, triggers, roles, storage ou payloads salvos no banco, atualizar `setup_supabase.sql`, aplicar no SQL Editor do Supabase e testar Auth/REST antes de considerar a entrega concluída.

## Arquivos Principais

- `index.html`: entrada pública.
- `login.html`: login, cadastro e recuperação de senha.
- `dashboard.html`: lista de provas, filtros, perfil e ações do professor.
- `editor.html`: editor principal de provas e banco de questões.
- `print.html`: renderização limpa para impressão/PDF.
- `coordenacao.html`: revisão, aprovação, devolução e bloqueio de provas.
- `schools.html`: gestão de escolas e vínculos.
- `config.js`: configuração do Supabase e exposição de `window.CONFIG`.
- `js/auth.js`: `AuthManager`, sessão, login e requisições autenticadas.
- `setup_supabase.sql`: schema, policies RLS, triggers e tabelas do Supabase.
- `tests/run-tests.js`: fonte rápida de contratos esperados pelo app.

## Supabase

Projeto configurado:

- Project URL: `https://birtgmrtaryfjogegimn.supabase.co`
- Project ref: `birtgmrtaryfjogegimn`
- Anon key: configurada em `config.js`

Observação importante: o projeto pode ficar pausado por inatividade no plano gratuito. Se a URL não resolver DNS ou Auth/REST não responderem, verificar primeiro no dashboard da Supabase se o projeto precisa ser restaurado.

Teste rápido depois de restaurar:

```bash
# No navegador ou via terminal:
https://birtgmrtaryfjogegimn.supabase.co/auth/v1/settings
```

Se for necessário recriar o backend, executar `setup_supabase.sql` no SQL Editor do Supabase e atualizar `config.js` com a nova URL e anon key.

## Contratos Que Não Devem Quebrar

- `config.js` precisa definir `window.CONFIG`; `const CONFIG` sozinho não basta no navegador.
- Redirects devem ser relativos, como `dashboard.html`, por causa do GitHub Pages em subpasta.
- A sessão fica em `localStorage` na chave `supabase.auth.token`.
- O rascunho local do editor deve existir apenas para prova nova ainda não salva e usuário logado: `gerador-provas-state-v1:<userId>`.
- Ao criar nova prova, limpar `editExamId` e o rascunho local daquele usuário antes de abrir o editor.
- Depois que uma prova nova é salva na nuvem, apagar o rascunho local para ela não voltar ao clicar em "Nova Prova".
- Ao editar prova existente, não enviar `user_id`; isso evita trocar o dono quando a coordenação salva ajustes.
- `DELETE` no Supabase pode retornar `204` sem corpo; `AuthManager.authenticatedRequest()` deve aceitar resposta vazia.
- Provas `aprovada` ou `bloqueada` não devem ser editáveis pelo professor.
- Questões do banco são privadas por padrão (`is_public: false`).
- Imagens ficam como data URL; cuidar de tamanho, compressão e peso da prova.

## Banco de Dados Esperado

As tabelas principais estão descritas e criadas em `setup_supabase.sql`:

- `profiles`: professor, coordenadora/admin, escola, série e disciplinas.
- `exams`: dados da prova, questões JSONB, status de revisão, histórico e bloqueios.
- `question_bank`: questões reutilizáveis privadas ou públicas.
- `schools`: escolas, logo e disciplinas.

O SQL também define:

- RLS nas tabelas principais.
- Policies idempotentes com `DROP POLICY IF EXISTS`.
- Funções auxiliares `current_user_role()` e `is_coordinator_or_admin()`.
- Trigger `on_auth_user_created` para criar perfil ao cadastrar usuário.

## Tipos de Questão

A lista completa e verificável fica em `tests/run-tests.js` na constante `questionTypes`.

Ao adicionar ou alterar um tipo de questão, revisar todos estes pontos:

- Opção/entrada no editor.
- Estado padrão e normalizadores.
- Renderização no preview.
- Renderização em `print.html`.
- Gabarito, quando aplicável.
- Salvamento/carregamento em `exams.questions`.
- Compatibilidade com banco de questões.
- Teste correspondente em `tests/run-tests.js`.

## Fluxos Principais

Autenticação:

1. `login.html` chama `AuthManager.signIn()` ou `signUp()`.
2. `AuthManager` salva sessão no localStorage.
3. Páginas protegidas validam autenticação.
4. Logout remove a sessão.

Professor:

1. Entra no dashboard.
2. Cria ou edita prova no editor.
3. Salva na nuvem.
4. Envia para coordenação quando necessário.
5. Imprime prova ou prova com gabarito.

Coordenação:

1. Abre `coordenacao.html`.
2. Revisa provas enviadas.
3. Pode editar ajustes sem trocar o dono original.
4. Aprova, devolve com observação ou bloqueia.
5. Histórico fica em `review_history`.

Escolas:

1. Coordenação/admin usa `schools.html`.
2. Cadastra escola, logo e disciplinas.
3. Vincula professores a escola, série e disciplinas.
4. Dashboard e editor refletem esses dados.

## Testes

Rodar sempre antes de publicar:

```bash
npm test
```

Os testes verificam:

- Existência dos arquivos principais.
- Sintaxe dos scripts inline e JS.
- IDs duplicados.
- Links e scripts locais.
- Configuração do Supabase.
- `AuthManager`.
- Tipos de questão no editor e impressão.
- Banco de questões.
- Fluxo de coordenação.
- SQL do Supabase.
- Servidor HTTP local retornando 200 nas páginas públicas.

## Pendências Reais / Próximos Cuidados

- Confirmar se o projeto Supabase foi restaurado após pausa por inatividade.
- Considerar mover credenciais para um fluxo menos manual; hoje a anon key pública fica em `config.js`.
- Revisar textos com mojibake em alguns arquivos se aparecerem quebrados no navegador.
- Evitar transformar `CLAUDE.md` em checklist histórico; melhorias concluídas devem sair daqui e ficar no git/testes.

## Plano de Ajuste de Fluxo

Status: implementado no commit `7908c76`.

Os 10 pontos da auditoria de fluxo foram consolidados em correções no login, editor, dashboard, coordenação, impressão, escolas, testes e SQL do Supabase. Não manter aqui o checklist detalhado como se ainda estivesse pendente; para conferir o comportamento esperado, usar `tests/run-tests.js` e o histórico do git.

Antes de iniciar qualquer correção ou refatoração, verificar o fluxo completo afetado pela mudança: tela de origem, botão/ação, destino, estado salvo no navegador, estado salvo no Supabase, retorno em caso de erro e caminho para desfazer/cancelar. Durante a implementação, se aparecer uma quebra, bug, inconsistência ou novo risco que não faça parte do escopo imediato, registrar o achado neste arquivo em "Achados Para Ajuste Posterior" antes de continuar. Não deixar achados relevantes apenas na memória da sessão.

### Fluxo de Execução

Para cada correção:

```bash
git status --short --branch
npm test
```

- Atualizar ou criar teste em `tests/run-tests.js`.
- Rodar `npm test`.
- Verificar se houve mudança de schema, RLS, Auth, roles ou formato de dados.
- Se houve impacto Supabase, atualizar `setup_supabase.sql`, aplicar no SQL Editor do Supabase e testar Auth/REST.
- Commitar com mensagem objetiva.

### Achados Para Ajuste Posterior

Registrar aqui bugs ou inconsistências encontrados durante correções/refatorações quando não forem resolvidos no mesmo commit.

- Confirmar aplicação no Supabase real das alterações de `setup_supabase.sql`: trigger de proteção dos campos de vínculo em `profiles` e policy que impede professor de deletar provas `aprovada` ou `bloqueada`.
- Depois de restaurar o projeto Supabase pausado, testar Auth/REST com anon key e validar login, criação de prova, envio para revisão e bloqueio de exclusão.
