// Diagnostico historico do editor em 3cf5d23; nao e teste de regressao das correcoes.
// Somente dados ficticios e funcoes em VM; nao acessa rede nem contas reais.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../editor.html'), 'utf8').replace(/\r\n/g, '\n');
const safety = require('../js/exam-safety.js');
function load(names, context) {
  vm.createContext(context);
  for (const name of names) {
    const start = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert(start, name);
    const rest = source.slice(start.index);
    const end = /^    }\s*$/m.exec(rest);
    assert(end, name);
    vm.runInContext(rest.slice(0, end.index + end[0].length), context);
  }
  return context;
}
(async () => {
  // Marcador inerte: prova quebra do atributo, sem executar JavaScript injetado.
  for (const [type, field] of [['ditado', 'wordCount'], ['problema_matematico', 'calcLines']]) {
    const q = safety.normalizeQuestion({ type, text: 'Teste', [field]: '1" data-audit-marker="injetado' });
    const template = source.match(new RegExp('<input[^>]+data-k="' + field + '"[^>]+>'))[0];
    const html = vm.runInNewContext('`' + template + '`', { q });
    assert(html.includes('data-audit-marker="injetado'));
    console.log('CONFIRMADO HTML: atributo adicional preservado em', field);
  }
  for (const imageAlign of ['lado_esquerda', 'lado_direita']) {
    const clean = safety.normalizeQuestion({ type: 'imagem', imageAlign });
    assert.equal(clean.imageAlign, 'left');
    console.log('CONFIRMADO alinhamento:', imageAlign, 'vira', clean.imageAlign, 'ao normalizar');
  }
  const profile = load(['normalizeClassList', 'isPlaceholderDiscipline', 'normalizeDisciplineList', 'applyProfileDefaults'], {
    auth: { getCurrentUser: () => ({ id: 'usuario-ficticio' }), authenticatedRequest: async () => [
      { full_name: 'Professor', school_grade: '6A', disciplines: [], school_id: null }
    ] },
    state: { school: { className: '5A', teacher: 'Autor original', schoolName: 'Escola original', subject: 'Matematica' } },
    defaultSchool: { className: '', teacher: '', schoolName: '' },
    PLACEHOLDER_DISCIPLINES: new Set(), STANDARD_DISCIPLINES: ['Matematica'],
    el: () => ({ innerHTML: '' }), esc: String, applyStateToInputs() {}, renderAll() {},
  });
  await profile.applyProfileDefaults();
  assert.equal(profile.state.school.className, '6A');
  console.log('CONFIRMADO turma: prova salva em 5A muda para 6A ao aplicar perfil');

  const bank = load(['editBankQuestion'], {
    window: { currentQuestionBankResults: [{ id: 'registro-original', user_id: 'autor', question: { type: 'discursiva', text: 'Original' } }] },
    auth: { getCurrentUser: () => ({ id: 'autor' }) },
    state: { questions: [] }, cloneQuestion: safety.normalizeQuestion, renderAll() {}, closeQuestionBankModal() {}, showToast() {},
  });
  bank.editBankQuestion(0);
  assert.equal(bank.state.questions.length, 1);
  assert.equal(bank.state.questions[0].id, undefined);
  console.log('CONFIRMADO banco: Alterar insere questao na prova sem vinculo ao registro original');

  let removeHandler;
  const imageNode = { dataset: { questionIndex: '0', imageIndex: '0' } };
  const removeButton = { addEventListener: (_, fn) => { removeHandler = fn; }, closest: () => imageNode };
  const locked = load(['initFreeImageInteractions', 'flushAutoSaveBeforeAction'], {
    document: { querySelectorAll: selector => selector === '.free-image-remove' ? [removeButton] : [] },
    state: { questions: [{ freeImages: [{ dataUrl: 'imagem-ficticia' }] }] },
    currentReviewStatus: 'aprovada', autoSaveReady: true, currentExamId: 'prova-ficticia',
    auth: { isAuthenticated: () => true }, autoSaveTimer: null, clearTimeout() {}, renderAll() {},
  });
  locked.initFreeImageInteractions();
  removeHandler({ stopPropagation() {} });
  assert.equal(locked.state.questions[0].freeImages.length, 0);
  assert.equal(await locked.flushAutoSaveBeforeAction(), true);
  console.log('CONFIRMADO bloqueio: imagem removida localmente em prova aprovada; fluxo permite imprimir');

  const limitedButton = { id: '', disabled: true };
  const controls = load(['applyReviewLock'], {
    currentReviewStatus: 'rascunho', currentReviewNotes: '', showToast() {},
    document: { getElementById: () => null, querySelectorAll: selector => selector.startsWith('.card.no-print') ? [limitedButton] : [] },
  });
  controls.applyReviewLock();
  assert.equal(limitedButton.disabled, false);
  console.log('CONFIRMADO controles: applyReviewLock reabilita botao desabilitado por limite de alternativas');

  const answer = load(['gerarGabaritoQuestao'], {});
  const result = answer.gerarGabaritoQuestao({ type: 'matematica_coluna', operations: [{ num1: '1.000', num2: '2', op: '+' }] }, 1);
  assert.equal(result.ans, '1. 3');
  console.log('CONFIRMADO gabarito: 1.000 + 2 resulta em', result.ans, '(esperado em notacao brasileira: 1.002)');

  const menu = source.match(/<select id="qtypeSelect">([\s\S]*?)<\/select>/)[1];
  const options = [...menu.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  assert.equal(options.length, 12);
  assert(!options.includes('texto_base'));
  console.log('CONFIRMADO menu: 12 entradas; texto_base nao tem entrada direta');

  console.log('Diagnostico concluido. Nenhum dado real foi lido ou alterado.');
})().catch(error => { console.error(error); process.exitCode = 1; });
