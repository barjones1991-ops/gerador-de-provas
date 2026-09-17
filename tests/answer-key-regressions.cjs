const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {boot}=require('./editor-flows.cjs');
const Safety=require('../js/exam-safety.js');
const png='data:image/png;base64,AA==';
const image=name=>({imageDataUrl:png,imageFileName:name});
function renderer(){
 const {document}=parseHTML(fs.readFileSync(path.join(__dirname,'../print.html'),'utf8'));
 const ctx={document,ExamSafety:Safety,URLSearchParams,URL,console,location:{search:''},window:{location:{search:''}},addEventListener(){},setTimeout(){},clearTimeout(){}};
 vm.createContext(ctx);
 for(const s of document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,ctx);
 return {document,ctx,run:s=>vm.runInContext(s,ctx)};
}
(async()=>{
 const questions=[
  {type:'discursiva',text:'Cuidados',expectedAnswer:'CRITERIO_RESERVADO: regar a planta.',lines:3},
  {type:'sequencia_imagens',text:'Ordene',items:[3,1,4,2].map((order,i)=>({...image('fase'+i),order}))},
  {type:'legenda_imagens',text:'Nomeie',items:['PEIXE','PÁSSARO','SOL'].map(answer=>({...image('figura'),answer}))},
  {type:'associacao_imagem_imagem',text:'Associe',leftItems:['peixe','ave','sol'].map(image),rightItems:['peixe','ave','sol'].map(image),rightOrder:[1,2,0]},
  {type:'expressao_matematica',text:'Calcule',expressions:[{latex:'2+3=',answer:'5'},{latex:'5-1=',answer:'4'},{latex:'1+2+3=',answer:'6'}]},
  {type:'marcarx',text:'Animais',markMode:'multiple',items:[{text:'Gato',checked:true},{text:'Pedra',checked:false},{text:'Cão',checked:true}]}
 ].map(q=>({...q,points:'1,0'}));
 const expected=['CRITERIO_RESERVADO: regar a planta.','Imagem 1: 3; Imagem 2: 1; Imagem 3: 4; Imagem 4: 2','1: PEIXE; 2: PÁSSARO; 3: SOL','1-B; 2-C; 3-A','1: 5; 2: 4; 3: 6','A, C'];
 const r=renderer();
 questions.forEach((q,i)=>assert.equal(r.ctx.getQuestionAnswer(q),expected[i],q.type));
 const exam={title:'Gabaritos',questions,total_value:'6,0'};
 r.ctx.exam=JSON.parse(JSON.stringify(exam));r.run('currentExam=exam;previewAnswerKey=true;renderExam(exam,true)');
 assert.equal(r.document.querySelectorAll('.answer-row').length,6);
 assert(r.document.querySelector('.answer-key').textContent.includes('CRITERIO_RESERVADO'));
 const cards=[...r.document.querySelectorAll('.assoc-img-section .assoc-img-row')];
 assert.deepEqual([...cards[1].querySelectorAll('img')].map(e=>e.alt),['ave','sol','peixe']);
 r.ctx.updated={...questions[3],rightOrder:[2,0,1]};r.run('patchPreviewQuestion(3,updated)');
 assert(r.document.querySelector('.answer-key').textContent.includes('1-C; 2-A; 3-B'));
 assert.equal(r.document.querySelectorAll('.question-block').length,6);
 r.run('renderExam(exam,false)');
 assert.equal(r.document.querySelector('.answer-key'),null);
 assert(!r.document.getElementById('root').textContent.includes('CRITERIO_RESERVADO'));
 console.log('OK GABARITO cinco tipos, letras, embaralhamento e versao sem respostas');
 const app=await boot({questions});app.run('state.school.examTitle="Teste de persistencia do gabarito";state.school.totalValue="6,0"');await app.run('saveToCloud()');
 const saved=JSON.parse(app.requests.filter(x=>x.options.method==='PATCH').at(-1).options.body).questions;
 const reopened=await boot({questions:saved});const loaded=reopened.run('state.questions');
 loaded.forEach((q,i)=>assert.equal(r.ctx.getQuestionAnswer(q),expected[i],q.type+' apos reabrir'));
 assert(r.ctx.getQuestionAnswer({type:'discursiva',expectedAnswer:' '}).includes('correção manual'));
 assert.equal(r.ctx.getQuestionAnswer({type:'expressao_matematica',expressions:[{answer:''}]}),'1: ?');
 assert.equal(r.ctx.getQuestionAnswer({type:'sequencia_imagens',items:[{order:0},{}]}),'Imagem 1: ?; Imagem 2: ?');
 assert.equal(r.ctx.getQuestionAnswer({type:'legenda_imagens',items:[{answer:'  '}]}),'1: ?');
 assert.equal(r.ctx.getQuestionAnswer({type:'marcarx',markMode:'checklist',items:[{checked:true}]}),'');
 assert.equal(r.ctx.getQuestionAnswer({type:'marcarx',markMode:'vf',items:[{answer:'V'},{answer:'F'}]}),'1-V; 2-F');
 assert.equal(r.ctx.getQuestionAnswer({type:'associacao_imagem_imagem',leftItems:[image('a')],rightItems:[image('a')]}),'1-A');
 const hostile={type:'discursiva',text:'Questão',expectedAnswer:'<img src=x onerror=alert(1)>',points:'1,0'};
 r.ctx.exam={questions:[hostile]};r.run('renderExam(exam,true)');
 assert.equal(r.document.querySelector('.answer-key img'),null);
 assert(r.document.querySelector('.answer-key').textContent.includes('<img'));
 console.log('OK GABARITO persistencia, respostas ausentes e escape de conteudo');
})().catch(e=>{console.error(e);process.exitCode=1});
