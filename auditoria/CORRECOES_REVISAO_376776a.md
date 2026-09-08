# Correções posteriores à revisão de 376776a

Implementação autorizada pelo usuário, incluindo remoção de duplicar/subir/descer questões. Publicação autorizada pelo usuário em 08/09/2026. A migração 03 já executada pelo usuário permanece suficiente; este lote não muda o SQL.

| Item | Implementação |
| --- | --- |
| R01 | Removidos botões e funções de duplicação e movimentação de questões. Salvar no banco verifica quantidade exata de uma questão, impedindo descarte silencioso das demais. |
| R02 | Editor do registro do banco não oferece remoção da única questão nem inserção de outras. Validação e normalização ficam dentro do tratamento de erro; estados inválidos preservam a cópia e não enviam PATCH. |
| R03 | Painel carrega ExamSafety e aplica seus erros bloqueantes antes do envio, assim como o editor. Mantidos os controles de quantidade e pontuação existentes. |
| R04 | Criação consulta nome e logo da escola e os inclui na nova prova. Falha nessa consulta interrompe a criação com orientação para tentar novamente. Cabeçalhos de provas existentes continuam preservados. |
| R05 | Botão de impressão reconsulta prova e perfil; pedidos da fila exigem aprovação e envio ainda ativos. Troca de conta, retirada, conclusão, falta de acesso ou erro de rede impedem a chamada de impressão. Conteúdo atualizado é renderizado antes de imprimir, aguardando imagens e fontes. |
| Recuperação | Rascunho da mesma versão exige escolha explícita: recuperar, descartar com confirmação ou decidir depois. A edição fica protegida enquanto a escolha está pendente; adiar e cancelar descarte mantêm a cópia local. |

## Verificação

`npm test` inclui cinco novos grupos em `tests/flow-refinements.cjs`: ações removidas/integridade do banco; escolhas de recuperação; conferência equivalente de envio; logo escolar e falha de carga; revalidação de impressão com pedido ativo, retirado, concluído, indisponível, rede falha e troca de conta. Mantidos os 16 fluxos DOM, 15 regressões, 39 verificações SQL e testes gerais.

Os testes usam dados fictícios e REST simulado/SQL isolado. Servidor local respondeu HTTP 200. Ainda falta conferência visual e ciclo com contas reais. A revalidação protege a ação do aplicativo; não impede recursos nativos de impressão/captura do navegador nem elimina a possibilidade de mudança do pedido após a consulta.

Conferência local: http://127.0.0.1:8000/dashboard.html. Reabrir o editor, conferir menu Mais sem duplicar/subir/descer; editar registro do banco; criar prova com logo escolar; recuperar rascunho; retirar pedido em outra conta antes de tentar imprimir pela aba aberta.
