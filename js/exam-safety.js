/* Dados de questoes podem vir de outras contas pelo banco compartilhado. */
(function (root) {
  const numericLimits = {
    lines: [1, 40], answerLines: [1, 40], calcLines: [1, 40], wordCount: [1, 40],
    columns: [1, 4], gridSize: [8, 18], answerBoxes: [1, 12], width: [40, 1400], height: [30, 1400],
    offsetY: [0, 500], x: [0, 100], y: [0, 100], imageWidth: [40, 1400], imageHeight: [30, 1400],
    order: [0, 500], crosswordSeed: [0, 10000], wordSearchSeed: [0, 2147483647],
  };
  const enums = {
    imageSize: ['small', 'medium', 'large', 'full'], imageAlign: ['left', 'center', 'right', 'lado_esquerda', 'lado_direita'],
    size: ['small', 'medium', 'large', 'full'], align: ['left', 'center', 'right', 'lado_esquerda', 'lado_direita'],
  };
  function mathExpressionToLatex(input) {
    const value = String(input ?? '').trim();
    if (!value) return '';
    if (/\\(?:frac|dfrac|tfrac|sqrt|times|div|pm|neq|leq|geq|left|right|cdot|overline|begin|text)\b/.test(value)) return value;
    let latex = value
      .replace(/(?:raiz|sqrt)\s*\(([^()]*)\)/gi, '\\sqrt{$1}')
      .replace(/√\s*\(([^()]*)\)/g, '\\sqrt{$1}')
      .replace(/√\s*([\dA-Za-z.,]+)/g, '\\sqrt{$1}')
      .replace(/\s+[xX]\s+/g, ' \\times ')
      .replace(/\s*×\s*/g, ' \\times ')
      .replace(/\s*÷\s*/g, ' \\div ')
      .replace(/\s*≤\s*/g, ' \\leq ')
      .replace(/\s*≥\s*/g, ' \\geq ')
      .replace(/\s*≠\s*/g, ' \\neq ')
      .replace(/\s*±\s*/g, ' \\pm ');
    latex = latex.replace(/(^|[\s(=+\-])([\dA-Za-z]+(?:[.,][\d]+)?)\s*\/\s*([\dA-Za-z]+(?:[.,][\d]+)?)(?=$|[\s)=+\-])/g, '$1\\frac{$2}{$3}');
    return latex.replace(/\s{2,}/g, ' ').trim();
  }
  function latexToMathExpression(input) {
    let value = String(input ?? '').trim();
    if (!value) return '';
    let previous;
    do {
      previous = value;
      value = value.replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
    } while (value !== previous);
    return value
      .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
      .replace(/\\times\b/g, '×')
      .replace(/\\div\b/g, '÷')
      .replace(/\\pm\b/g, '±')
      .replace(/\\neq\b/g, '≠')
      .replace(/\\leq\b/g, '≤')
      .replace(/\\geq\b/g, '≥')
      .replace(/\\left|\\right/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
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
      lacunas: ['items','answers'], relacione: ['pairs'], imagem: ['options','items','extraImages'], interpretacao_imagem: ['prompts'],
      relacione_imagens: ['pairs'], texto_base: ['options'], matematica_coluna: ['operations'], expressao_matematica: ['expressions'],
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
    if (question.correctOption != null) question.correctOption = String(question.correctOption).trim() && Number.isInteger(Number(question.correctOption)) ? Number(question.correctOption) : null;
    for (const key of ['text','points','bncc','expectedAnswer','wordList','wordsText','textBase','imageCaption','image1Caption','image2Caption']) {
      if (question[key] != null) question[key] = String(question[key]);
    }
    return question;
  }
  // Checks registered content, not pedagogical correctness. Never mutates a question.
  function inspectQuestionContent(q, raw, add) {
    const filled = value => String(value ?? '').trim().length > 0;
    const list = key => Array.isArray(q[key]) ? q[key] : [];
    const requireItems = (key, fields, label) => {
      const items = list(key);
      if (!items.length) add('Adicione ' + label + '.');
      items.forEach((item, i) => fields.forEach(([field, name]) => {
        if (!filled(field ? item?.[field] : item)) add(name + ' do item ' + (i + 1) + ': preencha o campo.');
      }));
    };
    const permutation = (order, size, start, label) => {
      if (!Array.isArray(order) || order.length !== size || new Set(order).size !== size ||
          order.some(n => !Number.isInteger(n) || n < start || n >= size + start))
        add(label + ': use cada número de ' + start + ' a ' + (size + start - 1) + ' uma única vez.', true);
    };
    if (q.type === 'vf') {
      requireItems('items', [['text','Texto']], 'afirmações');
      if (list('items').some(item => !['V','F'].includes(item.answer))) add('Complete o gabarito V/F.');
    }
    if (q.type === 'marcarx' && q.markMode === 'unica' && q.items.filter(item => item.checked).length > 1)
      add('Resposta única: marque somente uma alternativa.');
    if (q.type === 'imagem' && q.imageAnswerType === 'marcarx') {
      requireItems('items', [['text','Texto']], 'alternativas');
      if (!q.items.some(item => item.checked)) add('Marque a resposta correta.');
    }
    if (q.type === 'expressao_matematica') requireItems('expressions', [['latex','Expressão'],['answer','Resposta']], 'expressões');
    if (q.type === 'sequencia_numerica') requireItems('sequences', [['items','Sequência'],['answer','Resposta']], 'sequências');
    if (q.type === 'silabas') requireItems('words', [['word','Palavra'],['answer','Resposta']], 'palavras');
    if (q.type === 'leitura_escrita') requireItems('words', [['','Palavra']], 'palavras');
    if (q.type === 'legenda_imagens') requireItems('items', [['answer','Resposta']], 'itens');
    if (q.type === 'grade_imagens' && q.showAnswerLines !== false && list('items').some(item => !filled(item.answer)))
      add('Há imagens sem resposta de referência; confira a correção manual.');
    if (q.type === 'identificar_imagem') {
      requireItems('markers', q.showAnswerList === false ? [] : [['answer','Resposta']], 'marcadores');
    }
    if (q.type === 'matematica_coluna' && !q.operations.length) add('Adicione pelo menos uma operação.');
    if (q.type === 'subitens') {
      if (!q.items.length) add('Adicione os subitens.');
      q.items.forEach((item,i) => { if (!filled(item.text) && !filled(item.imageDataUrl)) add('Subitem ' + (i+1) + ': adicione texto ou imagem.'); });
    }
    if (q.type === 'lacunas') {
      const items = list('items').length ? q.items : (q.text.includes('_') ? [{text:q.text,answer:q.answers?.[0]}] : []);
      if (!items.length) add('Adicione as frases com lacunas.');
      items.forEach((item,i) => {
        const text = typeof item === 'string' ? item : item.text;
        if (!filled(text) || !String(text).includes('_')) add('Item ' + (i+1) + ': indique a lacuna com sublinhados.');
        if (!filled(item.answer ?? q.answers?.[i])) add('Resposta do item ' + (i+1) + ': preencha o campo.');
      });
    }
    if (['ordenacao','sequencia_imagens'].includes(q.type)) {
      requireItems('items', q.type === 'ordenacao' ? [['text','Texto']] : [], 'itens para ordenar');
      if (q.items.length) permutation(raw.items.map(item => item.order), q.items.length, 1, 'Ordem dos itens');
    }
    if (['relacione','relacione_imagens'].includes(q.type)) {
      requireItems('pairs', q.type === 'relacione' ? [['left','Texto esquerdo'],['right','Texto direito']] : [['imageDataUrl','Imagem'],['word','Palavra']], 'pares');
      const key = q.type === 'relacione' ? 'rightOrder' : 'wordOrder';
      if (q[key] != null && list('pairs').length) permutation(q[key], q.pairs.length, 0, 'Correspondência dos pares');
    }
    if (['associacao_setas','associacao_imagem_imagem'].includes(q.type)) {
      const fields = q.type === 'associacao_setas' ? [['','Texto']] : [['imageDataUrl','Imagem']];
      requireItems('leftItems', fields, 'itens à esquerda');
      requireItems('rightItems', fields, 'itens à direita');
      if (q.leftItems.length !== q.rightItems.length) add('As duas colunas precisam ter a mesma quantidade de itens.', true);
      if (q.rightOrder != null && q.rightItems.length) permutation(q.rightOrder, q.leftItems.length, 0, 'Correspondência dos pares');
    }
    if (q.type === 'tabela') {
      if (!q.headers.length || !q.rows.length) add('Preencha cabeçalhos e linhas da tabela.');
      if (q.rows.some(row => row.length !== q.headers.length)) add('Confira a quantidade de células das linhas da tabela.', true);
    }
  }
  function markerPosition(value) {
    return Math.max(0,Math.min(100,Number.isFinite(Number(value)) ? Math.round(Number(value)) : 50));
  }
  function hasManualAnswer(question) {
    if (['discursiva','subitens','interpretacao_imagem','problema_matematico','espaco_livre','comparar_imagens'].includes(question.type)) return true;
    if (['texto_base','tabela'].includes(question.type)) return !question.answerType || question.answerType === 'discursiva';
    return question.type === 'imagem' && (!question.imageAnswerType || question.imageAnswerType === 'discursiva');
  }
  function manualAnswer(question) {
    return String(question.expectedAnswer ?? '').trim() || '(correção manual — resposta esperada não cadastrada)';
  }
  function choiceAnswer(question) {
    const index = question.correctOption;
    return Number.isInteger(index) && index >= 0 && index < (question.options || []).length
      ? String.fromCharCode(65 + index) : '(não marcado)';
  }
  function answerLineCount(value, fallback = 5) {
    const n = Number(value);
    return Math.max(1, Math.min(40, Math.round(Number.isFinite(n) && n > 0 ? n : fallback)));
  }
  function renderAnswerSpace(question) {
    if (question.showAnswerSpace === false) return '';
    const count = answerLineCount(question.lines);
    const style = ['linhas','caixa','espaco'].includes(question.answerStyle) ? question.answerStyle : 'linhas';
    if (style === 'linhas') return '<div class="answer-space answer-space-lines" style="margin-top:8px;">' +
      Array.from({length:count}, () => '<div class="hline" style="height:24px;box-sizing:border-box;"></div>').join('') + '</div>';
    return '<div class="answer-space answer-space-' + style + '" style="height:' + count * 24 +
      'px;box-sizing:border-box;margin-top:8px;' + (style === 'caixa' ? 'border:1px solid #94a3b8;border-radius:6px;' : '') + '"></div>';
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
        if (q.options.length < 2) add(index, 'Adicione pelo menos duas alternativas.');
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
      if (q.type === 'matematica_coluna') q.operations.forEach((op, i) => {
        const issue = operationIssue(op);
        if (issue) add(index, `Operação ${i + 1}: ${issue}`);
      });
      if (q.type === 'cruzadinha' && (!q.clues.length || q.clues.some(item => !item.answer || !item.clue))) add(index, 'Preencha pistas e respostas da cruzadinha.');
      inspectQuestionContent(q, raw, (message, blocking) => add(index, message, blocking));
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
  function operationIssue(op) {
    const calculated = operationAnswer({ ...op, result:'' });
    if (calculated.startsWith('?')) return 'Confira os números e a operação: ' + calculated.slice(2);
    const manual = String(op.result ?? '').trim();
    if (manual && manual !== calculated) {
      const a = parseBrazilianNumber(manual), b = parseBrazilianNumber(calculated);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a !== b)
        return 'Resposta salva/manual: ' + manual + '. Cálculo automático: ' + calculated + '. Confira ou use o cálculo automático.';
    }
    return '';
  }
  function buildWordSearch(words, size = 12, seed = 0) {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toUpperCase();
    const clean = [...new Set(words.map(normalize).filter(Boolean))];
    const gridSize = Math.floor(Math.min(18, Math.max(8, Number(size) || 12, ...clean.map(word => Math.min(18, word.length)))));
    const grid = Array.from({ length: gridSize }, () => Array(gridSize).fill(''));
    const placements = [], unplaced = [];
    const directions = [[0, 1], [1, 0], [1, 1]];
    let randomState = Math.max(0, Math.min(2147483647, Math.floor(Number(seed) || 0)));
    const shuffled = randomState > 0;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
    for (const word of [...clean].sort((a, b) => b.length - a.length)) {
      let found = null;
      const candidates = [];
      for (const [dr, dc] of directions) {
        for (let row = 0; row < gridSize; row++) for (let col = 0; col < gridSize; col++) {
          if (row + dr * (word.length - 1) >= gridSize || col + dc * (word.length - 1) >= gridSize) continue;
          candidates.push({row,col,dr,dc});
        }
      }
      if (shuffled) for (let i=candidates.length-1; i>0; i--) {
        const j=Math.floor(random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
      }
      found = candidates.find(({row,col,dr,dc}) => [...word].every((letter, i) => !grid[row + dr * i][col + dc * i] || grid[row + dr * i][col + dc * i] === letter));
      if (!found) { unplaced.push(word); continue; }
      [...word].forEach((letter, i) => { grid[found.row + found.dr * i][found.col + found.dc * i] = letter; });
      placements.push(`${word}: linha ${found.row + 1}, coluna ${found.col + 1}`);
    }
    grid.forEach((row, r) => row.forEach((letter, c) => { if (!letter) row[c] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[shuffled ? Math.floor(random()*26) : (r * 7 + c * 11) % 26]; }));
    return { grid, placements, unplaced };
  }
  function wordSearchProblems(questions) {
    return questions.flatMap((q, i) => {
      if (q.type !== 'caca_palavras') return [];
      const words = String(q.wordsText || q.wordList || '').split(/[\n,;]+/).map(word => word.trim()).filter(Boolean);
      const unplaced = buildWordSearch(words, q.gridSize || 12, q.wordSearchSeed || 0).unplaced;
      return !words.length ? [`Questão ${i + 1}: adicione palavras ao caça-palavras.`]
        : unplaced.length ? [`Questão ${i + 1}: não couberam na grade: ${unplaced.join(', ')}.`] : [];
    });
  }
  const api = { markerPosition, hasManualAnswer, manualAnswer, choiceAnswer, answerLineCount, renderAnswerSpace, normalizeQuestion, buildWordSearch, wordSearchProblems, parseBrazilianNumber, operationAnswer, operationIssue, mathExpressionToLatex, latexToMathExpression, inspectExam };
  root.ExamSafety = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
