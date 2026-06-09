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

Este plano organiza os 10 pontos encontrados na auditoria de fluxo. A ordem abaixo deve ser seguida para reduzir risco: primeiro bugs que causam perda de ação/dados, depois regras de negócio, depois clareza de interface.

Antes de iniciar qualquer correção ou refatoração, verificar o fluxo completo afetado pela mudança: tela de origem, botão/ação, destino, estado salvo no navegador, estado salvo no Supabase, retorno em caso de erro e caminho para desfazer/cancelar. Durante a implementação, se aparecer uma quebra, bug, inconsistência ou novo risco que não faça parte do escopo imediato, registrar o achado neste arquivo em "Achados Para Ajuste Posterior" antes de continuar. Não deixar achados relevantes apenas na memória da sessão.

### Etapa 1 - Bugs que travam ou mentem para o usuário

1. Corrigir devolução de prova na coordenação.
   - Arquivo: `coordenacao.html`.
   - Problema: `closeReturnModal()` limpa `pendingReturnId` antes de `updateReviewStatus()`.
   - Correção esperada: guardar o id em variável local antes de fechar o modal, ou fechar sem limpar até depois do PATCH.
   - Teste esperado: adicionar/verificar teste em `tests/run-tests.js` garantindo que o id é usado antes de ser zerado.

2. Validar salvamento real no Supabase ao criar prova nova.
   - Arquivo: `editor.html`.
   - Problema: criação via `fetch()` não checa `response.ok`; pode mostrar "Salvo" sem ID criado.
   - Correção esperada: se `!response.ok`, ler erro do Supabase e lançar exceção; só mostrar sucesso quando receber `id`.
   - Teste esperado: teste textual garantindo presença de `response.ok` ou helper equivalente no branch de criação.

3. Resolver fluxo de usuário não logado que cria prova.
   - Arquivos: `index.html`, `editor.html`, `login.html`.
   - Problema: usuário pode montar prova sem login e perder trabalho ao entrar.
   - Decisão recomendada: home deve mandar "Criar Prova Agora" para login quando não autenticado, com retorno para `editor.html?new=1`; ou o editor deve bloquear edição anônima com CTA de login antes de começar.
   - Teste esperado: garantir que login preserva destino (`redirect_to`/`return_to`) quando o usuário veio de uma ação protegida.

### Etapa 2 - Regras de revisão e bloqueio

4. Unificar "Publicar" e "Enviar para coordenação".
   - Arquivo: `dashboard.html`.
   - Problema: `Publicar` e `Coord.` parecem ações concorrentes, mas afetam campos diferentes (`is_published` e `review_status`).
   - Correção esperada: substituir por uma ação principal clara, como "Enviar para revisão", e deixar "Publicar" apenas se houver um conceito separado e explicado.
   - Atenção Supabase: se o modelo de status mudar, atualizar `setup_supabase.sql` e aplicar no Supabase.

5. Proteger ações perigosas da coordenação.
   - Arquivo: `coordenacao.html`.
   - Problema: "Aprovar" e "Bloquear" executam direto; ações aparecem mesmo quando o status já não combina.
   - Correção esperada: adicionar confirmação para aprovar/bloquear e ocultar/desabilitar ações incompatíveis com o status atual.
   - Teste esperado: verificar presença de confirmação/modal e regra de renderização por status.

6. Impedir exclusão de prova aprovada/bloqueada pelo professor.
   - Arquivos: `dashboard.html`, `setup_supabase.sql`.
   - Problema: UI ainda mostra "Deletar" e RLS permite dono deletar.
   - Correção esperada: ocultar/desabilitar delete na UI para `aprovada`/`bloqueada`; ajustar policy DELETE para bloquear esses status.
   - Atenção Supabase: atualizar e aplicar `setup_supabase.sql`.

7. Bloquear edição visual no editor para provas aprovadas/bloqueadas.
   - Arquivo: `editor.html`.
   - Problema: parte dos botões do topo fica fora do seletor desabilitado em `applyReviewLock()`.
   - Correção esperada: desabilitar "Nova questão", menus de questão, banco de questões e ações de alteração quando locked.
   - Teste esperado: verificar que `applyReviewLock()` cobre botões do topo e banco.

### Etapa 3 - Navegação e retorno

8. Preservar destino ao exigir login.
   - Arquivos: `login.html`, `print.html`, possivelmente `editor.html`.
   - Problema: abrir PDF/prova sem login manda para login e depois para dashboard, não para o destino original.
   - Correção esperada: usar query `return_to` no login e redirecionar para ela após autenticação bem-sucedida, validando que é caminho local seguro.
   - Teste esperado: login contém parsing de `return_to` e redirecionamento pós-login.

### Etapa 4 - Clareza e redução de labirinto

9. Simplificar a gestão de escolas.
   - Arquivo: `schools.html`.
   - Problema: muitas ações inline na mesma tela; troca de logo existente não mostra prévia clara antes de salvar.
   - Correção esperada: melhorar feedback visual de edição, mostrar prévia de logo pendente e separar melhor cadastro, edição de escola e vínculo de professor.
   - Teste esperado: manter ações principais detectáveis e validar que edição de logo tem feedback.

10. Clarificar perfil do professor.
    - Arquivo: `dashboard.html`.
    - Problema: série aparece como editável e também como dado vinculado pela coordenação.
    - Correção esperada: escolher uma única autoridade para série/ano. Recomendado: coordenação define vínculo escolar; professor edita apenas nome. Se professor puder editar série, remover bloco duplicado/read-only.
    - Atenção Supabase: se mudar autoridade de campo ou policy, revisar RLS e `setup_supabase.sql`.

### Checklist de Execução

Para cada etapa:

```bash
git status --short --branch
npm test
```

Depois de cada correção:

- Atualizar ou criar teste em `tests/run-tests.js`.
- Rodar `npm test`.
- Verificar se houve mudança de schema, RLS, Auth, roles ou formato de dados.
- Se houve impacto Supabase, atualizar `setup_supabase.sql`, aplicar no SQL Editor do Supabase e testar Auth/REST.
- Commitar com mensagem objetiva.

### Achados Para Ajuste Posterior

Registrar aqui bugs ou inconsistências encontrados durante correções/refatorações quando não forem resolvidos no mesmo commit.

- RLS de `profiles` ainda permite que o próprio usuário atualize o perfil inteiro. Se a regra final for "série, escola e disciplinas são definidos apenas pela coordenação", revisar policies/privileges no Supabase para impedir PATCH manual desses campos pelo professor.
- Aplicar no Supabase real as alterações de `setup_supabase.sql`: trigger de proteção dos campos de vínculo em `profiles` e policy que impede professor de deletar provas `aprovada` ou `bloqueada`.

Ordem recomendada de commits:

1. `Corrige devolucao e salvamento de provas`
2. `Ajusta login e retorno de fluxo protegido`
3. `Reorganiza status de revisao no dashboard`
4. `Protege provas aprovadas e bloqueadas`
5. `Melhora fluxo de escolas e perfil`
