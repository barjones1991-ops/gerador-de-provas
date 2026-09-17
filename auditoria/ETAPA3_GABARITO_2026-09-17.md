# Etapa 3 — Cobertura do gabarito

Implementação local em 17/09/2026. O usuário validou a etapa 2 e pediu continuidade sem publicação. As duas etapas permanecem locais.

## Correções

- Discursiva: mostra expectedAnswer; quando vazio, informa correção manual e ausência de resposta cadastrada.
- Sequência de imagens: usa items/order, na ordem em que as imagens aparecem na prova. Exemplo: Imagem 1: 3; Imagem 2: 1; Imagem 3: 4; Imagem 4: 2.
- Legenda das imagens: usa items/answer e identifica cada posição.
- Associação entre imagens: relaciona cada posição apresentada à direita com a letra de referência à esquerda, respeitando rightOrder. Exemplo [1,2,0]: 1-B; 2-C; 3-A.
- Expressão matemática: mostra a resposta cadastrada por expressão, inclusive zero; resposta ausente aparece como ?.
- Alternativas de resposta única/múltipla: gabarito usa letras, como A, C. V/F e checklist conservam suas regras.

A alteração fica em print.html, renderer compartilhado pela prévia e impressão. Não há mudança no formato das questões, banco, SQL ou Supabase. Não é necessário recadastrar as respostas existentes. Os ramos preexistentes de formatos antigos foram mantidos.

## Validação

npm test aprovado com as regressões anteriores e a nova suíte tests/answer-key-regressions.cjs.

O teste novo falhou antes da correção ao detectar a omissão da discursiva e passou após a alteração. Cobertura: cinco tipos omitidos; letras; correspondência com imagens renderizadas e mudança de embaralhamento; atualização parcial da prévia; gravação e reabertura em DOM/Supabase simulados; resposta ausente; V/F/checklist; escape de texto; ausência das respostas reservadas na versão sem gabarito.

A validação técnica executou as funções reais de print.html em DOM isolado. Não houve gravação em provas reais nem publicação. A aba do navegador interno disponível continuou no login local; a conferência visual com conta real desta etapa permanece para o usuário.

## Conferência local

http://127.0.0.1:8000/dashboard.html

Atualizar a página para carregar print.html novo, abrir a prova de teste dos 30 tipos e ativar Mostrar gabarito. Conferir questões 6, 15, 17, 18 e 22. Na questão 3, devem aparecer A e C. Desativar Mostrar gabarito e verificar que as respostas reservadas não são exibidas.

## Próxima etapa

Etapa 4: ampliar a conferência, incluindo completude de respostas e estruturas/ordens inválidas. A etapa 3 corrige a apresentação dos dados cadastrados; não faz uma revisão geral das validações. As melhorias dos campos de resposta de outros formatos abertos permanecem na etapa 5.