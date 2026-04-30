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
├── index.html          # Página inicial / landing page
├── login.html          # Login e cadastro (abas Entrar/Criar conta)
├── dashboard.html      # Lista de provas do usuário logado
├── editor.html         # Editor visual de provas (funciona offline tb)
├── coordenacao.html    # Painel da coordenadora para revisar provas
├── print.html          # Página limpa de impressão/PDF
├── config.js           # Credenciais Supabase + expõe window.CONFIG
├── js/
│   └── auth.js         # Classe AuthManager (login, signup, requests)
├── setup.html          # Página auxiliar de setup (legada)
├── setup_supabase.sql  # SQL para criar tabelas no Supabase
├── .gitignore          # Ignora arquivos desnecessários
└── CLAUDE.md           # Este arquivo
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
| Múltipla escolha | `multipla` | `options[]` (2 a 6 alternativas), `correctOption` |
| Discursiva | `discursiva` | `lines` (altura), `answerStyle` |
| Verdadeiro/Falso | `vf` | — |
| Marcar X | `marcarx` | `items[]`, `markLayout` |
| Complete as lacunas | `lacunas` | `items[]` com frase + resposta, `answers[]` |
| Relacione as colunas | `relacione` | `pairs[]`, `rightOrder[]` |
| De acordo com a imagem | `imagem` | `imageDataUrl`, `imageFileName`, `imageSize`, `imageAlign`, `imageCaption`, `imageAnswerType`, `lines`, `options[]`, `items[]` |
| Relacione imagens e palavras | `relacione_imagens` | `pairs[]` com imagem + palavra, `wordOrder[]` |

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

---

## O que Já Foi Feito
- [x] Estrutura HTML completa (index, login, dashboard, editor)
- [x] Autenticação email/senha via Supabase Auth
- [x] Cadastro com criação de perfil automática (trigger SQL)
- [x] Editor visual com 6 tipos de questão
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
- [ ] Revisar a experiência de criação de questões para deixar o fluxo mais claro, rápido e com menos campos confusos.
- [ ] Criar painel de propriedades da questão selecionada, separando enunciado, mídia, alternativas, resposta esperada, pontuação e configuração de impressão.
- [ ] Permitir escolher se a questão deve aparecer com ou sem espaço para resposta.
- [x] Permitir controlar o número de linhas de resposta por questão discursiva e questão com imagem.
- [x] Permitir definir pontuação com validação e alerta quando a soma das questões não bater com o valor total da prova.
- [x] Permitir duplicar, mover, remover e recolher/expandir questões com melhor organização visual no editor.
- [ ] Criar numeração automática mais refinada, com opção de reiniciar ou ocultar numeração em blocos específicos.
- [ ] Adicionar pré-visualização por página A4, com indicação visual de quebras de página antes de imprimir.
- [ ] Evitar que uma questão seja cortada entre duas páginas sempre que possível.
- [ ] Criar modo "somente prova" e modo "prova com gabarito" para exportação.
- [x] Criar gabarito separado para múltipla escolha.
- [x] Criar gabarito separado para verdadeiro/falso.
- [x] Criar gabarito separado para marcar X.
- [x] Criar gabarito separado para relacionar colunas.
- [ ] Criar gabarito separado para demais questões objetivas.
- [ ] Permitir salvar modelos de cabeçalho por escola/professor.
- [x] Criar modelos de instruções reutilizáveis por tipo de avaliação.

### Prioridade: imagens nas questões
- [ ] Permitir recortar imagem enviada antes de inserir na questão.
- [ ] Permitir girar imagem para esquerda/direita.
- [x] Permitir redimensionar imagem no editor com tamanhos: pequena, média, grande e largura total.
- [x] Permitir escolher alinhamento da imagem: esquerda, centro ou direita.
- [x] Permitir adicionar legenda abaixo da imagem.
- [ ] Permitir layout com imagem ao lado do enunciado.
- [ ] Permitir remover fundo branco ou melhorar contraste da imagem quando possível.
- [ ] Permitir substituir imagem sem perder o restante da questão.
- [ ] Permitir inserir mais de uma imagem na mesma questão.
- [ ] Criar layout "imagem ao lado do texto" para questões de interpretação visual.
- [ ] Criar layout "grade de imagens" para educação infantil e anos iniciais.
- [ ] Validar tamanho da imagem e avisar quando ela pode deixar a prova pesada demais.
- [ ] Melhorar compressão automática das imagens para equilibrar qualidade e tamanho.

### Prioridade: esmeramento dos tipos atuais de questão
- [x] Múltipla escolha: permitir 2 a 6 alternativas, marcar alternativa correta e gerar gabarito.
- [ ] Múltipla escolha: permitir alternativas com texto longo sem quebrar o layout.
- [x] Discursiva: permitir pauta com linhas, caixa de resposta ou espaço em branco.
- [x] Verdadeiro/Falso: permitir vários itens V/F dentro da mesma questão.
- [x] Marcar X: permitir itens em lista simples com marcação de resposta correta.
- [x] Marcar X: permitir itens em duas colunas.
- [ ] Marcar X: permitir itens em tabela.
- [x] Complete as lacunas: permitir cadastrar respostas esperadas para o gabarito.
- [x] Complete as lacunas: permitir várias frases com lacunas na mesma questão.
- [x] Relacione as colunas: permitir embaralhar a coluna da direita automaticamente.
- [x] Relacione as colunas: permitir mais pares, adicionar/remover linhas e equilibrar colunas.
- [x] Questão com imagem: permitir resposta discursiva, múltipla escolha ou marcar X usando a mesma imagem.
- [x] Relacione imagens e palavras: permitir adicionar/remover pares e embaralhar palavras no PDF.

### Prioridade: novos tipos de questão mais usados por professores
- [ ] Questão de interpretação de texto com texto-base e perguntas vinculadas.
- [ ] Questão de interpretação de imagem.
- [ ] Questão de tabela/gráfico para interpretação de dados.
- [ ] Questão de caça-palavras.
- [ ] Questão de cruzadinha.
- [ ] Questão de ordenação de frases ou etapas.
- [ ] Questão de associação por setas.
- [ ] Questão de completar sequência numérica.
- [ ] Questão de produção textual com espaço grande de resposta.
- [ ] Questão de ditado/lista de palavras.
- [ ] Questão de leitura e escrita para alfabetização.
- [ ] Questão de identificação de sílabas, letras ou sons.
- [ ] Questão de operações matemáticas em coluna.
- [ ] Questão com problema matemático e espaço para cálculo.
- [ ] Questão de desenho ou ilustração com espaço livre.

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
- [ ] Questão de sequência/ordenação de imagens.
- [ ] Questão para identificar partes de uma imagem com setas ou números.
- [ ] Questão para comparar duas imagens e responder.
- [ ] Questão de legenda: escrever uma frase ou palavra para cada imagem.
- [ ] Questão de associação imagem-imagem.

### Fluxo de coordenação pedagógica
- [x] Criar perfil/função de coordenadora no sistema.
- [x] Criar painel da coordenadora com acesso às provas publicadas pelos professores.
- [x] Permitir que a coordenadora visualize, revise, corrija e salve ajustes na prova publicada.
- [x] Criar status de revisão: rascunho, enviada para coordenação, em revisão, aprovada, devolvida para ajustes e bloqueada.
- [x] Bloquear edição pelo professor depois que a prova for aprovada/bloqueada pela coordenação.
- [x] Permitir que a coordenadora devolva a prova ao professor com observações.
- [x] Exibir observações da devolução para o professor.
- [ ] Registrar histórico de alterações e comentários da coordenação.

### Organização escolar
- [ ] Vincular professores a uma escola/unidade.
- [ ] Criar turmas, séries e disciplinas cadastradas pela escola.
- [ ] Permitir filtrar provas por professor, turma, série, disciplina, bimestre e status.
- [ ] Criar permissões por papel: professor, coordenadora e administrador.

### Melhorias futuras opcionais
- [ ] Duplicar prova inteira a partir do dashboard.
- [ ] Criar modelos prontos de provas por disciplina.
- [ ] Exportar prova com gabarito separado.
- [ ] Adicionar campo de habilidade/BNCC por questão.
- [ ] Tema escuro (dark mode), se fizer sentido mais adiante.
