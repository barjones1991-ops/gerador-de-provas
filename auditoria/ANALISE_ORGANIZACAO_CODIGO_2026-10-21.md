# Análise de código: uso, redundância e organização — 21/10/2026

## Escopo

Análise estática do código próprio fora de `node_modules`/`.cache`, com foco em código não usado, duplicação, camadas antigas e organização. Nenhuma alteração funcional foi feita.

Estado observado: aplicação web estática, com HTML muito grande e JavaScript embutido, mais módulos compartilhados em `js/`, SQL legado em `migrations/`/`setup_storage.sql` e migrações novas em `supabase/migrations/`.

## Resumo dos achados

| prioridade | achado | evidência | impacto |
|---|---|---|---|
| P1 | Duas arquiteturas de imagens coexistem | `storage://`/`exam_image_links` em `setup_storage.sql` e `migrations/20261005_04...`; `asset://`/`image_assets` em `supabase/migrations/20261019173319...` e `js/image-storage.js` | aumenta complexidade, risco de aplicar SQL errado e mantém compatibilidade permanente sem plano de remoção |
| P1 | Suíte oficial está vermelha por contratos desatualizados | `tests/run-tests.js`: 3 falhas | CI pode bloquear entregas ou mascarar regressões reais |
| P1 | `editor.html` ainda contém wrappers de imagem obsoletos | `isAllowedImageFile`, `rotateImageDataUrl`, `openCropModal` só têm definição; `readImageFile` encapsula duas vezes o motor | manutenção duplicada e caminhos difíceis de entender |
| P1 | Renderização duplicada entre editor/print | `buildWordSearch`, `buildCrossword`, `renderQuestionPreview`, `safeImageAttr`, normalizadores e respostas aparecem nos dois HTML | correções precisam ser aplicadas em dois lugares; já há divergência de contrato |
| P2 | Helpers básicos repetidos em quatro páginas | `esc`, `parsePtNumber`, `formatPt1`, `showToast`, `isSafeImageDataUrl`, `safeImageSrc`, `safeImageAttr` | comportamento pode divergir; aumenta tamanho dos HTML |
| P2 | `image-storage.js` exporta API maior que o necessário | `discardAsset`, `discardTree`, `cleanupOrphanedAssets`, `refreshUrl`, refs legadas e refs novas | API pública difícil de evoluir; parte só é usada em fluxos de recuperação/limpeza |
| P2 | SQL base e migrações não têm uma única fonte operacional | `setup_supabase.sql`, `setup_storage.sql`, `migrations/*`, `supabase/migrations/*` | instalação/reaplicação depende de conhecimento histórico |
| P2 | Arquivos de teste têm contratos textuais frágeis | asserts procuram strings literais HTML/CSS, inclusive versão de iframe e seletor | pequenas mudanças válidas quebram testes sem regressão funcional |
| P3 | HTML monolítico concentra responsabilidades demais | `editor.html` 7.882 linhas; `print.html` 1.719; `schools.html` 2.109; `dashboard.html` 1.476 | revisão, navegação e testes ficam lentos; difícil localizar dono de cada regra |
| P3 | Documentação histórica conflita com o runtime | auditorias e guias ainda descrevem Base64/localStorage ou SDK antigo | novos mantenedores podem reintroduzir caminhos removidos |

## 1. Código comprovadamente sem uso ou com uso residual

### 1.1 Wrappers mortos no editor

Em `editor.html`:

- `isAllowedImageFile()` (`editor.html:2530-2532`) só é definido; a validação efetiva está em `ExamImageEngine.isAllowedFile()`.
- `rotateImageDataUrl()` (`editor.html:2628-2630`) só é definido; a operação usada pelo picker é `ExamImageEngine.rotate()`.
- `openCropModal()` (`editor.html:2632-2639`) só é definido; o picker usa diretamente `ExamImageEngine.openCrop()`.

Esses três wrappers podem ser removidos depois de confirmar que nenhum script externo depende deles. A busca global encontrou apenas as próprias definições.

`readImageFile()` (`editor.html:2615-2625`) ainda é usado pelo importador em lote, mas o picker faz um ciclo redundante:

`createImagePicker()` → `processFile` customizado → Promise → `readImageFile()` → `ExamImageEngine.processFile()`.

O picker pode chamar o motor diretamente e converter o retorno `{dataUrl,fileName}` para o formato do campo. Isso elimina um callback legado, uma Promise intermediária e a necessidade de manter três conjuntos de opções (`maxFileBytes`, `maxOutputBytes`, `maxSide`, `quality`).

### 1.2 API pública excessiva

`ExamImageStorage` exporta `discardAsset`, `discardTree`, `cleanupOrphanedAssets`, `refreshUrl`, `pathFromRef`, `assetIdFromRef`, `isStorageRef` e `isAssetRef` (`js/image-storage.js:438-442`). A maioria tem uso legítimo, mas a superfície está maior que a integração principal. `discardAsset` é usado internamente por `cloneTree`/`discardTree`; não precisa ser API pública salvo se houver ferramenta administrativa externa. `pathFromRef` só sustenta compatibilidade legada e poderia ficar privada se nenhuma tela precisar dela.

`ExamDecorations` exporta `pageElements()` e `clear()` (`js/exam-decorations.js:35-43,77`), embora sejam detalhes internos; apenas `renderPaged()` precisa deles. Os testes usam `normalizeItem`/`normalizeList`, mas não há necessidade de expor todos os helpers de renderização para produção.

### 1.3 Código legado ainda executável

O suporte a `storage://` é necessário para dados antigos, mas está espalhado pelo motor, SQL e testes. O código novo usa `asset://` e `image_assets`. A compatibilidade deve ser isolada em um adaptador de migração, em vez de manter dois fluxos completos em `signReference()`, `cloneTree()`, `can_read_exam_image()` e policies.

## 2. Redundâncias funcionais

### 2.1 Renderizadores duplicados

Os dois HTML implementam separadamente:

- `renderQuestionPreview()`;
- `buildFreeImagesHtml()`;
- `renderWordSearch()`/`buildWordSearch()`;
- `renderCrossword()`/`buildCrossword()`;
- `normalizeLacunasQuestion()`;
- `normalizeRelacioneQuestion()` e `normalizeRelacioneImagensQuestion()`;
- `relacioneAnswer()` e `relacioneImagensAnswer()`;
- `parsePtNumber()`, `esc()` e `formatPt1()`;
- `isSafeImageDataUrl()`, `safeImageSrc()` e `safeImageAttr()`.

O editor contém ainda uma versão de `printCleanDocument()` (`editor.html:6896`), enquanto a impressão canônica tem outra (`print.html:556`). A estratégia correta é manter em `print.html` apenas o renderer canônico e fazer o editor enviar estado/patch; helpers puros de normalização e gabarito devem ir para módulos compartilhados.

### 2.2 Helpers de UI copiados

`showToast`, `applyModuleNavigation`, `isPlaceholderDiscipline`, `formatBytes`, `dataUrlBytes` e helpers de imagem aparecem em múltiplos documentos. Isso torna correções de acessibilidade e mensagens inconsistentes. Um `js/ui.js` pequeno poderia centralizar apenas funções puras/seguras, sem transformar todos os HTML em framework.

### 2.3 Regras de imagem em três camadas

Hoje há regras em:

1. `js/image-engine.js` — validação e conversão;
2. wrappers no `editor.html` — limites e mapeamento de campos;
3. `schools.html` — wrappers próprios para logo;
4. `js/image-storage.js` — MIME, tamanho máximo do Blob e persistência;
5. SQL — MIME, tamanho, owner e vínculos.

As camadas são necessárias, mas os nomes e constantes não são uniformes: `MAX_FILE_SIZE`, `MAX_IMAGE_FILE_BYTES`, `MAX_IMAGE_DATA_URL_BYTES`, `MAX_OBJECT_BYTES` e limites específicos de logo. Recomenda-se um módulo de configuração de limites com nomes por etapa (`source`, `converted`, `object`, `examPayload`) e adaptadores por contexto.

## 3. SQL e migrações: redundância e organização

### 3.1 Duas famílias de schema de imagem

`setup_storage.sql` e `migrations/20261005_04_controle_acesso_imagens.sql` criam:

- `private.exam_image_links`;
- `private.image_object_name(s)`;
- `private.refresh_image_links()`;
- `private.can_read_exam_image()`;
- policies para `storage.objects` baseadas em `storage://`.

`supabase/migrations/20261019173319_centralizar_imagens.sql` cria:

- `public.image_assets`;
- `private.image_asset_links`;
- `private.image_asset_id(s)`;
- `private.refresh_image_asset_links()`;
- `private.can_read_image_asset()`;
- policies de `image_assets` e compatibilidade `storage://`.

Isso não é apenas duplicação histórica: são triggers, tabelas e políticas diferentes que podem coexistir no mesmo banco. A documentação diz que 07/08 já foram aplicadas, mas os scripts antigos continuam parecendo executáveis. A organização recomendada é:

- uma fonte canônica `supabase/migrations`;
- `setup_supabase.sql` apenas como bootstrap gerado/reproduzível;
- `setup_storage.sql` marcado como legado ou convertido em wrapper explícito;
- um README de migração com ordem, pré-requisitos e estratégia de rollback;
- teste que falhe se policies/triggers legados forem reintroduzidos.

### 3.2 Divergência de teste e produção

`tests/security-sql.cjs` executa contratos novos e antigos. Isso protege compatibilidade, mas também torna difícil saber qual família é obrigatória. Separe os testes em `legacy-compatibility` e `current-schema`, e inclua uma asserção de que o fluxo novo não depende de `exam_image_links`.

### 3.3 Repetição de SQL idempotente

`supabase/migrations/20261019174600_otimizar_imagens.sql` repete policies já criadas em `20261019173319_centralizar_imagens.sql`. Reaplicação idempotente é correta, mas a migração deveria conter somente o delta: índice/policy que mudou e justificativa. Repetir blocos completos aumenta risco de divergência futura.

## 4. Problemas de organização

### 4.1 HTML monolítico

O editor mistura CSS, markup, estado, normalização, renderização, Storage, autenticação, banco, preview e decoração em um único arquivo. O caminho incremental recomendado:

1. extrair funções puras de domínio (`question-normalizers.js`, `answer-key.js`, `image-fields.js`);
2. extrair renderização da questão para módulos sem DOM global;
3. extrair CSS por domínio (`editor-layout`, `question-card`, `decorations`, `print`);
4. deixar o HTML apenas como shell e composição.

Não é necessário introduzir bundler imediatamente; scripts ES modules ou arquivos clássicos ordenados já reduzem o acoplamento.

### 4.2 Nomenclatura e compatibilidade

Há simultaneamente `dataUrl`, `imageDataUrl`, `logoDataUrl`, `logo_data_url`, `storage://` e `asset://`. Para reduzir condicionais, defina uma representação interna única (`imageRef`) e converta apenas na borda REST/legado. O mesmo vale para `fileName`/`imageFileName` e `size`/`imageSize`.

### 4.3 Fontes e assets

O novo `NotoSans-exam.ttf` é usado pelo print e existe com licença, mas há referências versionadas em query string espalhadas nos HTML. Centralize um `APP_ASSET_VERSION` ou mantenha um manifesto para evitar versões divergentes (`question-header1`, `assets1`, `decor2`, `retry1`, etc.).

## 5. Saúde dos testes

`npm test` foi executado e terminou com código 1. Três falhas ocorreram em `tests/run-tests.js`:

1. **Tipos do seletor:** o teste exige 12 opções, mas `editor.html:1610-1622` contém 11 opções atuais. É provável que o teste esteja stale, mas a intenção precisa ser decidida: restaurar um tipo ou corrigir o contrato para 11.
2. **Classe de alternativas:** o CSS atual usa `.option-item.wide-marker` (`print.html:212`), enquanto o teste procura a string literal `option-item wide-marker`. É um falso negativo de teste textual.
3. **Versão do preview:** `js/editor-tools.js:1390` usa `v=20261021-question-header1`, mas o teste espera outra revisão. O contrato deveria ser uma constante ou leitura do HTML, não uma string duplicada.

Os testes específicos novos passaram quando executados separadamente: motor de imagens, decorações, Storage e SQL, com 54 verificações SQL aprovadas. Portanto, o resultado atual é “suíte global vermelha por contratos desatualizados/frágeis”, não uma aprovação completa.

## 6. Plano de limpeza recomendado

### Etapa 1 — baixo risco

- Remover os três wrappers comprovadamente sem uso.
- Trocar o `processFile` intermediário do picker por chamada direta ao motor.
- Corrigir os três asserts frágeis/stale da suíte.
- Adicionar uma constante de versão do preview.
- Documentar `setup_storage.sql` e `migrations/20261005_04...` como legado.

### Etapa 2 — médio risco

- Criar módulos compartilhados para helpers puros de escape, números, imagem segura e normalização.
- Mover respostas/gabaritos e puzzles para módulos usados por editor e print.
- Restringir a API pública de `ExamImageStorage` e `ExamDecorations`.
- Separar testes de compatibilidade legada dos contratos atuais.

### Etapa 3 — maior impacto

- Consolidar as migrações SQL em uma única linha canônica.
- Extrair o renderer canônico da prova para um módulo compartilhado ou para `print.html` com interface estável.
- Dividir `editor.html` e `schools.html` por domínio, mantendo uma camada de estado explícita.
- Remover compatibilidade `storage://` somente após medir e migrar todos os registros reais.

## Limites da análise

Não executei limpeza nem alterei código. Não medi bundle/heap em navegador real, nem confirmei quais páginas são acessadas em produção. A classificação “sem uso” significa ausência de referências no repositório; APIs públicas podem ser consumidas por código externo não presente no workspace.
