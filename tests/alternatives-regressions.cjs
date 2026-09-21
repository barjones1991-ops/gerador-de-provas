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
const card=app.document.querySelector('#question-1');assert(card.querySelector('[data-k="markLayout"]'));
assert(!card.querySelector('.question-appearance'));
assert.equal(card.querySelector('[data-k="markLayout"]').parentElement.querySelector('label').textContent,'Organização das alternativas');
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
const attached=await boot({questions:[{type:'discursiva',text:'Observe e explique.',points:'10',lines:5}]});
attached.ctx.EditorTools.focusQuestion(0);
const statement=attached.document.querySelector('textarea[data-k="text"]');
const imageButton=attached.document.querySelector('.enunciation-image-field .field-image-trigger');
assert(statement.parentElement.contains(imageButton),'imagem pertence ao campo de enunciado');
attached.run('window.headerPickers=[];createImagePicker=(config)=>{window.headerPickers.push(config);return document.createElement("div")}');
attached.event(imageButton,'click');
assert.equal(imageButton.getAttribute('aria-expanded'),'true');
assert.equal(attached.run('state.questions[0].headerImage.mode'),'one');
attached.run('window.headerPickers.at(-1).setImage("data:image/png;base64,AA==","enunciado.png")');
assert.equal(attached.document.querySelector('textarea[data-k="text"]'),statement,'adicionar imagem preserva o campo de texto');
assert(attached.run('buildHeaderImageHtml(state.questions[0])').includes('<img'));
attached.run('window.headerPickers.at(-1).setImage("data:image/png;base64,BB==","trocada.png")');
await attached.run('saveToCloud()');
const attachedSaved=JSON.parse(attached.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body);
assert.equal(attachedSaved.questions[0].text,'Observe e explique.');
assert.equal(attachedSaved.questions[0].headerImage.fileName,'trocada.png');
const reopenedImage=await boot({questions:attachedSaved.questions});reopenedImage.ctx.EditorTools.focusQuestion(0);
assert(!reopenedImage.document.querySelector('.enunciation-image-field .image-edit-panel').classList.contains('hidden'));
attached.run('window.headerPickers.at(-1).clearImage()');
assert.equal(attached.run('buildHeaderImageHtml(state.questions[0])'),'');
assert.equal(attached.run('state.questions[0].text'),'Observe e explique.');
for(const details of card.querySelectorAll('.alternative-image')) {
 assert(details.closest('.field-image-shell'));
 assert(details.querySelector('summary').getAttribute('aria-label').includes('alternativa'));
}
console.log('OK IMAGEM NO CAMPO enunciado, adicionar, substituir, remover, reabrir e preservar texto');
for (const type of ['discursiva','imagem']) {
 const extras=await boot({questions:[{type,text:'Observe',points:'10',freeImages:[{dataUrl:'data:image/png;base64,AA==',fileName:'original.png',width:180,height:120,offsetY:12,align:'right'}]}]});
 extras.ctx.EditorTools.focusQuestion(0);
 const shell=extras.document.querySelector('.enunciation-image-field');
 assert(!extras.document.querySelector('.question-images-details'));
 assert(!shell.querySelector('.enunciation-extra-images > button'));
 assert(!shell.querySelector('.enunciation-extra-images > input[type="file"]'));
 assert.equal(shell.querySelector('.extra-image-thumbnail').alt,'original.png');
 assert(!shell.querySelector('.image-edit-panel').classList.contains('hidden'));
 const trigger=shell.querySelector('.field-image-trigger');
 extras.event(trigger,'click'); assert.equal(trigger.getAttribute('aria-expanded'),'false');
 extras.event(trigger,'click'); assert.equal(trigger.getAttribute('aria-expanded'),'true');
 const width=shell.querySelector('.image-control-row input'); width.value='220'; extras.event(width,'input');
 assert.equal(extras.run('state.questions[0].freeImages.length'),1);
 await extras.run('saveToCloud()');
 const storedExtras=JSON.parse(extras.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions;
 assert.equal(storedExtras[0].freeImages[0].width,220); assert.equal(storedExtras[0].freeImages[0].align,'right');
 const restored=await boot({questions:storedExtras}); restored.ctx.EditorTools.focusQuestion(0);
 assert.equal(restored.document.querySelectorAll('.enunciation-image-field .extra-image-thumbnail').length,1);
 restored.event(restored.document.querySelector('.image-control-row button'),'click');
 assert.equal(restored.run('state.questions[0].freeImages.length'),0);
}
console.log('OK IMAGENS EXTRAS inclusão removida; imagens existentes permitem ajustar, salvar, reabrir e remover');
for (const align of ['lado_esquerda','lado_direita','left','center','right']) {
 ctx.q={type:'discursiva',text:'Explique a figura.',points:'1',lines:4,headerImage:{mode:'one',dataUrl:'data:image/png;base64,AA==',align,size:'medium',caption:'Figura'}};
 vm.runInContext('renderExam({questions:[q]},false)',ctx);
 const block=document.querySelector('.question-block');
 const beside=align.startsWith('lado_');
 assert.equal(Boolean(block.querySelector('.question-statement-with-image')),beside,align);
 assert.equal(block.querySelectorAll('.question-image').length,1,align);
 if (beside) {
  const statement=block.querySelector('.question-statement-with-image');
  assert(statement.querySelector('.qtext')); assert(statement.querySelector('.question-image'));
  assert(statement.nextElementSibling.classList.contains('qpreview'));
  assert(!statement.querySelector('.hline')); assert(!block.querySelector('.qpreview .question-image'));
 } else assert(block.querySelector('.qpreview .question-image'));
 assert.equal(block.querySelectorAll('.hline').length,4);
}
console.log('OK IMAGEM LATERAL junto do enunciado, sem duplicação e com resposta separada');
for (const [width,height] of [[400,1600],[1600,400],[600,600]]) {
 let previousWidth=0;
 for(const [size,heightLimit,targetWidth] of [['small',55,.28],['medium',90,.55],['large',139.5,.82],['full',195,1]]) {
 ctx.q={type:'discursiva',text:'Observe.',points:'1',headerImage:{mode:'one',dataUrl:'data:image/png;base64,AA==',align:'center',size}};
 vm.runInContext('renderExam({questions:[q]},false)',ctx);
 const img=document.querySelector('#root .question-image img');
 Object.defineProperties(img,{naturalWidth:{value:width},naturalHeight:{value:height},complete:{value:true}});
 vm.runInContext('fitQuestionImages()',ctx);
 const frame=10*25.4/96;
 const limit=parseFloat(img.style.getPropertyValue('--proportional-image-width'));
 assert(Math.abs(((limit-frame)*height/width+frame)-heightLimit)<0.001,'limite inclui moldura e mantém proporção');
 const renderedWidth=Math.min(192*targetWidth,limit);
 assert(renderedWidth>previousWidth,'tamanhos crescem sem inversão');
 previousWidth=renderedWidth;
 }
}
console.log('OK TAMANHOS limites proporcionais e progressivos para retrato, paisagem e quadrada');
const imageRecord={imageDataUrl:'data:image/png;base64,AA==',imageFileName:'figura.png'};
for(const question of [
 {type:'marcarx',items:[{text:'A',checked:true},{text:'B'}],optionImages:[{dataUrl:imageRecord.imageDataUrl,fileName:'figura.png'}]},
 {type:'vf',items:[{...imageRecord,text:'Afirmação',answer:true}]},
 {type:'sequencia_imagens',items:[{...imageRecord,order:1},{order:2}]},
 {type:'legenda_imagens',items:[{...imageRecord}]},
 {type:'grade_imagens',items:[{...imageRecord}]},
 {type:'relacione_imagens',pairs:[{...imageRecord,word:'Planta'}]},
 {type:'associacao_imagem_imagem',leftItems:[{...imageRecord}],rightItems:[{...imageRecord}],rightOrder:[0]},
 {type:'comparar_imagens',image1DataUrl:imageRecord.imageDataUrl,image1FileName:'figura.png'},
]) {
 const sizes=await boot({questions:[{...question,text:'Observe.',points:'10'}]}); sizes.ctx.EditorTools.focusQuestion(0);
 const control=[...sizes.document.querySelectorAll('.item-image-size-control')].find(node=>!node.hidden);
 assert(control,question.type);
 const select=control.querySelector('select'); select.value='large'; sizes.event(select,'change');
 await sizes.run('saveToCloud()');
 const savedQuestion=JSON.parse(sizes.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions[0];
 ctx.q=savedQuestion; vm.runInContext('renderExam({questions:[q]},false)',ctx);
 assert(document.querySelector('img[data-item-image-size="large"]'),question.type+' imprime tamanho escolhido');
 const again=await boot({questions:[savedQuestion]}); again.ctx.EditorTools.focusQuestion(0);
 assert([...again.document.querySelectorAll('.item-image-size-control select')].some(node=>node.value==='large'),question.type+' reabre tamanho salvo');
 const picker=control.closest('.image-picker'); const remove=[...picker.querySelectorAll('button')].find(node=>node.title==='Remover imagem');
 sizes.event(remove,'click'); assert(control.hidden,question.type+' oculta tamanho ao remover');
 sizes.run('readImageFile=(file,done)=>done("data:image/png;base64,BB==",file.name,1)');
 const fileInput=picker.querySelector('input[type="file"]'); fileInput.files=[{name:'nova.png'}]; sizes.event(fileInput,'change');
 assert(!control.hidden,question.type+' mostra tamanho depois do envio');
 select.value='medium'; sizes.event(select,'change');
 fileInput.files=[{name:'substituta.png'}]; sizes.event(fileInput,'change');
 assert.equal(select.value,'medium',question.type+' substituição preserva tamanho');
}
console.log('OK TAMANHO POR ITEM alternativas, afirmações, sequência, legenda, grade, relações e comparação: salvar, imprimir, reabrir e remover');
})().catch(e=>{console.error(e);process.exitCode=1});
