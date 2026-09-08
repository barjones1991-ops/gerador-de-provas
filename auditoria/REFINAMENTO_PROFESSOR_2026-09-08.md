# Refinamento do fluxo do professor

Escopo autorizado: reorganizar funções existentes, sem novos módulos ou tipos de questão.

- Envio e reenvio para coordenação disponíveis no editor, depois do salvamento confirmado e conferência da pontuação. Falha de envio conserva o estado anterior.
- Professor visualiza a prévia; botões de impressão ficam ocultos e acesso direto à página de impressão redireciona para consulta. Isso organiza o fluxo do aplicativo, não impede recursos nativos de captura/impressão do navegador.
- Provas enviadas/em revisão ficam em consulta para o professor. A devolução permite editar novamente. A migração 03 protege edição e exclusão no servidor.
- Devolutiva permanece em painel separado durante a correção; salvar não apaga a orientação nem muda automaticamente o estado devolvido.
- Painel mantém o envio visível, desabilitado e explicado quando faltam questões ou há divergência de pontuação.
- Textos padronizados para coordenação, prévia e aprovação. Dados gerais recolhíveis, conteúdo/respostas antes da pontuação e habilidade em seção recolhível.
- Preservação de foco e seleção ao reconstruir campos; navegação pelas questões continua disponível em consulta.

## Validação e entrega

Continuidade após aplicação da migração 03 informada pelo usuário: corrigidos retorno do login para edição do banco/prévia, mensagem de salvamento em modo de consulta e exclusão sem confirmação de linha removida. A confirmação de desbloqueio explica que a prova volta à revisão e precisa de devolução para edição pelo professor. Incluídos testes de login/retorno, mensagem de consulta e exclusão com resposta vazia/sucesso. Nenhum SQL adicional nesta continuidade.

Testes automatizados abrangem envio, falha, bloqueio durante revisão, manutenção da devolutiva e reenvio; SQL isolado cobre o ciclo professor/coordenação e reaplicação da migração. Conferência visual em navegador e Auth/REST real ainda pendentes.

`npm test` aprovado: suíte geral, 15 regressões funcionais, 39 verificações SQL e 16 fluxos do editor em DOM isolado. Servidor HTTP local verificado pela suíte.

Migração necessária: `migrations/20260908_03_fluxo_professor.sql`, após 01/02. Executada no Supabase conforme relato do usuário em 08/09/2026, sem verificação administrativa independente pelo agente. Publicação deste lote autorizada pelo usuário em 08/09/2026.

Conferência manual: abrir http://127.0.0.1:8000/dashboard.html com professor, editar/conferir/enviar; devolver pela coordenação; corrigir/reabrir e reenviar; aprovar e encaminhar à impressão pela coordenação. Conferir também tela estreita, Tab e mensagens de salvamento/erro.
