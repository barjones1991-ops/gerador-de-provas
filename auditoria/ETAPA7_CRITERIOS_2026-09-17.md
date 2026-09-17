# Etapa 7 — Resposta esperada e critérios de correção

Campo opcional por questão para discursiva, subitens, interpretação de imagem, problema matemático, desenho, comparação de imagens, texto-base, tabela e imagem em modo discursivo. Nos formatos com várias perguntas, o professor identifica cada critério pela letra ou número no mesmo campo. Não foi introduzida pontuação por subitem.

Critérios aparecem somente no gabarito. Sem preenchimento, informa correção manual e ausência de resposta esperada. Modos objetivos continuam com seu gabarito próprio; trocar o modo preserva os critérios cadastrados. Cada campo recebe rótulo acessível com o número da questão.

Dados: reutiliza expectedAnswer já suportado pela normalização e pelo JSON das questões. Não altera schema, RLS, Auth ou contratos REST e não exige migração. As questões antigas continuam válidas. Nenhuma prova real foi modificada nos testes.

Validação: tests/manual-answer-regressions.cjs exercita nove formatos com os renderers reais em DOM isolado, edição, salvar/reabrir via REST simulado, critérios vazios, mudança de modo, gabarito, escape de HTML e ausência dos critérios na versão do aluno. Suíte principal também cobre os critérios opcionais e a separação dos modos objetivos. Conferência visual real ainda pendente.

Local: http://127.0.0.1:8000/dashboard.html. Atualizar com Ctrl+F5; abrir uma questão de desenho ou problema; preencher Resposta esperada / critérios de correção; comparar prévia com e sem Mostrar gabarito.

Próximo lote da análise: codificação, rótulos acessíveis e atualização do resumo das questões. Publicação continua adiada.
