# Revisão do fluxo publicado — commit 376776a

Documento histórico da revisão. As correções locais posteriores estão em [CORRECOES_REVISAO_376776a.md](CORRECOES_REVISAO_376776a.md). O script de reprodução descreve falhas da versão antiga; a validação da versão corrigida usa `npm test`.

Escopo: verificar o refinamento existente, sem propor novas funcionalidades ou modificar o aplicativo nesta revisão.

Método: leitura do código, reprodução em DOM/VM com REST simulado e execução de `npm test`. A suíte existente passou (16 fluxos do editor, 15 regressões, 39 verificações SQL e testes gerais), mas não cobria todos os cenários abaixo. Migração 03 executada conforme relato do usuário; sem validação administrativa independente ou ciclo real com contas nesta revisão.

## R01 — Alta: duplicação no banco pode perder conteúdo

Ao editar `editor.html?bank=ID`, o botão Duplicar da questão continua ativo. É possível editar duas questões, mas `EditorTools.saveBank()` envia apenas `state.questions[0]`, enquanto confirma como salvo o fingerprint do estado inteiro. A segunda questão não chega ao registro original e desaparece ao reabrir.

Reprodução confirmada por clique no DOM: duplicar, editar a segunda, salvar; retorno true e payload sem a segunda questão. Referências: `editor.html:2501` e `js/editor-tools.js:279`.

Refinamento: restringir o modo de edição de um registro à sua única questão, retirando ações incompatíveis e validando a quantidade antes de salvar.

## R02 — Média: remover a única questão do banco quebra o salvamento

O botão Remover questão também continua ativo nesse modo. Depois de remover, salvar chama `normalizeQuestion(undefined)` antes do bloco try/catch e rejeita com “Questão inválida”, sem o tratamento normal do erro de salvamento. Reprodução confirmada por clique no DOM e captura da rejeição.

Referências: `editor.html:3015`, `js/editor-tools.js:283`. Refinamento: separar a exclusão do registro (já existente no banco) da remoção de uma questão dentro de uma prova; impedir estado vazio no editor do registro.

## R03 — Alta: os dois caminhos de envio aplicam conferências diferentes

O editor consulta `ExamSafety.inspectExam`, mas `dashboard.html:1042` verifica apenas existência de questões e soma dos pontos. Um caça-palavras com palavra de 30 letras gera pendência bloqueante no editor; o envio pela lista passa pelas validações do painel. A simulação confirma a requisição de envio e o estado enviada. As validações SQL de revisão conferem quantidade e soma, sem verificar a montagem desse passatempo.

Não foi realizado envio de prova real. Refinamento: usar a mesma conferência nos dois pontos de envio e mensagens equivalentes.

## R04 — Média: prova nova não herda o logo configurado na escola

Na criação, o painel consulta apenas o nome da escola e grava `logo_data_url: null` (`dashboard.html:958`). Ao abrir a prova criada, o preenchimento do logo exige `!currentExamId` (`editor.html:7012`), condição falsa nesse fluxo. Análise estática confirma que a herança automática não ocorre, mesmo com logo escolar configurado.

Refinamento: preencher o logo ao criar a prova; manter intactos os cabeçalhos das provas já existentes.

## R05 — Alta operacional: página de impressão aberta não revalida a fila

`print.html:480` confere o caça-palavras local e chama `window.print()`. A autorização/situação é consultada na carga da página. Se a coordenação retirar a aprovação/pedido depois da abertura, o botão da aba antiga não consulta o servidor novamente.

Constatado por leitura da função; cenário com contas reais não executado. Refinamento: revalidar a situação antes da ação de impressão do aplicativo. Isso não garante impedir impressão nativa ou captura de conteúdo já exibido pelo navegador.

## Pendência de usabilidade já conhecida

A recuperação de rascunho da mesma versão ainda usa confirmação nativa em que Cancelar descarta a cópia local (`editor.html:6474`). A mensagem explica o efeito, mas o significado do botão favorece enganos. Deve ser refinado antes de considerar concluída a proteção da recuperação para o professor.

## Limites e prioridade

Priorizar R01/R02 (integridade da edição do banco), R03 (conferência consistente), R05 (coerência da fila), depois R04 e recuperação de rascunho. Disposição visual, teclado/toque e PDFs nos navegadores reais continuam exigindo validação específica. Esta revisão não aplicou novas correções nem SQL.

Reprodução: `node auditoria/reproduzir-revisao-376776a.cjs`, executado na raiz. O script usa dados fictícios e REST simulado; não escreve no Supabase.
