# Correções da auditoria

Atualizado em 08/09/2026. Primeiro lote publicado em `main`, commit [`a518f8c`](https://github.com/barjones1991-ops/gerador-de-provas/commit/a518f8c46f075815a5d452e11bec727455ef2671), por autorização do usuário. [Testes no GitHub](https://github.com/barjones1991-ops/gerador-de-provas/actions/runs/34234772887) e [publicação no Pages](https://github.com/barjones1991-ops/gerador-de-provas/actions/runs/34234771238) concluídos com sucesso.

Segundo lote: S08 implementado e coberto pelos testes SQL. Em 08/09/2026, o usuário informou que executou os scripts no Supabase e autorizou a publicação de todas as alterações. A aplicação foi informada pelo usuário, sem verificação administrativa independente pelo agente; validação visual e testes com contas reais permanecem sem confirmação.

A análise original descreve o commit `517933c`. Seus scripts de reprodução e resultados são evidência histórica e podem deixar de reproduzir os erros depois das correções. A verificação atual é `npm test`.

## Implementado e testado localmente

| Achado | Correção / limite |
| --- | --- |
| S01 | Retorno do login limitado a páginas conhecidas, preservando a subpasta. Casos de protocolos executáveis, endereços externos e controles recusados. |
| S02, parcial | Devolutiva usa apenas texto; questões recebidas normalizam campos numéricos e alguns enums. Ainda falta um schema completo para os 30 tipos e revisão de todos os pontos de HTML. |
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
| F07, parcial | PDF respeita numeração oculta, gabarito e alguns campos de resposta; BNCC deixa de aparecer no documento limpo. Falta comparação visual completa dos 30 tipos. |
| F08 | Geração compartilhada não corta palavras; aumenta a grade até o limite e informa palavras sem posição. Impressão pelo botão é impedida quando o caça-palavras é inválido. |
| F09 | Setup gera window.CONFIG, recusa 401 e exibe código como texto. O teste novo também encontrou e eliminou um fechamento de script dentro de template e uma variável fora de escopo. |
| U03, parcial | Contraste e anúncio de status do salvamento corrigidos. Modais, labels e navegação por teclado ainda exigem trabalho. |
| U06, parcial | Página inicial descreve configuração encontrada e 30 tipos. Checklist completo de prontidão continua pendente. |
| O03 | Incluídos testes funcionais, SQL real isolado, setup.html e pipeline de testes no GitHub Actions. Primeiro lote aprovado no GitHub; segundo lote verificado localmente. |
| O05, parcial | Migração numerada e registro de versão; bootstrap por UUID separado. A documentação legada e os scripts de manutenção de dados ainda precisam de revisão. |

## Ainda não concluído

- F10: edição do registro original do banco de questões, separada da prova aberta.
- U01/U02/U04/U05/U07: barra de ações, desfazer/refazer, identidade visual, modelos/tipos guiados e responsividade real.
- O01/O02/O04/O06: paginação/resumos das demais listagens, backup de dados e restauração ensaiada, renderizador unificado e política completa de imagens/compartilhamento.
- Partes pendentes dos itens indicados como parciais na tabela.

## Aplicação no Supabase e validação

O usuário informou a execução dos scripts no Supabase. Seguir [o guia das migrações](../migrations/README.md) para conferir vínculos legados, configuração de confirmação de e-mail/SMTP e os cinco perfis. Esses testes no ambiente real ainda não foram confirmados. Ambas as migrações estão incorporadas ao `setup_supabase.sql` para novas instalações.

Abrir `http://127.0.0.1:8000/` com o servidor local em execução. Priorizar: primeira prova pela página inicial, edição/retorno, interrupção de rede, duas abas da mesma prova, impressão com número oculto, busca de questão antiga e recuperação de acesso.

Não houve inspeção visual pelo agente: o inventário de ferramentas retornou nenhum navegador disponível. O agente não enviou e-mails de teste nem alterou o Supabase real; os scripts foram executados manualmente pelo usuário, conforme seu relato.
