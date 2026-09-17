const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');const {parseHTML}=require('linkedom');const {boot}=require('./editor-flows.cjs');
(async()=>{
 const questions=[0,1,2].map(i=>({type:'discursiva',text:'Enunciado '+i,points:'1',hideNumber:i===1}));
 const app=await boot({questions});const messages=[];
 const frame=app.document.getElementById('canonicalPreview');Object.defineProperty(frame,'contentWindow',{value:{postMessage:(data,origin)=>messages.push({data,origin})},configurable:true});
 app.ctx.EditorTools.previewReady=false;app.ctx.EditorTools.previewQuestion(1);
 assert.equal(messages.length,0);assert.equal(app.ctx.EditorTools.pendingPreviewFocus,1);
 app.ctx.EditorTools.previewReady=true;app.ctx.EditorTools.updatePreview();
 assert.equal(messages.at(-1).data.type,'exam-preview-focus');assert.equal(messages.at(-1).data.index,1);
 assert.equal(messages.at(-2).data.type,'exam-preview');assert.equal(messages.at(-1).origin,'https://example.invalid');
 app.document.getElementById('previewNext').onclick();assert.equal(messages.at(-1).data.index,2);assert(app.document.getElementById('previewNext').disabled);
 app.document.getElementById('previewPrevious').onclick();assert.equal(messages.at(-1).data.index,1);
 const before=messages.length;app.ctx.EditorTools.previewQuestion(-1);app.ctx.EditorTools.previewQuestion(3);assert.equal(messages.length,before);
 app.run('state.questions.splice(1)');app.ctx.EditorTools.updatePreview();assert.equal(app.document.getElementById('previewQuestionSelect').value,'0');assert(app.document.getElementById('previewNext').disabled);
 app.run('state.questions=[]');app.ctx.EditorTools.updatePreview();assert(app.document.getElementById('previewQuestionSelect').disabled);
 const html=fs.readFileSync(require('path').join(__dirname,'../print.html'),'utf8');const {document}=parseHTML(html);
 const listeners={};const parent={postMessage(){}};
 const ctx={document,ExamSafety:require('../js/exam-safety.js'),URLSearchParams,URL,console,location:{search:'?preview=1',origin:'https://example.invalid'},window:{location:{search:'?preview=1'},parent,addEventListener:(type,fn)=>listeners[type]=fn},addEventListener:(type,fn)=>listeners[type]=fn,setTimeout(){},clearTimeout(){}};
 vm.createContext(ctx);for(const s of document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,ctx);
 ctx.exam={title:'Navegação',questions,total_value:'3'};vm.runInContext('currentExam=exam;renderExam(exam,false)',ctx);
 const blocks=[...document.querySelectorAll('#root .questions > .question-block')];let scrolled=-1;blocks.forEach((b,i)=>b.scrollIntoView=()=>scrolled=i);
 ctx.focusPreviewQuestion(1);assert.equal(scrolled,1);assert(blocks[1].classList.contains('preview-focused'));
 ctx.focusPreviewQuestion(0);assert(!blocks[1].classList.contains('preview-focused'));assert(blocks[0].classList.contains('preview-focused'));
 for(const invalid of [-1,99,0.5,'1'])ctx.focusPreviewQuestion(invalid);assert.equal(scrolled,0);
 // The existing origin/source gate must cover navigation as well as content updates.
 assert(html.indexOf('if (event.origin !== location.origin || event.source !== window.parent) return;') < html.indexOf("if (event.data?.type === 'exam-preview-focus')"));
 console.log('OK NAVEGACAO seletor, anterior/próxima, limites, carregamento, exclusão, número oculto e foco');
})().catch(e=>{console.error(e);process.exitCode=1});
