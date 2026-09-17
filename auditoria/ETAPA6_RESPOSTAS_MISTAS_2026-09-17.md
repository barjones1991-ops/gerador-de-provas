# Etapa 6 — Respostas mistas

Implementação local em 17/09/2026; publicação continua adiada.

- Tabela com múltipla escolha mostra conteúdo e alternativas no renderer do editor e em print.html, sem espaço discursivo indevido.
- Texto-base impresso mantém alternativas quando showAnswerSpace=false. A opção controla somente o espaço de escrita.
- Gabarito de tabela e texto-base usa letra com índice inteiro dentro das alternativas; índice inválido ou ausente resulta em “não marcado”. Tabela sem resposta não gera resposta no gabarito; discursivas informam correção manual ou resposta esperada existente.
- Controles de espaço/linhas não aparecem nos modos de múltipla escolha/sem resposta desses dois tipos. Troca de modo preserva conteúdo e gabarito cadastrado. Texto-base sem alternativas permite preencher duas opções iniciais.

Sem alteração de schema, RLS, Auth, payload ou migração Supabase. Nenhuma prova real modificada.

Validação: npm test aprovado; tests/mixed-answer-regressions.cjs testa os renderers reais e DOM isolado com alternativas, três modos, índices inválidos, texto escapado, atualização parcial do gabarito, salvar/reabrir e preservação das alternativas. Falta conferência visual e paginação real com conta do usuário.

Conferência local: http://127.0.0.1:8000/dashboard.html, Ctrl+F5. Em tabela e texto-base, selecionar múltipla escolha, cadastrar alternativas, conferir a prévia com e sem gabarito; alternar discursiva e retornar à múltipla escolha. Na tabela, testar também Sem resposta.
