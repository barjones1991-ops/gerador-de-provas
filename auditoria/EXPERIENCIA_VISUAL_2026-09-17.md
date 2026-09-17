# Organização e proporções do editor

Implementado localmente, sem publicação: cabeçalho compacto, aproveitamento da largura, campos mais legíveis, busca de questões por enunciado/tipo, lista com altura limitada, orientação quando nenhuma questão está selecionada, janela de tipos com categorias/busca/exemplos, contas antes da aparência, prévia ajustada à largura e revisão ampliada. Aviso duplicado de pontuação removido do painel.

Selecionar ou fechar uma questão não agenda salvamento nem marca alterações pendentes; editar conteúdo continua usando a rotina existente. Pesquisa disponível em modo de consulta. Nenhuma alteração de schema, RLS, Auth ou formato persistido.

Verificação em prova fictícia local, notebook 1366×768 e tela pequena 390×844, além das regressões automatizadas. A versão publicada e a prova de usabilidade não foram modificadas nesta rodada.
Separação entre questões: linha cinza fina e respiro de 12 px, compartilhados pela prévia A4 e impressão. A última questão não recebe linha ao final.

Unificação de tipos: criação oferece apenas Alternativas (uma ou várias respostas corretas); Verdadeiro/Falso permanece separado. Renderizadores mantêm compatibilidade com multipla e modos vf/checklist antigos. Conversão de multipla acontece somente ao escolher múltiplas respostas, preservando os dados comuns e o gabarito. Sem migração no banco ou publicação.


## Edição de Alternativas

- Pontuação no início; títulos repetidos removidos e orientação direta para o gabarito.
- Aparência, numeração e imagens opcionais recolhidas. Cada opção tem seu próprio seletor de imagem; imagens complementares continuam disponíveis.
- Resposta correta recebe destaque suave; remoção compacta com nome acessível por letra.
- Redução de várias respostas para uma pede qual resposta manter, com cancelamento sem alteração.
- Correção funcional: imagens de marcarx aparecem em lista, duas colunas e tabela na impressão; excluir opção mantém imagens e gabarito alinhados.
- Nova questão selecionada também na prévia; cache dos recursos atualizado.
- Validação: suíte npm test, teste de persistência/remoção de imagens, renderização segura na impressão, navegação local em desktop e celular. Não publicado.
