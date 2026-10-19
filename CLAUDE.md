# Gerador de Provas — manual técnico e operacional

## Finalidade e arquitetura

Aplicação web para criar provas, submetê-las à coordenação, revisar/aprovar e encaminhar provas aprovadas para a fila de impressão. O frontend é HTML, CSS e JavaScript sem framework e sem etapa de build. `config.js` centraliza o endpoint do projeto Supabase; `js/auth.js` implementa Auth e chamadas REST diretamente com `fetch`. O armazenamento principal é o Supabase; `localStorage` mantém sessão, seleção da prova e recuperação local de alterações.

Entradas principais:

| Página | Responsabilidade | Código de apoio |
|---|---|---|
| `index.html`, `login.html`, `setup.html` | entrada, login, cadastro/recuperação e configuração inicial | `js/auth.js`, `config.js` |
| `dashboard.html` | listar, criar, duplicar, enviar, excluir e abrir provas | `js/auth.js`, `js/exam-safety.js`, `js/image-storage.js` |
| `editor.html` | editar prova/banco, autosave, conferência, histórico e prévia; impressão conforme perfil | `js/editor-tools.js`, `js/exam-safety.js`, `js/image-engine.js`, `js/image-storage.js`, `js/exam-decorations.js`, `js/exam-pagination.js` |
| `coordenacao.html` | revisão, devolução, aprovação/bloqueio e envio para impressão | `js/auth.js` |
| `print.html` | prévia incorporada e renderização para impressão/PDF, com ou sem gabarito | `js/exam-pagination.js`, `js/exam-decorations.js`, `js/exam-safety.js`, `js/image-storage.js` |
| `impressao.html` | operar a fila de provas aprovadas e concluir impressão | `js/auth.js` |
| `schools.html`, `master.html` | administração de escolas, usuários e vínculos | `js/auth.js` |

`js/vendor/paged-0.4.3.js` é dependência vendorizada para paginação A4. `css/editor-tools.css` e `css/exam-pagination.css` sustentam editor/prévia e layout paginado. Não editar o vendor para corrigir comportamento da aplicação.

## Executar e validar

Comandos declarados em `package.json`:

```bash
npm ci --ignore-scripts
npm test
npm run serve                 # python -m http.server 8000 --bind 127.0.0.1
npm run test:sql              # somente tests/security-sql.cjs
```

A aplicação usa URLs relativas e pode ser servida como arquivos estáticos. `npm test` encadeia os testes de `tests/`, incluindo regressões de editor, segurança SQL, imagens, autosave, respostas, navegação, paginação, layout, UX e alternativas. Os testes são locais; não provam configuração ou estado do Supabase de produção. Não instalar dependências nem iniciar servidor por formalidade em tarefas apenas documentais.

O servidor local abre em `http://127.0.0.1:8000/`; requer Python disponível. Os testes usam Node.js e as dependências de desenvolvimento do projeto. Consulte `package.json` para os comandos vigentes e os arquivos de regressão específicos para cada módulo.

## Perfis, acesso e fluxos

Os papéis canônicos usados por `js/auth.js` e pelas policies são `master`, `school_owner`, `coordinator`, `teacher` e `print_operator`; aliases antigos (`admin`, `coordenadora`, `professor`, `impressao`) são normalizados no frontend. O perfil contém, entre outros, `school_id`, `school_grade`, `disciplines` e `force_password_change`.

- `master`: administração global e acesso previsto pelas funções de segurança.
- `school_owner`: administra a escola/usuários, revisa e acessa a fila de impressão da escola.
- `coordinator`: administra usuários conforme escopo, revisa provas da escola e respeita `school_grade`/turma.
- `teacher`: cria e edita suas provas liberadas, usa o banco de questões, envia para revisão e consulta a prévia, sem comandos de impressão da aplicação. `EditorTools.refreshActions()` oculta o botão; `openPrint()` mantém o professor na prévia; `print.html` redireciona esse perfil para o editor e recusa a ação de imprimir. Preservar esses controles; eles não impedem os comandos próprios do navegador.
- `print_operator`: não cria provas; acessa somente a fila autorizada e pode concluir um trabalho enviado como `impressa`.

Autenticação usa Supabase Auth. A sessão é salva em `localStorage['supabase.auth.token']`, renovada por refresh token e compartilhada entre abas. Cadastro cria/atualiza o perfil conforme o fluxo de convite; o redirecionamento de confirmação preserva o convite e o destino interno, removendo os segredos do callback da URL antes de continuar. Recuperação usa link individual do Auth. Não existe contrato de senha compartilhada nem RPC de reset fixo. Confirmação de e-mail, SMTP e a lista de URLs de redirecionamento permitidas são configuração externa, não garantida pelo código.

Estados de revisão: `rascunho → enviada → em_revisao → aprovada`, ou `devolvida` para correção e reenvio; `bloqueada` representa edição bloqueada. Estados de impressão: `nao_enviada → enviada → impressa`. Professor não pode editar/excluir prova enviada, em revisão, aprovada ou bloqueada; depois de devolvida pode voltar a rascunho, corrigir e reenviar. Coordenação pode iniciar revisão, devolver, aprovar, bloquear e reabrir conforme as ações expostas em `coordenacao.html`. Só prova aprovada pode ser enviada à impressão. A proteção definitiva deve estar nas triggers/policies, não apenas nos botões.

A fila é acessível a `master`, `school_owner` e `print_operator` (`AuthManager.canAccessPrintQueue`). `print.html` reconsulta a prova antes de imprimir; no fluxo da fila exige aprovação e pedido ainda enviado. A conclusão usa a RPC `mark_exam_printed`. No SQL, `can_print_exam` permite master ou dono/operador da mesma escola com pedido enviado/impresso; revisar também as policies de leitura e as demais funções de autorização ao alterar esse fluxo.

Em `schools.html`, escolas mantêm disciplinas e `schools.classes`; vínculos liberam disciplinas e turmas por `profiles.disciplines`/`school_grade`. Convites registram perfil, escola e escopo; cancelamento preserva o registro com `canceled_at`, e `accept_user_invite` recusa convites cancelados. Gestão de escolas e gestão de usuários têm permissões distintas em `js/auth.js`.

A interface de `schools.html` é adaptada ao perfil. Para coordenação, a escola atual e o perfil de professor são implícitos no convite; a aba Equipe exibe somente professores da escola, deixa o e-mail nos detalhes de gerenciamento e destaca se faltam turmas, disciplinas ou ambas. Perfis administrativos mais amplos continuam vendo escola, papel e os demais grupos de acesso.

Ao remover turmas ou disciplinas da escola, `schools.html` também elimina esses valores dos perfis de professor e dos convites pendentes correspondentes. Os indicadores de acesso e o modal de nova prova consideram somente a interseção com as listas oficiais atuais, inclusive quando uma delas fica vazia. A criação de convite usa UUID conhecido pelo navegador e reutiliza uma tentativa cuja confirmação ficou incerta, evitando registros duplicados após timeout.

A remoção de professor é uma desativação preservadora, definida em `migrations/20261019_05_desativacao_professor.sql`: pendências de revisão ou impressão bloqueiam a ação; depois da confirmação, escola, turmas e disciplinas são limpas e `profiles.is_active` fica falso. O usuário removido não pode acessar, criar ou editar provas, questões ou imagens, inclusive pessoais, e não deve ser contado como integrante ativo nas telas administrativas. Um novo convite aceito reativa a mesma conta, sem apagar autoria ou histórico; o vínculo direto de usuário existente não substitui essa reativação.

A interface de `schools.html` abre na equipe e separa equipe, convites e dados da escola por navegação interna. A faixa superior prioriza coordenação, professores, convites pendentes e acessos incompletos; o aviso de configuração só aparece enquanto faltarem escola, disciplinas, turmas, coordenação ou professor liberado. O formulário de convite abre sob demanda, turmas são agrupadas visualmente por segmento, ações sensíveis ficam dentro da gestão do usuário e o histórico de convites agrupa registros repetidos por e-mail, sem alterar permissões ou estados persistidos.

## Contratos de integração

- `config.js` deve expor `window.CONFIG`, consumido por `initAuthManager()`; uma constante isolada não basta.
- Links e redirecionamentos internos devem funcionar em subpastas, como no GitHub Pages. Preservar URLs relativas, os parâmetros de retorno ao login e o token de convite durante a confirmação de e-mail, sem conservar tokens de sessão no histórico do navegador.
- `AuthManager.authenticatedRequest()` aceita corpo vazio, inclusive em DELETE com HTTP 204; não exigir JSON de toda resposta bem-sucedida.
- PATCH de prova existente não envia `user_id` nem `school_id`. A coordenação não pode trocar o autor ao salvar ajustes. Na criação/duplicação, informar o autor, deixar o servidor atribuir a escola e não copiar estados de revisão/impressão da prova original.
- Mudanças de conta e respostas assíncronas atrasadas não podem aplicar conteúdo à prova/questão errada; preservar as verificações de usuário, versão e contexto.
- Operações com UUID criado no navegador devem consultar esse identificador depois de resposta perdida. Uploads e logotipos só podem ser descartados quando o registro consumidor for confirmado como ausente; reenvios à impressão devem conferir `print_requested_at` e `print_requested_by` da tentativa atual.

## Provas, editor e banco de questões

`dashboard.html` carrega resumos; `editor.html` carrega o JSON completo de `exams.questions`. Links de nova prova convergem para `dashboard.html?new=1`; o editor abre uma prova existente. A versão `updated_at` carregada é enviada no PATCH. Autosave só é habilitado após carregamento e versão confirmados; PATCH que afeta zero linhas é conflito, não sucesso.

Alterações pendentes de prova existente ficam em `localStorage` com chave `gerador-provas-pending-v2:<userId>:<examId>`, contendo versão e fingerprint. A cópia é removida após salvar exatamente o conteúdo enviado; em conflito ou divergência deve ser preservada para recuperação. Não confundir com o rascunho antigo de nova prova. `ExamSafety.normalizeQuestion` é o ponto canônico para compatibilidade/validação antes de salvar e renderizar; renderizadores e gabarito devem consumir o formato normalizado.

Tipos disponíveis para criação no editor (identificadores internos; conferir templates, menu, normalização e renderizadores ao alterar):

`discursiva`, `vf`, `marcarx`, `lacunas`, `relacione`, `imagem`, `interpretacao_imagem`, `relacione_imagens`, `texto_base`, `matematica_coluna`, `expressao_matematica`, `ditado`, `ordenacao`, `problema_matematico`, `espaco_livre`, `tabela`, `sequencia_numerica`, `leitura_escrita`, `silabas`, `sequencia_imagens`, `comparar_imagens`, `legenda_imagens`, `associacao_imagem_imagem`, `grade_imagens`, `identificar_imagem`, `caca_palavras`, `cruzadinha` e `subitens`.

Tipos legados `multipla` e `associacao_setas` continuam editáveis/renderizáveis em dados salvos, mas não aparecem no menu de criação. `addQuestionOfType()` redireciona novas solicitações desses tipos para `marcarx` e `relacione`, respectivamente. Não remover suporte aos dados antigos nem reintroduzir opções duplicadas.

Contratos de conteúdo que não devem ser quebrados:

- respostas podem ser de escolha, V/F, lacunas, associação, ordenação, critérios/resposta esperada, cálculo, desenho ou linhas; normalização deve preservar respostas legadas;
- `textBaseCaption` e `textBaseBeforeStatement` controlam legenda e posição do texto-base; conteúdo exibido deve ser escapado;
- `wordSearchSeed` torna a disposição de caça-palavras determinística e deve ser compartilhada por editor, prévia, impressão, gabarito e validação;
- imagens de questão/alternativa/item preservam `imageSize`, alinhamento, marcadores `x/y`, nomes e estruturas legadas; exclusão de alternativa deve ajustar imagem e índice do gabarito;
- `expectedAnswer` é opcional e aparece no gabarito para formatos abertos; não inventar migração para campos já armazenados no JSON;
- prévia canônica e impressão devem usar o mesmo conteúdo, paginação e regras de resposta. `js/exam-pagination.js` pagina somente regras de impressão, aguarda imagens e fontes e invalida renderizações antigas. A largura do dispositivo não pode reorganizar o conteúdo A4 nem acionar redimensionamento automático de texto; no celular, somente os controles externos respondem e a folha é reduzida proporcionalmente. O conteúdo impresso usa a fonte incorporada `assets/fonts/NotoSans-exam.ttf` (licença em `OFL-NotoSans.txt`), sem depender das métricas da fonte do sistema;
- navegação por questão usa posição no array, não o número impresso. Seleção, busca, anterior/próxima e foco do iframe são comportamento de interface, não dados persistidos.

O banco (`question_bank`) aceita escopo privado, escola ou público. A questão mantém autor; `school_id` só pode representar a escola do autor (exceto master). Ao alterar o banco, atualizar o editor, normalizador, prévia, gabarito e os testes correspondentes.

`editor.html?bank=ID` edita exatamente uma questão do próprio autor, independentemente de uma prova. `EditorTools.loadBank()`/`saveBank()` carregam e atualizam o registro original por PATCH condicionado a `updated_at`; conflito preserva o rascunho. O escopo padrão é privado. Inserção na prova, edição do registro e alteração de compartilhamento são operações distintas, com permissões próprias.

No editor, a lista de questões seleciona um cartão por vez. `js/editor-tools.js` concentra histórico/desfazer, conferência, bloqueios e prévia canônica em `print.html?preview=1`; mensagens do iframe exigem a mesma origem e a janela esperada. Ao investigar divergência entre editor e PDF, conferir também `print.html` e `js/exam-pagination.js`.

## Dados, Supabase e imagens

O frontend usa REST/Auth/Storage do Supabase sem SDK. Tabelas e campos relevantes aparecem nas consultas de `dashboard.html`, `coordenacao.html`, `editor.html` e nos SQL: `profiles`, `schools`, `exams`, `question_bank`, `user_invites`, `schema_migrations` e `storage.objects`. A prova guarda `questions` e `decorative_images` como JSONB e resumos `questions_count`/`questions_score_total`; `review_history` registra transições.

`exams.school_id` é fotografia permanente da escola no momento da criação. O servidor atribui esse valor e rejeita alteração pelo aplicativo; transferir o autor não move provas antigas. Provas pessoais podem permanecer com `NULL`. Não usar `school_name` impresso para inferir vínculo. A consulta e a cautela de migração estão em `migrations/README.md`.

Com `IMAGE_STORAGE_ENABLED === true`, `js/image-storage.js` converte Data URLs em arquivos no bucket privado `exam-images`, registra cada arquivo em `image_assets` e persiste a referência `asset://<uuid>`. Referências antigas `storage://exam-images/<caminho>` continuam legíveis. `durableTree()` recupera a referência permanente de URLs assinadas conhecidas; não persistir URLs temporárias irrecuperáveis. Duplicar prova, salvar questão no banco e inserir questão do banco usam `cloneTree()` para criar arquivo e identidade independentes; editar o mesmo registro usa `persistTree()`. O bucket permite PNG/JPEG/WebP/GIF até 5 MiB. `setup_storage.sql`, a migração 04 e `supabase/migrations/20261019173319_centralizar_imagens.sql` restringem leitura conforme autor e acesso ao conteúdo. A política `SELECT` de `image_assets` deve permitir diretamente `owner_id = (SELECT auth.uid())`, pois o cadastro usa `INSERT ... RETURNING` antes de qualquer vínculo com prova ou questão. Imagens sem vínculo recebem carência de sete dias e são removidas pelo aplicativo via API do Storage; nunca apagar objetos do Storage por SQL.

`js/image-engine.js` é o motor único do navegador para entrada e manipulação de imagens: valida tipo/tamanho, lê, redimensiona, comprime, gira, recorta e monta o seletor reutilizado pelos campos do editor. A importação em lote e os logotipos escolares delegam a conversão ao mesmo motor com limites próprios. `js/image-storage.js` continua responsável pela persistência e pelo acesso; não duplicar `FileReader`, canvas ou regras de compressão nas páginas.

Imagens ilustrativas da prova ficam em `exams.decorative_images`, separadas das imagens de questão. O botão **Decorar prova**, junto à prévia, permite inserir pelo mesmo `js/image-engine.js`, mover, redimensionar, girar, recortar, substituir, trocar de página e remover. `js/exam-decorations.js` normaliza e renderiza essas imagens sobre as páginas produzidas pelo Paged.js, tanto na prévia quanto na impressão/PDF. Duplicar uma prova clona também seus arquivos decorativos; alterações de conteúdo que podem repaginar uma prova com decoração devem persistir `exams.decorations_need_review = true` até o usuário concluir a revisão. Durante a edição, a camada decorativa do iframe fica oculta para não duplicar visualmente a camada interativa; a impressão deve aguardar também o carregamento das imagens adicionadas após a paginação.

Preservar os fallbacks de implantação: falha no upload mantém o conteúdo compatível em Data URL; ausência de `questions_count`/`questions_score_total` faz o dashboard consultar o formato antigo. Isso não dispensa investigar falhas de Storage ou migrações pendentes.

`importQuestionImages()` em `editor.html` aceita até 20 imagens por seleção para `grade_imagens`, `sequencia_imagens`, `legenda_imagens` e `relacione_imagens`. Preenche espaços vazios antes de criar itens, preserva respostas e rejeita resultados se conta, questão ou conteúdo mudarem durante a leitura. Falha não aplica lote parcial. Novas `freeImages` não têm ação de inclusão; as já salvas continuam visíveis, ajustáveis, removíveis e imprimíveis.

## SQL, instalação e publicação

Para ambiente novo, usar `setup_supabase.sql`, depois `setup_storage.sql` e por fim, em ordem, as duas migrações em `supabase/migrations/`; criar e confirmar o primeiro master administrativamente com o UUID conferido no Auth. Para ambiente existente, consultar `migrations/README.md`, conferir o estado aplicado, fazer backup e executar somente as migrações necessárias, inteiras e na ordem registrada. Não reaplicar `setup_supabase.sql` em ambiente existente. Antes da migração 02, conferir o vínculo proposto para as provas antigas; o nome impresso não reconstrói transferências de escola.

As migrações criam/atualizam triggers, funções, RLS, escopos de convite, vínculo permanente da escola, proteção do fluxo do professor e controle de Storage. Se uma transação falhar, não executar apenas trechos restantes. Verificar `schema_migrations`, policies, grants e contas controladas. Registros locais ou autorização para publicar não equivalem a aplicação SQL, deploy ou configuração de Auth confirmados.

O frontend é compatível com hospedagem estática (GitHub Pages). Antes de publicar, executar `npm test`, revisar o diff e as versões de cache dos recursos alterados, disponibilizar o endereço local e obter a validação do usuário. Commit/push e publicação devem respeitar a autorização da sessão; não pedir novamente uma autorização já concedida para o mesmo escopo. Se o usuário autorizar publicação com validações pendentes, registrar essa condição sem declarar que foram realizadas. Avaliar impacto em schema, RLS, Auth, Storage e dados persistidos; atualizar SQL/migrações quando necessário e distinguir arquivo preparado de aplicação confirmada no ambiente.

## Checklist para mudanças

1. Ler o manual, verificar `git status --short` e consultar o módulo afetado; ampliar a leitura pelas dependências, sem exigir releitura integral do repositório.
2. Para uma funcionalidade, localizar entrada, perfil, estado, persistência, normalização, renderização, SQL/RLS e testes.
3. Preservar fallback de imagens, dados legados, escape de texto, controle de versão do autosave e autorização no servidor.
4. Ao adicionar tipo de questão, atualizar templates/labels, editor, `normalizeQuestion`, renderizadores de prévia/impressão/gabarito, validação, banco se aplicável e regressões.
5. Para mudanças de comportamento, atualizar regressões pertinentes em `tests/` e executar `npm test`; validar visualmente quando houver impacto de interface/impressão. Em tarefas apenas documentais, conferir referências e coerência sem iniciar o aplicativo por formalidade. Relatar comando, resultado e validações não realizadas.
6. Revisar o diff dos arquivos alterados e o status final, preservar mudanças preexistentes do usuário e respeitar o escopo autorizado. Atualizar as seções afetadas deste manual conforme as regras abaixo.

## Verificações externas e pendências

- Confirmar SMTP, confirmação de e-mail, redirecionamentos e fluxo completo com contas dos cinco perfis no ambiente alvo; testes locais não comprovam essas configurações.
- `migrations/README.md` registra aplicação da migração 04 pelo conector em 05/10/2026, com verificações de acesso. O mesmo registro deixa pendentes questão compartilhada com imagem e prova com imagem enviada à fila. Validar esses cenários com dados controlados; essa evidência documental não é uma nova consulta ao ambiente real.
- Conferir prévia/PDF em navegador, incluindo todos os tipos, imagens, gabaritos e provas longas. Regressões automatizadas não substituem a inspeção visual.

## Manutenção deste manual

Consultar o manual no início e verificar o código relevante antes de confiar em qualquer descrição sujeita a mudança. Após alteração relevante, revisar as seções afetadas e substituir descrições superadas, em vez de acrescentar diário cronológico. Manter uma descrição canônica por regra e distinguir implementação local, teste executado, autorização de publicação e implantação confirmada. O código mostra o comportamento implementado; instruções do usuário definem o comportamento solicitado. Se divergirem, registrar a diferença, sem transformar um possível bug em regra de produto.

Atualizar mapa de arquivos, funcionalidades, fluxos, permissões, persistência, integrações, comandos e tipos de questão quando mudarem. Usar caminhos relativos e identificadores estáveis; evitar números de linha. Não documentar mudanças puramente cosméticas sem efeito operacional, copiar segredos/dados pessoais nem incorporar restrições temporárias de uma tarefa como regras permanentes. Se o escopo proibir editar documentação, informar apenas a atualização necessária, quando houver.

Registrar achados não resolvidos no formato breve: problema, evidência/caminho, impacto e próxima verificação. Remover pendências só com evidência de resolução. Auditorias e histórico do git guardam detalhes de entregas; este arquivo guarda o mapa operacional e os contratos atuais. Não converter indisponibilidade de uma ferramenta em uma sessão em limitação permanente do projeto.
