const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');const {boot}=require('./editor-flows.cjs');const safety=require('../js/exam-safety.js');
const {document}=parseHTML(fs.readFileSync(require('node:path').join(__dirname,'../print.html'),'utf8'));
const ctx={document,ExamSafety:safety,URLSearchParams,URL,console,location:{search:''},window:{location:{search:''}},addEventListener(){},setTimeout(){},clearTimeout(){}};
vm.createContext(ctx);for(const s of document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,ctx);
const types=['discursiva','imagem','interpretacao_imagem','texto_base','problema_matematico','tabela','comparar_imagens'];
const q=(type,fields={})=>({type,text:'Responda',points:'10',lines:1,answerStyle:'linhas',calcLines:1,headers:['A'],rows:[['B']],prompts:['Observe'],answerType:'discursiva',imageAnswerType:'discursiva',...fields});
const body=question=>parseHTML('<main>'+ctx.renderQuestionPreview(question)+'</main>').document;
(async()=>{
 for(const type of types){
  for(const lines of [1,5,20,40]){
   const doc=body(q(type,{lines}));const counts=[...doc.querySelectorAll('.answer-space-lines')].map(el=>el.children.length);
   assert(counts.includes(lines),type+': '+lines);
  }
  for(const style of ['caixa','espaco']){
   const doc=body(q(type,{lines:3,answerStyle:style}));
   assert(doc.querySelector('.answer-space-'+style).getAttribute('style').includes('height:72px'),type);
  }
  assert.equal(body(q(type,{showAnswerSpace:false})).querySelector('.answer-space'),null,type);
 }
 assert.equal(body(q('interpretacao_imagem',{prompts:['A','B'],lines:2})).querySelectorAll('.answer-space-lines').length,2);
 assert.equal(body(q('problema_matematico',{showAnswerSpace:false})).querySelector('.prob-calc-box'),null);
 const mathText='Calcule 1/2 de 3^2 e encontre √(25).';
 const segments=safety.mathTextSegments(mathText);
 assert.deepEqual(segments.filter(item=>item.type==='math').map(item=>item.value),['1/2','3^2','√(25)']);
 ctx.mathProblem=q('problema_matematico',{text:mathText});
 vm.runInContext('document.body.innerHTML=renderQuestionBlock(mathProblem,0,1)',ctx);
 assert.equal(document.querySelectorAll('.qtext .inline-math').length,3);
 assert(document.querySelector('.qtext').textContent.includes('Calcule 1/2 de 3^2'));
 ctx.mathProblem.text='<img src=x onerror=alert(1)> 1/2';
 vm.runInContext('document.body.innerHTML=renderQuestionBlock(mathProblem,0,1)',ctx);
 assert.equal(document.querySelector('.qtext img'),null);
 for(const borderStyle of ['solida','tracejada','pontilhada','nenhuma'])assert(body(q('espaco_livre',{height:240,borderStyle})).querySelector('.espaco-livre-box.'+borderStyle).getAttribute('style').includes('240px'));
 assert.equal(body(q('espaco_livre',{showAnswerSpace:false})).querySelector('.espaco-livre-box'),null);
 assert.equal(safety.answerLineCount(1000),40);assert.equal(safety.answerLineCount(2.7),3);
 const app=await boot({questions:types.map(type=>q(type))});app.run('state.collapsedQuestions={};renderAll()');
 for(const card of app.document.querySelectorAll('.qcard')){
  const lines=card.querySelector('[data-k="lines"]');assert(lines);assert.equal(lines.max,'40');assert.equal(lines.min,'1');
  assert(card.querySelector('[data-k="answerStyle"]'));
 }
 const first=app.document.querySelector('.qcard');const lines=first.querySelector('[data-k="lines"]');lines.value='20';app.event(lines,'input');
 const style=first.querySelector('[data-k="answerStyle"]');style.value='caixa';app.event(style,'input');
 assert.equal(app.run('state.questions[0].lines'),20);assert.equal(app.run('state.questions[0].answerStyle'),'caixa');
 await app.run('saveToCloud()');const saved=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions;
 const reopened=await boot({questions:saved});assert.equal(reopened.run('state.questions[0].lines'),20);
 assert(body(saved[0]).querySelector('.answer-space-caixa').getAttribute('style').includes('480px'));
 for(const type of [...types,'espaco_livre']){
  const question=q(type,{showAnswerSpace:false});app.ctx.fixture=question;
  assert.equal(app.run('renderQuestionPreview(fixture)').includes('answer-space'),false);
 }
 const mathApp=await boot({questions:[q('problema_matematico',{text:'João repartiu igualmente.'})]});
 mathApp.ctx.EditorTools.focusQuestion(0);
 const mathCard=mathApp.document.querySelector('#question-0');
 const statement=mathCard.querySelector('textarea[data-k="text"]');
 const mathTools=mathCard.querySelector('.math-statement-tools');assert(mathTools);
 const fraction=[...mathTools.querySelectorAll('button')].find(button=>button.textContent==='Fração');
 statement.focus();statement.selectionStart=statement.value.length;statement.selectionEnd=statement.value.length;mathApp.event(fraction,'click');
 assert.equal(mathApp.run('state.questions[0].text'),'João repartiu igualmente.1/2');
 assert.equal(statement.selectionStart,statement.value.length-3);
 assert(mathApp.ctx.EditorTools.persistTimer,'inserção matemática agenda salvamento');
 await mathApp.run('saveToCloud()');
 const savedMath=JSON.parse(mathApp.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions[0];
 assert.equal(savedMath.text,'João repartiu igualmente.1/2');
 console.log('OK ESPACOS formatos, limites, ocultar, perguntas por imagem, cálculo, bordas, controles e persistência');
})().catch(e=>{console.error(e);process.exitCode=1});
