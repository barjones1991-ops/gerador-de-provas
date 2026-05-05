# GERADOR DE PROVAS — Guia do Projeto

## Visão Geral
Plataforma web para professores criarem, salvarem e exportarem provas escolares em PDF.
Desenvolvida em HTML/CSS/JS puro (sem frameworks), com backend no Supabase.

**Site ao vivo:** https://barjones1991-ops.github.io/gerador-de-provas/
**Repositório:** https://github.com/barjones1991-ops/gerador-de-provas

---

## Stack Técnica
- **Frontend:** HTML + CSS + JavaScript puro (sem React, sem Vue, sem build)
- **Backend/Auth/DB:** Supabase (REST API via fetch, sem SDK)
- **Hospedagem:** GitHub Pages (gratuito)
- **Autenticação:** Supabase Auth (email + senha)
- **Banco de dados:** PostgreSQL via Supabase

---

## Estrutura de Arquivos

```
GERADOR DE PROVAS/
├── index.html                    # Página inicial / landing page
├── login.html                    # Login e cadastro (abas Entrar/Criar conta)
├── dashboard.html                # Lista de provas do usuário logado
├── editor.html                   # Editor visual de provas (funciona offline tb)
├── coordenacao.html              # Painel da coordenadora para revisar provas
├── print.html                    # Página limpa de impressão/PDF
├── config.js                     # Credenciais Supabase + expõe window.CONFIG
├── js/
│   └── auth.js                   # Classe AuthManager (login, signup, requests)
├── tests/
│   └── run-tests.js              # Testes automáticos (npm test)
├── setup.html                    # Página auxiliar de setup (legada)
├── teste-conexao.html            # Página de diagnóstico de conexão Supabase (legada)
├── setup_supabase.sql            # SQL para criar tabelas no Supabase
├── package.json                  # Só define script "npm test"
├── CLAUDE.md                     # Este arquivo
├── GUIA_SETUP.md                 # Guia de configuração inicial do projeto
├── INSTRUÇÕES_CONFIGURE_AGORA.md # Instruções rápidas de configuração
├── TESTE_AGORA.md                # Checklist de testes manuais
└── .gitignore                    # Ignora arquivos desnecessários
```

---

## Credenciais Supabase (config.js)
- **Project URL:** https://birtgmrtaryfjogegimn.supabase.co
- **Anon Key:** configurada em config.js
- **Projeto:** birtgmrtaryfjogegimn

> `config.js` expõe `window.CONFIG` para que `auth.js` funcione no browser.
> `const CONFIG` sozinho NÃO cria `window.CONFIG` — o `window.CONFIG = CONFIG` ao final do arquivo é essencial.

---

## Tabelas no Supabase

### `profiles`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | UUID (PK) | Referência auth.users |
| email | TEXT | Email do professor |
| full_name | TEXT | Nome completo |
| school_name | TEXT | Nome da escola |
| role | TEXT | Papel do usuário (`professor`, `coordenadora`, `admin`) |
| created_at | TIMESTAMPTZ | Data de cadastro |

### `exams`
| Coluna | Tipo | Descrição |
|---|---|---|
| id | UUID (PK) | Gerado automaticamente |
| user_id | UUID (FK) | Referência auth.users |
| title | TEXT | Título da prova |
| school_name | TEXT | Nome da escola |
| subject | TEXT | Disciplina |
| class_name | TEXT | Turma |
| teacher | TEXT | Nome do professor |
| term | TEXT | Bimestre/Etapa |
| date | TEXT | Data da prova |
| total_value | TEXT | Valor total (ex: "10,0") |
| instructions | TEXT | Instruções da prova |
| questions | JSONB | Array de questões |
| logo_data_url | TEXT | Logo da escola em base64 |
| is_draft | BOOLEAN | Se é rascunho |
| is_published | BOOLEAN | Se está publicada |
| review_status | TEXT | Status de revisão pedagógica |
| review_notes | TEXT | Observações da coordenação |
| reviewed_by | UUID | Usuário que revisou |
| reviewed_at | TIMESTAMPTZ | Data da revisão |
| locked_at | TIMESTAMPTZ | Data de bloqueio/aprovação |
| created_at | TIMESTAMPTZ | Data de criação |
| updated_at | TIMESTAMPTZ | Última atualização |

> RLS (Row Level Security) ativado — cada usuário só acessa suas próprias provas.
> Trigger `on_auth_user_created` cria perfil automaticamente ao cadastrar.

---

## Fluxo do Usuário
```
index.html → login.html → dashboard.html → editor.html
                                ↑                ↓
                          (volta com          salva na
                          lista de           nuvem via
                          provas)           Supabase API)
```

### Fluxo de autenticação
1. `login.html` usa `AuthManager.signIn()` ou `signUp()`
2. Sessão salva em `localStorage` (chave: `supabase.auth.token`)
3. Páginas protegidas verificam `auth.isAuthenticated()` e redirecionam
4. Logout limpa o localStorage

### Fluxo do editor
1. `localStorage.getItem('editExamId')` → se existir, carrega prova da nuvem
2. Se não existir, abre editor em branco
3. "💾 Salvar na Nuvem" → POST (nova) ou PATCH (existente) em `/rest/v1/exams`
4. Dashboard → "Nova Prova" → `localStorage.removeItem('editExamId')` antes de redirecionar

---

## Tipos de Questão no Editor
| Tipo | Chave | Campos extras |
|---|---|---|
| Múltipla escolha | `multipla` | `options[]` (2 a 6 alternativas), `correctOption`, `points`, `hideNumber` |
| Discursiva | `discursiva` | `lines` (altura), `answerStyle` (`linhas`/`caixa`/`espaco`), `points`, `hideNumber`, `showAnswerSpace` |
| Verdadeiro/Falso | `vf` | `items[]` com `{ text, answer }`, `points`, `hideNumber` |
| Marcar X | `marcarx` | `items[]` com `{ text, checked }`, `markLayout` (`lista`/`duas_colunas`/`tabela`), `points`, `hideNumber` |
| Complete as lacunas | `lacunas` | `items[]` com `{ text, answer }`, `answers[]`, `points`, `hideNumber` |
| Relacione as colunas | `relacione` | `pairs[]` com `{ left, right }`, `rightOrder[]` (embaralhado), `points`, `hideNumber` |
| De acordo com a imagem | `imagem` | `imageDataUrl`, `imageFileName`, `imageSize` (`small`/`medium`/`large`/`full`), `imageAlign` (`left`/`center`/`right`/`lado_esquerda`/`lado_direita`), `imageCaption`, `imageAnswerType` (`discursiva`/`multipla`/`marcarx`), `lines`, `options[]`, `items[]`, `points`, `hideNumber`, `showAnswerSpace` |
| Interpretação de imagem | `interpretacao_imagem` | `imageDataUrl`, `imageFileName`, `imageSize`, `imageAlign`, `imageCaption`, `prompts[]`, `lines`, `answerStyle`, `points`, `hideNumber`, `showAnswerSpace` |
| Relacione imagens e palavras | `relacione_imagens` | `pairs[]` com `{ imageDataUrl, imageFileName, word }`, `wordOrder[]` (embaralhado), `points`, `hideNumber` |
| Interpretação de texto | `texto_base` | `textBase` (texto-base), `answerType` (`discursiva`/`multipla`), `lines`, `answerStyle`, `options[]`, `correctOption`, `points`, `hideNumber`, `showAnswerSpace` |
| Operações matemáticas | `matematica_coluna` | `operations[]` com `{ expression }` (ex: "234 + 567"), `points`, `hideNumber` |
| Produção textual | `producao_textual` | `titlePrompt` (linha de título), `lines`, `answerStyle`, `points`, `hideNumber`, `showAnswerSpace` |
| Ditado / lista de palavras | `ditado` | `wordCount` (nº de linhas), `wordList` (palavras p/ gabarito, uma por linha), `points`, `hideNumber` |
| Caça-palavras | `caca_palavras` | `wordsText`, `gridSize`, `points`, `hideNumber` |
| Cruzadinha | `cruzadinha` | `clues[]` com `{ clue, answer }`, `points`, `hideNumber` |
| Ordenação de frases | `ordenacao` | `items[]` com `{ text, order }` (order = posição correta p/ gabarito), `points`, `hideNumber` |
| Problema matemático | `problema_matematico` | `lines`, `calcLines` (linhas da área de cálculo), `answerStyle`, `points`, `hideNumber`, `showAnswerSpace` |
| Espaço de desenho | `espaco_livre` | `height` (altura em px), `borderStyle` (`solida`/`tracejada`/`pontilhada`/`nenhuma`), `points`, `hideNumber` |
| Tabela / gráfico | `tabela` | `headers[]`, `rows[][]`, `answerType` (`discursiva`/`multipla`), `lines`, `answerStyle`, `options[]`, `correctOption`, `points`, `hideNumber`, `showAnswerSpace` |
| Associação por setas | `associacao_setas` | `leftItems[]`, `rightItems[]`, `rightOrder[]` (embaralhado), `points`, `hideNumber` |
| Sequência numérica | `sequencia_numerica` | `sequences[]` com `{ items, answer }` (usar `___` como lacuna), `points`, `hideNumber` |
| Leitura e escrita | `leitura_escrita` | `words[]`, `columns` (1 ou 2), `showCopyLines`, `points`, `hideNumber` |
| Sílabas / letras / sons | `silabas` | `exerciseType` (`separar`/`contar`/`classificar`/`identificar`), `words[]` com `{ word, answer }`, `points`, `hideNumber` |
| Sequência de imagens | `sequencia_imagens` | `images[]` com `{ dataUrl, fileName }`, `correctOrder[]`, `points`, `hideNumber` |
| Comparar duas imagens | `comparar_imagens` | `imageA` com `{ dataUrl, fileName, caption }`, `imageB` com `{ dataUrl, fileName, caption }`, `lines`, `answerStyle`, `points`, `hideNumber`, `showAnswerSpace` |
| Legenda das imagens | `legenda_imagens` | `images[]` com `{ dataUrl, fileName, legend }`, `columns` (1/2/3), `points`, `hideNumber` |
| Associe imagem a imagem | `associacao_imagem_imagem` | `pairs[]` com `{ imageDataUrl, imageFileName, word, wordDataUrl, wordFileName }`, `shuffleWords`, `wordOrder[]`, `points`, `hideNumber` |
| Grade de imagens | `grade_imagens` | `items[]` com `{ imageDataUrl, imageFileName, caption, answer }`, `columns` (2/3/4), `showCaptions`, `showAnswerLines`, `points`, `hideNumber` |
| Identificar partes da imagem | `identificar_imagem` | `imageDataUrl`, `imageFileName`, `imageCaption`, `markers[]` com `{ x, y, label, answer }`, `showAnswerList`, `points`, `hideNumber` |

> Todos os tipos têm `hideNumber` (oculta numeração nessa questão) e `showAnswerSpace` (controla espaço de resposta, relevante para discursiva e imagem).
> Todos os tipos têm campo opcional `bncc` (código de habilidade, ex: "EF02MA01") — exibido como badge roxo no preview e no print (oculto na impressão para alunos).

---

## Git — Workflow Completo

### Configuração (já feita)
```bash
# Remoto já configurado aponta para:
# https://github.com/barjones1991-ops/gerador-de-provas.git
git remote -v
```

### Publicar alterações no site (usar sempre)
```bash
cd "c:\Users\yesle\Desktop\GERADOR DE PROVAS"
git add -A
git commit -m "descrição do que foi alterado"
git push
```

### Ver o que mudou antes de publicar
```bash
git status          # arquivos modificados
git diff            # ver as mudanças em detalhe
git log --oneline   # histórico de commits
```

### Rodar testes automáticos antes de publicar
```bash
npm test
```

> Os testes verificam sintaxe dos scripts, links internos, IDs duplicados, configuração Supabase, AuthManager, tipos de questão, página de impressão, SQL do Supabase e carregamento HTTP das páginas principais.

### Se der erro no push
```bash
git push --set-upstream origin main
```

> Após o push, o GitHub Pages atualiza o site em ~1 minuto automaticamente.

---

## Problemas Conhecidos / Cuidados

1. **Supabase pausa projetos inativos** no plano gratuito após ~1 semana sem acesso.
   - Solução: acessar o site pelo menos 1x/semana, ou upgrade para plano Pro ($25/mês).

2. **`window.CONFIG`** deve ser definido explicitamente em `config.js` — `const` no topo não cria propriedade no `window`.

3. **Caminhos de redirect** devem ser **relativos** (`dashboard.html`) e não absolutos (`/dashboard.html`), pois o GitHub Pages serve em subpasta (`/gerador-de-provas/`).

4. **`editExamId` no localStorage** — sempre usar `localStorage.removeItem('editExamId')` ao criar nova prova, para não abrir a prova errada no editor.

5. **DELETE no Supabase** retorna 204 (sem body) — o `authenticatedRequest` em `auth.js` lida com isso via `response.text()`.

6. **Rascunho local do editor** deve ser separado por usuário logado (`gerador-provas-state-v1:<userId>`), para uma prova preenchida por um usuário não aparecer quando outro usuário entra no mesmo navegador.

7. **Coordenação editando prova** não pode alterar `user_id` da prova. Ao salvar uma prova existente, o editor nunca envia `user_id`; esse campo só é enviado na criação de prova nova.

8. **Modelo de cabeçalho** salvo no localStorage com chave `gerador-provas-header-tpl`. Inclui nome da escola, professor, disciplina, turma, bimestre, valor total, instruções e logo em base64.

9. **Questões do banco salvas como privadas por padrão** (`is_public: false`). O professor pode torná-las públicas pelo botão "Tornar pública" no modal do banco de questões. Questões públicas aparecem para todos os professores na busca do banco.

---

## O que Já Foi Feito
- [x] Estrutura HTML completa (index, login, dashboard, editor)
- [x] Autenticação email/senha via Supabase Auth
- [x] Cadastro com criação de perfil automática (trigger SQL)
- [x] Editor visual com 8 tipos de questão (multipla, discursiva, vf, marcarx, lacunas, relacione, imagem, relacione_imagens)
- [x] Prévia em tempo real da prova
- [x] Exportar/Imprimir em PDF
- [x] Upload de logo da escola
- [x] Salvar/editar/deletar provas na nuvem
- [x] Dashboard com estatísticas, busca e filtros
- [x] Modal de confirmação de exclusão
- [x] Toast notifications (sem alerts do browser)
- [x] Mover questões (↑↓) e duplicar questão (⊕)
- [x] Estado vazio no editor e no dashboard
- [x] Erros de autenticação traduzidos para português
- [x] Marcar prova como "Publicada" ou voltar para rascunho no dashboard
- [x] Recuperação de senha pelo login
- [x] Editar perfil do professor (nome, escola)
- [x] Ordenar e filtrar provas por data/disciplina
- [x] Preencher escola/professor no editor a partir do perfil
- [x] Contador de questões visível no dashboard card
- [x] Página de impressão dedicada (sem painel de edição)
- [x] Mobile: layout do editor em tela pequena
- [x] Questões com imagem por upload/arrastar arquivo
- [x] Questão "De acordo com a imagem, responda"
- [x] Questão "Relacione imagens e palavras"
- [x] Testes automáticos com `npm test`
- [x] Rascunho local do editor separado por usuário logado
- [x] Base do fluxo de coordenação: enviar prova para revisão
- [x] Base de papéis: professor, coordenadora e admin
- [x] Bloqueio de edição para prova aprovada/bloqueada
- [x] Painel da coordenação para revisar, aprovar, devolver e bloquear provas
- [x] Coordenadora pode corrigir prova sem alterar o dono original
- [x] Professor visualiza devolutiva da coordenação no dashboard e editor
- [x] Git configurado e conectado ao GitHub
- [x] Deploy no GitHub Pages

## O que Ainda Pode Melhorar

### Prioridade: geração e acabamento da prova
- [x] Revisar a experiência de criação de questões: seletor visual por botões com ícones (substituiu dropdown).
- [x] Criar painel de propriedades da questão selecionada, separando enunciado, mídia, alternativas, resposta esperada, pontuação e configuração de impressão.
- [x] Permitir escolher se a questão deve aparecer com ou sem espaço para resposta (toggle por questão).
- [x] Permitir controlar o número de linhas de resposta por questão discursiva e questão com imagem.
- [x] Permitir definir pontuação com validação e alerta quando a soma das questões não bater com o valor total da prova.
- [x] Permitir duplicar, mover, remover e recolher/expandir questões com melhor organização visual no editor.
- [x] Criar numeração automática refinada: opção de ocultar número por questão; numeração automática pula questões ocultas.
- [x] Adicionar pré-visualização por página A4, com indicação visual de quebras de página antes de imprimir.
- [x] Evitar que uma questão seja cortada entre duas páginas (CSS break-inside: avoid em todos os blocos).
- [x] Criar modo "somente prova" e modo "prova com gabarito" para exportação (botão "Com gabarito").
- [x] Criar gabarito separado para múltipla escolha.
- [x] Criar gabarito separado para verdadeiro/falso.
- [x] Criar gabarito separado para marcar X.
- [x] Criar gabarito separado para relacionar colunas.
- [x] Criar gabarito separado para demais questões objetivas (lacunas, imagem, relacione imagens).
- [x] Permitir salvar modelos de cabeçalho por escola/professor (salvar/carregar/apagar no localStorage).
- [x] Criar modelos de instruções reutilizáveis por tipo de avaliação.

### Prioridade: imagens nas questões
- [x] Permitir recortar imagem enviada antes de inserir na questão (modal canvas com drag-to-select).
- [x] Permitir girar imagem para esquerda/direita (botões ↺ e ↻ no picker de imagem).
- [x] Permitir redimensionar imagem no editor com tamanhos: pequena, média, grande e largura total.
- [x] Permitir escolher alinhamento da imagem: esquerda, centro, direita, lado esq. do texto, lado dir. do texto.
- [x] Permitir adicionar legenda abaixo da imagem.
- [x] Permitir layout com imagem ao lado do enunciado (float left/right com opção no select de alinhamento).
- [x] Permitir substituir imagem sem perder o restante da questão (botão "Substituir imagem" aparece quando há imagem).
- [x] Permitir inserir mais de uma imagem na mesma questão.
- [x] Criar layout "grade de imagens" para educação infantil e anos iniciais.
- [x] Validar tamanho da imagem e avisar quando ela pode deixar a prova pesada demais (indicador de KB/MB).
- [x] Melhorar compressão automática das imagens (WebP quando suportado, JPEG 0.82 como fallback).

### Prioridade: esmeramento dos tipos atuais de questão
- [x] Múltipla escolha: permitir 2 a 6 alternativas, marcar alternativa correta e gerar gabarito.
- [x] Múltipla escolha: permitir alternativas com texto longo sem quebrar o layout.
- [x] Discursiva: permitir pauta com linhas, caixa de resposta ou espaço em branco.
- [x] Verdadeiro/Falso: permitir vários itens V/F dentro da mesma questão.
- [x] Marcar X: permitir itens em lista simples com marcação de resposta correta.
- [x] Marcar X: permitir itens em duas colunas.
- [x] Marcar X: permitir itens em tabela.
- [x] Complete as lacunas: permitir cadastrar respostas esperadas para o gabarito.
- [x] Complete as lacunas: permitir várias frases com lacunas na mesma questão.
- [x] Relacione as colunas: permitir embaralhar a coluna da direita automaticamente.
- [x] Relacione as colunas: permitir mais pares, adicionar/remover linhas e equilibrar colunas.
- [x] Questão com imagem: permitir resposta discursiva, múltipla escolha ou marcar X usando a mesma imagem.
- [x] Relacione imagens e palavras: permitir adicionar/remover pares e embaralhar palavras no PDF.

### Prioridade: novos tipos de questão mais usados por professores
- [x] Questão de interpretação de texto com texto-base e perguntas vinculadas.
- [x] Questão de interpretação de imagem.
- [x] Questão de tabela/gráfico para interpretação de dados.
- [x] Questão de caça-palavras.
- [x] Questão de cruzadinha.
- [x] Questão de ordenação de frases ou etapas.
- [x] Questão de associação por setas.
- [x] Questão de completar sequência numérica.
- [x] Questão de produção textual com espaço grande de resposta.
- [x] Questão de ditado/lista de palavras.
- [x] Questão de leitura e escrita para alfabetização.
- [x] Questão de identificação de sílabas, letras ou sons.
- [x] Questão de operações matemáticas em coluna.
- [x] Questão com problema matemático e espaço para cálculo.
- [x] Questão de desenho ou ilustração com espaço livre.

### Banco de questões
- [x] Criar banco de questões por série/ano, disciplina, habilidade e dificuldade.
- [x] Permitir pesquisar questões por palavra-chave, série, habilidade e nível de dificuldade.
- [x] Permitir selecionar questões do banco e inserir direto na prova em edição.
- [x] Salvar questões criadas pelo professor no banco para reutilização futura.
- [x] Exibir banco de questões em janela própria.
- [x] Identificar questões criadas pelo professor e questões públicas.
- [x] Permitir alterar/excluir apenas questões criadas pelo professor.
- [x] Marcar questões como públicas da escola ou privadas do professor.
- [x] Permitir banco de questões com imagens anexadas.

### Novos tipos de questão com imagens
- [x] Questão com imagem e múltipla escolha.
- [x] Questão com imagem para marcar X.
- [x] Questão de sequência/ordenação de imagens.
- [x] Questão para identificar partes de uma imagem com setas ou números.
- [x] Questão para comparar duas imagens e responder.
- [x] Questão de legenda: escrever uma frase ou palavra para cada imagem.
- [x] Questão de associação imagem-imagem.

### Fluxo de coordenação pedagógica
- [x] Criar perfil/função de coordenadora no sistema.
- [x] Criar painel da coordenadora com acesso às provas publicadas pelos professores.
- [x] Permitir que a coordenadora visualize, revise, corrija e salve ajustes na prova publicada.
- [x] Criar status de revisão: rascunho, enviada para coordenação, em revisão, aprovada, devolvida para ajustes e bloqueada.
- [x] Bloquear edição pelo professor depois que a prova for aprovada/bloqueada pela coordenação.
- [x] Permitir que a coordenadora devolva a prova ao professor com observações.
- [x] Exibir observações da devolução para o professor.
- [x] Registrar histórico de alterações e comentários da coordenação.

### Organização escolar
- [x] Vincular professores a uma escola/unidade.
- [x] Criar turmas, séries e disciplinas cadastradas pela escola.
- [x] Permitir filtrar provas por professor, turma, série, disciplina, bimestre e status.
- [x] Criar permissões por papel: professor, coordenadora e administrador.

### Melhorias futuras opcionais
- [x] Duplicar prova inteira a partir do dashboard.
- [x] Exportar prova com gabarito separado (botão "📋 Com gabarito" no editor — gera gabarito em página separada ao imprimir).
- [x] Adicionar campo de habilidade/BNCC por questão.
