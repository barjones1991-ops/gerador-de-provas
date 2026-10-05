const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { boot } = require('./editor-flows.cjs');

const pagination = fs.readFileSync(path.join(__dirname, '../js/exam-pagination.js'), 'utf8');
const print = fs.readFileSync(path.join(__dirname, '../print.html'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../js/editor-tools.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../css/editor-tools.css'), 'utf8');

assert(pagination.includes('detectSpaceSuggestion'), 'o paginador deve analisar sobras entre paginas');
assert(pagination.includes('available < 56'), 'sobras pequenas nao devem gerar sugestoes ruidosas');
assert(pagination.includes("candidate.dataset.unnumbered === 'true'"), 'blocos sem numero nao devem ser movidos isoladamente');
assert(print.includes('exam-preview-space-suggestion'), 'a previa deve comunicar a sugestao ao editor');
assert(print.includes('data-unnumbered='), 'a pagina deve identificar blocos de apoio sem numero');
assert(editor.includes('Sugerir otimização'), 'a finalizacao deve oferecer o botao de sugestao');
assert(editor.includes('Isso aproveita melhor o espaço') && editor.includes('altera a ordem das questões'), 'o professor deve ser avisado antes da mudanca');
assert(editor.includes('this.recordHistory()') && editor.includes('state.questions.splice(fromIndex, 1)'), 'a aplicacao deve participar do historico de desfazer');
assert(css.includes('.layout-optimization'), 'a sugestao deve ter apresentacao propria');

(async () => {
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
    reportExamSpaceSuggestion: value => reports.push(value),
  };
  const context = { window, document, location: { href: 'http://localhost/print.html' }, console };
  vm.createContext(context);
  vm.runInContext(pagination, context);
  await window.ExamPagination.schedule();
  assert.equal(reports.at(-1).fromIndex, 3);
  assert.equal(reports.at(-1).toIndex, 2);
  assert.equal(reports.at(-1).page, 1);

  const questions = [0, 1, 2, 3].map(index => ({ type:'discursiva', text:`Questão ${index + 1}`, points:'2,5', lines:3 }));
  const app = await boot({ questions });
  app.ctx.EditorTools.setSpaceSuggestion({ fromIndex:3, toIndex:2, page:1, availablePx:300, questionHeightPx:192 });
  assert.equal(app.document.getElementById('layoutOptimization').hidden, false);
  app.document.getElementById('layoutOptimizationBtn').onclick();
  assert.deepEqual(app.run('state.questions.map(q => q.text)'), ['Questão 1', 'Questão 2', 'Questão 4', 'Questão 3']);
  assert(app.document.getElementById('lastSaved').textContent.includes('pendentes'));

  console.log('OK DIAGRAMACAO detecta ganho real, protege blocos de apoio, pede confirmacao e permite desfazer');
})().catch(error => { console.error(error); process.exitCode = 1; });
