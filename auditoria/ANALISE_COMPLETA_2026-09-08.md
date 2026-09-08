# Análise do Gerador de Provas

Data: 08/09/2026. Base analisada: commit `517933c`, branch `main`, inicialmente sem alterações locais.

Atualização: este é o registro histórico da auditoria. As correções posteriores e pendências estão em [STATUS_CORRECOES.md](STATUS_CORRECOES.md). Para verificar o código atual, executar `npm test`; os experimentos originais documentam a versão anterior.

## Parecer

O programa tem uma base funcional ampla: criação de provas, 30 tipos de questão, banco reutilizável, revisão pedagógica, gestão escolar e fila de impressão. Entretanto, ainda não considero adequado ampliar seu uso com dados reais de várias escolas. Existem falhas de segurança, risco de perda de conteúdo e diferenças entre o editor e a impressão que precisam ser resolvidas primeiro.

A prioridade é tornar confiáveis os acessos, o salvamento e o documento entregue ao aluno. A apresentação visual pode evoluir sobre essa base, sem uma reescrita completa do produto.

| Área | Avaliação |
| --- | --- |
| Segurança e identidade | Há problemas que devem bloquear a expansão do uso. |
| Salvamento e recuperação | O fluxo normal existe, mas falhas de rede e concorrência não estão bem protegidas. |
| Fluxos pedagógicos | Boa cobertura; aprovação e histórico precisam de garantias adicionais no servidor. |
| Editor e banco de questões | Recursos numerosos, com erros reproduzidos de busca e geração de exercícios. |
| Impressão/PDF | Há divergências confirmadas no HTML gerado; paginação visual ainda precisa de teste. |
| Usabilidade e design | Estrutura promissora, mas o caminho da primeira prova e a clareza das ações precisam de ajustes. |
| Acessibilidade | Implementação parcial; contraste insuficiente confirmado por cálculo. |
| Operação e manutenção | Testes úteis, porém insuficientes para garantir RLS, recuperação e impressão. |

## Como a análise foi feita e seus limites

- Leitura do código dos módulos, autenticação, configuração, schema, policies, triggers, RPCs, testes e documentação versionada relevante.
- Execução de `npm test`: todos os testes existentes passaram.
- Execução de 11 verificações locais adicionais, usando funções extraídas do próprio programa e dados fictícios. Código em [reproduzir-achados.cjs](reproduzir-achados.cjs).
- Consulta somente de leitura a `/auth/v1/settings` do Supabase configurado: HTTP 200, `disable_signup: false`, `mailer_autoconfirm: true`, `external.email: true`.
- Conferência da semântica de RLS, sessões e acessibilidade na documentação oficial citada junto aos achados.
- O servidor HTTP local foi iniciado. Nenhum navegador estava disponível nas ferramentas da sessão; as tentativas de abrir o navegador integrado e o Chrome falharam por indisponibilidade.

**Limites:** não houve login com os cinco perfis reais, execução do SQL em PostgreSQL, teste de exploração no backend, captura visual das telas ou conferência de páginas A4 renderizadas. A análise de aparência deriva de HTML/CSS; não representa aprovação visual. As policies efetivamente instaladas, grants, configurações de SMTP, backups e limites do projeto não foram inspecionados no painel administrativo.

As reproduções locais demonstram fluxo de dados e comportamento das funções. Elas não executam scripts maliciosos, não fazem requisições de escrita e não provam que o SQL local já está aplicado em produção. Nenhum arquivo do programa foi corrigido; os arquivos novos são apenas os artefatos desta auditoria.

Prioridades: **P0** = resolver antes de ampliar o uso; **P1** = próxima rodada de estabilização; **P2** = melhoria planejada. A prioridade não é uma pontuação CVSS.

## Segurança, identidade e permissões

### S01 — P0 — Retorno do login aceita protocolo executável

**Evidência:** `login.html:178`, `getSafeReturnTo()`, e `login.html:225`, `goAfterAuth()`.

A validação recusa alguns endereços externos e caminhos relativos, mas aceita `javascript:`. O resultado é atribuído a `window.location.href` após autenticar. A reprodução local mostrou que `javascript:void(0)` é devolvido intacto. Isso constitui um caminho de XSS pelo redirecionamento, cuja execução final no navegador não foi ensaiada nesta sessão.

**Impacto:** um link de login preparado pode executar conteúdo no contexto do site, onde estão os tokens de sessão.

**Correção:** resolver o destino com `URL`, exigir mesma origem, restringir protocolo e permitir apenas páginas conhecidas da aplicação. Incluir casos com espaços, caracteres de controle, esquemas e caminhos codificados nos testes.

### S02 — P0 — Observação de revisão chega sem escape a um ponto de inserção de HTML

**Evidência:** `editor.html:6923`, `applyReviewLock()`, e `editor.html:7113`, dentro de `loadFromCloud()`.

A observação é inicialmente escrita com `textContent`, mas, quando há histórico, o texto é recuperado e interpolado em `innerHTML`. A proteção inicial é perdida. Uma marcação HTML inerte inserida como observação apareceu intacta no conteúdo destinado a esse ponto.

**Impacto:** conteúdo persistido pode ser interpretado como HTML ao abrir a prova; combinado com os tokens em `localStorage`, o risco de execução de código é relevante. O vetor exige controle da observação e presença de histórico.

Também existem interpolações não escapadas de campos do JSON, como `q.lines` em `editor.html:4712`. A interface tratar um campo como numérico não garante que o JSON recebido pela API tenha esse tipo.

**Correção:** usar `textContent` para a mensagem completa, validar o schema de cada questão e atribuir valores de inputs pela propriedade `.value`. Revisar os pontos de `innerHTML`, inclusive os usados para questões compartilhadas.

### S03 — P0 — Cadastro sem confirmação de e-mail fragiliza o aceite de convites

**Evidência real:** o endpoint público de configurações respondeu com cadastro aberto e `mailer_autoconfirm: true`.

**Evidência de código:** `setup_supabase.sql:620` permite ao destinatário consultar convites pelo e-mail do JWT; `setup_supabase.sql:690` aceita o convite comparando esse mesmo e-mail. A linha do convite contém seu token.

Se o SQL local estiver aplicado, uma pessoa pode cadastrar um endereço ainda não registrado sem provar que controla a caixa postal. A confiança do convite no e-mail do JWT deixa de representar a identidade do destinatário. Como a policy também permite consultar o convite pelo endereço, o segredo do link não deve ser considerado uma segunda barreira nessa combinação.

**Correção:** exigir verificação efetiva do e-mail, revisar contas criadas sob a configuração anterior e restringir a exposição de tokens de convite. Ajustar a mensagem de cadastro para orientar a confirmação. A documentação do [Supabase sobre confirmação de e-mail](https://supabase.com/docs/guides/auth/general-configuration) explica que, desativada, a opção confirma implicitamente o endereço.

**Limite:** não foi criada conta nem aceito convite para explorar esse risco.

### S04 — P0 — Redefinição administrativa usa senha única e troca obrigatória contornável

**Evidência:** `setup_supabase.sql:142` redefine diretamente `auth.users.encrypted_password` para `123456`; `schools.html:1130` comunica essa senha na interface.

O indicador `force_password_change` não restringe as policies de acesso. O próprio usuário pode editar esse campo em `profiles`; o trigger de proteção preserva apenas role, escola, turmas e disciplinas. Há, portanto, uma senha previsível e uma exigência de troca que não constitui uma barreira de autorização no servidor.

**Correção:** substituir o mecanismo por recuperação individual com expiração e uso único, via fluxo oficial de Auth. Se mantida alguma restrição de sessão, implementá-la no backend. Não tratar metadados editáveis pelo usuário como decisão de segurança.

### S05 — P0 — A policy de gestão de perfis não valida explicitamente o novo papel

**Evidência:** `setup_supabase.sql:117`, `:178` e `:184`.

`can_manage_profile(id)` verifica o perfil consultando a tabela, e é uma função `STABLE`. O mesmo helper aparece em `USING` e `WITH CHECK`, sem validar diretamente o novo `role` e o novo `school_id`. O trigger de proteção só atua quando o usuário altera o próprio perfil.

**Inferência técnica de alta confiança:** um coordenador ou dono que possa editar um professor tem um caminho para enviar campos de privilégio que a interface oculta, inclusive promover outro perfil além do permitido. A função `STABLE` enxerga o snapshot do início da instrução, portanto não resolve a validação da nova linha. Veja a documentação de [visibilidade de alterações em funções STABLE](https://www.postgresql.org/docs/current/xfunc-volatility.html).

**Correção:** validar explicitamente a transição de papel/escola e restringir as colunas alteráveis, preferencialmente por operações específicas. Testar coordenador→professor, dono→coordenador e tentativas de promover para master em um banco de teste.

**Limite:** o ataque não foi executado no PostgreSQL real. É um achado do SQL fornecido.

### S06 — P0 — Criação de prova permite declarar aprovação e impressão

**Evidência:** `setup_supabase.sql:429`: a policy de INSERT exige apenas `auth.uid() = user_id`.

O trigger exige questões e consistência de pontos, e a fila exige status aprovado, mas nenhum desses controles exige um papel de coordenação para criar uma prova já com `review_status = 'aprovada'`, histórico ou campos de impressão preenchidos. Um pedido direto pode contornar a sequência pedagógica prevista.

**Correção:** impor estado inicial de rascunho e valores controlados pelo servidor; autorizar transições por papel em RPCs ou triggers. Gerar identidade do revisor e datas no servidor.

**Precisão:** não concluo que um professor consegue aprovar por PATCH simplesmente porque falta `WITH CHECK`. Quando ele é omitido, o PostgreSQL reutiliza `USING` na nova linha. O problema demonstrado aqui é a policy de INSERT e a ausência de validação do estado inicial. Referência: [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html).

### S07 — P0 — Promoção do master depende de e-mail editável do perfil

**Evidência:** `setup_supabase.sql:744` promove para master pelo valor de `profiles.email`; a edição do próprio perfil em `:174` não protege esse campo.

Um usuário pode alterar o e-mail de seu perfil sem alterar o e-mail autenticado. Se o instalador for executado posteriormente, uma linha com o endereço usado no bootstrap poderá ser promovida indevidamente. É um risco condicionado à reaplicação do SQL, não uma promoção instantânea durante o uso normal.

**Correção:** retirar o bootstrap das migrações recorrentes; usar UUID administrativo conferido em `auth.users`; proteger e sincronizar o e-mail do perfil. Não transformar uma informação de exibição em autoridade administrativa.

### S08 — P1 — Escola da prova é inferida a partir do vínculo atual do professor

**Evidência:** `exams` não tem `school_id`; `can_review_exam()` e `can_print_exam()` usam o perfil atual do proprietário (`setup_supabase.sql:323` e `:380`).

Ao transferir um professor entre escolas, o acesso às provas antigas pode acompanhar o novo vínculo, enquanto o nome da escola impresso continua sendo o anterior. Isso afeta confidencialidade, histórico institucional e acesso da escola de origem.

**Correção:** registrar a escola proprietária na prova e definir separadamente o tratamento de transferência, cópia e acervo histórico. Testar uma transferência sem deslocar provas antigas automaticamente.

### S09 — P1 — Histórico, autorizações e escopo ainda dependem de dados graváveis pelo cliente

**Evidência:** `review_history`, `reviewed_by`, datas e estados fazem parte da linha editável da prova. O histórico é um array montado no frontend (`coordenacao.html:695`), não uma trilha independente. `question_bank` permite UPDATE ao proprietário sem aplicar novamente a restrição de escola do INSERT (`setup_supabase.sql:488` e `:500`).

**Impacto:** o histórico não pode ser tratado como registro de auditoria inviolável. O proprietário de uma questão pode atribuir a ela outra escola conhecida por UUID por uma chamada direta; a interface só oferece a escola atual.

**Correção:** criar eventos de revisão controlados no servidor e validar escopo de escola também em UPDATE. Tipar/validar roles, status, quantidade de cópias, tipos de questões e limites de payload. A edição de provas pela coordenação também precisa preservar o proprietário no backend, além de omitir `user_id` no frontend.

### S10 — P1 — Sessão expirada, logout e timeout incompletos

**Evidência:** `js/auth.js:18`, `:146`, `:158` e `:310`; `config.js` declara timeout, mas as requisições não o utilizam.

Uma sessão expirada continua sendo considerada autenticada localmente. Não há renovação com `refresh_token`, recuperação central de 401 nem sincronização de logout entre abas. Sair remove o estado local sem chamar a revogação de sessão remota. A reprodução confirmou um único pedido recusado, sem refresh ou logout remoto.

**Impacto:** o editor pode falhar depois de algum tempo aberto; outra aba mantém a sessão em memória; requisições demoradas deixam ações esperando sem limite definido pelo aplicativo.

**Correção:** implementar o ciclo completo da sessão, renovação coordenada, logout remoto, comunicação entre abas e cancelamento por timeout. Preservar o conteúdo pendente antes de redirecionar para login. O [Supabase documenta sessões com access/refresh tokens](https://supabase.com/docs/guides/auth/sessions) e esclarece que [logout revoga refresh tokens, mas não invalida imediatamente todo access token já emitido](https://supabase.com/docs/guides/auth/signout).

### S11 — P2 — Endurecimento complementar ainda pendente

As páginas carregam KaTeX de CDN com versão fixa, mas sem `integrity`; não há CSP definida nos HTMLs. Funções `SECURITY DEFINER` auxiliares não fixam uniformemente `search_path`, e o SQL não explicita grants/revokes de execução.

Isso não prova comprometimento do CDN ou exploração de search path: várias funções qualificam suas tabelas com `public`, o que já reduz risco. Ainda assim, convém controlar dependências, usar uma política de conteúdo compatível com a aplicação e restringir RPCs aos papéis necessários.

A `anon key` publicada em `config.js` é esperada nesse tipo de arquitetura; não é, por si só, um segredo vazado. A segurança depende das policies e dos privilégios efetivos.

## Funcionamento, salvamento e conteúdo pedagógico

### F01 — P0 — Erro ao carregar pode levar à sobrescrita da prova

**Evidência:** `editor.html:7071`, `loadFromCloud()`, e `:6869`, `initCloud()`.

Quando o GET falha, o catch mostra uma mensagem, mas conserva `currentExamId`. Depois, `initCloud()` habilita o autosave apenas porque existe um ID. O conteúdo inicial do editor passa a poder ser enviado para aquela prova.

**Reprodução local:** GET com falha simulada → ID preservado → autosave habilitado → PATCH contendo título inicial e questões vazias. É risco de perda de conteúdo, não apenas mensagem inadequada.

**Correção:** um carregamento deve retornar sucesso explícito. Enquanto não houver uma versão válida carregada, bloquear mutações e oferecer tentar novamente. Nunca converter um erro de rede em uma nova prova silenciosamente.

### F02 — P0 — Editor confirma salvamento sem confirmar que alguma linha foi atualizada

**Evidência:** `editor.html:7204`, PATCH por ID sem retorno de representação; sucesso anunciado em `:7250`.

Uma resposta vazia é tratada como prova salva. Se a linha tiver sido excluída ou ficar invisível/indisponível para UPDATE, a requisição pode não alterar nenhuma linha. A reprodução com resposta vazia retornou sucesso e atualizou “Último salvamento”.

**Correção:** pedir a representação da linha ou resultado equivalente verificável e exigir um registro atualizado. Distinguir sucesso, conflito, perda de acesso e erro de comunicação.

### F03 — P1 — Autosave não protege contra edições concorrentes

**Evidência:** o editor grava por ID, sem versão ou `updated_at` esperado. Dashboard e coordenação já utilizam esse filtro em algumas transições (`dashboard.html:1071`, `coordenacao.html:713`).

Duas abas, ou professor e coordenação, podem salvar cópias diferentes da prova. A última gravação pode substituir conteúdo mais recente. Além disso, enquanto a prova está enviada/em revisão, uma alteração temporária na soma de pontos bloqueia o salvamento, dificultando ajustes normais de pontuação.

**Correção:** controle de versão em todas as gravações e decisão clara sobre quem pode editar cada etapa. Separar rascunho em edição da versão submetida/aprovada; permitir salvar alterações incompletas como rascunho e validar a versão no envio.

### F04 — P1 — Recuperação de alterações pendentes é insuficiente

**Evidência:** `editor.html:2456` removeu rascunho local; o autosave aguarda 1.200 ms (`:7122`); apenas links específicos passam por flush (`:6450`).

Fechar a aba, recarregar ou usar a navegação do navegador pode perder alterações ainda não enviadas. Não há proteção de saída com estado pendente, recuperação durável ou fluxo de reenvio após a rede voltar. O tratamento de limite de tamanho e divergência de pontuação pode retornar antes de substituir o texto “Salvando alterações...”; o caso de tamanho foi reproduzido.

**Correção:** estados explícitos “alterações pendentes/salvando/salvo/erro”, cópia recuperável por usuário e prova, recuperação após conexão e aviso de saída quando necessário. Um aviso sozinho não substitui a recuperação dos dados.

### F05 — P0 — “Criar Prova Agora” leva a editor sem autosave

**Evidência:** `index.html:72` direciona para `editor.html?new=1` depois do login. Nessa rota, `currentExamId` fica nulo, e o editor habilita autosave somente quando há ID (`editor.html:6505`, `:6905`). As chamadas visíveis de `saveToCloud()` são de autosave/flush, que exigem prova já criada.

O caminho correto atual cria primeiro a linha no dashboard. O principal botão da página inicial desvia desse fluxo e permite começar a editar sem salvar automaticamente. A própria mensagem do editor orienta a abrir uma prova criada no dashboard, depois de o usuário já ter chegado à tela errada.

**Correção:** unificar toda entrada de “Nova prova” no mesmo fluxo de criação, incluindo sidebar, página inicial, login e links diretos. O professor deve terminar a primeira questão já com um rascunho recuperável.

### F06 — P1 — Busca no banco só procura entre 30 questões recentes

**Evidência:** `editor.html:6690` faz `limit=30` antes de aplicar busca textual, habilidade e escopo localmente.

**Reprodução:** banco fictício com 31 registros; o termo está apenas no 31º. A busca retorna zero. “Minhas questões” também pode parecer vazio se os primeiros 30 resultados pertencerem a outros autores e forem visíveis por compartilhamento.

**Correção:** executar os filtros antes da paginação, no servidor, e oferecer próxima página/carregar mais. Testar busca por questão antiga e por escopo com volume misto.

### F07 — P1 — PDF limpo e editor não produzem a mesma prova

**Evidência:** o editor respeita `hideNumber` (`editor.html:5938`) e oculta o selo BNCC na impressão. `print.html:1281` numera incondicionalmente por índice e imprime o selo; seu gabarito também usa o índice (`:1209`).

**Reprodução:** uma questão com `hideNumber: true` gera “Questão 1” no PDF limpo. Isso afeta textos-base sem numeração e desloca a numeração seguinte em relação ao editor.

Há ainda verificações de `showAnswerSpace` presentes em ramos do editor e ausentes em ramos equivalentes do print. As duas implementações precisam de uma matriz de comparação por tipo.

**Correção:** compartilhar o renderizador e a regra de numeração/gabarito. Usar uma mesma prova de referência para comparar editor, impressão direta e `print.html`.

### F08 — P1 — Caça-palavras pode pedir uma palavra que não cabe na grade

**Evidência:** `buildWordSearch()`, `editor.html:1852` e `print.html:541`.

O algoritmo corta a palavra ao tamanho da grade, mas a lista e o registro de posicionamento usam a palavra completa. “RESPONSABILIDADE”, com 16 letras, foi declarada posicionada em uma grade 12×12, onde essa palavra completa não cabe nas direções usadas. Tentativas de posicionamento também podem falhar sem aviso ao professor.

**Correção:** validar tamanho e confirmar que todas as palavras foram posicionadas; aumentar a grade ou mostrar quais palavras precisam de ajuste. Conferir o gabarito contra a grade efetivamente gerada.

### F09 — P1 — A instalação assistida gera configuração incompatível

**Evidência:** `setup.html:378` gera `const CONFIG` sem `window.CONFIG`, exigido por `initAuthManager()`. A geração foi avaliada localmente e `window.CONFIG` ficou indefinido. `setup.html:361` também trata HTTP 401 como aceitável no teste de credenciais.

**Correção:** produzir o mesmo contrato de configuração usado pelo aplicativo, rejeitar autenticação inválida e incluir `setup.html` nos testes. Atualmente ele não está na lista `htmlFiles` de `tests/run-tests.js:7`.

### F10 — P1 — Edição de questão do banco cria outra cópia

**Evidência:** `editor.html:6733`, `editBankQuestion()`, insere a questão no estado da prova, sem preservar uma associação para atualização do registro original; `saveQuestionToBank()` cria novo registro.

O botão sugere edição do item existente, mas o caminho orienta a salvar novamente e pode acumular duplicatas. Além disso, abrir uma questão “para editar no banco” altera a prova que estiver aberta.

**Correção:** separar “Inserir na prova”, “Editar original” e “Criar cópia”. Manter o ID do item no fluxo de edição e confirmar qual objeto foi salvo.

## Usabilidade, aparência e design inteligente

### U01 — P1 — Ações essenciais de saída estão escondidas e duplicadas

**Evidência:** `editor.html:1543` concentra “PDF limpo”, “Exportar PDF”, “Com gabarito” e “Imprimir” dentro da engrenagem. “Exportar PDF” e “Imprimir” usam a mesma chamada de impressão do navegador.

Isso aumenta a necessidade de exploração e passa a impressão de que existem mecanismos distintos de exportação. O professor precisa reconhecer facilmente o que está salvo, o que será impresso e qual o próximo passo.

**Proposta:** uma barra com “Adicionar questão”, estado de salvamento, “Visualizar/Imprimir” e ação de revisão adequada ao status. No diálogo de impressão, escolher “Prova” ou “Prova + gabarito” e informar que o PDF é salvo pelo diálogo do navegador.

### U02 — P1 — Remoção de questão não oferece desfazer

**Evidência:** `editor.html:3021` remove imediatamente com `splice()` e renderiza; a renderização agenda autosave. Não foi encontrada pilha de undo para alterações estruturais.

Um clique incorreto pode excluir enunciado, imagem e gabarito, propagando a exclusão para a nuvem. Uma confirmação em todo clique seria cansativa.

**Proposta:** desfazer/refazer para questões, imagens e reordenação; aviso temporário “Questão removida — Desfazer”; histórico de versões para recuperação posterior.

### U03 — P1 — Contraste e semântica de acessibilidade incompletos

**Evidência calculada:** `#lastSaved` usa texto `#4ade80`, 12 px, sobre `#f0fdf4`: contraste aproximado **1,66:1**. A referência para texto normal é **4,5:1**, conforme [WCAG 2.2, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Diversos labels do editor não estão associados por `for`/`id`; modais como nova prova e banco não têm o conjunto completo de semântica e gerenciamento de foco. O modal de devolução já tem `role="dialog"`, `aria-modal` e foco inicial: é uma base para uniformização. Não há tratamento equivalente de Escape/foco em todos os diálogos.

**Proposta:** corrigir contraste, associar labels, tornar estados de salvamento anunciáveis e garantir abertura/fechamento, foco contido e retorno de foco nos modais. Validar teclado, leitor de tela e zoom de 200% em navegador real.

### U04 — P2 — Identidade visual e vocabulário precisam de consistência

A entrada/login usam gradientes roxos; a área de trabalho usa tons neutros e azuis; o editor dá grande destaque verde à conexão. Há mistura de textos com e sem acentos e o rótulo técnico “Master” aparece na navegação.

O problema não é escolher uma cor específica: é comunicar a mesma estrutura, hierarquia e significado em todos os módulos. Recomendo tokens compartilhados de cor, espaçamento, tipografia, foco e botões; verde reservado a sucesso, azul à ação principal e vermelho a erro/destruição. “Administração geral” é mais claro que “Master” na interface.

Essa é uma avaliação da implementação visual declarada. Alinhamento real, densidade, cortes e percepção estética precisam de captura renderizada.

### U05 — P2 — Muitos recursos, pouca orientação pela intenção pedagógica

O sistema oferece 30 tipos de questão e boa flexibilidade, mas a seleção poderia começar pela intenção: resposta objetiva, resposta escrita, interpretação, matemática ou atividade lúdica. A implementação atual cria menus a partir das opções e não oferece um fluxo amplo de modelos de prova ou descoberta por objetivo.

**Proposta:** mostrar inicialmente os tipos mais usados, busca por nome, exemplos curtos e opções avançadas sob demanda. Modelos como bimestral, recuperação e atividade devem preencher estrutura e instruções, sem inventar questões silenciosamente.

“Design inteligente” aqui significa prevenir erros: destacar questões sem enunciado, alternativas vazias, gabarito incompleto, nota divergente e imagens ausentes antes de enviar ou imprimir. O sistema já verifica soma e quantidade de questões em parte do fluxo; deve expandir essa orientação sem bloquear a escrita de rascunhos incompletos.

### U06 — P2 — Mensagens de prontidão não representam validação real

**Evidência:** `index.html:92` mostra “Plataforma pronta” apenas por existir uma URL configurada. O editor contém “Pronto para impressão” fixo (`editor.html:1683`). A página inicial anuncia seis tipos de questão, enquanto os testes enumeram 30.

**Proposta:** separar “configuração encontrada”, “conexão disponível”, “alterações salvas” e “prova validada”. Mostrar apenas estados efetivamente verificados. Atualizar a apresentação pública para as capacidades atuais.

### U07 — P2 — Responsividade está prevista, mas precisa de validação prática

Há media queries para 720/430 px e conversão de grids para uma coluna. Isso é positivo. No celular, a sidebar vira navegação em uma coluna e a barra do editor deixa de ser fixa (`editor.html:1226`), podendo aumentar o deslocamento necessário para chegar ao trabalho e às ações.

**Proposta:** validar 360, 390, 768 e 1366 px, orientação horizontal e zoom; reduzir navegação repetida no celular e facilitar alternância “Editar/Visualizar”. Não afirmo que haja corte ou sobreposição específica sem renderização.

## Operação, desempenho e manutenção

### O01 — P1 — Listagens pesadas e sem paginação completa

**Evidência:** dashboard e coordenação fazem `select=*` em provas (`dashboard.html:667`, `coordenacao.html:329`), incluindo JSON de questões e imagens. Master e gestão carregam listas completas de escolas/convites. A fila de impressão já seleciona colunas específicas, um padrão positivo.

**Impacto:** mais transferência e memória, filtros client-side incompletos se a API limitar resultados e contadores que podem deixar de representar o total. A documentação descreve um [limite padrão de 1.000 linhas por resposta](https://supabase.com/docs/reference/javascript/v1/select); o valor efetivo deste projeto não foi consultado.

**Correção:** paginação, filtros no servidor, colunas resumidas e busca do conteúdo completo só ao abrir/duplicar/imprimir. Medir a necessidade de índices por escola, autor, status e datas com consultas reais. O SQL não declara índices adicionais para essas listagens.

### O02 — P1 — Backup documentado não demonstra recuperação de dados

**Evidência:** `SEGURANCA_BACKUP_ESCALA.md` orienta guardar SQL, exportar schema e recuperar a estrutura pelo Git. Não define rotina completa de backup de dados das provas, retenção, local externo, responsável ou teste periódico de restauração.

Reaplicar `setup_supabase.sql` recupera estrutura, não o conteúdo perdido de uma prova. O estado dos backups reais do Supabase não foi verificado.

**Correção:** definir backup de schema e dados, prazo máximo de perda aceitável, prazo de recuperação e ensaio de restauração isolado. Incluir imagens se migrarem para Storage. O keepalive diário não substitui backup ou monitoramento de falhas.

### O03 — P1 — Testes aprovados não validam as fronteiras mais importantes

Os testes verificam sintaxe, links, IDs, contratos textuais e alguns comportamentos em VM. Isso captura regressões úteis. Entretanto, grande parte dos testes de SQL usa `includes()`, sem executar policies com usuários de papéis distintos.

Há inclusive teste que exige a senha fixa `123456` (`tests/run-tests.js:542`): o teste preserva o comportamento atual, mas esse comportamento é inseguro. `setup.html` fica fora da lista principal de páginas.

**Correção:** manter os testes rápidos, acrescentando testes reais de RLS e transições, isolamento entre escolas, concorrência de salvamento, primeira prova e comparação de impressão. Rodar essas verificações em CI. O workflow versionado encontrado é o keepalive, não uma pipeline de validação do produto.

### O04 — P2 — Duplicação de renderização aumenta o custo de manutenção

`editor.html` tem aproximadamente 342 KB e mais de 7.200 linhas, reunindo CSS, estado, persistência, autenticação, renderização, imagens e lógica dos exercícios. `print.html` repete parte significativa das regras.

Isso já se manifesta nos desvios de numeração e resposta. Não há necessidade demonstrada de migrar imediatamente para um framework.

**Correção:** separar gradualmente renderização compartilhada, schema/normalização de questões, salvamento, validação e estilos. Adicionar versão ao formato das questões e migração explícita de formatos antigos.

### O05 — P1 — SQL de instalação mistura schema, alterações de dados e bootstrap

O arquivo cria tabelas/policies, remove coluna, redefine estados de provas (`setup_supabase.sql:312`, `:347`) e promove um master. Reaplicar esse conjunto como operação genérica dificulta distinguir instalação, migração e manutenção de dados.

**Correção:** migrações numeradas, versão aplicada registrada, instruções de backup e scripts de dados separados. Conferir policies antigas remanescentes no banco: remover apenas alguns nomes conhecidos não garante ausência de permissões legadas.

Também existem divergências na documentação: `CLAUDE.md` ainda descreve rascunho local por usuário, mas o editor e os testes mais recentes o removeram; `GUIA_SETUP.md` é referenciado e ignorado no `.gitignore`, prejudicando a reprodutibilidade de uma instalação a partir do repositório.

### O06 — P2 — Limites e regras de compartilhamento precisam ficar explícitos

Imagens são comprimidas e o frontend impõe limites, o que já ajuda. Porém a política de tamanho precisa existir no servidor para requisições diretas. O modelo em base64 amplia leitura, salvamento e backup das provas; Storage deve ser avaliado quando medições justificarem a mudança.

Questões públicas são legíveis pela policy `is_public = TRUE`, inclusive para acesso anônimo se os grants permitirem. O operador tem leitura de provas já impressas na RLS, embora `print.html` bloqueie a reabertura pela interface. São decisões que precisam ser assumidas conscientemente: bloqueio visual não é revogação de leitura, e nenhum sistema consegue recolher um PDF já baixado.

Definir claramente público/privado/escola, acesso ao gabarito pelo operador, retenção e exportação de acervos. Não foi realizada avaliação jurídica ou certificação de conformidade.

## Pontos que vale preservar

- RLS habilitada nas tabelas principais e helpers para evitar recursão nas policies.
- Perfil criado por trigger sem copiar diretamente um role informado no cadastro.
- Escapamento de texto em muitos pontos e restrição de imagens a formatos raster em data URL.
- Compressão de imagens e limite de peso antes do salvamento.
- Separação entre professor, coordenação, gestão e impressão na navegação.
- Feedback de devolução e histórico visíveis no dashboard/coordenação.
- Controle de concorrência já presente em algumas ações de revisão.
- Convites com estados de aceito, expirado e cancelado; RPC verifica cancelamento e e-mail.
- RPC para concluir trabalho de impressão e regra de que fila exige aprovação.
- Arquitetura estática simples de hospedar e testes rápidos sem dependências de aplicação.

## Ordem recomendada de correção

| Ordem | Pacote | Resultado verificável |
| --- | --- | --- |
| 1 | Segurança: S01–S07 | Login aceita só destinos internos válidos; texto nunca executa HTML; convite exige identidade verificada; nenhuma senha compartilhada; papéis e aprovação não podem ser forjados pela API. |
| 2 | Salvamento e primeira prova: F01–F05, S10 | Falha de carga não permite gravar; confirmação exige linha salva; conflito não sobrescreve; trabalho pendente é recuperável; toda entrada de nova prova converge. |
| 3 | Documento e banco: F06–F10 | Busca encontra itens antigos; PDF coincide com editor e gabarito; atividades são solucionáveis; editar item não cria duplicatas inesperadas. |
| 4 | Isolamento e operação: S08–S09, O01–O05 | Transferência de professor preserva acervo; histórico confiável; paginação correta; restauração de dados comprovada; migrações rastreáveis. |
| 5 | Experiência: U01–U07 | Ações claras, desfazer, contraste adequado, teclado funcional, primeira prova guiada e telas validadas em desktop/celular. |

Não recomendo começar por uma grande reforma visual. Melhorias de aparência são úteis, mas os problemas de identidade, salvamento e fidelidade da impressão têm impacto mais imediato no uso escolar.

## Critérios para encerrar a validação

1. Em ambiente de teste, usar dois conjuntos de escolas e os cinco papéis; testar leitura/escrita pela API, incluindo tentativas de privilégio indevido.
2. Criar prova pela página inicial, pelo dashboard e por link direto; sair e retornar sem perder conteúdo.
3. Simular GET com falha, token vencido, internet interrompida, resposta sem linha, aba fechada e duas abas concorrentes.
4. Comparar editor, impressão direta e PDF limpo com todos os tipos; incluir texto-base sem número, imagens, gabarito, questão longa e pontuação decimal.
5. Revisar a mesma prova entre professor, coordenador e operador: devolver, corrigir, reenviar, aprovar, imprimir e reabrir revisão.
6. Confirmar busca de questão antiga, compartilhamento por escola e transferência de professor sem mover acervo indevidamente.
7. Validar teclado, modais, contraste, zoom e tamanhos de tela em navegador real.
8. Restaurar um backup de dados em ambiente isolado e comparar as provas e imagens recuperadas.

Os 11 experimentos locais desta auditoria podem ser repetidos com `node auditoria/reproduzir-achados.cjs`. Eles registram o comportamento defeituoso atual; quando as correções forem feitas, alguns deixarão de reproduzir e deverão ser substituídos por testes que exijam o comportamento correto.
