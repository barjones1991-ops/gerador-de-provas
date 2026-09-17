# Organização das ações da questão

Implementação local autorizada em 09/09/2026. Menu Mais e seus eventos/estilos removidos.

- Questão recolhida: apenas número, tipo e resumo; expandir revela controles.
- Imagens: controles universais existentes junto de Adicionar imagem complementar; tamanho/posição das complementares no mesmo bloco. Imagens próprias de cada tipo continuam no conteúdo correspondente.
- Respostas: Mostrar espaço para o aluno responder aparece nos tipos compatíveis.
- Apresentação: Mostrar número da questão usa caixa de seleção positiva.
- Rodapé: Salvar no banco de questões e Excluir questão, separados. No modo de edição de um registro do banco, mantém-se apenas o salvamento principal da página.
- Pontuação e habilidade preservadas. Bloqueio por revisão permanece aplicado aos controles; exclusão continua reversível por Desfazer.

Testes verificam ausência do menu, ocultação de ações ao recolher, posicionamento dos controles de imagens, persistência das duas caixas de seleção, conservação das imagens e permissões em revisão/banco. A suíte geral continua sendo `npm test`.

Sem alteração de SQL. Ainda não publicado; disposição visual, teclado/toque e ciclo com contas reais permanecem sujeitos a conferência manual. Endereço local: http://127.0.0.1:8000/dashboard.html.
