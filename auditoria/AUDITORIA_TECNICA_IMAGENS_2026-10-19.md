# Auditoria técnica do uso de imagens — 19/10/2026

## Resumo executivo

O sistema possui uma arquitetura de imagens funcional e, em vários pontos, cuidadosa: reduz e recodifica arquivos no navegador, exclui SVG, persiste imagens de provas e do banco de questões em bucket privado, grava referências permanentes `storage://`, resolve URLs assinadas somente para exibição e protege o autosave com versão. A suíte oficial passou integralmente.

O conjunto, porém, ainda não deve ser considerado pronto para operação prolongada em escala sem tratamento dos achados prioritários:

1. **Alta — referências transferíveis ampliam e prolongam leitura.** Qualquer usuário que possa gravar uma prova ou questão pode registrar no próprio conteúdo um caminho de objeto de outro usuário. O trigger transforma a string em vínculo e a policy passa a autorizar a leitura. Isso é necessário para a reutilização atual, mas torna o caminho uma capacidade copiável e impede revogação simples quando a origem deixa de ser pública/compartilhada.
2. **Alta — objetos nunca são coletados.** Remover/trocar imagem, questão, prova ou registro do banco remove referências e vínculos, mas não o objeto. Falhas parciais de upload também deixam objetos órfãos. O efeito é crescimento contínuo de custo, inventário e retenção de conteúdo.
3. **Alta — instalação documentada e scripts de instalação divergem.** `README.md` manda executar `setup_supabase.sql`, que não cria o bucket nem incorpora as migrações 04–06. `setup.html` gera configuração sem as flags de Storage. Uma instalação nova por esses caminhos cai silenciosamente em Base64, não na arquitetura descrita.
4. **Média — limites incompatíveis.** O editor admite até 25 MiB para a árvore de imagens, mas o banco rejeita prova+logo acima de 8 MiB e questão de banco acima de 8 MiB. Quando Storage falha e ocorre fallback para Base64, uma prova aceita pelo cliente pode ser recusada pelo servidor.
5. **Média — impressão pode falhar por uma única imagem.** O fluxo final usa `Promise.all(img.decode())` sem captura individual; uma imagem quebrada ou URL expirada aborta `window.print()`.
6. **Média — transformação destrutiva não é comunicada.** Todo upload de questão passa por canvas: GIF perde animação; metadados são removidos; PNG transparente pode virar JPEG em navegadores sem WebP; não há política explícita de orientação/ICC. Rotação e recorte repetidos acumulam recompressão.
7. **Média — custo de CPU/memória continua alto no editor.** Fingerprint, rascunho, histórico, prévia e autosave serializam árvores inteiras. URLs repetidas podem ser assinadas em paralelo mais de uma vez e um editor aberto além de 24 horas pode continuar tentando renderizar a URL já expirada.

Conclusão: **o caminho feliz está bem coberto e os controles contra `javascript:`/SVG são bons; as maiores dívidas estão no ciclo de vida, no modelo de delegação de leitura e na coerência operacional da implantação.**

## Escopo, estado e método

- Branch examinada: `main`.
- Commit de base: `afe54a06306fcf82477b6953467c8cf2c4fc23fb`.
- Estado inicial: limpo em `git diff --name-only`, `git diff --cached --name-only` e `git ls-files --others --exclude-standard`.
- Único artefato criado: este relatório. Nenhum arquivo da aplicação, banco ou teste foi alterado.
- `CLAUDE.md` foi lido; não existe `AGENTS.md`.
- Foram inventariados 95 arquivos fora de `.git`, `node_modules` e `.cache`. Não há PNG/JPEG/GIF/WebP/SVG/ICO/AVIF físicos de aplicação.
- Todo código próprio executável foi lido integralmente, inclusive CSS/JS embutidos nos HTML, SQL, testes e scripts de reprodução. Arquivos históricos foram inventariados e pesquisados; os documentos diretamente ligados a imagens foram lidos integralmente.
- Os dois DOCX foram abertos como pacotes OOXML; manifestos e texto relacionado a imagens foram inspecionados. As miniaturas JPEG internas são metadados do Word, não ativos da aplicação.
- Não foram lidos internamente: `node_modules`, `.cache` e o corpo minificado de `js/vendor/paged-0.4.3.js`. São dependências/artefatos de terceiros ou gerados. Versão, licença e pontos de integração foram verificados.
- Esta é uma auditoria estática com testes locais. Não houve acesso ao Supabase real, inspeção de objetos existentes, métricas de produção, navegador real, dispositivos, impressão física ou validação visual. Logo, afirmações sobre comportamento de produção que dependem da implantação SQL são condicionais.

## I. Inventário completo do uso de imagens

### I.1 Origens e ativos

| origem | estado | formato/uso | observação |
|---|---|---|---|
| Arquivo escolhido ou arrastado no editor | ativo | PNG, JPEG, WebP, GIF declarados; `accept=image/*` em seletores individuais | MIME é validado e o navegador precisa decodificar a imagem antes do canvas. |
| Lote de arquivos | ativo | PNG/JPEG/WebP/GIF; até 20 | Apenas grade, sequência, legenda e relação imagem/palavra. |
| Logo da escola | ativo | PNG/JPEG/WebP/GIF, armazenada como Data URL em `schools.logo_data_url` | Não usa `ExamImageStorage`; `accept=image/*` é mais amplo que a validação. |
| Logo da prova | ativo | snapshot da logo escolar ou logo legada | No próximo salvamento da prova, a Data URL é elegível para upload ao Storage da prova. |
| JSON legado em Base64 | compatibilidade ativa | `data:image/(png|jpeg|jpg|webp|gif);base64,...` | Migra para Storage no próximo salvamento se Storage estiver operacional. |
| Referência permanente | ativo | `storage://exam-images/<user>/<scope>/<uuid>.<ext>` | Formato persistido preferencial para provas e banco de questões. |
| URL assinada | ativa, transitória | URL Supabase com validade de 86.400 s | Deve existir apenas no estado de exibição; `durableTree()` a converte de volta antes de persistir. |
| Máscara CSS embutida | ativo | `data:image/svg+xml` em `css/editor-tools.css:549` | Ícone fixo da interface; não entra em upload, JSON, prova nem Storage. |
| Arquivos físicos de imagem no repositório | inexistente | — | Nenhum ativo raster/vetor próprio foi encontrado. |
| Miniaturas dentro dos DOCX | fora do runtime | JPEG OOXML | Não são carregadas pela aplicação. |

SVG de usuário, BMP, TIFF, HEIC/HEIF e AVIF não são aceitos. Isso reduz superfície de script em SVG, mas a UI induz seleção mais ampla com `image/*`.

### I.2 Campos persistidos ou transportados

| estrutura | campos | estado | consumidores |
|---|---|---|---|
| Cabeçalho da prova | `logo_data_url` no banco / `logoDataUrl` no estado | ativo | dashboard, editor, preview, impressão |
| Escola | `schools.logo_data_url` | ativo e separado | escolas, criação de prova, cabeçalho |
| Imagem principal | `imageDataUrl`, `imageFileName`, `imageSize`, `imageAlign`, `imageCaption` | ativo | imagem, interpretação e identificação |
| Comparação | `image1DataUrl`, `image1FileName`, `image1Size`, `image1Caption` e equivalentes `image2*` | ativo | editor, preview, impressão, gabarito |
| Imagens extras | `extraImages[].{dataUrl,fileName,size,align,caption}` | ativo/compatível | questão do tipo imagem |
| Imagens de alternativas | `optionImages[].{dataUrl,fileName,imageSize}` | ativo | alternativas, marcar X, texto-base e imagem com resposta objetiva |
| Itens/pares/colunas | `items[]`, `pairs[]`, `leftItems[]`, `rightItems[]` com `imageDataUrl`, `imageFileName`, `imageSize` conforme o tipo | ativo | V/F, grade, sequência, legenda, relação e associação |
| Imagem junto ao enunciado | `headerImage` nos modos `one` e `grade` | ativo | tipos que não são intrinsecamente visuais |
| Imagens livres | `freeImages[].{dataUrl,fileName,width,height,align,offsetY}` e fallbacks `x/y` | legado renderizado | sem caminho atual de inclusão; pode ajustar/remover o que já existe |
| Marcadores | `markers[].{x,y,label,answer}` associados à imagem principal | ativo | posicionamento percentual, preview, impressão e gabarito |
| Metadados transitórios | `logoFileName`, seleção de arquivo, `pendingLogos`, URLs assinadas e caches `Map` | não persistir como fonte durável | UX e sessão corrente |

Os normalizadores mantêm campos adicionais seguros por compatibilidade, limitam profundidade/coleções e removem chaves de prototype pollution. Consequentemente, strings de imagem também podem aparecer em campos não previstos e ainda serão encontradas pelo caminhamento genérico do Storage.

### I.3 Componentes que criam, transformam, persistem ou exibem

- `editor.html:2497-2974`: validação, tamanho, `FileReader`, decode, canvas, compressão, rotação, recorte, drag-and-drop e seletor.
- `editor.html:2592-2620,5591-5608`: importação em lote.
- `editor.html:5750-6245`: imagens livres e renderização da prévia.
- `editor.html:6668-6728,7305-7512`: fingerprint, rascunho, resolução, autosave e persistência.
- `js/editor-tools.js:10-157,500-687,688-941`: histórico, banco, imagens por opção, preview e mensagens.
- `js/image-storage.js:1-217`: Data URL ↔ Blob ↔ Storage/ref ↔ URL assinada.
- `dashboard.html:949-980,1011-1073`: snapshot da logo, carga tardia e duplicação.
- `schools.html:403-464,638-777,990-1020`: compressão e persistência direta de logos.
- `print.html:492-569,778-1211,1384-1591`: validação, renderização duplicada, ajuste e impressão final.
- `js/exam-pagination.js:70-121`: espera de imagens/fontes e paginação Paged.js.
- `setup_storage.sql:6-163` e migrações 04/05: bucket, vínculos e policies.
- `css/editor-tools.css:549`: único ativo visual embutido em CSS.

## II. Fluxos ponta a ponta

### II.1 Imagem individual de questão

1. O seletor/drag-and-drop entrega um `File` a `readImageFile()`.
2. O código exige MIME declarado PNG/JPEG/WebP/GIF e no máximo 5 MiB (`editor.html:2502,2520-2522,2622-2631`).
3. `FileReader.readAsDataURL()` lê o arquivo; `Image` confirma que é decodificável.
4. Canvas reduz o maior lado a 1.400 px e tenta WebP em qualidade 0,82; se necessário, 0,72/0,62/0,52. Se WebP não for produzido, cai para JPEG. A saída deve ficar até 850 KiB (`editor.html:2632-2666`).
5. A Data URL entra imediatamente no estado e na prévia. Rotação e recorte geram nova rasterização WebP/JPEG.
6. Cada mudança agenda autosave em 1.200 ms. Antes do envio, o editor calcula fingerprint durável, preserva rascunho local e bloqueia árvore estimada acima de 25 MiB (`editor.html:6668-6728,7364-7454`).
7. `persistTree()` encontra Data URLs únicas em toda a árvore, envia em lotes sequenciais de até três e substitui por `storage://...` (`js/image-storage.js:162-194`).
8. A prova é atualizada por PATCH com condição de versão `updated_at`. O rascunho só é descartado depois de exatamente uma linha confirmada.
9. Ao reabrir, `resolveTree()` assina as referências e o estado passa a usar URLs temporárias para renderização (`editor.html:7329-7339`).

### II.2 Lote

O lote aceita até 20 arquivos, converte todos sequencialmente antes de alterar a questão e compara usuário, existência da questão, itens e ordem ao terminar. Erro em qualquer conversão não aplica o lote. O upload físico só ocorre no autosave posterior. Isso dá atomicidade lógica ao formulário, não atomicidade ao Storage (`editor.html:2592-2620`).

### II.3 Logo escolar e logo da prova

`schools.html` reduz a logo para lado máximo de 420 px e até 220 KiB, em WebP/JPEG, e salva a Data URL diretamente na coluna da escola (`schools.html:403-464,777,1010`). Uma nova prova copia essa string para `exams.logo_data_url` (`dashboard.html:949-980`). Ao salvar a prova no editor, a cópia entra no fluxo genérico e normalmente vira um objeto exclusivo do escopo daquela prova. Alterar a logo da escola não altera provas existentes.

Esse desenho produz snapshot histórico útil, mas duplica fisicamente a mesma logo entre novas provas porque o cache de deduplicação inclui o escopo. A escola mantém Base64 na tabela mesmo quando as provas usam Storage.

### II.4 Banco de questões

Salvar uma questão cria antecipadamente UUID e escopo `bank-<uuid>`, chama `persistTree()` e só depois insere o registro (`editor.html:6787-6826`). Editar/usar questão resolve as referências sob o escopo do registro. Se uma referência já existente for incorporada a outra prova/questão, o objeto é compartilhado, não copiado.

### II.5 Duplicação, remoção e desfazer

- Duplicar prova chama `durableTree()` e reutiliza os mesmos caminhos físicos.
- Duplicar questão e histórico clonam a estrutura; Data URLs iguais são deduplicadas apenas dentro da chamada de persistência/sessão e referências existentes continuam compartilhadas.
- Remover imagem desfaz apenas o campo; remover prova/questão remove a linha e os vínculos por trigger.
- Não existe chamada de exclusão ao endpoint de objetos na aplicação.
- Desfazer pode recuperar a referência lógica, desde que o objeto ainda exista; como objetos nunca são apagados, hoje não há corrida com GC.

### II.6 Preview e impressão

O editor envia HTML integral ou patch de questão a um iframe `print.html?preview=1`; origem, janela e revisão são checadas. A paginação espera `img.decode()` com falha individual tolerada e fontes antes de Paged.js. A impressão definitiva não confia no preview: busca novamente prova/perfil, revalida autorização/estado, resolve referências, renderiza e só então imprime (`print.html:536-569,1491-1591`).

Há duas implementações substanciais de renderização — editor e `print.html` — com CSS e branches próprios. Essa duplicação é a principal fonte de divergência futura.

## III. Persistência, sincronização, concorrência e consistência

### III.1 Modelo durável

O objeto segue `<userId>/<scope>/<UUID.ext>` e é enviado com `x-upsert:false` (`js/image-storage.js:89-110`). A referência salva não expira. A URL assinada vale 24 h e o cache local é marcado para 23 h (`js/image-storage.js:113-138`). `durableTree()` reconhece URLs assinadas do mesmo projeto/bucket e recupera a referência; uma URL assinada própria irrecuperável bloqueia persistência (`js/image-storage.js:26-53,158-170`).

### III.2 Falhas e retentativas

- Se qualquer upload falhar, `persistTree()` devolve a árvore durável anterior inteira e aciona fallback; imagens já enviadas no mesmo lote não são removidas (`js/image-storage.js:181-194`).
- O PATCH pode então tentar persistir Base64. Em payload grande, o banco rejeita e o rascunho local permanece.
- Não há retentativa com backoff no Storage. Um autosave posterior tentará novamente; o cache em memória evita reenviar apenas uploads que já concluíram na mesma sessão.
- Não há fila persistente de uploads, idempotency key durável nem reconciliação de órfãos após reload.
- Assinatura falha de modo “fail closed”: a carga da prova/impressão é interrompida, em vez de exibir silenciosamente conteúdo incompleto.

### III.3 Concorrência

- Autosave serializa gravações e enfileira uma nova tentativa se houver edição durante o envio.
- PATCH condicionado a `updated_at` evita sobrescrita silenciosa por outra aba.
- Troca de conta é detectada antes de salvar.
- Lote verifica mutação concorrente dos itens antes de aplicar.
- Uploads são feitos em grupos de três; não existe cancelamento com `AbortController`.
- `resolveTree()` percorre a árvore com `Promise.all` sem limite. Referências repetidas que ainda não entraram no cache podem disparar assinaturas concorrentes duplicadas, pois não há cache de promessa em voo.

### III.4 Consistência entre camadas

| camada | limite | consequência |
|---|---:|---|
| arquivo bruto no cliente | 5 MiB | coerente com limite do objeto no bucket |
| imagem convertida no editor | 850 KiB | reduz tráfego; não se aplica a legado já persistido |
| logo escolar convertida | 220 KiB | continua Base64 na tabela `schools` |
| árvore estimada no editor | 25 MiB | maior que a proteção SQL |
| prova + logo no SQL | 8 MiB | pode rejeitar fallback aceito pelo editor |
| questão do banco no SQL | 8 MiB | não há pré-checagem específica equivalente no cliente |
| lote visual | 20 arquivos | a estrutura normalizada permite até 500 itens |

O cliente mede `Blob(JSON.stringify(...)).size`; o SQL mede `octet_length()` de JSON/texto. São conceitos próximos, mas não idênticos na composição dos campos.

## IV. Segurança

### IV.1 Controles positivos

- Bucket privado; leitura somente autenticada e vinculada.
- INSERT/UPDATE/DELETE restritos à pasta cujo primeiro segmento é `auth.uid()`; migração 05 exige perfil ativo.
- SVG de usuário é excluído; renderização aceita apenas Data URL raster permitida ou URL assinada reconhecida do mesmo projeto/bucket.
- Valores entram no atributo por `esc()`; `javascript:`, URL externa e `data:image/svg+xml` não passam.
- O servidor limita tipo MIME e 5 MiB por objeto.
- Tokens de acesso são renovados pelo `AuthManager`; a aplicação usa REST direto, sem service-role no cliente.
- Triggers e tabela de vínculos ficam em schema `private`, sem acesso direto de `anon`/`authenticated`.

### IV.2 Achado alto — vínculo por referência transferível

`private.image_object_names()` aceita qualquer string `storage://exam-images/...` em todo JSON. `refresh_image_links()` cria o vínculo sem confirmar que o autor do conteúdo possui o objeto ou que a origem autorizada ainda existe (`setup_storage.sql:26-71`). `can_read_exam_image()` concede SELECT se o objeto estiver vinculado a uma prova/questão acessível (`setup_storage.sql:109-142`).

Cenário verificável por lógica SQL:

1. usuário A obtém legitimamente o caminho de uma imagem de questão pública/escolar, prova compartilhada ou URL assinada;
2. A grava essa referência em uma prova/questão própria;
3. o trigger cria novo vínculo;
4. A continua autorizado pelo próprio conteúdo mesmo se a origem deixar de ser pública, mudar de escola ou for excluída.

O teste atual confirma reutilização sem novo upload, mas não testa revogação ou tentativa de “reancorar” caminho de outro proprietário. Se o compartilhamento copiável for requisito, precisa ser explícito e auditável; caso contrário, deve haver cópia server-side para a pasta do novo proprietário ou validação de proveniência no trigger/RPC.

### IV.3 Riscos restantes

- URL assinada é um bearer link até expirar; pode vazar por captura de tela, histórico de rede, extensões ou logs do navegador. Não foi encontrado envio intencional para terceiros.
- O servidor confia no `Content-Type` do objeto; no fluxo normal o conteúdo é reconstruído por canvas ou decodificado, mas um cliente REST próprio pode tentar conteúdo incompatível com MIME permitido. Avaliar verificação de magic bytes fora do Storage nativo se isso for requisito.
- Os caminhos contêm UUID aleatório, reduzindo adivinhação, mas caminho não deve ser tratado como segredo suficiente diante do vínculo transferível.
- As imagens são conteúdo de prova. Sem GC e política de retenção, a exclusão lógica pelo professor não equivale a eliminação do arquivo.
- Não há antivírus/moderação. Para os formatos raster aceitos e renderização no navegador o risco principal é parser/DoS, reduzido pelo limite de 5 MiB e reprocessamento por canvas no cliente normal.

## V. Renderização, UX, compatibilidade e acessibilidade

### V.1 Qualidade e formatos

- O limite de 1.400 px é razoável para A4 comum, mas pode degradar diagramas com texto fino e impressão de alta densidade.
- WebP com perda é usado inclusive para PNG; transparência costuma sobreviver em WebP, mas cai para fundo preto/transparente problemático se o navegador não produzir WebP e o código usar JPEG sem preencher o canvas.
- GIF é aceito, porém convertido a um frame estático no primeiro upload/edição.
- EXIF, ICC e demais metadados são descartados. Não há teste de orientação EXIF; navegadores modernos normalmente aplicam orientação ao decodificar, mas isso não é contratado pelo código.
- Rotação/crop não preservam original nem fornecem edição não destrutiva.

### V.2 Responsividade e tamanho

Tamanhos pequeno/médio/grande, alinhamento e limites CSS são cobertos por testes. `fitQuestionImages()` atua somente em `.question-image img`; alternativas, grades, pares e imagens livres dependem de CSS separado (`print.html:1384-1399`). Há testes DOM de proporção, mas nenhuma matriz visual real com retrato/paisagem/extremos, impressão em Chrome/Edge/Firefox/Safari ou driver físico.

### V.3 Falhas visíveis

- `printCleanDocument()` pode abortar por uma imagem (`print.html:552-560`).
- Alguns branches de grade/identificação verificam a verdade do campo antes de `safeImageAttr()` e podem produzir `<img>` sem `src`; não há XSS, mas há ícone quebrado/alt inconsistente (`print.html:1159-1178`, equivalente no editor).
- `compressDataUrl()`, rotação e partes do modal de crop não rejeitam erro de decode/canvas; uma Promise pode permanecer pendente ou lançar fora do fluxo de mensagem (`editor.html:2529-2543,2669-2833`).
- A URL assinada só é renovada quando `resolveTree()` é chamado. Uma aba aberta por mais de 24 horas pode rerenderizar estado com URL expirada até recarregar/re-resolver.

### V.4 Acessibilidade

Há texto alternativo em grande parte das imagens e controles de teclado para marcadores. Várias imagens decorativas usam `alt=""`, corretamente. Em outros casos, o `alt` é apenas nome de arquivo ou genérico; não existe campo dedicado de descrição acessível. Legenda visual não é automaticamente uma descrição equivalente. Drag-and-drop possui alternativa de clique/teclado, e posição de marcador possui campos numéricos.

## VI. Performance, escala e custo

### Pontos positivos

- Dashboard e coordenação preferem resumos e carregam JSON completo apenas quando necessário.
- Objetos privados evitam Base64 repetido no banco e no tráfego após o primeiro salvamento.
- Deduplicação por Data URL evita upload repetido da mesma string dentro da sessão/escopo.
- Concorrência de upload é limitada a três.
- Cache de URL assinada evita reassinar dentro de 23 h após o primeiro resultado.

### Gargalos e crescimento

- `examFingerprint()`, rascunho, limite, histórico e autosave fazem serialização completa; antes do primeiro upload incluem Base64 grande. Edições frequentes podem gerar CPU e pressão de GC.
- Histórico suporta 30 snapshots ou estimativa de 24 MiB UTF-16; imagens ainda em Base64 multiplicam memória.
- `dataToRef` usa a Data URL inteira na chave e os três Maps vivem até a página fechar.
- Preview envia HTML grande ao iframe e Paged.js recompõe páginas; carregamento de imagens pode provocar repaginação.
- Logos escolares continuam inchando linhas `schools` e são clonadas/uploadadas por prova.
- Não há paginação/streaming de assinaturas nem limite de referências por prova no Storage walker.
- Sem GC, custo de Storage cresce monotonicamente; duplicação lógica compartilha objetos, mas substituições e falhas acumulam órfãos.
- Triggers percorrem recursivamente o JSON completo em cada INSERT/UPDATE e reconstroem todos os vínculos, custo proporcional ao documento.

Não há dados de produção para quantificar latência, taxa de autosave, volume médio, órfãos ou custo. Qualquer capacidade em número de escolas/provas seria especulativa.

## VII. Dependências, integrações e implantação

| componente | versão | integração | impacto | internos lidos? |
|---|---|---|---|---|
| Supabase REST/Auth/Storage | serviço; sem SDK npm | `fetch` direto para `/rest/v1`, `/auth/v1`, `/storage/v1` | autenticação, JSON, bucket e URLs assinadas | código do serviço não; contratos locais/SQL sim |
| Paged.js | 0.4.3 | vendorizado em `js/vendor/paged-0.4.3.js` | paginação A4 e espera de imagens | não; cabeçalho/versão, licença MIT e chamadas foram verificados |
| KaTeX | 0.16.11 | CDN jsDelivr em editor/print | matemática; não gerencia imagens de usuário | não |
| `@electric-sql/pglite` | 0.5.8 | devDependency fixada | executa testes SQL isolados | não |
| `linkedom` | 0.18.13 | devDependency fixada | DOM isolado dos testes | não |
| Browser APIs | implementação do navegador | FileReader, Image, canvas, Blob, crypto, postMessage, print | todo pipeline local de imagem | API nativa |

### Drift de implantação

- `config.js:28-30` habilita Storage e bucket no repositório atual.
- `setup.html:394` gera `MAX_FILE_SIZE`, mas não `IMAGE_STORAGE_ENABLED` nem `IMAGE_STORAGE_BUCKET`; pelo código, `enabled()` exige `=== true`, portanto essa configuração gerada desliga uploads.
- `setup_supabase.sql` incorpora apenas migrações até 03. O bucket/policies estão em `setup_storage.sql`; o gate de perfil ativo está na migração 05; o endurecimento final está na 06.
- `README.md:69-81` chama `setup_supabase.sql` de fonte oficial e não inclui com clareza a sequência Storage + 04–06. `migrations/README.md` também precisa ser a referência operacional real.
- Documentos antigos em raiz ainda descrevem localStorage, base64 e até uma arquitetura `supabase-js` que não corresponde ao runtime atual. `SEGURANCA_BACKUP_ESCALA.md:32-34` fala em “mover para Storage” como trabalho futuro, embora já tenha sido implementado.

## VIII. Testes e verificações

### VIII.1 Execução observada

Em 19/10/2026 foi executado `npm test` no commit auditado. Resultado: **exit code 0; todos os 21 scripts passaram**. A execução incluiu:

- contratos/sintaxe/links/servidor HTTP local;
- regressões de referências duráveis, assinatura e fallback de Storage;
- 15 regressões funcionais;
- 49 verificações SQL em PostgreSQL/PGlite isolado;
- 16 fluxos do editor em DOM isolado;
- lote, marcadores, paginação, layout, alternativas, tamanhos por item, persistência e renderização segura.

Isso não prova que SQL/migrações estão aplicados no Supabase real, nem substitui navegador e impressão reais.

### VIII.2 Cobertura existente relevante

- `tests/image-storage-regressions.cjs`: upload único por Data URL repetida, formato da referência, três formas de URL assinada, reinício de sessão, URL legada expirada, URL de bucket estranho e fallback.
- `tests/security-sql.cjs`: acesso por autor/revisor/impressão, escopos do banco, reutilização, perfil desativado e bloqueio de upload.
- `tests/batch-images-regressions.cjs`: quatro tipos, atomicidade lógica, limite e concorrência.
- `tests/alternatives-regressions.cjs`, `marker-regressions.cjs`, `pagination-regressions.cjs`, `layout-optimization-regressions.cjs`: renderização, segurança de `src`, posição e tamanho.
- `tests/flow-refinements.cjs`: rascunho/histórico duráveis, snapshot de logo e revalidação de impressão.

### VIII.3 Lacunas de teste

1. Reancoragem/revogação de referência de outro proprietário.
2. GC seguro com objeto compartilhado e órfão.
3. Falha no segundo/terceiro upload após sucesso parcial e inventário do órfão.
4. Aba aberta além de 24 h e renovação da URL sem reload.
5. Duplicatas concorrentes na assinatura.
6. `img.decode()` rejeitado no `printCleanDocument()`.
7. GIF animado, PNG transparente, EXIF/orientação, perfil de cor e diagramas finos.
8. Erros/abort em FileReader de logo escolar e erros de canvas/rotação/crop.
9. Fronteiras 8 MiB versus 25 MiB e fallback real de Storage.
10. Validação visual real em navegadores, celular, A4 e drivers.
11. Acessibilidade de descrições e leitor de tela.
12. Telemetria de latência, memória, volume de assinaturas e crescimento de objetos.

Scripts históricos de reprodução foram lidos, mas não executados como prova do estado atual porque registram achados de commits anteriores e alguns assertam deliberadamente comportamentos já corrigidos.

## IX. Recomendações priorizadas

### P0/P1 — antes de ampliar uso real

1. **Definir a semântica de compartilhamento de imagem.** Se copiar uma questão deve conceder uma cópia permanente, implementar RPC que copie o objeto para a pasta do novo proprietário e grave nova referência. Se não, validar no trigger que o caminho pertence ao autor/origem permitida e testar revogação. Registrar evento de cópia.
2. **Implementar ciclo de vida/GC conservador.** Manter `last_referenced_at`, executar job periódico que liste objetos sem vínculo por período de carência e delete somente após segunda verificação. Nunca apagar diretamente na remoção de uma prova, porque objetos são compartilhados.
3. **Unificar instalação.** Criar um caminho canônico idempotente que aplique schema, Storage e migrações 04–06; atualizar README/setup; fazer `setup.html` gerar as flags de Storage. Acrescentar verificação pós-deploy do bucket/policies.
4. **Alinhar limites.** Preferível: cliente abaixo do limite SQL com margem e validação específica do banco de questões. Se a arquitetura garante referências curtas, limitar separadamente Base64 pendente e tamanho estrutural do JSON.

### P2 — robustez e experiência

5. Capturar falha individual de `img.decode()` na impressão, relatar quais imagens falharam e impedir/permitir impressão com escolha explícita.
6. Renovar referências automaticamente quando imagem falha por expiração ou antes de imprimir; armazenar/promover promises em voo no cache de assinatura.
7. Tornar compressão não destrutiva quando necessário: preservar original temporário para recrop, documentar GIF estático e transparência, preencher fundo ao cair para JPEG e tratar todas as Promises/erros de canvas.
8. Convergir renderizadores editor/print em helpers compartilhados e adicionar snapshots/fixtures visuais por tipo.
9. Migrar logos escolares para Storage ou, no mínimo, separar thumbnail de original e evitar upload idêntico por prova quando não houver requisito de snapshot físico.

### P3 — escala e manutenção

10. Reduzir serializações integrais: hash incremental por questão, debounce de fingerprint, histórico estrutural/diffs e transferência de patches ao preview.
11. Instrumentar: uploads, fallback, órfãos, falha de assinatura/decode, tempo de paginação, tamanho antes/depois, autosave e memória.
12. Adicionar campo de descrição acessível e orientação de qualidade para material impresso.
13. Remover/arquivar documentação obsoleta para que operação não reintroduza Base64/localStorage ou uma instalação incompleta.

## Apêndice A — Inventário de arquivos e cobertura

### Runtime próprio — leitura integral

`config.js`; `index.html`; `login.html`; `dashboard.html`; `editor.html`; `print.html`; `coordenacao.html`; `impressao.html`; `schools.html`; `master.html`; `setup.html`; `js/auth.js`; `js/editor-tools.js`; `js/exam-safety.js`; `js/exam-pagination.js`; `js/image-storage.js`; `css/editor-tools.css`; `css/exam-pagination.css`.

### Banco/infra — leitura integral

`setup_supabase.sql`; `setup_storage.sql`; `migrations/README.md`; `migrations/20260908_01_seguranca.sql`; `migrations/20260908_02_escola_da_prova.sql`; `migrations/20260908_03_fluxo_professor.sql`; `migrations/20261005_04_controle_acesso_imagens.sql`; `migrations/20261019_05_desativacao_professor.sql`; `migrations/20261019_06_endurecimento_desativacao_professor.sql`; `.github/workflows/tests.yml`; `.github/workflows/supabase-keepalive.yml`; `.env.example`; `.gitignore`.

### Testes — leitura integral e execução pela suíte

`tests/run-tests.js`; `tests/image-storage-regressions.cjs`; `tests/security-sql.cjs`; `tests/safety-regressions.cjs`; `tests/editor-flows.cjs`; `tests/flow-refinements.cjs`; `tests/operations-regressions.cjs`; `tests/answer-key-regressions.cjs`; `tests/readiness-regressions.cjs`; `tests/answer-space-regressions.cjs`; `tests/mixed-answer-regressions.cjs`; `tests/manual-answer-regressions.cjs`; `tests/interface-regressions.cjs`; `tests/preview-navigation-regressions.cjs`; `tests/batch-images-regressions.cjs`; `tests/marker-regressions.cjs`; `tests/single-question-regressions.cjs`; `tests/pagination-regressions.cjs`; `tests/layout-optimization-regressions.cjs`; `tests/ux-regressions.cjs`; `tests/alternatives-regressions.cjs`.

### Scripts de reprodução — leitura integral

`auditoria/reproduzir-achados.cjs`; `auditoria/reproduzir-editor-20260908.cjs`; `auditoria/reproduzir-revisao-376776a.cjs`.

### Dependências e documentação operacional

Leitura integral: `package.json`; `package-lock.json`; `README.md`; `CLAUDE.md`; `SEGURANCA_BACKUP_ESCALA.md`; `COMECE_AQUI.txt`; `EXECUTE_AGORA.txt`; `GUIA_SETUP.md`; `INSTRUÇÕES_CONFIGURE_AGORA.md`; `TESTE_AGORA.md`; `js/vendor/PAGED-LICENSE.md`.

### Histórico de auditoria

Todos foram inventariados e pesquisados; os diretamente ligados a imagens/paginação e os resultados foram lidos integralmente: `auditoria/ARQUITETURA_IMAGENS_E_ESCALA_2026-09-22.md`; `ETAPA10_LOTE_IMAGENS_2026-09-17.md`; `ETAPA11_MARCADORES_2026-09-17.md`; `PAGINAS_A4_2026-09-17.md`; `EXPERIENCIA_VISUAL_2026-09-17.md`; `resultados-editor-20260908.txt`; `resultados-locais.txt`; `testes-existentes.txt`.

Inventário histórico adicional pesquisado: `ANALISE_COMPLETA_2026-09-08.md`; `ANALISE_EDITOR_2026-09-08.md`; `CORRECOES_EDITOR_2026-09-08.md`; `CORRECOES_REVISAO_376776a.md`; `ETAPA2_OPERACOES_2026-09-17.md`; `ETAPA3_GABARITO_2026-09-17.md`; `ETAPA4_CONFERENCIA_2026-09-17.md`; `ETAPA5_ESPACOS_2026-09-17.md`; `ETAPA6_RESPOSTAS_MISTAS_2026-09-17.md`; `ETAPA7_CRITERIOS_2026-09-17.md`; `ETAPA8_INTERFACE_2026-09-17.md`; `ETAPA9_NAVEGACAO_2026-09-17.md`; `ORGANIZACAO_QUESTOES_2026-09-09.md`; `QUESTAO_UNICA_2026-09-17.md`; `REFINAMENTO_PROFESSOR_2026-09-08.md`; `REVISAO_FLUXO_376776a.md`; `STATUS_CORRECOES.md`.

### Binários e terceiros

- `analise_projeto.docx` e `arquitetura_plataforma.docx`: pacote e texto relacionado a imagens inspecionados; não são runtime.
- `js/vendor/paged-0.4.3.js`: corpo minificado não lido; integração, versão e licença verificadas.
- `node_modules/**` e `.cache/**`: excluídos como dependências instaladas/cache gerado.

## Apêndice B — Evidência principal por arquivo

- Storage cliente: `js/image-storage.js:3-16,26-53,80-138,141-215`.
- Upload/conversão/editor: `editor.html:2491-2974,5591-5608`.
- Estado, rascunho, load e autosave: `editor.html:6650-6728,7305-7512`.
- Banco de questões: `editor.html:6787-6965`; `js/editor-tools.js:801-875`.
- Logo escolar: `schools.html:403-464,638-777,990-1020`.
- Criação/duplicação/exclusão: `dashboard.html:949-1073,1313-1329`.
- Renderização/impressão: `print.html:492-569,778-1211,1384-1591`.
- Paginação: `js/exam-pagination.js:70-121`.
- Vínculos e leitura: `setup_storage.sql:16-142`; migração 04 equivalente; gate ativo em `migrations/20261019_05_desativacao_professor.sql:289-338`.
- Limites SQL: `migrations/20260908_01_seguranca.sql:107-108,143-144`; `setup_supabase.sql:834-846`.

---

**Status da auditoria:** cobertura completa do código próprio no escopo declarado, com exclusões de terceiros/gerados explicitadas. Validação de implantação real, conteúdo existente no bucket, navegadores e impressão física permanece fora desta execução e não é inferida como concluída.
