# Etapa 11 — Marcadores sobre a imagem

Identificar partes da imagem passa a exibir uma área de posicionamento com botões numerados. Arraste usa as dimensões reais da imagem exibida e converte para X/Y percentuais inteiros entre 0 e 100. Alteração é confirmada ao soltar; Esc, pointercancel e perda de captura cancelam movimento não confirmado. Setas movem 1%; Shift+seta move 5%. Rótulos informam questão/marcador. Campos numéricos são mantidos e sincronizados; troca de imagem e adição/remoção de marcadores atualizam a área.

Corrigida a interpretação de 0% como 50% no formulário, prévia e impressão. Gabaritos, rótulos e respostas preservados. Edição depende das permissões e da permanência da questão/marcador no estado.

Reutiliza markers/x/y no JSON existente, sem SQL, migração ou mudança de permissões. Nada publicado.

Testes em tests/marker-regressions.cjs: eventos de ponteiro e teclado em DOM isolado, limites, cancelamento, campos X/Y, salvamento/reabertura e bloqueio por permissão. Suíte principal verifica a posição 0% e uso da regra comum na impressão. Dimensões simuladas no teste: interação visual real com mouse e toque ainda pendente.

Local: http://127.0.0.1:8000/dashboard.html, Ctrl+F5. Abrir Identificar partes da imagem com imagem cadastrada; arrastar números, experimentar setas e Esc, conferir prévia/gabarito e reabrir após salvar.

## Simplificação após feedback

Coordenadas passam a Ajuste fino fechado por padrão; rótulos e respostas recebem o número correspondente. Tooltip sem coordenadas. O arraste tem destaque de captura e confirma a posição antes de liberar a captura, mantendo o botão no ponto escolhido. Setas sempre movem 1%, sem modificador Shift. Teste cobre permanência após lostpointercapture e campos recolhidos.

## Divergência visual relatada

O usuário relatou coordenadas corretas na prévia, mas número deslocado no editor. A reprodução isolada com estilos atuais posicionou corretamente; a causa na sessão real não foi comprovada. Geometria essencial passou a ser explícita no componente: contêiner relativo, imagem sem margem/padding/borda e número absoluto. CSS recebeu versão para evitar reutilização de estilos antigos. Fixture local no navegador valida o arraste real; não altera provas.
