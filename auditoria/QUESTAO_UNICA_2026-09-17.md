# Uma questão por vez no editor

Pedido: evitar repetir todas as questões abaixo da lista expansível Questões da prova.

Ao abrir uma prova existente, nenhum cartão fica visível. Selecionar na lista ou em um aviso de conferência mostra apenas aquele cartão expandido; o item da lista recebe destaque. Nova questão e inserção pelo banco abrem automaticamente o item criado. Número no cabeçalho fecha a edição; excluir a questão ativa limpa seleção. Consulta de prova enviada também permite selecionar; permissões existentes permanecem. Edição de registro individual do banco mantém a questão aberta.

activeQuestionIndex é estado de interface e não integra o payload salvo. Os demais cartões ficam hidden, preservando os formulários existentes e o conteúdo completo da prova. A prévia e o gabarito continuam com todas as questões. Sem alterações de Supabase ou migração. Alteração local, ainda não publicada.

Validação: tests/single-question-regressions.cjs cobre entrada sem seleção, seleção, conteúdo alterado preservado ao trocar, nova questão, fechamento, exclusão, banco, salvar/reabrir e consulta. Conferência visual final pendente.

Local: http://127.0.0.1:8000/dashboard.html (Ctrl+F5).

## Seleção sincronizada

Ao selecionar questão, questionOverview é recolhido e previewQuestionSelect recebe o mesmo índice imediatamente. O foco da prévia usa a fila existente caso o iframe ainda esteja carregando; a visualização permanece em edição. Teste cobre selecionar a segunda questão, voltar à primeira e recolher a lista em ambas as seleções.

## Rolagem da prévia

Atualização imediata cancela o timer pendente de reconstrução; o destino usa scrollTo no iframe, evitando rolar os ancestrais do editor. Contêiner externo volta ao topo e espaço final apenas na prévia permite alinhar também a última questão. URLs do iframe/script atualizadas para evitar cache antigo. Testes cobrem cancelamento, rolagem interna e contêiner externo.
Validação visual: fixture local com o print.html real, 12 questões e iframe dentro de contêiner com rolagem. Selecionar a questão 12 alinhou seu enunciado ao topo visível; selecionar a questão 3 retornou corretamente e manteve a página externa estável. Nenhuma prova real alterada.
