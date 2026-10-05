const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { boot } = require('./editor-flows.cjs');

const pagination = fs.readFileSync(path.join(__dirname, '../js/exam-pagination.js'), 'utf8');

async function testPaginatorRevision() {
  const { document } = parseHTML('<html><head><style data-exam-layout></style></head><body><main id="root"></main></body></html>');
  Object.defineProperty(document.querySelector('style'), 'sheet', { value: { cssRules: [] } });
  const reports = [];
  class Previewer {
    polisher = { destroy() {} };
    async preview(html, styles, stage) {
      stage.innerHTML = `
        <div class="pagedjs_page"><div class="pagedjs_page_content">
          <div class="question-block" data-question-index="0" data-unnumbered="false"></div>
          <div class="question-block" data-question-index="1" data-unnumbered="false"></div>
        </div></div>
        <div class="pagedjs_page"><div class="pagedjs_page_content">
          <div class="question-block" data-question-index="2" data-unnumbered="false"></div>
          <div class="question-block" data-question-index="3" data-unnumbered="false"></div>
        </div></div>`;
      const pages = stage.querySelectorAll('.pagedjs_page');
      pages[0].querySelector('.pagedjs_page_content').getBoundingClientRect = () => ({ bottom: 1000 });
      pages[0].querySelectorAll('.question-block')[1].getBoundingClientRect = () => ({ bottom: 700, height: 200 });
      pages[1].querySelectorAll('.question-block')[0].getBoundingClientRect = () => ({ bottom: 400, height: 360 });
      pages[1].querySelectorAll('.question-block')[1].getBoundingClientRect = () => ({ bottom: 600, height: 180 });
    }
  }
  const window = {
    Paged: { Previewer }, requestAnimationFrame() {},
    getComputedStyle: () => ({ marginTop: '0', marginBottom: '12' }),
    reportExamSpaceSuggestion: (value, context, pending) => reports.push({ value, context, pending }),
  };
  const context = { window, document, location: { href: 'http://localhost/print.html' }, console };
  vm.createContext(context);
  vm.runInContext(pagination, context);
  const request = { revision: 7, fingerprint: '4:estado' };
  await window.ExamPagination.schedule(request);
  assert.equal(reports[0].value, null, 'a sugestao anterior deve sumir no inicio da paginacao');
  assert.equal(reports[0].pending, true, 'o aviso inicial deve manter a paginacao como pendente');
  assert.equal(reports.at(-1).pending, false, 'o resultado deve encerrar a paginacao');
  assert.equal(reports.at(-1).value.fromIndex, 3);
  assert.equal(reports.at(-1).value.toIndex, 2);
  assert.equal(reports.at(-1).value.page, 1);
  assert.deepEqual({ ...reports.at(-1).context }, request, 'a medicao deve conservar a revisao que a originou');
}

function questions(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    type:'discursiva', text:`Questão ${index + 1}`, points:'2,0', lines:3,
  }));
}

function bindPreview(app) {
  const messages = [];
  const source = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const frame = app.document.getElementById('canonicalPreview');
  Object.defineProperty(frame, 'contentWindow', { value: source, configurable:true });
  app.ctx.EditorTools.previewReady = true;
  return { source, messages };
}

function requestPagination(app, binding) {
  app.ctx.EditorTools.forceSnapshot = true;
  app.ctx.EditorTools.updatePreview();
  const message = [...binding.messages].reverse().find(item => item.data.type === 'exam-preview');
  assert(message, 'o editor deve solicitar uma paginacao identificada');
  assert(Number.isInteger(message.data.revision));
  assert.equal(message.data.fingerprint, app.ctx.EditorTools.questionFingerprint());
  return { revision: message.data.revision, fingerprint: message.data.fingerprint };
}

function dispatchSuggestion(app, binding, value, context) {
  const event = new app.ctx.Event('message');
  Object.defineProperties(event, {
    origin: { value: app.ctx.location.origin }, source: { value: binding.source },
    data: { value: { type:'exam-preview-space-suggestion', suggestion:value, ...context } },
  });
  app.ctx.dispatchEvent(event);
}

function suggestion() {
  return { fromIndex:3, toIndex:2, page:1, availablePx:300, questionHeightPx:192 };
}

function order(app) {
  return JSON.parse(app.run('JSON.stringify(state.questions.map(q => q.text))'));
}

async function testDeletionInvalidates() {
  const app = await boot({ questions:questions() });
  const binding = bindPreview(app);
  const context = requestPagination(app, binding);
  dispatchSuggestion(app, binding, suggestion(), context);
  assert.equal(app.document.getElementById('layoutOptimization').hidden, false);

  app.run('state.questions.splice(0, 1); EditorTools.changed()');
  assert.equal(app.document.getElementById('layoutOptimization').hidden, true, 'exclusao deve esconder imediatamente a sugestao');
  assert.equal(app.ctx.EditorTools.spaceSuggestion, null);
  const previousOrder = order(app);
  app.event(app.document.getElementById('layoutOptimizationBtn'), 'click');
  assert.deepEqual(order(app), previousOrder, 'a sugestao excluida nao pode mover outro item');
}

async function testInsertionInvalidates() {
  const app = await boot({ questions:questions() });
  const binding = bindPreview(app);
  const context = requestPagination(app, binding);
  dispatchSuggestion(app, binding, suggestion(), context);

  app.run("state.questions.splice(0, 0, {type:'discursiva',text:'Questão inserida',points:'0',lines:2}); EditorTools.changed()");
  assert.equal(app.document.getElementById('layoutOptimization').hidden, true, 'insercao deve esconder imediatamente a sugestao');
  assert.equal(app.ctx.EditorTools.spaceSuggestion, null);
}

async function testDelayedSuggestionIgnored() {
  const app = await boot({ questions:questions() });
  const binding = bindPreview(app);
  const oldContext = requestPagination(app, binding);
  app.run("state.questions[0].text='Questão alterada'; EditorTools.changed()");
  const currentContext = requestPagination(app, binding);
  assert(currentContext.revision > oldContext.revision);

  dispatchSuggestion(app, binding, suggestion(), oldContext);
  assert.equal(app.ctx.EditorTools.spaceSuggestion, null, 'mensagem atrasada nao deve ser aceita');
  assert.equal(app.document.getElementById('layoutOptimization').hidden, true);
  assert.equal(app.ctx.EditorTools.previewPaginationPending, true, 'mensagem antiga nao deve concluir a paginacao atual');
}

async function testValidSuggestionAndHistory() {
  const app = await boot({ questions:questions() });
  const binding = bindPreview(app);
  const context = requestPagination(app, binding);
  dispatchSuggestion(app, binding, suggestion(), context);
  assert.equal(app.document.getElementById('layoutOptimization').hidden, false);

  app.event(app.document.getElementById('layoutOptimizationBtn'), 'click');
  assert.deepEqual(order(app), ['Questão 1','Questão 2','Questão 4','Questão 3','Questão 5']);
  assert.equal(app.run('state.activeQuestionIndex'), 2, 'o foco deve acompanhar a questao movida');
  assert(app.document.getElementById('lastSaved').textContent.includes('pendentes'), 'a mudanca deve entrar no salvamento automatico');

  app.ctx.EditorTools.travelHistory(-1);
  assert.deepEqual(order(app), ['Questão 1','Questão 2','Questão 3','Questão 4','Questão 5']);
  app.ctx.EditorTools.travelHistory(1);
  assert.deepEqual(order(app), ['Questão 1','Questão 2','Questão 4','Questão 3','Questão 5']);
}

async function testHiddenWhileRepaginating() {
  const app = await boot({ questions:questions() });
  const binding = bindPreview(app);
  const context = requestPagination(app, binding);
  dispatchSuggestion(app, binding, suggestion(), context);
  assert.equal(app.document.getElementById('layoutOptimization').hidden, false);

  requestPagination(app, binding);
  const pendingContext = {
    revision:app.ctx.EditorTools.previewRevision,
    fingerprint:app.ctx.EditorTools.previewFingerprint,
    pending:true,
  };
  dispatchSuggestion(app, binding, null, pendingContext);
  assert.equal(app.document.getElementById('layoutOptimization').hidden, true, 'nova paginacao deve esconder a sugestao antes do resultado');
  assert.equal(app.ctx.EditorTools.spaceSuggestion, null);
  assert.equal(app.ctx.EditorTools.previewPaginationPending, true);
}

(async () => {
  await testPaginatorRevision();
  await testDeletionInvalidates();
  await testInsertionInvalidates();
  await testDelayedSuggestionIgnored();
  await testValidSuggestionAndHistory();
  await testHiddenWhileRepaginating();
  console.log('OK DIAGRAMACAO revisao, exclusao, insercao, atraso, aplicacao, historico e repaginacao pendente');
})().catch(error => { console.error(error); process.exitCode = 1; });
