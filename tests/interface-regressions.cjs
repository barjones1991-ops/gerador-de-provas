const assert=require('node:assert/strict');const fs=require('fs');const {boot}=require('./editor-flows.cjs');
(async()=>{
 const questions=[{type:'vf',text:'Texto antigo',points:'3',items:[{text:'O sol ilumina',answer:'V'},{text:'Pedra cresce',answer:'F'}]},
 {type:'cruzadinha',text:'Complete',points:'3',clues:[{clue:'Animal',answer:'GATO'},{clue:'Astro',answer:'SOL'}]},
 {type:'caca_palavras',text:'Encontre',points:'4',wordsText:'SOL GATO',gridSize:8}];
 const app=await boot({questions});app.run('state.collapsedQuestions={};renderAll()');
 assert.equal(app.document.querySelector('#previewZoom').getAttribute('aria-label'),'Zoom da prévia');
 const vf=app.document.querySelector('[data-question-index="0"]');
 const radios=[...vf.querySelectorAll('input[type="radio"]')];assert.equal(radios.length,4);
 assert.equal(radios[0].getAttribute('aria-label'),'Questão 1: afirmação 1, verdadeiro');
 assert.equal(radios[3].getAttribute('aria-label'),'Questão 1: afirmação 2, falso');
 app.event(radios[2],'change');assert.equal(app.run('state.questions[0].items[1].answer'),'V');
 const text=vf.querySelector('[data-k="text"]');assert(text);
 const subtitle=vf.querySelector('.qhead-subtitle');text.value='<b>Novo enunciado</b>';app.event(text,'input');
 assert.equal(subtitle.textContent,'<b>Novo enunciado</b>');assert.equal(subtitle.title,text.value);assert.equal(subtitle.querySelector('b'),null);
 assert.equal(app.document.querySelector('[data-question-index="0"] [data-k="text"]'),text,'edição não recria o campo');
 text.value='  ';app.event(text,'input');assert.equal(subtitle.textContent,'Sem enunciado ainda');
 const remove=app.document.querySelector('[aria-label="Questão 2: remover pista 1"]');assert.equal(remove.textContent,'Remover');app.event(remove,'click');
 assert.equal(app.run('state.questions[1].clues.length'),1);
 assert.equal(app.document.querySelector('[aria-label="Questão 2: pista 1"]').value,'Astro');
 assert.equal(app.document.querySelector('[aria-label="Questão 2: resposta da pista 1"]').value,'SOL');
 assert(app.document.body.textContent.includes('A grade é gerada automaticamente.'));
 assert(![...app.document.querySelectorAll('[aria-label]')].some(el=>/Campo \d/.test(el.getAttribute('aria-label'))));
 const html=fs.readFileSync(require('path').join(__dirname,'../editor.html'),'utf8');assert(!html.includes('Ã©'));assert(!html.includes('Ã—'));
 // Reorganizing a form must retain its actual fields, values, locks and print
 // output. This catches lost controls even for types with nested list editors.
 const forms=await boot();
 forms.run('window.organizeForm=EditorTools.organizeStandardQuestion; EditorTools.organizeStandardQuestion=()=>{}');
 for(const type of forms.run('Object.keys(templates)').filter(type=>type!=='discursiva')) {
   forms.run(`state.questions=[templates[${JSON.stringify(type)}]()]; state.collapsedQuestions={}; renderAll()`);
   const card=forms.document.querySelector('.qcard');
   const fields=[...card.querySelectorAll('input,select,textarea')];
   const before=fields.map(field=>[field.value,field.checked,field.disabled]);
   const data=forms.run('examFingerprint()');
   const printed=forms.run('renderQuestionPreview(state.questions[0])');
   forms.run('window.organizeForm.call(EditorTools,document.querySelector(".qcard"),state.questions[0],0)');
   assert.equal(forms.run('examFingerprint()'),data,type+' must not mutate exam data');
   assert.equal(forms.run('renderQuestionPreview(state.questions[0])'),printed,type+' must not change print output');
   assert.equal(card.querySelectorAll('input,select,textarea').length,fields.length,type+' retains all fields');
   fields.forEach((field,i)=>{assert(card.contains(field),type+' retains the original field');assert.deepEqual([field.value,field.checked,field.disabled],before[i],type+' retains values and locks');});
   const statement=card.querySelector('[data-k="text"]');
   statement.value='Enunciado preservado';forms.event(statement,'input');
   assert.equal(forms.run('state.questions[0].text'),'Enunciado preservado',type+' retains editing events');
   assert.equal(card.querySelector('[data-k="text"]'),statement,type+' keeps focusable DOM identity');
 }
 console.log('OK INTERFACE codificação, V/F, pistas, zoom, resumo imediato e preservação do campo');
 console.log('OK INTERFACE todos os tipos e legados preservam campos, dados e saída impressa ao reorganizar');
})().catch(e=>{console.error(e);process.exitCode=1});
