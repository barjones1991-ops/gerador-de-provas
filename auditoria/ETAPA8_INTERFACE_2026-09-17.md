# Etapa 8 — Textos, rótulos e resumos

Correções locais: instrução do caça-palavras com acento correto; remoção de pista da cruzadinha com texto Remover; nomes acessíveis por questão e pista para pista/resposta/remoção; V/F identifica questão, afirmação e valor; zoom da prévia possui nome próprio.

O fallback de campos sem rótulo usa título, placeholder, alternativa, rótulo envolvente ou finalidade do campo, sem o antigo Campo N e sem índice global de formulário. Rótulos explícitos existentes são preservados. Este lote não substitui uma auditoria completa com leitor de tela.

Resumo no cabeçalho atualizado com texto e tooltip atuais durante edição, sem recriar campos. Texto é aplicado como textContent, inclusive quando contém HTML, e enunciado vazio tem mensagem padrão. Também atualiza ao sincronizar a prévia.

Testes: tests/interface-regressions.cjs verifica texto corrigido, quatro controles V/F, ação real de V/F, remoção e renumeração de pistas, zoom, texto do resumo durante input, campo preservado, HTML como texto e enunciado vazio. Suíte principal impede retorno dos caracteres defeituosos conhecidos.

Sem alterações de dados, Supabase, permissões ou migrações. Sem publicação. Conferência visual e leitor de tela reais pendentes. Local: http://127.0.0.1:8000/dashboard.html (Ctrl+F5).
