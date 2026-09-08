/* Dados de questoes podem vir de outras contas pelo banco compartilhado. */
(function (root) {
  const numericFields = new Set(['lines', 'answerLines', 'columns', 'gridSize', 'answerBoxes', 'width', 'height', 'offsetY', 'x', 'y', 'imageWidth', 'imageHeight', 'order']);
  const enums = {
    imageSize: ['small', 'medium', 'large', 'full'], imageAlign: ['left', 'center', 'right'],
    size: ['small', 'medium', 'large', 'full'], align: ['left', 'center', 'right'],
  };
  function normalizeQuestion(input) {
    function clean(value, key = '', depth = 0) {
      if (depth > 12) throw new Error('Questão com estrutura muito complexa.');
      if (numericFields.has(key)) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(-2000, Math.min(2000, number)) : 3;
      }
      if (enums[key]) return enums[key].includes(value) ? value : enums[key][0];
      if (Array.isArray(value)) return value.map(item => clean(item, '', depth + 1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([name]) => !['__proto__', 'constructor', 'prototype'].includes(name))
        .map(([name, item]) => [name, clean(item, name, depth + 1)]));
      return value;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Questão inválida.');
    const question = clean(input);
    question.text = String(question.text || '');
    if (question.type === 'producao_textual') { question.type = 'discursiva'; question.titlePrompt = question.titlePrompt !== false; }
    return question;
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
  const api = { normalizeQuestion, buildWordSearch, wordSearchProblems };
  root.ExamSafety = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
