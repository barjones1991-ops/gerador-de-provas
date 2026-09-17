# Etapa 2 — Cálculo automático das operações

Implementação local em 17/09/2026. Publicação pendente de validação do usuário.

## Comportamento

- Operações com `result` vazio usam o cálculo compartilhado de `ExamSafety.operationAnswer`, sem gravar um resultado automático que possa ficar desatualizado.
- Editar qualquer número ou trocar o operador atualiza o resultado apresentado no editor e na prévia.
- O campo é identificado como resposta manual opcional. Respostas preenchidas são preservadas, inclusive em provas antigas, pois o formato legado não distingue edição manual de resultado automático antigo.
- Um aviso identifica respostas salvas/manuais divergentes. O botão Usar cálculo automático limpa somente a resposta daquela operação e retoma o cálculo.
- A conferência também sinaliza números inválidos e divisão por zero, mesmo com resposta manual preenchida.
- Novos rótulos acessíveis identificam operandos, operador, resposta manual e ação de retorno ao automático.

## Compatibilidade e Supabase

Nenhuma mudança em tabelas, SQL, RLS, Auth ou formato do JSON. Mantém `num1`, `op`, `num2` e `result`. Resultado vazio já era interpretado como automático pelo gerador de gabarito. Respostas antigas não são alteradas apenas por carregar a prova. Não há migração SQL a executar.

A correção não altera automaticamente as respostas antigas da prova de teste publicada. Ao abri-la localmente, a questão 21 deve mostrar divergências e oferecer retorno ao automático.

## Testes

`npm test` aprovado, incluindo `tests/operations-regressions.cjs`.

Cobertura nova: reprodução de 234 + 567 para 2 + 3; edição dos dois operandos; troca dos quatro operadores; vírgula decimal; separador de milhar; negativos; divisão periódica; vazio e texto inválido; divisão por zero; preservação e reabertura de resposta manual; equivalência 5/5,0; retorno ao automático; payload salvo e gerador real do gabarito.

Perfil: professor. Ambiente técnico: DOM isolado e Supabase simulado nos testes. A suíte SQL usa PGlite isolado.

## Conferência manual

Servidor local: http://127.0.0.1:8000/dashboard.html

O navegador local abriu na página de login. É necessário entrar nessa origem para a conferência com conta real; a sessão do site publicado não é compartilhada automaticamente.

1. Abrir a prova de teste dos 30 tipos e expandir a questão 21.
2. Conferir os avisos das respostas antigas.
3. Clicar em Usar cálculo automático e verificar 5, 3, 4 e 3 para as quatro contas.
4. Alterar os números e o operador, conferindo a atualização imediata e o gabarito.
5. Testar uma resposta manual, alterar a conta e conferir o aviso.
6. Salvar/reabrir e conferir a persistência.

## Pendências fora desta etapa

A etapa 3 ainda precisa corrigir omissões no gabarito da discursiva, sequência de imagens, legenda, associação entre imagens e expressão matemática. As demais melhorias da conferência permanecem na etapa 4.