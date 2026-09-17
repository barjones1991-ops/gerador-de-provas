const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');const {boot}=require('./editor-flows.cjs');const safety=require('../js/exam-safety.js');
const {document}=parseHTML(fs.readFileSync(require('path').join(__dirname,'../print.html'),'utf8'));
const ctx={document,ExamSafety:safety,URLSearchParams,URL,console,location:{search:''},window:{location:{search:''}},addEventListener(){},setTimeout(){},clearTimeout(){}};
vm.createContext(ctx);for(const s of document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,ctx);
const types=['discursiva','subitens','interpretacao_imagem','problema_matematico','espaco_livre','comparar_imagens','texto_base','tabela','imagem'];
const question=type=>({type,text:'Observe e responda',points:'1',lines:2,items:[{text:'Observe',lines:1}],prompts:['O que você vê?'],headers:['A'],rows:[['B']],answerType:'discursiva',imageAnswerType:'discursiva'});
(async()=>{
 const questions=types.map(question);const app=await boot({questions});app.run('state.collapsedQuestions={};renderAll()');
 assert.equal(app.document.querySelectorAll('[data-k="expectedAnswer"]').length,types.length);
 const secret='CRITERIO_RESERVADO <img src=x onerror=alert(1)>\nAceitar soluções equivalentes.';
 for(const [i,field] of [...app.document.querySelectorAll('[data-k="expectedAnswer"]')].entries()){
  assert(field.getAttribute('aria-label').includes('Questão '+(i+1)));
  field.value=secret;app.event(field,'input');
  assert.equal(app.run('state.questions['+i+'].expectedAnswer'),secret);
 }
 await app.run('saveToCloud()');const saved=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions;
 const reopened=await boot({questions:saved});const loaded=reopened.run('state.questions');
 for(const q of loaded){
  assert.equal(ctx.getQuestionAnswer(q),secret,q.type);
  assert.equal(safety.hasManualAnswer(q),true);
  assert.equal(ctx.getQuestionAnswer({...q,expectedAnswer:' '}),'(correção manual — resposta esperada não cadastrada)');
  reopened.ctx.fixture=q;assert.equal(reopened.run('gerarGabaritoQuestao(fixture,1).ans'),secret);
  assert(!ctx.renderQuestionPreview(q).includes('CRITERIO_RESERVADO'),q.type);
 }
 ctx.exam={title:'Critérios',questions:loaded,total_value:'9'};
 vm.runInContext('currentExam=exam;previewAnswerKey=true;renderExam(exam,true)',ctx);
 assert.equal(document.querySelectorAll('.answer-row').length,9);
 assert(document.querySelector('.answer-key').textContent.includes('CRITERIO_RESERVADO'));
 assert.equal(document.querySelector('.answer-key img'),null);
 vm.runInContext('renderExam(exam,false)',ctx);assert(!document.getElementById('root').textContent.includes('CRITERIO_RESERVADO'));
 for(const type of ['imagem','tabela','texto_base']){
  const q={...question(type),answerType:'multipla',imageAnswerType:'multipla',options:['A','B'],correctOption:1,expectedAnswer:secret};
  assert.equal(safety.hasManualAnswer(q),false);assert.equal(ctx.getQuestionAnswer(q),'B');
 }
 assert.equal(safety.hasManualAnswer({...question('tabela'),answerType:'nenhuma'}),false);
 const toggle=await boot({questions:[{...question('texto_base'),expectedAnswer:secret,options:['A','B'],correctOption:0}]});
 toggle.run('state.collapsedQuestions={};renderAll()');
 let mode=toggle.document.querySelector('[data-k="answerType"]');mode.value='multipla';toggle.event(mode,'input');assert.equal(toggle.document.querySelector('[data-k="expectedAnswer"]'),null);
 mode=toggle.document.querySelector('[data-k="answerType"]');mode.value='discursiva';toggle.event(mode,'input');assert.equal(toggle.document.querySelector('[data-k="expectedAnswer"]').value,secret);
 console.log('OK CRITERIOS nove formatos, campo opcional, persistência, modos, gabarito e sigilo na prova do aluno');
})().catch(e=>{console.error(e);process.exitCode=1});
