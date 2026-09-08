const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ExamSafety = require('../js/exam-safety.js');
const { AuthManager } = require('../js/auth.js');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
let checks = 0;
function functions(source, names, context) {
  const code = names.map(name => {
    const start = new RegExp('^    (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert(start, name);
    const rest = source.slice(start.index);
    const end = /^    }\s*$/m.exec(rest);
    assert(end, name);
    return rest.slice(0, end.index + end[0].length);
  }).join('\n');
  vm.createContext(context); vm.runInContext(code, context); return context;
}
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function editor(request = async () => '') {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, disabled: false, classList: { add() {}, remove() {} } });
    return nodes.get(id);
  };
  const context = {
    ExamSafety, Blob, URL, setTimeout, clearTimeout,
    EditorTools: { loading:false, bankId:null, refreshActions() {}, lockControl(node, locked) { node.disabled = locked; } },
    document: { getElementById: node, querySelectorAll: () => [node('editorInput')] },
    auth: { isAuthenticated: () => true, getCurrentUser: () => ({ id: 'u1' }), authenticatedRequest: request },
    localStorage: storage(), state: { school: { examTitle: 'Original' }, questions: [], logoDataUrl: '' },
    currentExamId: 'e1', currentExamVersion: 'v1', editorUserId: 'u1', currentReviewStatus: 'rascunho',
    currentReviewNotes: '', currentExamOwnerId: 'u1', autoSaveReady: true, autoSaveInFlight: false,
    autoSaveQueued: false, pendingDraftAvailable: false, lastSavedFingerprint: '', defaultSchool: {},
    MAX_EXAM_IMAGE_BYTES: 8388608, imagePayloadBytes: () => 0, syncSchoolFromInputs() {},
    getReviewPayloadForSave: () => ({ review_status: 'rascunho' }),
    setAutoSaveStatus() {}, setAutoSaveHint(value) { node('lastSaved').textContent = value; },
    showToast(message) { context.lastToast = message; }, applyStateToInputs() {}, renderAll() {},
    collapseAllQuestions() {}, updatePrintPageLink() {}, scheduleAutoSave() { context.queued = true; },
    node,
  };
  functions(read('editor.html'), ['examFingerprint','pendingDraftKey','preservePendingDraft','setEditorLoading','applyReviewLock','loadFromCloud','saveToCloud'], context);
  context.lastSavedFingerprint = context.examFingerprint();
  return context;
}
async function test(name, task) { await task(); checks++; console.log('OK REG', name); }

(async () => {
  await test('destinos de login maliciosos recusados e subpasta preservada', () => {
    for (const value of ['javascript:void(0)', 'data:text/html,oi', '//outro.test', 'https://outro.test', '../editor.html', '\\outro.test', ' editor.html', 'editor.html\n', 'editor.html#x']) {
      const ctx = functions(read('login.html'), ['getSafeReturnTo'], { URL, URLSearchParams, window: { location: { href: 'https://example.invalid/app/login.html', search: '?return_to=' + encodeURIComponent(value) } } });
      assert.equal(ctx.getSafeReturnTo(), '', value);
    }
    const value = 'print.html?id=123&gabarito=1';
    const ctx = functions(read('login.html'), ['getSafeReturnTo'], { URL, URLSearchParams, window: { location: { href: 'https://example.invalid/app/login.html', search: '?return_to=' + encodeURIComponent(value) } } });
    assert.equal(ctx.getSafeReturnTo(), value);
  });
  await test('falha no GET bloqueia edicao e nao envia PATCH', async () => {
    let patches = 0;
    const ctx = editor(async (url, options) => { if (options) patches++; throw new Error('offline'); });
    assert.equal(await ctx.loadFromCloud('e1'), false);
    assert.equal(ctx.node('editorInput').disabled, true);
    ctx.state.school.examTitle = 'Mudanca';
    assert.equal(await ctx.saveToCloud({ auto: true }), false);
    assert.equal(patches, 0);
    ctx.autoSaveTimer = null;
    functions(read('editor.html'), ['flushAutoSaveBeforeAction'], ctx);
    assert.equal(await ctx.flushAutoSaveBeforeAction(), false);
    assert.equal(await ctx.flushAutoSaveBeforeAction({ navigation: true }), true);
  });
  await test('observacao HTML permanece texto e prova vazia substitui estado anterior', async () => {
    const marker = '<img src=x onerror="alert(1)">';
    const ctx = editor(async () => [{ id: 'e1', user_id: 'u1', updated_at: 'v2', review_status: 'devolvida', review_notes: marker, review_history: [{ date: '2026-09-08T12:00:00Z' }], questions: [] }]);
    ctx.state.questions = [{ text: 'Antiga' }];
    assert.equal(await ctx.loadFromCloud('e1'), true);
    assert(ctx.node('reviewInfo').textContent.includes(marker));
    assert.equal(ctx.node('reviewInfo').innerHTML, undefined);
    assert.equal(ctx.state.questions.length, 0);
  });
  await test('salvamento sem linha nao confirma sucesso e conserva rascunho', async () => {
    const ctx = editor(async () => []);
    ctx.state.school.examTitle = 'Conteudo novo';
    assert.equal(await ctx.saveToCloud({ auto: true }), false);
    assert.equal(ctx.autoSaveReady, false);
    assert(ctx.localStorage.getItem(ctx.pendingDraftKey()).includes('Conteudo novo'));
    assert(!ctx.node('lastSaved').textContent.startsWith('Ultimo'));
  });
  await test('salvamento verifica versao e limpa copia somente apos confirmacao', async () => {
    let sent;
    const ctx = editor(async (url, options) => { sent = { url, options }; return [{ id: 'e1', updated_at: 'v2' }]; });
    ctx.state.school.examTitle = 'Novo';
    assert.equal(await ctx.saveToCloud({ auto: true }), true);
    assert(sent.url.includes('updated_at=eq.v1'));
    assert.equal(sent.options.headers.Prefer, 'return=representation');
    assert.equal(ctx.currentExamVersion, 'v2');
    assert.equal(ctx.localStorage.getItem(ctx.pendingDraftKey()), null);
  });
  await test('edicao feita durante o envio permanece pendente na nova versao', async () => {
    let resolve;
    const ctx = editor(() => new Promise(done => { resolve = done; }));
    ctx.state.school.examTitle = 'Enviado';
    const save = ctx.saveToCloud({ auto: true });
    ctx.state.school.examTitle = 'Digitado durante envio';
    resolve([{ id: 'e1', updated_at: 'v2' }]); await save;
    const draft = JSON.parse(ctx.localStorage.getItem(ctx.pendingDraftKey()));
    assert.equal(draft.version, 'v2'); assert(draft.content.includes('Digitado durante envio')); assert(ctx.queued);
  });
  await test('troca de conta nao grava o conteudo do editor anterior', async () => {
    let calls = 0; const ctx = editor(async () => { calls++; });
    ctx.state.school.examTitle = 'Alterado'; ctx.auth.getCurrentUser = () => ({ id: 'outra-conta' });
    assert.equal(await ctx.saveToCloud({ auto: true }), false); assert.equal(calls, 0);
  });
  await test('limite de tamanho termina em erro recuperavel', async () => {
    const ctx = editor(); ctx.state.school.examTitle = 'Alterado'; ctx.imagePayloadBytes = () => 9000000; ctx.formatBytes = String;
    assert.equal(await ctx.saveToCloud({ auto: true }), false);
    assert.equal(ctx.node('lastSaved').textContent, 'Erro ao salvar alterações.');
    assert.equal(ctx.node('retrySaveBtn').hidden, false);
  });
  await test('JSON externo nao injeta atributos numericos', () => {
    const q = ExamSafety.normalizeQuestion({ type: 'tabela', lines: '\"><img src=x>', imageAlign: 'x\" onerror=x', text: '<texto>' });
    assert.equal(typeof q.lines, 'number'); assert.equal(q.imageAlign, 'left'); assert.equal(q.text, '<texto>');
  });
  await test('caca-palavras mantem palavra inteira e identifica impossiveis', () => {
    const word = 'RESPONSABILIDADE';
    const built = ExamSafety.buildWordSearch([word], 12);
    assert(built.grid.some(row => row.join('').includes(word)));
    assert.equal(built.unplaced.length, 0);
    const impossible = ExamSafety.buildWordSearch(['A'.repeat(19)], 12);
    assert.equal(impossible.placements.length, 0); assert.equal(impossible.unplaced.length, 1);
  });
  await test('PDF respeita numero oculto sem deslocar questao seguinte', () => {
    const node = { innerHTML: '' };
    const ctx = functions(read('print.html'), ['esc','parsePtNumber','normalizeExam','renderQuestionBlock','renderExam'], {
      ExamSafety, URLSearchParams, window: { location: { search: '' } }, document: { getElementById: () => node },
      isSafeImageDataUrl: () => false, buildFreeImagesHtml: () => '', _buildHeaderHtml: () => '', renderQuestionPreview: () => '',
    });
    ctx.renderExam({ questions: [{ type: 'texto_base', hideNumber: true, text: 'Texto' }, { type: 'discursiva', text: 'Pergunta' }] });
    assert.equal((node.innerHTML.match(/Questão 1/g) || []).length, 1); assert(!node.innerHTML.includes('Questão 2'));
  });
  await test('banco filtra no servidor antes de paginar e permite buscar item antigo', async () => {
    const nodes = new Map();
    const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false }); return nodes.get(id); };
    node('bankSearch').value = 'questao antiga'; node('bankScopeFilter').value = 'mine';
    const records = Array.from({ length: 65 }, (_, i) => ({ title: i === 64 ? 'questao antiga' : 'recente', user_id: 'u1' }));
    const ctx = functions(read('editor.html'), ['loadQuestionBank', 'loadQuestionBankPage'], {
      window: {}, document: { getElementById: node }, bankPageOffset: 0, bankLastQuery: '', bankRequestSequence: 0,
      auth: { isAuthenticated: () => true, getCurrentUser: () => ({ id: 'u1' }), authenticatedRequest: async endpoint => {
        const query = new URL('https://example.invalid' + endpoint).searchParams;
        assert.equal(query.get('user_id'), 'eq.u1');
        let filtered = query.get('or') ? records.filter(item => item.title === 'questao antiga') : records;
        const offset = Number(query.get('offset')); return filtered.slice(offset, offset + Number(query.get('limit')));
      } }, renderQuestionBank(items) { ctx.items = items; }, showToast(message) { throw new Error(message); },
    });
    await ctx.loadQuestionBank(); assert.equal(ctx.items.length, 1); assert.equal(ctx.items[0].title, 'questao antiga');
    node('bankSearch').value = ''; await ctx.loadQuestionBank(); assert.equal(ctx.items.length, 30); assert.equal(node('bankNextBtn').disabled, false);
    await ctx.loadQuestionBankPage(30); assert.equal(ctx.bankPageOffset, 30); assert.equal(ctx.items.length, 30);
    await ctx.loadQuestionBankPage(60); assert.equal(ctx.items.length, 5); assert.equal(node('bankNextBtn').disabled, true);
  });
  await test('sessao renova uma vez para pedidos concorrentes e logout revoga no servidor', async () => {
    global.localStorage = storage();
    const session = { access_token: 'vencido', refresh_token: 'r1', expires_at: 1, user: { id: 'u1' } };
    localStorage.setItem('supabase.auth.token', JSON.stringify(session));
    let refreshes = 0, logouts = 0;
    global.fetch = async (url, options) => {
      if (url.includes('refresh_token')) { refreshes++; return { ok: true, json: async () => ({ access_token: 'novo', refresh_token: 'r2', expires_in: 3600, user: { id: 'u1' } }) }; }
      if (url.includes('/logout')) { logouts++; return { ok: true }; }
      assert.equal(options.headers.Authorization, 'Bearer novo');
      return { ok: true, headers: { get: () => 'application/json' }, text: async () => '[]' };
    };
    const auth = new AuthManager({ AUTH_URL: 'https://example.invalid/auth', API_URL: 'https://example.invalid/rest' });
    await Promise.all([auth.authenticatedRequest('/exams'), auth.authenticatedRequest('/profiles')]);
    assert.equal(refreshes, 1);
    assert.equal((await auth.signOut()).serverRevoked, true); assert.equal(logouts, 1); assert.equal(localStorage.getItem('supabase.auth.token'), null);
    delete global.fetch; delete global.localStorage;
  });
  await test('timeout termina requisicao pendurada', async () => {
    global.localStorage = storage();
    global.fetch = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const auth = new AuthManager({ TIMEOUT: 10 });
    await assert.rejects(() => auth.fetchWithTimeout('https://example.invalid'), /demorou/);
    delete global.fetch; delete global.localStorage;
  });
  await test('setup e migracao dedicada mantem os mesmos controles', () => {
    const migration = read('migrations/20260908_01_seguranca.sql').replace('BEGIN;\n', '').replace(/COMMIT;\s*$/, '').trim();
    assert(read('setup_supabase.sql').includes(migration));
    assert(read('setup.html').includes("if (typeof window !== 'undefined') window.CONFIG = CONFIG;"));
    assert(!read('setup.html').includes('document.write'));
  });
  console.log(`${checks} regressões funcionais aprovadas.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
