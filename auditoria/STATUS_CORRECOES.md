# Correções da auditoria

Lote posterior à revisão de `376776a`: R01–R05 e recuperação refinados; ações de duplicar/subir/descer questões removidas por solicitação do usuário. Consulte [as correções da revisão](CORRECOES_REVISAO_376776a.md). Publicação autorizada pelo usuário em 08/09/2026. Não exige SQL adicional; validação visual deste lote ainda pendente.

Refinamento do professor: fluxo reorganizado para elaborar, conferir e enviar à coordenação, com publicação autorizada pelo usuário em 08/09/2026. Consulte [o registro do refinamento](REFINAMENTO_PROFESSOR_2026-09-08.md). Testes aprovados: 16 fluxos do editor, 15 regressões e 39 verificações SQL, além da suíte geral. Migração 03 aplicada no Supabase conforme relato do usuário em 08/09/2026, sem verificação administrativa independente; validação visual e ciclo com contas reais ainda pendentes.

Atualizado em 08/09/2026. Primeiro lote publicado em `main`, commit [`a518f8c`](https://github.com/barjones1991-ops/gerador-de-provas/commit/a518f8c46f075815a5d452e11bec727455ef2671), por autorização do usuário. [Testes no GitHub](https://github.com/barjones1991-ops/gerador-de-provas/actions/runs/34234772887) e [publicação no Pages](https://github.com/barjones1991-ops/gerador-de-provas/actions/runs/34234771238) concluídos com sucesso.

Segundo lote: S08 publicado em `3cf5d23` e coberto pelos testes SQL. Em 08/09/2026, o usuário informou que executou os scripts no Supabase e autorizou a publicação de todas as alterações. A aplicação foi informada pelo usuário, sem verificação administrativa independente pelo agente; validação visual e testes com contas reais permanecem sem confirmação.

A análise original descreve o commit `517933c`. Seus scripts de reprodução e resultados são evidência histórica e podem deixar de reproduzir os erros depois das correções. A verificação atual é `npm test`.

Lote do editor: implementadas as correções E01–E16, com publicação autorizada pelo usuário em 08/09/2026. Consulte [o detalhamento do editor](CORRECOES_EDITOR_2026-09-08.md), incluindo os limites da validação. Não exige nova migração SQL. `npm test` aprovado, incluindo 15 grupos de regressões funcionais, 35 verificações SQL e 12 fluxos do editor em DOM isolado.

## Implementado e testado localmente

| Achado | Correção / limite |
| --- | --- |
| S01 | Retorno do login limitado a páginas conhecidas, preservando a subpasta. Casos de protocolos executáveis, endereços externos e controles recusados. |
| S02, parcial | Devolutiva usa apenas texto; questões recebidas validam coleções por tipo, limites numéricos e enums. Atributos vulneráveis e fallback LaTeX foram escapados. Ainda falta um schema semântico completo para todos os tipos e revisão de todos os pontos de HTML do aplicativo. |
| S03, parcial | Migração oculta tokens do destinatário, exige e-mail confirmado e bloqueia reutilização. Ativar confirmação no Auth e revisar contas antigas permanece obrigatório. |
| S04 | Frontend envia recuperação individual. RPC de senha compartilhada removida na migração; senhas antigas não foram alteradas. |
| S05, S06, S07 | Triggers validam papel/escola e estado inicial, protegem identidade e proprietário. Bootstrap por e-mail removido. Validação em PostgreSQL isolado; execução dos scripts no Supabase informada pelo usuário. |
| S08 | Segundo lote: escola gravada na prova pelo servidor e protegida contra alteração pelo aplicativo. Transferência/desvinculação do professor conserva o acesso da escola de origem; a nova escola só recebe provas novas. Provas pessoais continuam sem escola. Migração 02 e reaplicação do setup testadas; vínculos legados exigem conferência administrativa antes da aplicação. |
| S09, parcial | Escopo da questão e proprietário da prova protegidos no servidor. Histórico de revisão ainda não é uma trilha imutável. |
| S10 | Renovação de sessão com coordenação entre pedidos/abas quando Web Locks está disponível, logout remoto e timeout de conexão. Cópia pendente fica preservada diante de erro. |
| S11, parcial | Helpers do setup usam search_path fixo; aceite e impressão têm grants explícitos. CSP e integridade do CDN continuam pendentes. |
| F01, F02 | Carga com erro bloqueia edição; salvar exige uma linha retornada e versão confirmada. |
| F03, parcial | Editor usa controle otimista por updated_at. Uma arquitetura de rascunhos/versionamento pedagógico continua pendente. |
| F04 | Cópia pendente por usuário/prova, aviso de saída, reenvio e recuperação. Conflito de versão bloqueia edição e permite baixar a cópia; falta comparar/mesclar na própria interface. Sem espaço local, o usuário é avisado para manter a aba aberta. |
| F05 | Página inicial e editor sem ID conduzem à criação pelo dashboard. |
| F06 | Busca/escopo/habilidade são enviados ao servidor antes da paginação. Páginas de 30 itens com próxima/anterior; respostas antigas são ignoradas. Sintaxe do filtro conferida via GET anônimo no REST real: HTTP 200, sem escrita. |
| F07, parcial | Prévia e saída do editor usam print.html, com numeração, gabarito e tipografia compartilhados. BNCC deixa de aparecer no documento limpo. Falta comparação visual completa dos tipos e das quebras de página em navegadores reais. |
| F08 | Geração compartilhada não corta palavras; aumenta a grade até o limite e informa palavras sem posição. Impressão pelo botão é impedida quando o caça-palavras é inválido. |
| F09 | Setup gera window.CONFIG, recusa 401 e exibe código como texto. O teste novo também encontrou e eliminou um fechamento de script dentro de template e uma variável fora de escopo. |
| U03, parcial | Contraste e anúncio do salvamento corrigidos; editor recebeu labels, foco visível, atalhos, controle de foco dos modais e alternativas numéricas ao arraste. Falta validar teclado/toque reais e revisar acessibilidade das demais páginas. |
| U06, parcial | Página inicial descreve configuração encontrada e 30 tipos. Checklist completo de prontidão continua pendente. |
| O03 | Incluídos testes funcionais, SQL real isolado, setup.html, fluxos do editor em DOM e pipeline de testes no GitHub Actions. A aprovação automatizada não substitui testes visuais e de Auth/REST no ambiente real. |
| O05, parcial | Migração numerada e registro de versão; bootstrap por UUID separado. A documentação legada e os scripts de manutenção de dados ainda precisam de revisão. |

## Ainda não concluído

- F10 recebeu implementação: edição do registro original em aba separada e PATCH com versão. Falta validação manual com conta real.
- U01/U02/U04/U05/U07 receberam melhorias de barra de ações, desfazer/refazer, catálogo por finalidade e alternância Editar/Prévia. Validação visual e responsividade em dispositivos reais permanecem pendentes.
- O01/O02/O06: paginação/resumos das demais listagens, backup de dados e restauração ensaiada e política completa de imagens/compartilhamento.
- O04, parcial: prévia e impressão ativas do editor já usam print.html; ainda falta remover o renderizador legado sem uso e reduzir duplicações remanescentes.
- Partes pendentes dos itens indicados como parciais na tabela.

## Aplicação no Supabase e validação

O usuário informou a execução dos scripts no Supabase. Seguir [o guia das migrações](../migrations/README.md) para conferir vínculos legados, configuração de confirmação de e-mail/SMTP e os cinco perfis. Esses testes no ambiente real ainda não foram confirmados. Ambas as migrações estão incorporadas ao `setup_supabase.sql` para novas instalações.

Abrir `http://127.0.0.1:8000/` com o servidor local em execução. Priorizar: primeira prova pela página inicial, edição/retorno, interrupção de rede, duas abas da mesma prova, impressão com número oculto, busca de questão antiga e recuperação de acesso.

Não houve inspeção visual pelo agente: o inventário de ferramentas retornou nenhum navegador disponível. O agente não enviou e-mails de teste nem alterou o Supabase real; os scripts foram executados manualmente pelo usuário, conforme seu relato.
