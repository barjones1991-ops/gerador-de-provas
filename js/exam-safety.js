/* Dados de questoes podem vir de outras contas pelo banco compartilhado. */
(function (root) {
  const numericLimits = {
    lines: [1, 40], answerLines: [1, 40], calcLines: [1, 40], wordCount: [1, 40],
    columns: [1, 4], gridSize: [8, 18], answerBoxes: [1, 12], width: [40, 1400], height: [30, 1400],
    offsetY: [0, 500], x: [0, 100], y: [0, 100], imageWidth: [40, 1400], imageHeight: [30, 1400],
    order: [0, 500], crosswordSeed: [0, 10000],
  };
  const enums = {
    imageSize: ['small', 'medium', 'large', 'full'], imageAlign: ['left', 'center', 'right', 'lado_esquerda', 'lado_direita'],
    size: ['small', 'medium', 'large', 'full'], align: ['left', 'center', 'right', 'lado_esquerda', 'lado_direita'],
  };
  function normalizeQuestion(input) {
    function clean(value, key = '', depth = 0) {
      if (depth > 12) throw new Error('Questão com estrutura muito complexa.');
      if (numericLimits[key]) {
        const number = Number(value);
        const [min, max] = numericLimits[key];
        return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : Math.max(min, 3);
      }
      if (enums[key]) return enums[key].includes(value) ? value : enums[key][0];
      if (Array.isArray(value)) {
        if (value.length > 500) throw new Error('Questão com mais de 500 itens. Divida o conteúdo.');
        return value.map(item => clean(item, '', depth + 1));
      }
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([name]) => !['__proto__', 'constructor', 'prototype'].includes(name))
        .map(([name, item]) => [name, clean(item, name, depth + 1)]));
      return value;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Questão inválida.');
    const question = clean(input);
    question.text = String(question.text || '');
    if (question.type === 'producao_textual') { question.type = 'discursiva'; question.titlePrompt = question.titlePrompt !== false; }
    const collections = {
      multipla: ['options'], discursiva: [], vf: ['items'], marcarx: ['items'], subitens: ['items'],
      lacunas: [], relacione: [], imagem: ['options','items','extraImages'], interpretacao_imagem: ['prompts'],
      relacione_imagens: [], texto_base: ['options'], matematica_coluna: ['operations'], expressao_matematica: ['expressions'],
      ditado: [], ordenacao: ['items'], problema_matematico: [], espaco_livre: [], tabela: ['headers','rows','options'],
      associacao_setas: ['leftItems','rightItems'], sequencia_numerica: ['sequences'], leitura_escrita: ['words'], silabas: ['words'],
      sequencia_imagens: ['items'], comparar_imagens: [], legenda_imagens: ['items'], associacao_imagem_imagem: ['leftItems','rightItems'],
      grade_imagens: ['items'], identificar_imagem: ['markers'], caca_palavras: [], cruzadinha: ['clues'],
    };
    if (!Object.hasOwn(collections, question.type)) throw new Error('Tipo de questão não reconhecido.');
    for (const key of collections[question.type]) {
      if (question[key] != null && !Array.isArray(question[key])) throw new Error(`Formato inválido em ${key}.`);
      question[key] ??= [];
    }
    for (const key of ['freeImages','extraImages','options','pairs','items','rows','headers','words','clues','markers','operations','expressions','sequences','prompts','leftItems','rightItems']) {
      if (Array.isArray(question[key]) && question[key].some(item => item == null)) throw new Error(`Item vazio ou inválido em ${key}.`);
    }
    if (question.rows?.some(row => !Array.isArray(row))) throw new Error('Linha de tabela inválida.');
    if (question.correctOption != null) question.correctOption = Number.isInteger(Number(question.correctOption)) ? Number(question.correctOption) : null;
    for (const key of ['text','points','bncc','expectedAnswer','wordList','wordsText','textBase','imageCaption','image1Caption','image2Caption']) {
      if (question[key] != null) question[key] = String(question[key]);
    }
    return question;
  }
  function inspectExam(rawExam) {
    const school = rawExam.school || {};
    const questions = Array.isArray(rawExam.questions) ? rawExam.questions : [];
    const issues = [];
    const add = (index, message, blocking = false) => issues.push({ index, message: index >= 0 ? `Questão ${index + 1}: ${message}` : message, blocking });
    if (!questions.length) add(-1, 'Adicione pelo menos uma questão.', true);
    if (!String(school.examTitle ?? rawExam.title ?? '').trim()) add(-1, 'Informe o título da avaliação.');
    if (!String(school.subject ?? rawExam.subject ?? '').trim()) add(-1, 'Confira a disciplina.');
    if (!String(school.className ?? rawExam.class_name ?? '').trim()) add(-1, 'Confira a turma.');
    let sum = 0;
    questions.forEach((raw, index) => {
      let q; try { q = normalizeQuestion(raw); } catch (error) { add(index, error.message, true); return; }
      if (!q.text.trim()) add(index, 'Escreva o enunciado.');
      const score = parseBrazilianNumber(q.points);
      if (!Number.isFinite(score) || score < 0) add(index, 'Valor inválido. Use números como 1,5.', true); else sum += score;
      const choices = q.type === 'multipla' || ['texto_base','tabela'].includes(q.type) && q.answerType === 'multipla' || q.type === 'imagem' && q.imageAnswerType === 'multipla';
      if (choices) {
        if (!q.options?.length || q.options.some(option => !String(option).trim())) add(index, 'Preencha as alternativas.');
        if (!Number.isInteger(q.correctOption) || q.correctOption < 0 || q.correctOption >= q.options.length) add(index, 'Marque a alternativa correta.');
      }
      if (q.type === 'marcarx') {
        if (!q.items.length || q.items.some(item => !String(item.text ?? item).trim())) add(index, 'Preencha os itens.');
        if (q.markMode === 'vf' && q.items.some(item => !['V','F'].includes(item.answer))) add(index, 'Complete o gabarito V/F.');
        if (!['vf','checklist'].includes(q.markMode) && !q.items.some(item => item.checked)) add(index, 'Marque a resposta correta.');
      }
      if (q.type === 'texto_base' && !String(q.textBase || '').trim()) add(index, 'Adicione o texto de apoio.');
      if (['imagem','interpretacao_imagem','identificar_imagem'].includes(q.type) && !q.imageDataUrl) add(index, 'Adicione a imagem.');
      if (q.type === 'comparar_imagens' && (!q.image1DataUrl || !q.image2DataUrl)) add(index, 'Adicione as duas imagens.');
      if (['grade_imagens','sequencia_imagens','legenda_imagens'].includes(q.type) && (!q.items.length || q.items.some(item => !item.imageDataUrl))) add(index, 'Complete as imagens dos itens.');
      if (q.type === 'matematica_coluna' && q.operations.some(op => operationAnswer(op).startsWith('?'))) add(index, 'Confira os números e as operações do gabarito.');
      if (q.type === 'cruzadinha' && (!q.clues.length || q.clues.some(item => !item.answer || !item.clue))) add(index, 'Preencha pistas e respostas da cruzadinha.');
      if (q.type === 'caca_palavras') wordSearchProblems([q]).forEach(message => add(index, message.replace(/^Questão 1: /, ''), true));
    });
    const total = parseBrazilianNumber(school.totalValue ?? rawExam.total_value);
    if (!Number.isFinite(total) || total < 0) add(-1, 'Informe um valor total válido.', true);
    else if (Math.abs(sum - total) >= 0.05) add(-1, `A soma das questões (${sum.toLocaleString('pt-BR')}) difere do valor total (${total.toLocaleString('pt-BR')}).`);
    return issues;
  }
  // Texto digitado usa convencao brasileira. Numeros JSON continuam numericos.
  function parseBrazilianNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const text = String(value ?? '').trim();
    if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)) return NaN;
    return Number(text.replace(/\./g, '').replace(',', '.'));
  }
  function operationAnswer(op) {
    if (String(op.result ?? '').trim()) return String(op.result).trim();
    const a = parseBrazilianNumber(op.num1 ?? op.expression), b = parseBrazilianNumber(op.num2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '? (verifique os números)';
    const symbol = op.op || '+';
    const result = symbol === '+' ? a + b : symbol === '-' ? a - b
      : ['×', 'x', '*'].includes(symbol) ? a * b : ['÷', '/'].includes(symbol) && b !== 0 ? a / b : NaN;
    if (!Number.isFinite(result)) return '? (operação inválida)';
    const rounded = Math.round((result + Number.EPSILON) * 1000000) / 1000000;
    const approximate = Math.abs(result - rounded) > 1e-10;
    return (approximate ? '≈ ' : '') + rounded.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
  }
  function buildWordSearch(words, size = 12) {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toUpperCase();
    const clean = [...new Set(words.map(normalize).filter(Boolean))];
    const gridSize = Math.floor(Math.min(18, Math.max(8, Number(size) || 12, ...clean.map(word => Math.min(18, word.length)))));
    const grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(''));
    const placements = [], unplaced = [];
    const directions = [[0, 1], [1, 0], [1, 1]];
    for (const word of [...clean].sort((a, b) => b.length - a.length)) {
      let found = null;
      for (const [dr, dc] of directions) {
        for (let row = 0; row < gridSize && !found; row++) for (let col = 0; col < gridSize && !found; col++) {
          if (row + dr * (word.length - 1) >= gridSize || col + dc * (word.length - 1) >= gridSize) continue;
          if ([...word].every((letter, i) => !grid[row + dr * i][col + dc * i] || grid[row + dr * i][col + dc * i] === letter)) found = { row, col, dr, dc };
        }
        if (found) break;
      }
      if (!found) { unplaced.push(word); continue; }
      [...word].forEach((letter, i) => { grid[found.row + found.dr * i][found.col + found.dc * i] = letter; });
      placements.push(`${word}: linha ${found.row + 1}, coluna ${found.col + 1}`);
    }
    grid.forEach((row, r) => row.forEach((letter, c) => { if (!letter) row[c] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[(r * 7 + c * 11) % 26]; }));
    return { grid, placements, unplaced };
  }
  function wordSearchProblems(questions) {
    return questions.flatMap((q, i) => {
      if (q.type !== 'caca_palavras') return [];
      const words = String(q.wordsText || q.wordList || '').split(/[\n,;]+/).map(word => word.trim()).filter(Boolean);
      const unplaced = buildWordSearch(words, q.gridSize || 12).unplaced;
      return !words.length ? [`Questão ${i + 1}: adicione palavras ao caça-palavras.`]
        : unplaced.length ? [`Questão ${i + 1}: não couberam na grade: ${unplaced.join(', ')}.`] : [];
    });
  }
  const api = { normalizeQuestion, buildWordSearch, wordSearchProblems, parseBrazilianNumber, operationAnswer, inspectExam };
  root.ExamSafety = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
