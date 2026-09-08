# Correções do editor — 08/09/2026

Implementação dos achados E01–E16 da [análise do editor](ANALISE_EDITOR_2026-09-08.md), com publicação autorizada pelo usuário em 08/09/2026. Esta etapa não exige nova migração SQL: usa as tabelas e o controle de versão das migrações 01/02 já executadas pelo usuário.

## Entrega por achado

| Achado | Implementação |
| --- | --- |
| E01 — HTML externo | wordCount/calcLines e demais medidas têm limites numéricos específicos; atributos escapados; fallback de LaTeX usa texto escapado. Contratos de coleções por tipo recusam estruturas incompatíveis, itens nulos e excesso de itens. Isso não substitui uma auditoria contínua de todos os componentes do aplicativo. |
| E02 — Dados alterados na abertura | Prova existente preserva turma, autor, escola, logo e campos intencionalmente vazios. Perfil fornece opções disponíveis, sem substituir o cabeçalho salvo. |
| E03 — Provas aprovadas | Ações de edição e callbacks de imagens respeitam bloqueio/conta. Impressão abre novamente a prova persistida, sem imprimir estado local alterado. A prévia A4 é somente leitura. |
| E04 — Gabarito numérico | Parser brasileiro compartilhado, separador de milhar, decimais e divisão por zero. Resultados não exatos exibem aproximação com até seis casas. |
| E05 — Exclusão | Desfazer/refazer do conteúdo nesta aba, com atalhos Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z ou Ctrl+Y. Até 30 estados, com orçamento de memória e retenção mínima dos dois estados mais recentes; não é versionamento permanente no servidor. |
| E06 — Banco de questões | Alterar abre `editor.html?bank=ID` em outra aba. Edita uma questão e seus metadados, sem inserir na prova aberta. Salvar faz PATCH no ID e updated_at originais; conflito preserva a cópia local. |
| E07 — Limites | Bloqueio por permissão preserva o estado disabled original dos controles. Remoção de alternativas também verifica limites no próprio handler. Opções antigas além do limite de criação não são truncadas ao abrir. |
| E08 — Alinhamento | Normalização conserva lado_esquerda/lado_direita; controles numéricos permitem alterar tamanho, deslocamento e alinhamento de imagens livres. |
| E09 — Impressão | Ação principal Imprimir/PDF e opções de gabarito conduzem a print.html. Navegação não aparece na impressão do editor; Ctrl/Cmd+P conduz ao fluxo correto. A impressão pelo menu nativo do navegador na página de edição exibe orientação para abrir o documento. |
| E10 — Prévia | Frame de print.html recebe snapshots por mensagem da mesma origem e janela pai. Usa a mesma renderização e tipografia de impressão, largura de conteúdo A4 e zoom. Marcadores estimados antigos foram desativados; quebras finais continuam a cargo do mecanismo de impressão do navegador. |
| E11 — Conferência | Resumo com pendências clicáveis: identificação, pontuação, alternativas/gabarito, imagens, texto de apoio, operações e passatempos. Erros estruturais impedem impressão; avisos pedagógicos permitem continuar após conferência explícita. |
| E12 — Tabela | Reconstrução reinstala os eventos; múltipla escolha oferece edição de alternativas e seleção da correta. |
| E13 — Catálogo | Todos os tipos com template têm entrada direta, agrupada por finalidade e com exemplo. Rótulo Tabela de dados substitui a promessa de gráfico. Compatibilidade com produção textual legada permanece no normalizador. |
| E14 — Organização | Barra principal com título, desfazer/refazer e impressão; dados gerais recolhíveis; navegação pelas questões; alternância Editar/Prévia em telas estreitas. Altura da barra é acompanhada para evitar conteúdo encoberto. |
| E15 — Acessibilidade | Labels/nomes de campos, foco visível, estado de expansão, diálogo do banco e do recorte com retorno/contenção de foco e Escape. Imagens usam Pointer Events e oferecem controles numéricos; recorte também pode ser definido sem arrastar. |
| E16 — Custo de edição | Prévia e cópia local são agrupadas por intervalo; formulários de questões recolhidas não são montados. Atualização incremental troca só o bloco alterado na prévia, mantendo os demais. Alterações estruturais enviam snapshot completo. |

Também foi corrigida uma falha anterior de inicialização: o primeiro script executava funções que dependiam de declarações de um script posterior. A inicialização agora aguarda DOMContentLoaded.

## Validação

`npm test` inclui os contratos anteriores, regressões de salvamento, SQL/PGlite e `tests/editor-flows.cjs`, que usa DOM/VM isolados com dados fictícios. Os cenários novos cobrem carregamento, todos os templates, desfazer/refazer, limite de alternativas, tabela, bloqueio de prova aprovada, edição/conflito no banco, HTML hostil, números brasileiros, renderização de todos os tipos e atualizações incrementais.

O cenário com 100 questões verifica que os formulários recolhidos não são criados e que 100 alterações não causam 100 gravações locais. Não é um benchmark de latência ou consumo de memória de um navegador real.

O inventário de controle de interface novamente retornou nenhum navegador. Portanto, disposição visual, zoom, quebras de página, teclado/toque reais e SMTP/Auth reais não foram validados nesta etapa. Não foram alteradas provas reais nem enviados e-mails.

## Conferência manual

Com o servidor local ativo, abrir `http://127.0.0.1:8000/dashboard.html` e selecionar uma prova de teste:

1. Conferir que turma, autor e campos vazios permanecem iguais depois de abrir e recarregar.
2. Excluir uma questão, desfazer, refazer e verificar o conteúdo salvo.
3. Criar questão de tabela, adicionar linha, mudar resposta e marcar alternativa correta.
4. Reabrir imagem posicionada ao lado do texto e conferir a posição na prévia e na impressão.
5. Conferir operação `1.000 + 2`, decimal e divisão não exata no gabarito.
6. Editar registro do banco em aba separada; confirmar que a prova original não mudou e que o registro foi atualizado.
7. Conferir uma prova aprovada: edição bloqueada e saída obtida do documento persistido.
8. Testar largura de celular e desktop, foco com Tab/Escape, controles de recorte e impressão com/sem gabarito.

Os scripts `reproduzir-editor-20260908.cjs` e `resultados-editor-20260908.txt` permanecem como evidência histórica da versão anterior; não devem ser usados como testes de sucesso da versão corrigida.
