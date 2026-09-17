const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {parseHTML}=require('linkedom');
(async()=>{
const {document}=parseHTML('<html><head><style data-exam-layout></style></head><body><main id="root"><div class="question-block" data-question-index="0">Inicial</div></main></body></html>');
Object.defineProperty(document.querySelector('style'),'sheet',{value:{cssRules:[{type:4,conditionText:'screen',cssRules:[{cssText:'.screen-only{}'}]},{type:4,conditionText:'print',cssRules:[{type:6,cssText:'@page { size:A4; margin:8mm 9mm 10mm; }',cssRules:[]}]}]}});
let release, fail=false, calls=0, css, focus;
class Previewer { polisher={destroy(){}};async preview(html,styles,stage){calls++;css=Object.values(styles[0])[0];if(calls===1)await new Promise(r=>release=r);if(fail)throw Error('teste de falha');stage.innerHTML='<div class="pagedjs_page">'+html+'</div>';}}
const window={Paged:{Previewer},requestAnimationFrame(){},focusPreviewQuestion(i){focus=i}};
const ctx={window,document,location:{href:'http://localhost/print.html'},console:{error(){}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../js/exam-pagination.js'),'utf8'),ctx);
const api=window.ExamPagination;api.focus(0);const first=api.schedule();while(!release)await Promise.resolve();document.getElementById('root').firstElementChild.textContent='Atualizada';api.schedule();release();await first;
assert.equal(calls,2);assert.equal(document.querySelector('#paper-preview').textContent,'Atualizada');assert.equal(focus,0);assert.equal(api.focus(0).textContent,'Atualizada');assert(css.includes('210mm 297mm'));assert(!css.includes('screen-only'));assert(document.body.classList.contains('paper-ready'));assert.equal(document.querySelectorAll('.paper-staging').length,0);
fail=true;await api.schedule();await assert.rejects(()=>api.ready(),/preparar as páginas/);assert(!document.body.classList.contains('paper-ready'));assert.equal(document.querySelector('#paper-preview').textContent,'');
fail=false;await api.schedule();await api.ready();api.reset();assert(!document.body.classList.contains('paper-ready'));assert.equal(document.querySelector('#paper-preview').textContent,'');
console.log('OK PAGINACAO A4, regras de impressão, edição concorrente, foco, falha e recuperação');
})().catch(e=>{console.error(e);process.exitCode=1});
