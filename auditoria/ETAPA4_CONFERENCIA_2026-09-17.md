# Etapa 4 — Conferência por tipo de questão

Implementação local em 17/09/2026, sem publicação. As etapas 2 e 3 foram preservadas.

## Comportamento

- Expressões, sequências numéricas, sílabas, legendas e identificação: avisos de respostas ou campos ausentes, identificando a posição do item.
- V/F, resposta única e imagem com alternativas: gabarito ausente ou seleção incompatível; múltipla escolha exige duas alternativas e não aceita seleção vazia como alternativa A.
- Lacunas: verifica frase, espaço indicado por sublinhados e resposta; aceita os campos legados text/answers.
- Subitens aceitam texto ou imagem; leitura verifica palavras; operações vazias recebem aviso.
- Ordenação textual e de imagens: números inteiros de 1 a N, sem repetição. Validação consulta os números originais antes de normalizar.
- Relacionar texto, imagem/palavra e associação entre colunas: verifica conteúdo, imagens, quantidades e permutações cadastradas. A ausência da permutação mantém a compatibilidade com a ordem padrão legada.
- Tabela: aviso de estrutura vazia e erro se as linhas divergem da quantidade de colunas.
- Checklist, resposta discursiva, desenho e formatos abertos não exigem resposta objetiva. Grade sem linhas de resposta não exige gabarito; com linhas e respostas vazias, avisa para conferir a correção manual.

Ordens, correspondências e tamanhos de colunas incompatíveis são erros estruturais: usam o bloqueio existente no envio e na ação de impressão do editor. Dados incompletos continuam salvos como rascunho. Avisos de conteúdo não bloqueiam o envio. A prévia permanece disponível para revisão.

O painel esclarece que a conferência é automática e não verifica a correção pedagógica. Avisos continuam levando à questão correspondente. Não há novas tabelas, migrações, permissões, chamadas REST ou alteração do formato persistido no Supabase.

## Validação

npm test aprovado: suíte principal, segurança, SQL isolado, fluxos do editor, refinamentos e regressões das etapas 2, 3 e 4.

tests/readiness-regressions.cjs cobre exemplos completos/incompletos, formatos abertos, ordens repetidas/fracionárias/fora do intervalo, pares, dados malformados, imutabilidade, atualização dos avisos, navegação, gravação de rascunho e bloqueio de envio em DOM isolado. tests/run-tests.js também verifica que a normalização não oculta ordem fracionária.

Conferência visual com conta real fica pendente. Nenhuma prova real foi alterada pelos testes. Servidor local: http://127.0.0.1:8000/dashboard.html.

## Próxima etapa

Padronizar os formatos de resposta aberta e seus espaços de escrita/desenho, mantendo os gabaritos opcionais e revisando a impressão.
