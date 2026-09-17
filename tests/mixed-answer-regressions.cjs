const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');const {boot}=require('./editor-flows.cjs');const safety=require('../js/exam-safety.js');
const {document}=parseHTML(fs.readFileSync(require('path').join(__dirname,'../print.html'),'utf8'));
const ctx={document,ExamSafety:safety,URLSearchParams,URL,console,location:{search:''},window:{location:{search:''}},addEventListener(){},setTimeout(){},clearTimeout(){}};
vm.createContext(ctx);for(const s of document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,ctx);
const fixture=type=>({type,text:'Observe',points:'10',textBase:'Texto de apoio',headers:['Animal'],rows:[['Peixe']],options:['Água','Terra'],correctOption:0,answerType:'multipla',showAnswerSpace:false});
const dom=q=>parseHTML('<main>'+ctx.renderQuestionPreview(q)+'</main>').document;
(async()=>{
 for(const type of ['texto_base','tabela']){
  const q=fixture(type);
  assert.equal(dom(q).querySelectorAll('.option-item').length,2);
  assert.equal(dom(q).querySelector('.answer-space'),null);
  assert(dom(q).textContent===null || ctx.renderQuestionPreview(q).includes(type==='tabela'?'Peixe':'Texto de apoio'));
  assert.equal(ctx.getQuestionAnswer(q),'A');
  for(const correctOption of [null,-1,2,1.5,'', '1'])assert.equal(ctx.getQuestionAnswer({...q,correctOption}),'(não marcado)');
  assert.equal(dom({...q,answerType:'discursiva',showAnswerSpace:true}).querySelectorAll('.option-item').length,0);
  assert(dom({...q,answerType:'discursiva',showAnswerSpace:true}).querySelector('.answer-space'));
  assert.equal(dom({...q,answerType:'discursiva'}).querySelector('.answer-space'),null);
  const app=await boot({questions:[q]});app.run('state.collapsedQuestions={};renderAll()');
  assert.equal(app.document.querySelector('[data-presentation="answer-space"]'),null);
  const mode=()=>app.document.querySelector('[data-k="answerType"]');
  mode().value='discursiva';app.event(mode(),'input');assert(app.document.querySelector('[data-presentation="answer-space"]'));
  mode().value='multipla';app.event(mode(),'input');assert.equal(app.run('state.questions[0].options[0]'),'Água');
  app.run('state.questions[0].correctOption=1');await app.run('saveToCloud()');
  const saved=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions;
  const reopened=await boot({questions:saved});const loaded=reopened.run('state.questions[0]');
  assert.equal(ctx.getQuestionAnswer(loaded),'B');assert.equal(dom(loaded).querySelectorAll('.option-item').length,2);
  app.ctx.fixture=q;assert.equal(parseHTML(app.run('renderQuestionPreview(fixture)')).document.querySelectorAll('.option-item').length,2);
  ctx.exam={title:'Teste',questions:[q],total_value:'10'};vm.runInContext('renderExam(exam,false)',ctx);assert.equal(document.querySelector('.answer-key'),null);
  vm.runInContext('currentExam=exam;previewAnswerKey=true;renderExam(exam,true)',ctx);assert(document.querySelector('.answer-key').textContent.includes('A'));
  ctx.updated={...q,correctOption:1};vm.runInContext('patchPreviewQuestion(0,updated)',ctx);assert(document.querySelector('.answer-key').textContent.includes('B'));
  const hostile={...q,options:['<script>alert(1)</script>','B']};assert.equal(dom(hostile).querySelector('script'),null);
 }
 const no=fixture('tabela');no.answerType='nenhuma';assert.equal(ctx.getQuestionAnswer(no),'');assert.equal(dom(no).querySelectorAll('.option-item,.answer-space').length,0);assert(dom(no).querySelector('table'));
 const empty=await boot({questions:[{...fixture('texto_base'),options:[]}]});empty.run('state.collapsedQuestions={};renderAll()');assert.equal(empty.run('state.questions[0].options.length'),2);
 console.log('OK RESPOSTAS MISTAS alternativas, gabarito, modos, persistência, prévia e escape');
})().catch(e=>{console.error(e);process.exitCode=1});
