# Análise do editor de provas

Atualização: os achados desta análise histórica receberam implementação local. Veja [correções e validação](CORRECOES_EDITOR_2026-09-08.md). As reproduções abaixo descrevem a versão anterior.

Base: commit `3cf5d23`, em 08/09/2026. Escopo: editor.html, normalização compartilhada, integração com banco de questões, salvamento e saída para impressão. Esta análise não alterou o aplicativo nem dados do Supabase.

## Método e limites

Leitura do código e execução de funções extraídas em VM com dados fictícios. O script [reproduzir-editor-20260908.cjs](reproduzir-editor-20260908.cjs) e os [resultados](resultados-editor-20260908.txt) registram as reproduções. Execute `node auditoria/reproduzir-editor-20260908.cjs` na raiz. É um diagnóstico histórico: quando os defeitos forem corrigidos, suas expectativas deverão deixar de ocorrer.

`npm test` passou, incluindo 15 grupos de regressão funcional e 35 verificações SQL. Esses testes não cobrem todos os comportamentos encontrados abaixo. O teste que procura campos numéricos seguros, por exemplo, não exercita wordCount e calcLines.

O inventário de controle de interface retornou `apps: []` e `browsers: []`. Não houve inspeção de tela, impressão física, medição de desempenho em navegador ou teste com conta real. Os apontamentos de layout abaixo são inferências das regras HTML/CSS e precisam de confirmação visual. As reproduções em VM comprovam os comportamentos das funções, não constituem uma simulação completa do navegador.

## Avaliação geral

O editor tem recursos úteis e uma base de persistência melhor do que a versão anterior: carregamento protegido, salvamento com versão, recuperação local, modelos de instrução, pontuação, banco paginado, imagens e gabarito. Entretanto, ainda pode alterar informações sem intenção do professor e produzir uma saída diferente da prova aprovada ou do que a prévia sugere.

A prioridade deve ser preservar conteúdo e fidelidade da prova. A revisão visual deve acompanhar essa correção, organizando as tarefas principais: preencher dados, montar questões, revisar e imprimir.

P1 = corrigir primeiro, por segurança, conteúdo ou confiabilidade da avaliação. P2 = impacto importante no fluxo, acessibilidade ou manutenção. A classificação expressa prioridade de engenharia, não uma medição formal de risco.

## Achados de maior prioridade

### E01 — P1 — Campos externos ainda podem inserir HTML

**Confirmado por reprodução da normalização e do template.** `wordCount` e `calcLines` não estão na lista de campos numéricos do normalizador (`js/exam-safety.js:3`). O editor insere esses valores diretamente em atributos HTML (`editor.html:4544` e `editor.html:4601`). Um valor com aspas introduziu um atributo extra no diagnóstico, usando apenas um marcador inerte.

Uma questão recebida do banco compartilhado pode percorrer esse caminho ao ser inserida na prova. É um ponto de injeção de HTML com potencial de XSS; não foi executado código injetado em navegador nem demonstrado roubo de sessão. Há ainda um fallback de expressão matemática sem escape quando KaTeX não está disponível (`editor.html:4459`, atribuído a innerHTML em 4488/4492).

**Correção proposta:** schema por tipo, coerção com limites próprios de cada campo e construção de controles por propriedades DOM. Escapar também os caminhos de fallback. Acrescentar regressões para todos esses campos, sem depender apenas de validação do input local.

### E02 — P1 — Abrir uma prova pode trocar sua turma

**Confirmado em VM.** `applyProfileDefaults()` usa o perfil de quem está conectado. Se ele tem uma única turma e a prova salva tem outra, a função substitui a turma (`editor.html:7061`, especialmente o bloco próximo de 7107).

Reprodução: prova salva em **5A**, usuário com turma **6A**; aplicar os padrões muda a prova para **6A**. `initCloud()` chama essa função depois do carregamento e posteriormente agenda o autosave (6909–6953). Assim, a alteração pode chegar à nuvem sem edição intencional. Campos vazios de professor/escola e logo também podem ser preenchidos com os dados atuais do usuário, inclusive durante revisão por outra pessoa.

**Correção proposta:** aplicar padrões na criação. Ao abrir uma prova existente, preservar os valores salvos; qualquer atualização de cabeçalho deve ser explícita. O vínculo fixo de escola no SQL não resolve sozinho essa alteração do conteúdo impresso.

### E03 — P1 — Bloqueio de prova aprovada não cobre imagens da prévia

**Confirmado em VM.** `applyReviewLock()` desabilita controles do painel, mas não os controles de imagem livre da prévia. `initFreeImageInteractions()` permite remover, mover e redimensionar sem consultar o bloqueio (`editor.html:5933`).

A reprodução removeu uma imagem de uma prova marcada como aprovada. `flushAutoSaveBeforeAction()` retorna true para provas aprovadas/bloqueadas (7219), permitindo a impressão do estado local modificado. A remoção chama `renderAll()`, que recria controles sem reaplicar imediatamente o bloqueio.

Isso não demonstra que um professor consiga modificar a prova aprovada no banco: as proteções SQL continuam relevantes. Demonstra que a cópia impressa pelo editor pode divergir da aprovada.

**Correção proposta:** uma regra central de edição aplicada em cada ação e renderização, prévia sem controles interativos no modo de leitura e impressão da versão aprovada confirmada.

### E04 — P1 — Gabarito numérico interpreta separador de milhar incorretamente

**Confirmado em VM.** `gerarGabaritoQuestao()` usa parseFloat com troca de vírgula por ponto (`editor.html:6061`). Para `1.000 + 2`, retorna **3**, enquanto a notação brasileira representa **1.002**. Também é necessário definir o tratamento de resultados fracionários e do arredondamento a duas casas.

**Correção proposta:** parser único de números brasileiros, validação de entradas ambíguas e testes de operações inteiras, decimais, milhares e divisão. Um gabarito incorreto tem impacto pedagógico direto.

### E05 — P1 — Exclusão de questão não oferece recuperação

**Confirmado no código.** O botão de remoção executa splice e renderAll diretamente (`editor.html:2996`). Não há confirmação, lixeira ou histórico de desfazer no aplicativo. O autosave pode persistir a remoção e apagar a cópia pendente após confirmar o salvamento; essa cópia não equivale a um histórico de versões.

**Correção proposta:** desfazer imediato para remoção e histórico limitado de ações, com recuperação de versões como proteção adicional. Não depender de confirmação para toda ação pequena.

## Fluxos, impressão e integridade visual

### E06 — P2 — “Alterar” no banco insere uma cópia na prova

**Confirmado em VM.** `editBankQuestion()` acrescenta a questão ao array da prova (6780), sem manter vínculo de edição com o registro original. `saveQuestionToBank()` faz POST de um novo registro (6622).

O professor pode aumentar a quantidade de questões e a soma de pontos da prova apenas tentando corrigir seu acervo. **Correção:** edição independente do registro original, com ações distintas para usar uma cópia e atualizar o banco.

### E07 — P2 — Limites dos botões são perdidos após a rotina de bloqueio

**Confirmado em VM.** `applyReviewLock()` atribui `disabled = false` a todos os controles quando a prova é editável (7011), reabilitando botões que o renderizador havia desabilitado por limite de quantidade.

No tipo multipla, remover alternativa não verifica novamente o mínimo no handler (3137); com menos de duas, a próxima renderização redefine as opções como duas strings vazias (3094). Isso cria uma sequência de possível perda de conteúdo. **Correção:** combinar bloqueio global com a condição específica do controle e validar o limite no handler.

### E08 — P2 — Posição lateral de imagem não sobrevive à normalização

**Confirmado em VM.** O editor oferece `lado_esquerda` e `lado_direita` (3477), mas o normalizador aceita apenas left/center/right. Ambos os valores laterais viraram `left`. A configuração pode desaparecer ao reabrir, recuperar ou copiar a questão. **Correção:** contrato compartilhado entre opções, normalização e renderização.

### E09 — P2 — Caminhos de impressão diferentes e navegação lateral sem ocultação

**Confirmado no HTML/CSS; resultado final depende de validação visual.** “Exportar PDF” e “Imprimir” chamam a mesma função window.print (6407 e 6444). “PDF limpo” abre outro arquivo, com outro renderizador.

O aside da navegação não tem no-print (1517). As regras de impressão ocultam essa classe, mas não ocultam explicitamente o aside nem zeram padding-left do body (1426); no desktop, a regra base reserva 240 px. Dependendo da largura de mídia usada na impressão, a regra móvel pode zerar a margem, mas a navegação segue sem exclusão explícita. Isso pode levar navegação e espaço indevido ao documento.

**Correção:** uma ação principal “Imprimir / PDF”, opções claras de gabarito e um único caminho de renderização. Garantir ocultação da interface e testar saída em navegadores reais.

### E10 — P2 — Prévia não é uma página A4 fiel

**Inferência fundamentada no CSS e algoritmo.** A prévia usa largura flexível, espaçamentos diferentes dos de impressão e muda sua estrutura no celular. As quebras são estimadas pela largura da prévia (6220), não pela paginação do documento impresso. O recálculo é agendado por renderAll, mas alterações de texto chamam apenas renderPreview; não há atualização dedicada para resize ou fim do carregamento de imagens.

**Correção:** prévia com dimensões reais de página e zoom, renderização compartilhada e recálculo após alterações de conteúdo. Enquanto isso, identificar as quebras como estimativas.

### E11 — P2 — “Pronto para impressão” aparece sem verificar a prova

**Confirmado no código.** O selo é HTML fixo (1688). A rotina de impressão confere caça-palavras, mas não implementa uma verificação geral de conteúdo. Rascunhos podem conter questões vazias, imagens ausentes e gabaritos incompletos.

**Correção:** resumo de pendências com acesso à questão correspondente. Separar avisos pedagógicos, que podem ser intencionais, de erros que tornam o documento inválido. Conferência de pontuação já existe e deve compor esse resumo.

### E12 — P2 — Controles da tabela podem perder seus eventos

**Confirmado por leitura do ciclo de criação.** Adicionar linha/coluna chama renderTableEditor e recria os selects de resposta/linhas (4658–4686). Os listeners data-k são instalados depois, uma única vez na renderização externa (5366). Os controles recriados internamente não recebem esses listeners por esse caminho.

Além disso, o bloco permite selecionar resposta de múltipla escolha sem oferecer ali a configuração completa das alternativas. **Correção:** eventos delegados ou montagem reutilizável que registre os eventos a cada recriação; completar ou retirar opções incompletas.

## Organização, aparência e acessibilidade

### E13 — P2 — Recursos existentes têm caminhos de criação incompletos

O menu expõe 12 entradas, confirmado pelo diagnóstico. Agrupar modalidades é útil — Alternativas já oferece resposta única, múltipla, V/F e checklist. Porém, isso não dá acesso a todos os tipos implementados. `texto_base`, por exemplo, tem renderizador, mas não tem entrada direta nem conversão de tipo encontrada. “Tabela / gráfico” não oferece um construtor de gráficos no bloco analisado.

**Proposta:** catálogo por finalidade (alternativas, escrita, interpretação, matemática, imagens, alfabetização), com amostra e descrição curta; verificar que cada rótulo corresponde a uma função completa. Permitir texto de apoio vinculado a várias questões, sem exigir repetição.

### E14 — P2 — Hierarquia da tela e adaptação móvel precisam de revisão

**Avaliação de projeto baseada no código, sem inspeção visual.** A paleta neutra, cartões, agrupamento de opções e destaque de salvamento são uma base coerente. Entretanto, impressão fica sob engrenagem, e-mail ocupa o status de destaque e não há um resumo navegável das questões.

No desktop, a lateral fixa usa 240 px e a coluna de edição usa 420 px a partir de 1024 px de viewport; a prévia pode ficar comprimida ou forçar transbordamento. No celular, navegação e ações viram listas verticais antes do conteúdo, e a prévia fica abaixo de todo o painel. A prévia não acompanha a edição por uma navegação própria.

**Proposta:** título da prova, status e impressão na barra principal; dados gerais recolhíveis; lista compacta de questões; foco na questão selecionada; alternância Editar/Prévia em telas estreitas. Não é necessário mudar cores antes de resolver essa organização.

### E15 — P2 — Acessibilidade e interação por toque incompletas

Os campos principais e muitos campos dinâmicos usam labels sem associação ao input. O modal do banco não declara dialog/aria-modal nem controla entrada, contenção e retorno do foco. Menus não atualizam aria-expanded e não há tratamento de Escape encontrado. A sobreposição do banco tem z-index 80, abaixo da navegação lateral com 90, o que exige revisão de empilhamento.

Mover e redimensionar imagens livres usa mousedown/mousemove/mouseup, sem Pointer Events nem alternativa por teclado (`editor.html:5933`). **Proposta:** semântica dos controles, foco previsível, atalhos de saída e controles numéricos acessíveis de posição/tamanho, além de toque.

### E16 — P2 — Renderização e cópia local crescem com a prova inteira

**Confirmado na arquitetura; lentidão não foi medida.** Cada edição de texto recria toda a prévia via innerHTML, reinstala interações e chama saveState. scheduleAutoSave calcula a assinatura e grava a cópia local antes do atraso de 1200 ms; esse atraso limita o envio de rede, não o custo por tecla. Imagens em base64 ampliam a serialização.

**Proposta:** atualizar apenas a questão alterada, separar atualização visual de persistência, controlar a frequência das cópias locais e medir cenários com muitas questões/imagens antes de escolher mudanças maiores. A criação de todos os controles mesmo para questões recolhidas também merece medição.

## Sequência sugerida

1. Fechar injeções de HTML e tornar o modo aprovado realmente somente leitura.
2. Preservar os dados carregados, corrigir números do gabarito e oferecer desfazer para exclusões.
3. Corrigir banco de questões, limites de controles, tabelas e persistência de posicionamento de imagens.
4. Unificar impressão/prévia e criar conferência de pendências.
5. Reorganizar a tela, completar os caminhos de criação e testar teclado, toque e telas estreitas.
6. Medir e otimizar provas grandes; ampliar testes funcionais a partir dos defeitos reproduzidos.

Esta entrega é uma análise. Os achados novos ainda não foram corrigidos nem publicados no GitHub.
