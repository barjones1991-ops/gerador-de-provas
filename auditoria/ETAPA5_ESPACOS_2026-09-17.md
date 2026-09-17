# Etapa 5 — Espaços de escrita e desenho

Implementação local, sem publicação e sem alteração de formato persistido ou Supabase.

Editor e impressão usam o mesmo renderAnswerSpace: linhas pautadas, caixa para escrita/desenho e branco com altura equivalente (24 px por linha, aproximadamente 6 mm em escala 100%). O intervalo é 1–40, sem o antigo corte em 15 ou mínimo de duas linhas. Quantidades fracionárias são arredondadas.

Controles de formato, limites e rótulos uniformes nos sete formatos abertos: discursiva, imagem, interpretação, texto-base, problema, tabela e comparação. Interpretação aplica a altura por pergunta. Tabela ganha seletor do formato já persistido em answerStyle. Operações por dígitos conservam seus controles próprios.

Ocultar espaço também funciona no problema matemático impresso, inclusive cálculo, e no espaço livre. Interpretação e espaço livre passam a oferecer a caixa de seleção. Espaço livre mantém altura de 60–600 px e quatro bordas existentes. Nenhum gabarito é exigido em atividades abertas.

Validação automatizada: tests/answer-space-regressions.cjs executa o renderer real, verifica sete tipos, três formatos, 1/5/20/40 linhas, ocultação, cálculo, perguntas de interpretação, bordas e edição/salvamento/reabertura em DOM e REST simulados. tests/run-tests.js inclui regressão do corte em 15 linhas. Conferência visual e paginação real com conta do usuário ainda pendentes.

Local: http://127.0.0.1:8000/dashboard.html. Atualizar com Ctrl+F5, comparar 1 e 20 linhas, alternar caixa/branco, ocultar espaço e conferir a prévia.

Achados fora do escopo registrados em CLAUDE.md: alternativas de tabela não são renderizadas; ocultação do espaço em texto-base pode ocultar alternativas. Próximo lote deve corrigir respostas mistas.
