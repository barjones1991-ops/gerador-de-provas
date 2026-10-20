# Reorganização dos formulários de questão

Estado: alterações locais, sem commit ou publicação. Referência: a composição atual da discursiva e a imagem fornecida pelo usuário.

## Implementação

`editor.html`: formulários e eventos de todos os tipos, incluindo listas recriadas internamente. Campos ligados a itens receberam rótulos e classes também na criação de novos itens.

`js/editor-tools.js`: leitura de `enhanceFields`, `organizeQuestionChrome`, `organizeAlternatives`, `organizeAnswerItemImages`, `embedFieldImages`, `organizeDiscursive`, numeração e atualização dos resumos. Ícones e cabeçalhos foram extraídos para `questionIcon` e `questionBlockHeading`; a composição da discursiva foi preservada. `organizeStandardQuestion` move os controles existentes para blocos de finalidade específica. `syncStandardQuestion` atualiza a identificação impressa e a visibilidade das opções dependentes.

`css/editor-tools.css`: substituída a camada anterior de caixas genéricas. Os dois organizadores compartilham a apresentação dos blocos, cabeçalho, ajustes, interruptor e rodapé. Respostas ligadas a itens continuam nos respectivos itens, com identificação textual e tratamento verde.

## Cobertura por grupo

| Tipos | Organização | Conferência no navegador |
|---|---|---|
| `discursiva` | Referência preservada | Exemplo preenchido em desktop e 390 px |
| `multipla` (legado) | Alternativas, letras, seleção junto de cada resposta | Exemplo preenchido em desktop e 390 px |
| `marcarx` | Modo de resposta junto das alternativas; apresentação em ajustes | Exemplo múltiplo existente e exemplo único novo; troca de modos, seleção e inclusão/remoção de alternativa |
| `vf` | Afirmações com V/F junto de cada item | Exemplo preenchido em desktop e 390 px |
| `lacunas` | Frases e gabarito junto de cada lacuna | Exemplo preenchido em desktop e 390 px |
| `relacione` | Pares corretos preservados como pares | Exemplo preenchido em desktop e 390 px |
| `associacao_setas` (legado) | Pares e comandos existentes preservados | Somente DOM isolado; sem exemplo salvo disponível no navegador |
| `imagem`, `interpretacao_imagem`, `comparar_imagens` | Imagens no conteúdo; modo, perguntas e espaço no bloco de resposta | Exemplos com imagens em desktop e 390 px; ocultar/restaurar espaço; alternância aberta/objetiva de `imagem` |
| `texto_base` | Texto de apoio separado do enunciado e da resposta | Exemplo preenchido em desktop e 390 px |
| `subitens` | Comandos e linhas por item; estilo dos marcadores em ajustes | Exemplo preenchido em desktop e 390 px |
| `matematica_coluna`, `expressao_matematica` | Contas e ferramentas visíveis; apresentação em ajustes; respostas junto da conta | Exemplos preenchidos em desktop e 390 px |
| `problema_matematico`, `espaco_livre` | Espaços de escrita, cálculo ou desenho e critérios separados | Exemplos preenchidos em desktop e 390 px |
| `tabela` | Tabela de apoio separada do tipo de resposta | Exemplo preenchido em desktop e 390 px |
| `ditado` | Quantidade de espaços separada das palavras exclusivas do professor | Exemplo preenchido em desktop e 390 px |
| `ordenacao`, `sequencia_numerica` | Ordem ou resposta junto do conteúdo relacionado | Exemplos preenchidos em desktop e 390 px |
| `leitura_escrita`, `silabas` | Conteúdo para trabalhar e configurações pertinentes; gabarito identificado por palavra | Exemplos preenchidos em desktop e 390 px |
| `relacione_imagens`, `sequencia_imagens`, `legenda_imagens`, `associacao_imagem_imagem`, `grade_imagens`, `identificar_imagem` | Imagens, pares, ordens, legendas e respostas continuam relacionados | Exemplos com imagens em desktop e 390 px |
| `caca_palavras`, `cruzadinha` | Montagem da atividade; pistas e respostas ligadas; palavras em primeiro plano | Exemplos novos no navegador; caça-palavras preenchido e embaralhado; ausência de corte horizontal em 390 px |

## Execução controlada

Utilizada a prova existente “TESTE DE USABILIDADE – Um exemplo de cada tipo – 1º Ano A (cópia)”, explicitamente identificada como prova de teste. Foram percorridos os 27 exemplos existentes em desktop e em 390 px. Não houve campos além da largura da tela nos 27 exemplos. Foram adicionados caça-palavras, cruzadinha e alternativas para verificar também a criação; o valor total da prova de teste foi atualizado para 30 pontos.

Na alternativa nova, foram preenchidas quatro opções, marcada uma correta, ativado o modo múltiplo, marcada uma segunda correta e testada a escolha explícita ao voltar para resposta única. Foi adicionada uma alternativa temporária e removida em seguida, mantendo quatro opções e o gabarito A. Nas imagens, foi testado ocultar/restaurar o espaço mantendo cinco linhas e alternar para resposta objetiva e voltar à discursiva. Dados foram salvos e reabertos pelo aplicativo. Não houve envio à coordenação.

Capturas reais: `questoes-redesign-desktop.jpg` e `questoes-redesign-mobile.jpg`, na pasta de visualizações desta conversa.

## Regressões

`tests/interface-regressions.cjs` verifica para todos os tipos não discursivos, inclusive os legados, que a reorganização conserva cada controle original, seus valores, marcações e bloqueios. Compara o conteúdo persistido e a saída impressa antes/depois e verifica que editar o campo original continua atualizando a questão.

Foram atualizadas as expectativas estruturais de `editor-flows.cjs` e `alternatives-regressions.cjs` para numeração/BNCC em ajustes e exclusão no rodapé, mantendo as verificações funcionais. `npm test` executado integralmente com sucesso.

## Limites da validação

- A inspeção no navegador não equivale a executar todas as combinações de conteúdo e opção de cada tipo. Há cobertura adicional de persistência, imagens, permissões, histórico e renderização nas regressões automatizadas.
- `associacao_setas` e os modos legados V/F e checklist de `marcarx` foram verificados pelas regressões, sem inspeção de registros desses formatos no navegador nesta rodada.
- Durante mudanças rápidas, o console registrou falhas transitórias do paginador vendorizado (`MutationObserver` e `getBoundingClientRect`). A prévia final recuperou a paginação, apresentou dez páginas e focou a questão selecionada. A reorganização visual não alterou o paginador; investigar separadamente a concorrência de renderizações antes de afirmar ausência de erros nesse fluxo.
- Não houve publicação, migração, alteração de permissões ou mudança no formato persistido das questões.
