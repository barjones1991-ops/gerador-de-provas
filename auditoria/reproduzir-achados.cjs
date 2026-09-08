// Reproducoes locais da auditoria. Nao acessa rede nem altera dados do programa.
// Execute: node auditoria/reproduzir-achados.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const editor = read('editor.html');
const login = read('login.html');
const results = [];

function extract(source, name) {
  const start = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
  assert(start, 'Funcao nao encontrada: ' + name);
  const rest = source.slice(start.index);
  const end = /^    }\s*$/m.exec(rest);
  assert(end, 'Final nao encontrado: ' + name);
  return rest.slice(0, end.index + end[0].length);
}
function run(source, names, context) {
  vm.createContext(context);
  vm.runInContext(names.map(name => extract(source, name)).join('\n'), context);
  return context;
}
function record(name, evidence) { results.push({ name, evidence }); }
function editorContext(request) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', innerHTML: '', disabled: false,
      classList: { add() {}, remove() {} },
    });
    return nodes.get(id);
  };
  const context = {
    auth: { authenticatedRequest: request, isAuthenticated: () => true, getCurrentUser: () => ({ id: 'usuario-ficticio' }) },
    document: { getElementById: node, querySelectorAll: () => [] },
    localStorage: { removeItem() {}, setItem() {} },
    state: { school: { examTitle: 'Estado inicial', totalValue: '10,0' }, questions: [], logoDataUrl: '' },
    defaultSchool: {}, currentExamId: 'prova-ficticia', currentExamOwnerId: null,
    currentReviewStatus: 'rascunho', currentReviewNotes: '', currentProfile: { role: 'coordinator' },
    autoSaveInFlight: false, autoSaveQueued: false, autoSaveReady: false,
    MAX_EXAM_IMAGE_BYTES: 8388608,
    imagePayloadBytes: () => 0, syncSchoolFromInputs() {},
    getReviewPayloadForSave: () => ({ review_status: 'rascunho' }),
    setAutoSaveStatus() {}, setAutoSaveHint(message) { context.lastHint = message; },
    showToast(message) { context.lastToast = message; },
    applyStateToInputs() {}, renderAll() {}, collapseAllQuestions() {},
    updatePrintPageLink() {}, scheduleAutoSave() {}, resetStateToDefault() {},
    node,
  };
  return run(editor, ['applyReviewLock', 'loadFromCloud', 'saveToCloud'], context);
}

(async () => {
  const redirect = run(login, ['getSafeReturnTo'], {
    URLSearchParams,
    window: { location: { search: '?return_to=' + encodeURIComponent('javascript:void(0)') } },
  });
  const accepted = redirect.getSafeReturnTo();
  assert.equal(accepted, 'javascript:void(0)');
  record('Retorno do login aceita protocolo javascript', accepted);

  // Marcacao inerte: demonstra interpretacao como HTML sem executar scripts.
  const marker = '<strong data-audit="review">MARCADOR</strong>';
  const html = editorContext(async () => [{
    user_id: 'usuario-ficticio', review_status: 'devolvida', review_notes: marker,
    review_history: [{ date: '2026-09-08' }], questions: [],
  }]);
  await html.loadFromCloud('prova-ficticia');
  assert(html.node('reviewInfo').innerHTML.includes(marker));
  record('Observacao chega sem escape ao innerHTML', html.node('reviewInfo').innerHTML);

  let patch;
  const failedLoad = editorContext(async (endpoint, options) => {
    if (!options) throw new Error('Falha de rede simulada');
    patch = { endpoint, payload: JSON.parse(options.body) };
    return '';
  });
  await failedLoad.loadFromCloud('prova-ficticia');
  // Mesma atribuicao feita por initCloud depois de loadFromCloud retornar.
  failedLoad.autoSaveReady = Boolean(failedLoad.currentExamId);
  assert(failedLoad.autoSaveReady);
  const saved = await failedLoad.saveToCloud({ auto: true });
  assert(saved);
  assert.equal(patch.payload.questions.length, 0);
  record('Falha de GET conserva ID e permite PATCH com estado inicial', patch);

  const noRows = editorContext(async () => '');
  assert.equal(await noRows.saveToCloud({ auto: true }), true);
  assert(noRows.lastHint.startsWith('Ultimo salvamento:'));
  record('PATCH vazio e tratado como salvamento confirmado', noRows.lastHint);

  const tooLarge = editorContext(async () => { throw new Error('Nao deveria enviar'); });
  tooLarge.imagePayloadBytes = () => 9 * 1024 * 1024;
  tooLarge.formatBytes = value => String(value);
  tooLarge.setAutoSaveStatus = saving => { if (saving) tooLarge.lastHint = 'Salvando alteracoes...'; };
  assert.equal(await tooLarge.saveToCloud({ auto: true }), false);
  assert.equal(tooLarge.lastHint, 'Salvando alteracoes...');
  record('Limite de tamanho deixa status permanente de salvando', tooLarge.lastHint);

  const words = run(editor, ['normalizePuzzleWord', 'buildWordSearch'], {});
  const word = 'RESPONSABILIDADE';
  const grid = words.buildWordSearch([word], 12);
  assert(word.length > grid.grid.length);
  assert.equal(grid.placements.length, 1);
  record('Caca-palavras declara palavra maior que a grade como posicionada', {
    word, length: word.length, grid: grid.grid.length, placement: grid.placements[0],
  });

  const printRoot = { innerHTML: '' };
  const printed = run(read('print.html'), ['esc', 'parsePtNumber', 'normalizeExam', 'renderExam'], {
    URLSearchParams, window: { location: { search: '' } },
    document: { getElementById: () => printRoot }, isSafeImageDataUrl: () => false,
    buildFreeImagesHtml: () => '', _buildHeaderHtml: () => '', renderQuestionPreview: () => '',
  });
  printed.renderExam({ questions: [{ type: 'discursiva', hideNumber: true, points: '0,0', text: 'Texto sem numero' }] });
  assert(printRoot.innerHTML.includes('Questão 1'));
  record('PDF limpo ignora hideNumber', 'hideNumber=true produz Questão 1');

  const bankNodes = new Map();
  const bankNode = id => {
    if (!bankNodes.has(id)) bankNodes.set(id, { value: '', innerHTML: '' });
    return bankNodes.get(id);
  };
  bankNode('bankSearch').value = 'questao antiga';
  const records = Array.from({ length: 31 }, (_, i) => ({ title: i === 30 ? 'questao antiga' : 'recente ' + i }));
  let bankEndpoint;
  const bank = run(editor, ['loadQuestionBank'], {
    window: {}, document: { getElementById: bankNode },
    auth: { isAuthenticated: () => true, authenticatedRequest: async endpoint => {
      bankEndpoint = endpoint;
      const limit = Number(new URL('https://example.invalid' + endpoint).searchParams.get('limit'));
      return records.slice(0, limit);
    } },
    renderQuestionBank(items) { bank.items = items; }, showToast() {},
  });
  await bank.loadQuestionBank();
  assert.equal(bank.items.length, 0);
  record('Busca do banco nao encontra item depois dos 30 primeiros', { total: records.length, returned: bank.items.length, endpoint: bankEndpoint });

  const setupSource = read('setup.html');
  const configTemplate = /const configContent = `([\s\S]*?)`;/m.exec(setupSource)[1];
  const setupContext = { window: {}, newDate: '' };
  vm.createContext(setupContext);
  vm.runInContext(configTemplate.replace(/\$\{[^}]*\}/g, 'valor-ficticio'), setupContext);
  assert.equal(setupContext.window.CONFIG, undefined);
  record('Configuracao gerada pelo setup nao expoe window.CONFIG', 'undefined');

  const { AuthManager } = require(path.join(root, 'js/auth.js'));
  const session = { access_token: 'token-ficticio-expirado', refresh_token: 'refresh-ficticio', expires_at: 1, user: { id: 'usuario-ficticio', email: 'audit@example.invalid' } };
  global.localStorage = { getItem: () => JSON.stringify(session), removeItem() {} };
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"message":"JWT expired"}' }; };
  const auth = new AuthManager({ API_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'ficticia' });
  assert(auth.isAuthenticated());
  await assert.rejects(() => auth.authenticatedRequest('/exams'), /JWT expired/);
  assert.equal(calls, 1);
  await auth.signOut();
  assert.equal(calls, 1);
  record('Token vencido e aceito localmente; sem refresh e sem logout remoto', { requestsIncludingLogout: calls });
  delete global.fetch;
  delete global.localStorage;

  function luminance(hex) {
    const values = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  }
  const ratio = (luminance('f0fdf4') + .05) / (luminance('4ade80') + .05);
  record('Contraste calculado do aviso de salvamento', { foreground: '#4ade80', background: '#f0fdf4', ratio: Number(ratio.toFixed(2)) });
  console.log(JSON.stringify({ executed: results.length, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
