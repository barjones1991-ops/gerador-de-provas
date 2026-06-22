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

Regra de validação local: depois de qualquer alteração, rodar `npm test` e abrir o projeto em servidor local para o usuário verificar se ficou de acordo com as expectativas. Só publicar no GitHub depois dessa validação do usuário.

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
- Rodar o programa localmente e compartilhar o endereço local com o usuário.
- Aguardar a validação do usuário antes de enviar para o GitHub.
- Verificar se houve mudança de schema, RLS, Auth, roles ou formato de dados.
- Se houve impacto Supabase, atualizar `setup_supabase.sql`, aplicar no SQL Editor do Supabase e testar Auth/REST.
- Commitar com mensagem objetiva.

## Plano Futuro: Perfis de Acesso

Objetivo: refinar o sistema de permissoes para separar claramente acesso master, dono da escola, coordenacao e professor. Este plano deve ser executado em partes, com testes e validacao local a cada etapa.

### Status Atual dos Perfis

Ultima validacao local: `npm test` passou e o servidor local respondeu em `http://127.0.0.1:8000/index.html`.

Ja foi feito no codigo:

- O sistema reconhece os papeis novos `master`, `school_owner`, `coordinator` e `teacher`.
- Os papeis antigos continuam funcionando por compatibilidade:
  - `admin` equivale a `master`.
  - `coordenadora` equivale a `coordinator`.
  - `professor` equivale a `teacher`.
- `js/auth.js` tem helpers centralizados:
  - `normalizeRole()`
  - `loadCurrentProfile()`
  - `canManageSchools()`
  - `canManageUsers()`
  - `canReviewExams()`
  - `canEditExam(exam)`
  - `canDeleteExam(exam)`
  - `canManageQuestionBank()`
- `setup_supabase.sql` foi atualizado com funcoes auxiliares, policies RLS e convite/cadastro assistido por token.
- `setup_supabase.sql` agora tambem bloqueia no banco `school_owner` e `coordinator` sem `school_id`.
- `dashboard.html` usa os helpers para liberar dashboard ampliado, coordenacao e escolas conforme perfil.
- `coordenacao.html` aceita `master`, `school_owner` e `coordinator`.
- `schools.html` foi evoluido de "professores" para gestao de equipe:
  - lista professor, coordenacao, dono da escola e master;
  - `master` pode definir `teacher`, `coordinator` e `school_owner`;
  - `school_owner` pode alternar equipe da propria escola entre `teacher` e `coordinator`;
  - `coordinator` pode editar dados pedagogicos/resetar senha de professores da propria escola, mas nao altera perfil de acesso;
  - ao definir `school_owner` ou `coordinator`, a tela exige e salva a escola de acesso no `school_id`;
  - vinculo inicial por e-mail ficou restrito a `master`;
  - `master` pode gerar link de convite para novo usuario com escola, papel, series e disciplinas.
  - `master` e `school_owner` visualizam convites gerados, com status pendente/aceito/expirado.
  - convites ainda nao aceitos podem ser cancelados pela tela de escolas.
  - `school_owner` pode gerar convites apenas para `teacher` e `coordinator` da propria escola; somente `master` convida `school_owner`.
  - tela de escolas tem resumo de acessos para apoiar migracao: totais por perfil, usuarios sem escola e convites pendentes/expirados.
- `login.html` aceita `?invite=<token>` e aplica o convite apos login/cadastro pela RPC `accept_user_invite`.
- `setup_supabase.sql` tem tabela `user_invites`, policies RLS e RPC `accept_user_invite`.
- `editor.html` carrega o perfil atual e salva `school_id` em itens do banco de questoes quando disponivel.
- `editor.html` tem controles visuais para banco de questoes com escopos `private`, `school` e `public`.
- O banco de questoes permite salvar, filtrar e alterar escopo de questoes acessiveis conforme permissao.
- `login.html` redireciona por perfil quando nao existe `return_to` seguro:
  - `master` e `school_owner` vao para `schools.html`;
  - `coordinator` vai para `coordenacao.html`;
  - `teacher` e fallback vao para `dashboard.html`.
- `tests/run-tests.js` cobre os novos helpers, roles, policies e regras principais.
- `CLAUDE.md` foi atualizado com as decisoes desta etapa.

Ja foi feito no Supabase:

- O usuario aplicou uma primeira versao do `setup_supabase.sql`.
- O usuario reaplicou a versao atual do `setup_supabase.sql` depois dos ajustes de perfis, RLS, convites e resumo de migracao.
- O endpoint REST do Supabase respondeu `HTTP 200` com a anon key.
- O endpoint Auth respondeu, com `401` esperado quando chamado sem credenciais.

Historico de ajustes incluidos na versao atual aplicada no Supabase:

- criacao da funcao `public.normalized_role(raw_role TEXT)`;
- promocao inicial de `yesley@msn.com` para `master`;
- `WITH CHECK` na policy de edicao de perfis;
- regras atualizadas para gestao de equipe em `schools.html` e testes correspondentes.
- tabela/RPC de convites `user_invites` e `accept_user_invite`.
- listagem e cancelamento de convites em `schools.html`.
- resumo de acessos/migracao em `schools.html`.

Atencao: apos a ultima reaplicacao informada pelo usuario, foi adicionado um novo ajuste em `setup_supabase.sql`:

- constraints idempotentes para impedir `school_owner`/`coordinator` sem `school_id` em `profiles` e convites escolares sem `school_id` em `user_invites`.

Ainda falta antes de publicar:

- Reaplicar no Supabase a versao atual do `setup_supabase.sql` para incluir as novas constraints de `school_id`.
- Confirmar no Supabase que `yesley@msn.com` esta com `role = 'master'`.
- Mapear usuarios reais para os novos papeis:
  - quem sera `master`;
  - quem sera `school_owner`;
  - quem sera `coordinator`;
  - quem continuara como `teacher`.
- Vincular `school_owner`, `coordinator` e `teacher` a `school_id` correto.
- Testar login real com pelo menos um usuario de cada perfil.
- Testar em navegador:
  - `master` cria/edita/exclui escola e altera perfis;
  - `master` define `school_owner` e `coordinator` escolhendo explicitamente a escola de acesso;
  - `school_owner` gerencia equipe da propria escola e nao ve outras escolas;
  - `coordinator` revisa provas e edita dados pedagogicos de professores da propria escola;
  - `teacher` cria/edita apenas as proprias provas dentro das regras de status.
- Testar banco de questoes com escopo por escola usando usuarios reais.
- Testar convite real: gerar link no `schools.html`, ver o convite na lista, cadastrar/entrar pelo link, confirmar aplicacao de `role`, `school_id`, series e disciplinas, e testar cancelamento de um convite pendente.
- Conferir o resumo de acessos em `schools.html` para identificar usuarios sem escola antes de publicar.
- So publicar no GitHub depois da validacao do usuario.

Roteiro de validacao real apos SQL aplicado:

- Validacao `master`:
  - entrar com `yesley@msn.com`;
  - confirmar redirecionamento para `schools.html`;
  - criar uma escola de teste;
  - editar nome, cidade, logo e disciplinas da escola;
  - gerar convite para `teacher`, `coordinator` e `school_owner`;
  - cancelar um convite pendente;
  - conferir o resumo de acessos.
- Validacao `school_owner`:
  - entrar com usuario vinculado a uma escola como `school_owner`;
  - confirmar que ve apenas dados da propria escola;
  - editar dados da propria escola;
  - gerar convite apenas para `teacher` e `coordinator`;
  - confirmar que nao consegue criar outra escola nem definir outro `school_owner`.
- Validacao `coordinator`:
  - entrar com usuario `coordinator`;
  - confirmar acesso a `coordenacao.html`;
  - revisar prova de professor da propria escola;
  - devolver/aprovar/bloquear uma prova de teste;
  - confirmar que nao consegue alterar perfil de acesso nem criar escola.
- Validacao `teacher`:
  - entrar com usuario `teacher`;
  - confirmar redirecionamento para `dashboard.html`;
  - criar prova propria;
  - enviar para revisao;
  - confirmar que nao acessa `schools.html`;
  - confirmar que prova aprovada/bloqueada nao fica editavel pelo professor.
- Validacao de convite:
  - abrir o link de convite em navegador sem sessao ativa;
  - cadastrar ou entrar com o mesmo e-mail do convite;
  - confirmar aplicacao de `role`, `school_id`, series e disciplinas;
  - tentar usar convite expirado/cancelado e confirmar bloqueio.

### Papeis Oficiais

`master`

- Acesso maximo ao sistema inteiro.
- Pode criar, editar e excluir escolas.
- Pode gerenciar usuarios, vinculos, provas, questoes, series, disciplinas e configuracoes.
- Deve ser tratado como dono da plataforma, nao como usuario comum de uma escola.

`school_owner`

- Dono ou gestor de uma escola especifica.
- Pode gerenciar tudo que pertence a propria escola.
- Pode gerenciar professores, coordenacao, provas, banco de questoes da escola, series, disciplinas e configuracoes da escola.
- Nao pode acessar dados de outras escolas.
- Recomendacao inicial: pode criar, editar vinculos e desativar usuarios da escola, mas exclusao definitiva de usuarios deve ficar restrita ao `master`.

`coordinator`

- Coordenacao pedagogica vinculada a uma escola.
- Pode revisar, aprovar, devolver, bloquear e acompanhar provas dos professores da escola.
- Pode visualizar professores e dados pedagogicos da escola.
- Nao deve ter poder total administrativo, como excluir escola ou alterar dono.

`teacher`

- Professor vinculado a uma escola.
- Pode criar, editar, salvar, enviar para coordenacao e imprimir as proprias provas.
- Pode usar o banco de questoes permitido.
- Nao deve acessar provas privadas de outros professores, salvo regras explicitas de compartilhamento.

### Matriz Inicial de Permissoes

| Acao | master | school_owner | coordinator | teacher |
| --- | --- | --- | --- | --- |
| Criar escola | Sim | Nao | Nao | Nao |
| Editar qualquer escola | Sim | Nao | Nao | Nao |
| Editar propria escola | Sim | Sim | Parcial, se definido | Nao |
| Excluir escola | Sim | Nao | Nao | Nao |
| Criar usuario | Sim | Sim, na propria escola | Talvez, se definido | Nao |
| Desativar usuario | Sim | Sim, na propria escola | Talvez, se definido | Nao |
| Excluir usuario definitivamente | Sim | Nao | Nao | Nao |
| Criar prova | Sim | Sim | Talvez, se definido | Sim |
| Editar prova propria | Sim | Sim | Conforme fluxo de revisao | Sim, se permitido pelo status |
| Editar prova de professor da escola | Sim | Sim | Sim, conforme fluxo de revisao | Nao |
| Revisar prova | Sim | Sim | Sim | Nao |
| Aprovar/devolver/bloquear prova | Sim | Sim | Sim | Nao |
| Excluir prova | Sim | Sim, na propria escola | Talvez, se definido | Propria, se permitido |
| Gerenciar banco de questoes | Sim | Sim | Parcial ou sim, se definido | Proprio |
| Ver dados de outra escola | Sim | Nao | Nao | Nao |

### Parte 1: Decisao de Produto

Status: parcialmente concluida.

- Decidido nesta etapa: vinculo inicial por e-mail fica restrito ao `master`.
- Feito nesta etapa: fluxo seguro de convite/cadastro assistido por token foi implementado localmente.
- Decidido nesta etapa: `school_owner` pode gerenciar equipe ja vinculada a propria escola e alternar perfis entre `teacher` e `coordinator`.
- Decidido nesta etapa: `school_owner` so pode ser definido por `master`.
- Decidido nesta etapa: todo `school_owner` e `coordinator` precisa ter `school_id` definido no momento do vinculo ou alteracao de perfil.
- Decidido nesta etapa: `coordinator` pode editar dados pedagogicos e resetar senha de professores da propria escola, mas nao altera perfil de acesso.
- Confirmar em etapa futura se provas podem ser criadas por `master`, `school_owner` e `coordinator`, ou se criacao fica principalmente com professor.
- Decidido nesta etapa: banco de questoes tem controles visuais para escopos privado, escola e publico.

### Parte 2: Banco de Dados e Supabase

Status: implementada no arquivo e reaplicada no Supabase; pendente validacao completa com usuarios reais.

- Feito: `profiles` suporta os papeis `master`, `school_owner`, `coordinator` e `teacher`, com compatibilidade para papeis antigos.
- Feito: usuarios vinculados a escola usam `school_id`.
- Feito: `schools`, `exams` e `question_bank` foram revisados para escopo por escola.
- Feito: `setup_supabase.sql` tem funcoes auxiliares, policies RLS e convites por token atualizados.
- Feito: policies seguem padrao idempotente com `DROP POLICY IF EXISTS`.
- Feito: usuario informou que a versao atual do SQL ja foi aplicada no Supabase.
- Feito no arquivo: constraints de integridade exigem `school_id` para `school_owner`, `coordinator` e convites escolares.
- Pendente: reaplicar o SQL no Supabase por causa das novas constraints de integridade.
- Pendente: avaliar se sera necessario permitir mais de uma escola por usuario no futuro.
- Pendente: validar RLS e fluxos reais com usuarios de cada perfil.

Funcoes auxiliares recomendadas:

- `is_master()`
- `is_school_owner(target_school_id)`
- `is_school_staff(target_school_id)`
- `can_manage_school(target_school_id)`
- `can_review_exam(target_exam_id)`

### Parte 3: RLS e Seguranca

Status: implementada no SQL, pendente de validacao com usuarios reais por perfil.

- Feito no SQL: `master` tem acesso amplo.
- Feito no SQL: `school_owner` fica restrito a propria escola.
- Feito no SQL: `coordinator` fica restrito aos professores/provas da propria escola.
- Feito no SQL: `teacher` fica restrito aos proprios dados e conteudos permitidos.
- Feito no SQL: exclusao de escolas fica restrita ao `master`.
- Feito parcialmente: Auth/REST responderam, mas ainda falta teste funcional logado com cada papel.

### Parte 4: AuthManager e Helpers de Permissao

Status: concluida localmente.

- Feito: `js/auth.js` carrega perfil completo com `loadCurrentProfile()`.
- Feito: papel, escola e permissoes do usuario atual ficam padronizados.
- Feito: helpers reutilizaveis foram criados para evitar regras duplicadas.

Helpers sugeridos:

- `canManageSchools()`
- `canManageUsers()`
- `canReviewExams()`
- `canEditExam(exam)`
- `canDeleteExam(exam)`
- `canManageQuestionBank()`

### Parte 5: Ajuste das Telas

Status: parcialmente concluida.

`dashboard.html`

- Feito: professor ve as proprias provas.
- Feito: coordenacao/dono/master usam consulta ampliada protegida pela RLS.
- Pendente: validar visualmente com usuario real de cada papel.

`editor.html`

- Feito: professor edita apenas provas proprias enquanto o status permitir.
- Feito: coordenacao pode editar ajustes no fluxo de revisao sem trocar o dono original.
- Feito: banco de questoes salva `school_id` quando disponivel.
- Feito: banco de questoes tem controle visual de escopo ao salvar, filtrar e alterar questoes.
- Pendente: validar edicao real com `school_owner` e `master`.

`coordenacao.html`

- Feito: liberada para `coordinator`, `school_owner` e `master`.
- Feito: restricao por escola depende da RLS.
- Pendente: validar com usuarios reais.

`schools.html`

- Feito: `master` cria, edita e exclui escolas.
- Feito: `master` gerencia perfis `teacher`, `coordinator` e `school_owner`.
- Feito: a edicao de equipe tem seletor de escola de acesso para salvar `school_id` junto com o perfil.
- Feito: `school_owner` e `coordinator` nao podem ser definidos sem escola vinculada.
- Feito: `school_owner` edita a propria escola e alterna equipe entre `teacher` e `coordinator`.
- Feito: `coordinator` gerencia dados pedagogicos de professores da propria escola, sem alterar perfil de acesso.
- Feito: `teacher` nao acessa.
- Feito localmente: `master` gera link de convite para novos usuarios.
- Feito: tela mostra resumo de acessos para apoiar migracao e auditoria dos perfis.
- Pendente: validar convite real no Supabase depois de reaplicar o SQL atual.

`print.html`

- Feito por RLS: impressao via prova salva respeita permissao de acesso a prova.
- Pendente: validar com usuarios reais.

`login.html`

- Feito: se nao houver `return_to`, redireciona por papel apos login.

### Parte 6: Testes

Status: concluida localmente para contratos estaticos; pendente teste manual com usuarios reais.

- Feito: `tests/run-tests.js` cobre novos papeis.
- Feito: testa existencia dos helpers de permissao.
- Feito: testa funcoes e policies esperadas em `setup_supabase.sql`.
- Feito: testa bloqueios por tela e regras principais de acesso.
- Feito: testa que `master` existe como perfil superior.
- Pendente: teste manual real logado em cada perfil.

### Parte 7: Migracao de Usuarios Existentes

Status: parcialmente apoiada por tela de auditoria; pendente de dados reais.

- Pendente: mapear usuarios atuais antes de publicar.
- Pendente: converter admins atuais para `master` ou `school_owner`, conforme decisao.
- Pendente: converter coordenadoras atuais para `coordinator`.
- Pendente: manter professores como `teacher`.
- Pendente: garantir `school_id` correto para usuarios vinculados a escolas.
- Feito localmente: `schools.html` destaca usuarios sem escola e contagens por perfil para ajudar essa conferencia.
- Pendente: evitar exclusao de dados historicos.
- Pendente: testar login com pelo menos um usuario de cada papel.

### Ordem Recomendada de Execucao

1. Fechar matriz definitiva de permissoes.
2. Atualizar esta secao com as decisoes finais.
3. Ajustar `setup_supabase.sql`.
4. Atualizar `js/auth.js`.
5. Ajustar `schools.html`.
6. Ajustar `dashboard.html`.
7. Ajustar `coordenacao.html`.
8. Ajustar `editor.html`.
9. Ajustar `print.html`.
10. Atualizar `tests/run-tests.js`.
11. Rodar `npm test`.
12. Rodar o programa localmente e compartilhar o endereco local com o usuario.
13. Aplicar SQL no Supabase, se houver impacto.
14. Testar Auth/REST e login real por perfil.
15. Aguardar validacao do usuario.
16. Publicar somente depois da validacao.

### Achados Para Ajuste Posterior

Registrar aqui bugs ou inconsistências encontrados durante correções/refatorações quando não forem resolvidos no mesmo commit.
