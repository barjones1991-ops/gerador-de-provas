# Etapa 10 — Imagens em lote

Adicionar várias imagens no bloco Imagens de grade, sequência, legenda e relação imagem/palavra. Até 20 por seleção. Preenche itens sem imagem na ordem em que o navegador fornece os arquivos; excedentes criam novos itens. Imagens existentes, respostas, legendas e ordens existentes são preservadas. Novas sequências recebem ordem ao final; novos pares ampliam wordOrder sem desfazer o embaralhamento existente.

Conversão e compressão reutilizam readImageFile, com os limites existentes de formato, arquivo e imagem convertida. Falhas de leitura agora possuem callback de erro e abort. O lote é preparado antes de alterar a questão; arquivo inválido cancela o lote. Questão removida, conta trocada, edição bloqueada ou alteração concorrente dos itens cancelam a aplicação dos resultados. Após erro, o seletor permite tentar novamente. O salvamento continua pelo fluxo existente.

Sem alteração de schema, RLS, Auth ou formato persistido; sem publicação. Upload por coluna em associação imagem/imagem não faz parte deste lote.

Testes: tests/batch-images-regressions.cjs cobre os quatro tipos, espaços vazios, acréscimo, metadados, ordem, salvar/reabrir, limite, seleção vazia, falha parcial e mudanças concorrentes. Conversão de arquivos é simulada nesses testes; seleção e compressão reais no navegador ainda precisam de validação visual.

Local: http://127.0.0.1:8000/dashboard.html (Ctrl+F5). Abrir um dos quatro tipos e selecionar várias imagens no bloco Imagens; conferir imagens, respostas e ordem antes de usar a prova.

Próximo ponto: posicionamento dos marcadores sobre a imagem.
