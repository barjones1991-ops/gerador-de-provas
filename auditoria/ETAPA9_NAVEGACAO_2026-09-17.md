# Etapa 9 — Navegação da prévia

Seletor Ir à questão junto à prévia, com enunciados abreviados e botões Anterior/Próxima. A seleção abre a visualização e rola até a questão; foco e contorno azul ajudam a localizar o destino. O contorno existe somente na tela da prévia incorporada e não imprime.

A posição da questão independe de hideNumber. Lista acompanha edição e exclusão, limita a seleção à lista atual e desabilita navegação vazia ou além das extremidades. Se o iframe ainda não carregou, guarda o último destino e o envia depois do conteúdo, quando recebe exam-preview-ready. Mensagem de foco passa pela verificação existente de origem e janela pai; índices inválidos são ignorados.

Sem mudança em prova salva, banco, schema, RLS ou Auth. Sem publicação.

Testes em tests/preview-navigation-regressions.cjs: seletor, próxima/anterior, limites, lista vazia, exclusão, espera do carregamento, ordem das mensagens, questão com número oculto e foco no renderer real em DOM isolado. A suíte principal verifica que a mensagem permanece após a proteção de origem/janela. Rolagem visual real ainda pendente.

Local: http://127.0.0.1:8000/dashboard.html, Ctrl+F5. Abrir prova com várias questões e usar Ir à questão acima da prévia.

Próximos achados de usabilidade ainda pendentes: upload em lote e manipulação dos marcadores de imagem.
