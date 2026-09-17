const assert=require('node:assert/strict');const {boot}=require('./editor-flows.cjs');
(async()=>{
const app=await boot({questions:[{type:'multipla',text:'Escolha um ser vivo',options:['Gato','Pedra','Planta'],correctOption:0,points:'10',bncc:'EF01CI01',hideNumber:true}]});
assert.equal(app.document.querySelectorAll('#topQuestionMenu button[data-type="multipla"]').length,0);
assert.equal(app.document.querySelectorAll('#topQuestionMenu button[data-type="marcarx"]').length,1);
assert(app.document.querySelector('#topQuestionMenu button[data-type="vf"]'));
app.ctx.EditorTools.focusQuestion(0);assert.equal(app.run('state.questions[0].type'),'multipla');
let mode=app.document.querySelector('#question-0 [aria-label="Quantidade de respostas corretas"]');mode.value='multipla';app.event(mode,'input');
assert.equal(app.run('state.questions[0].type'),'marcarx');assert.equal(app.run('state.questions[0].items[0].checked'),true);assert.equal(app.run('state.questions[0].items[2].text'),'Planta');assert.equal(app.run('state.questions[0].bncc'),'EF01CI01');assert.equal(app.run('state.questions[0].hideNumber'),true);
mode=app.document.querySelector('#question-0 [data-k="markMode"]');assert.equal(mode.querySelectorAll('option').length,2);
app.run('state.questions[0].items[2].checked=true');mode.value='unica';app.event(mode,'input');assert.equal(app.run('state.questions[0].items.filter(i=>i.checked).length'),2);
assert.equal(app.run('state.questions[0].markMode'),'multipla');
let choice=app.document.querySelector('.single-answer-choice');assert(choice);
app.event([...choice.querySelectorAll('button')].at(-1),'click');assert(!app.document.querySelector('.single-answer-choice'));
assert.equal(app.run('state.questions[0].items.filter(i=>i.checked).length'),2);
mode.value='unica';app.event(mode,'input');app.event(app.document.querySelector('[data-keep-answer="2"]'),'click');
assert.equal(app.run('state.questions[0].markMode'),'unica');assert.equal(app.run('state.questions[0].items.filter(i=>i.checked).length'),1);
assert.equal(app.run('state.questions[0].items[2].checked'),true);
await app.run('saveToCloud()');const payload=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body);assert.equal(payload.questions[0].items[2].text,'Planta');assert.equal(payload.questions[0].items[2].checked,true);
app.run("addQuestionOfType('multipla')");assert.equal(app.run('state.questions.at(-1).type'),'marcarx');assert.equal(app.run('state.questions.at(-1).markMode'),'unica');
assert.equal(app.ctx.EditorTools.previewSelection,1);assert.equal(app.ctx.EditorTools.pendingPreviewFocus,1);
const card=app.document.querySelector('#question-1');assert(card.querySelector('.alternatives-appearance [data-k="markLayout"]'));
assert.equal(card.querySelectorAll('.alternative-image').length,4);assert(!card.textContent.includes('Conteúdo e respostas'));
app.ctx.EditorTools.enhanceFields();assert.equal(card.querySelectorAll('.alternative-image').length,4);
assert.equal(card.querySelector('.alternative-score label').textContent,'Valor');
assert.equal(card.querySelector('.alternative-score input').inputMode,'decimal');
assert(card.querySelector('.qhead .question-remove-icon'));
assert.equal(card.querySelector('.qhead .question-remove-icon').textContent,'🗑');
assert.equal(card.querySelector('.question-footer button[title="Remover questão"]'),null);
assert(card.querySelector('.alternative-main > input'));
assert(card.querySelector('.alternative-main > .alternative-image'));
assert(card.querySelector('.alternative-add'));
assert.equal(card.querySelector('[data-k="markMode"]').parentElement.querySelector('label').textContent,'Respostas corretas');
for(const type of ['multipla','marcarx']) {
 const image='data:image/png;base64,AA==';
 const data={type,text:'Imagens',points:'10',options:['A','B','C'],correctOption:2,markMode:'unica',items:[{text:'A'},{text:'B'},{text:'C',checked:true}],optionImages:[{dataUrl:image,fileName:'A'},{dataUrl:image,fileName:'B'},{dataUrl:image,fileName:'C'}]};
 const a=await boot({questions:[data]});a.ctx.EditorTools.focusQuestion(0);
 assert(a.run('renderQuestionPreview(state.questions[0])').includes('<img'));
 a.event(a.document.querySelector('[aria-label="Remover alternativa B"]'),'click');
 assert.equal(a.run('state.questions[0].optionImages[1].fileName'),'C');
 assert.equal(a.run('state.questions[0].optionImages.length'),2);
 if(type==='multipla')assert.equal(a.run('state.questions[0].correctOption'),1);
 else assert.equal(a.run('state.questions[0].items[1].checked'),true);
}
const legacy=await boot({questions:[{type:'marcarx',text:'Afirmações',markMode:'vf',items:[{text:'Plantas vivem',answer:'V',checked:true}],points:'10'}]});legacy.ctx.EditorTools.focusQuestion(0);assert(legacy.document.querySelector('#question-0 option[value="vf"]'));assert.equal(legacy.run('state.questions[0].items[0].answer'),'V');
const embeddedCases=[
 {question:{type:'vf',text:'Julgue',points:'1',items:[{text:'A',answer:'V'},{text:'B',answer:'F'}]},stored:"state.questions[0].items[0].imageFileName"},
 {question:{type:'texto_base',text:'Leia',textBase:'Texto',answerType:'multipla',points:'1',options:['A','B'],correctOption:0},stored:"state.questions[0].optionImages[0].fileName"},
 {question:{type:'imagem',text:'Observe',imageAnswerType:'multipla',points:'1',options:['A','B'],correctOption:0},stored:"state.questions[0].optionImages[0].fileName"},
 {question:{type:'imagem',text:'Observe',imageAnswerType:'marcarx',points:'1',items:[{text:'A',checked:true},{text:'B',checked:false}]},stored:"state.questions[0].optionImages[0].fileName"},
];
for(const {question,stored} of embeddedCases){
 const embedded=await boot({questions:[question]});
 embedded.run(`window.pickers=[];createImagePicker=(config)=>{window.pickers.push(config);return document.createElement('div')};`);
 embedded.ctx.EditorTools.focusQuestion(0);
 assert.equal(embedded.document.querySelectorAll('.answer-item-image').length,2);
 embedded.run(`window.pickers.at(-2).setImage('data:image/png;base64,AA==','item.png')`);
 assert.equal(embedded.run(stored),'item.png');
 assert(embedded.run('renderQuestionPreview(state.questions[0])').includes('<img'));
}
const subitems=await boot({questions:[{type:'subitens',text:'Responda',points:'1',items:[{text:'A',lines:1},{text:'B',lines:1}]}]});
subitems.ctx.EditorTools.focusQuestion(0);
assert.equal(subitems.document.querySelectorAll('.subitem-main .subitem-image-button').length,2);
assert([...subitems.document.querySelectorAll('.subitem-image-tools')].every(row=>row.hidden));
const imageDelete=await boot({questions:[{type:'imagem',text:'Observe',imageAnswerType:'multipla',points:'1',options:['A','B','C'],correctOption:2,optionImages:[{fileName:'A'},{fileName:'B'},{fileName:'C'}]}]});
imageDelete.ctx.EditorTools.focusQuestion(0);
imageDelete.event(imageDelete.document.querySelectorAll('#question-0 .option-row .danger')[1],'click');
assert.equal(imageDelete.run('state.questions[0].optionImages[1].fileName'),'C');
assert.equal(imageDelete.run('state.questions[0].correctOption'),1);
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{parseHTML}=require('linkedom');
const {document}=parseHTML(fs.readFileSync(path.join(__dirname,'../print.html'),'utf8'));
const ctx={document,ExamSafety:require('../js/exam-safety.js'),URLSearchParams,URL,console,location:{search:''},window:{location:{search:''}},addEventListener(){},setTimeout(){},clearTimeout(){}};
vm.createContext(ctx);for(const script of document.querySelectorAll('script:not([src])'))vm.runInContext(script.textContent,ctx);
for(const markLayout of ['lista','duas_colunas','tabela']) {
 ctx.q={type:'marcarx',text:'Teste',points:'1',markMode:'unica',markLayout,items:[{text:'Planta',checked:true},{text:'Pedra'}],optionImages:[{dataUrl:'data:image/png;base64,AA=='}]};
 vm.runInContext('renderExam({questions:[q]},false)',ctx);
 assert.equal(document.querySelectorAll('.question-block img').length,1);
 assert(!document.querySelector('.question-block').textContent.includes('Correta'));
 ctx.q.optionImages[0].dataUrl='javascript:alert(1)';vm.runInContext('renderExam({questions:[q]},false)',ctx);assert.equal(document.querySelectorAll('.question-block img').length,0);
}
for(const question of [
 {type:'vf',text:'Julgue',points:'1',items:[{text:'A',imageDataUrl:'data:image/png;base64,AA=='},{text:'B',imageDataUrl:'javascript:alert(1)'}]},
 {type:'texto_base',text:'Leia',textBase:'Texto',answerType:'multipla',points:'1',options:['A','B'],optionImages:[{dataUrl:'data:image/png;base64,AA=='},{dataUrl:'javascript:alert(1)'}]},
 {type:'imagem',text:'Observe',imageAnswerType:'multipla',points:'1',options:['A','B'],optionImages:[{dataUrl:'data:image/png;base64,AA=='},{dataUrl:'javascript:alert(1)'}]},
 {type:'imagem',text:'Observe',imageAnswerType:'marcarx',points:'1',items:[{text:'A'},{text:'B'}],optionImages:[{dataUrl:'data:image/png;base64,AA=='},{dataUrl:'javascript:alert(1)'}]},
]){
 ctx.q=question;vm.runInContext('renderExam({questions:[q]},false)',ctx);
 assert.equal(document.querySelectorAll('.question-block img').length,1);
}
const uploaded=await boot({questions:[{type:'marcarx',text:'Imagem',points:'10',markMode:'unica',items:[{text:'A',checked:true},{text:'B'}]}]});
uploaded.run(`window.pickers=[]; createImagePicker=(config)=>{window.pickers.push(config);return document.createElement('div')};`);
uploaded.ctx.EditorTools.focusQuestion(0);
uploaded.run(`window.pickers.at(-1).setImage('data:image/png;base64,AA==','opcao-B.png');`);
assert.equal(uploaded.run('state.questions[0].optionImages[1].fileName'),'opcao-B.png');
await uploaded.run('saveToCloud()');
const saved=JSON.parse(uploaded.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body);
assert.equal(saved.questions[0].optionImages[1].fileName,'opcao-B.png');
uploaded.run('window.pickers.at(-1).clearImage()');assert.equal(uploaded.run('state.questions[0].optionImages[1].dataUrl'),'');
console.log('OK ALTERNATIVAS tipo único, escolha única/múltipla, legado, respostas e persistência');
})().catch(e=>{console.error(e);process.exitCode=1});
