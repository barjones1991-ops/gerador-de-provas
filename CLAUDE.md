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

## Fluxo de Trabalho Para Tornar o Projeto Utilizavel

Objetivo: transformar o projeto de piloto funcional em produto confiavel para escola, coordenacao, impressao e professores. Cada melhoria deve passar por descoberta, implementacao, teste tecnico e confirmacao de uso real antes de ser considerada pronta.

### Regra Geral

Antes de iniciar qualquer melhoria:

```bash
git status --short --branch
npm test
```

- Identificar o perfil afetado: professor, coordenacao, impressao, dono de escola ou master.
- Descrever o fluxo afetado em uma frase: origem, acao, destino e dado salvo.
- Conferir se existe impacto no Supabase: tabela, coluna, RLS, Auth, roles, storage ou payload JSON.
- Definir o criterio de pronto antes de editar.
- Atualizar ou criar teste em `tests/run-tests.js` quando o comportamento puder quebrar no futuro.
- Rodar `npm test` ao final.
- Rodar localmente e entregar o link para validacao do usuario.
- So publicar depois da validacao manual do usuario.

### Ordem Recomendada de Implementacao

1. Estabilizacao e fechamento do pacote atual.
2. Documentacao e operacao do projeto.
3. Validacao real dos perfis e permissoes.
4. Usabilidade do professor no dashboard e editor.
5. Impressao/PDF e fila de impressao.
6. Coordenacao pedagogica e devolutivas.
7. Gestao escolar, convites e vinculos.
8. Seguranca, backup e escala.

### 1. Estabilizacao Atual

Objetivo: garantir que o estado local atual seja compreendido, testado e versionado.

Confirmacoes obrigatorias:

- `git status --short --branch` revisado.
- Diff revisado por arquivo alterado.
- `npm test` passando.
- Fluxo manual testado: login, dashboard, nova prova, editor, autosave, print limpo, envio para coordenacao.
- Alteracoes confirmadas pelo usuario antes de commit/push.

Criterio de pronto:

- Nenhuma mudanca local sem explicacao.
- Testes passando.
- Usuario validou no navegador local.
- Commit feito com mensagem objetiva.

### 2. Documentacao e Operacao

Objetivo: deixar o projeto retomavel por qualquer sessao futura e instalavel sem memoria oral.

Tarefas:

- Atualizar `GUIA_SETUP.md` para refletir o schema real atual.
- Criar ou atualizar `README.md` com execucao local, publicacao e perfis.
- Documentar checklist de deploy no GitHub Pages.
- Documentar checklist de aplicacao do `setup_supabase.sql`.
- Registrar como testar Supabase pausado/restaurado.

Confirmacoes obrigatorias:

- Instrucoes antigas removidas ou marcadas como historicas.
- SQL documentado bate com `setup_supabase.sql`.
- Comandos de teste e servidor local documentados.

Criterio de pronto:

- Uma pessoa consegue abrir o projeto, rodar localmente e saber qual SQL aplicar sem perguntar.

### 3. Perfis, Permissoes e Supabase

Objetivo: confirmar que cada perfil ve e faz apenas o que deve.

Perfis a validar:

- `master`
- `school_owner`
- `coordinator`
- `teacher`
- `print_operator`

Fluxos a confirmar:

- Login redireciona para o modulo correto.
- Professor cria, edita, duplica, envia e imprime apenas suas provas permitidas.
- Coordenacao revisa, devolve, aprova, bloqueia e edita sem trocar dono da prova.
- Impressao acessa fila e marca como impressa.
- Gestao escolar cria escola, vincula professores, define series e disciplinas.
- RLS impede acesso indevido via REST.

Criterio de pronto:

- Cada perfil foi testado com usuario real no Supabase.
- Qualquer ajuste de banco foi refletido em `setup_supabase.sql`.
- Teste automatizado cobre o contrato critico.

### 4. Usabilidade do Professor

Objetivo: fazer o professor criar prova sem medo e sem depender do desenvolvedor.

Melhorias prioritarias:

- Fluxo guiado de primeira prova.
- Modelos prontos: bimestral, recuperacao, simulado e atividade.
- Tipos de questao separados por "mais usados" e "avancados".
- Busca/filtro para tipos de questao.
- Mensagem clara de autosave: salvando, salvo, erro ao salvar.
- Recuperacao amigavel quando internet ou Supabase falhar.
- Aviso claro quando disciplina/turma nao estiverem vinculadas.
- Preview e acoes de imprimir/enviar sempre visiveis ou faceis de encontrar.

Confirmacoes obrigatorias:

- Criar prova nova nao reabre prova antiga.
- Autosave preserva titulo, disciplina, turma, questoes, gabaritos e imagens.
- Professor entende o que fazer quando nao tem disciplina vinculada.
- Prova aprovada/bloqueada nao fica editavel para professor.

Criterio de pronto:

- Um professor consegue criar uma prova simples, salvar, sair, voltar e imprimir sem instrucao externa.

### 5. Impressao, PDF e Fila

Objetivo: tornar a impressao previsivel em ambiente escolar.

Fluxos a validar:

- PDF limpo sem gabarito.
- PDF com gabarito.
- Prova curta.
- Prova longa.
- Prova com imagens.
- Prova enviada para fila de impressao.
- Operador marca prova como impressa.
- Bloqueio de reimpressao quando aplicavel.

Confirmacoes obrigatorias:

- Testar no Chrome ou Edge.
- Conferir A4 real.
- Conferir que imagens nao estouram pagina.
- Conferir que cabecalho e rodape do navegador nao aparecem quando possivel.

Criterio de pronto:

- Escola consegue imprimir uma prova real sem ajuste manual no HTML.

### 6. Coordenacao Pedagogica

Objetivo: deixar revisao, devolucao e aprovacao claras para coordenacao e professor.

Melhorias prioritarias:

- Filtros por professor, turma, disciplina e status.
- Historico de revisao mais legivel.
- Observacao de devolucao destacada no dashboard do professor.
- Acoes com texto claro: enviar revisao, devolver, aprovar, bloquear, enviar para impressao.
- Confirmacoes para acoes irreversiveis.

Criterio de pronto:

- Coordenacao consegue revisar uma prova, devolver com observacao, professor corrigir e reenviar.

### 7. Gestao Escolar

Objetivo: permitir que a escola se configure sem manutencao manual.

Melhorias prioritarias:

- Onboarding para master/dono de escola.
- Convites com status claro: pendente, usado, cancelado.
- Edicao de vinculos de professor com series e disciplinas.
- Validacao de escola obrigatoria para perfis de gestao.
- Confirmacao antes de reset de senha e desvinculo.

Criterio de pronto:

- Uma escola nova consegue cadastrar estrutura minima e liberar acesso para professores.

### 8. Seguranca, Backup e Escala

Objetivo: reduzir risco operacional antes de uso amplo.

Melhorias prioritarias:

- Revisar RLS real no Supabase com usuarios de teste.
- Definir rotina de backup/exportacao.
- Trocar fluxo de senha padrao por convite/reset mais seguro.
- Planejar migracao de imagens grandes para Supabase Storage.
- Registrar limites de payload e tamanho de imagem.
- Documentar como recuperar projeto pausado no Supabase.

Criterio de pronto:

- Dados de escolas e provas ficam protegidos por perfil.
- Existe caminho documentado de backup e restauracao.

### Registro de Validacao Manual

Ao concluir uma melhoria, registrar no resumo da entrega:

- Perfil testado.
- Fluxo testado.
- Navegador usado.
- Resultado do `npm test`.
- Se houve impacto no Supabase.
- Pendencias restantes.

### Validacao Manual - Etapa 1

Data: 2026-08-24.
Perfil testado: validacao manual informada pelo usuario.
Fluxo testado: estabilizacao do pacote atual, criacao/edicao de provas, imagens, impressao e navegacao principal.
Navegador usado: validacao local pelo usuario.
Resultado do `npm test`: aprovado.
Impacto no Supabase: sem migracao nova; alteracoes usam tabelas e endpoints existentes.
Pendencias restantes: seguir para a Etapa 2, documentacao operacional e setup confiavel.

### Validacao Manual - Etapa 2

Data: 2026-08-24.
Perfil testado: documentacao operacional para professor, coordenacao, impressao e gestao escolar.
Fluxo testado: setup local, configuracao Supabase, testes tecnicos, fluxo de uso e checklist manual.
Navegador usado: nao aplicavel para documentacao; servidor local segue validado por teste automatizado.
Resultado do `npm test`: aprovado.
Impacto no Supabase: sem migracao nova; documentacao aponta `setup_supabase.sql` como fonte oficial.
Pendencias restantes: seguir para a Etapa 3, perfis, permissoes e Supabase em profundidade.
### Validacao Tecnica - Etapa 3

Data: 2026-08-24.
Perfil testado: matriz tecnica de `master`, `school_owner`, `coordinator`, `teacher` e `print_operator` por codigo e SQL.
Fluxo testado: helpers de acesso no frontend, RLS/funcoes em `setup_supabase.sql`, fila de impressao e autosave com payload pesado.
Navegador usado: pendente de validacao manual por usuarios reais no Supabase.
Resultado do `npm test`: aprovado.
Impacto no Supabase: sim; `can_print_exam` agora permite `school_owner` da mesma escola, alinhando banco com `canAccessPrintQueue` do frontend.
Pendencias restantes: aplicar `setup_supabase.sql` no Supabase real e validar login/acoes com um usuario real de cada perfil.
### Validacao Manual - Etapa 4

Data: 2026-08-24.
Perfil testado: professor por fluxo tecnico de dashboard e editor.
Fluxo testado: criacao de prova com disciplina/turma vinculadas, bloqueio quando falta vinculo, autosave visivel e envio para revisao apenas com questoes.
Navegador usado: validacao manual do usuario no navegador local.
Resultado do `npm test`: aprovado.
Impacto no Supabase: sem migracao nova; apenas uso dos dados existentes de perfil, turma, disciplina e prova.
Pendencias restantes: seguir para a Etapa 5, impressao/PDF e fila de impressao.

### Validacao Tecnica - Etapa 5

Data: 2026-08-25.
Perfil testado: matriz tecnica de `master`, `school_owner` e `print_operator` para fila/PDF.
Fluxo testado: somente prova aprovada pode ser enviada/mantida na fila de impressao, PDF aberto pela fila mostra acao de marcar como impressa, RPC `mark_exam_printed` continua centralizando a conclusao do trabalho.
Navegador usado: pendente de validacao manual do usuario em ambiente local conectado ao Supabase real.
Resultado do `npm test`: aprovado.
Impacto no Supabase: sim; `setup_supabase.sql` adiciona limpeza de pedidos invalidos e trigger `prevent_invalid_print_request_before_write` para impedir impressao de prova nao aprovada.
Pendencias restantes: aplicar `setup_supabase.sql` no Supabase real e validar manualmente: aprovar prova, enviar para impressao, abrir PDF pela fila, imprimir e marcar como impressa.
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

### Achados Para Ajuste Posterior

Registrar aqui bugs ou inconsistências encontrados durante correções/refatorações quando não forem resolvidos no mesmo commit.
