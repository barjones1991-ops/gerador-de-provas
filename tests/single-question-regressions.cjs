const assert=require('node:assert/strict');const {boot}=require('./editor-flows.cjs');
(async()=>{
 const questions=[0,1,2].map(i=>({type:'discursiva',text:'Questão '+i,points:'1',lines:2}));const app=await boot({questions});
 const visible=()=>[...app.document.querySelectorAll('.qcard')].filter(card=>!card.hidden);
 assert.equal(visible().length,0,'ao abrir, nenhuma questão repetida abaixo da lista');
 assert.equal(app.document.querySelectorAll('#questionOutline .question-outline-open').length,3);
 app.document.getElementById('questionOverview').open=true;
 app.event(app.document.querySelectorAll('#questionOutline .question-outline-open')[1],'click');assert.equal(visible().length,1);assert.equal(visible()[0].id,'question-1');assert(!visible()[0].classList.contains('collapsed'));
 assert.equal(app.document.getElementById('questionOverview').open,false);
 assert.equal(app.document.getElementById('previewQuestionSelect').value,'1');
 assert.equal(app.document.body.dataset.editorView,'edit');
 app.ctx.EditorTools.updatePreview();
 assert.equal(app.document.querySelector('#questionOutline [aria-current]').getAttribute('aria-label'),'Questão 2: Questão 1');
 const text=visible()[0].querySelector('[data-k="text"]');text.value='Alterada';app.event(text,'input');
 app.document.getElementById('questionOverview').open=true;app.ctx.EditorTools.focusQuestion(0);assert.equal(app.document.getElementById('questionOverview').open,false);assert.equal(app.document.getElementById('previewQuestionSelect').value,'0');assert.equal(visible().length,1);assert.equal(visible()[0].id,'question-0');assert.equal(app.run('state.questions[1].text'),'Alterada');
 app.run("addQuestionOfType('discursiva')");assert.equal(visible().length,1);assert.equal(visible()[0].id,'question-3');assert(!visible()[0].classList.contains('collapsed'));
 app.event(visible()[0].querySelector('.qnum'),'click');assert.equal(visible().length,0);
 app.ctx.EditorTools.focusQuestion(2);const remove=visible()[0].querySelector('button[title="Remover questão"]');app.event(remove,'click');assert.equal(visible().length,0);assert.equal(app.run('state.questions.length'),3);
 app.ctx.currentQuestionBankResults=[{question:{type:'discursiva',text:'Do banco',points:'1'}}];await app.run('insertBankQuestion(0)');assert.equal(visible().length,1);assert.equal(visible()[0].id,'question-3');
 await app.run('saveToCloud()');const payload=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body);assert.equal(payload.questions.length,4);assert.equal(payload.questions[1].text,'Alterada');assert(!Object.hasOwn(payload,'activeQuestionIndex'));
 const reopened=await boot({questions:payload.questions});assert(![...reopened.document.querySelectorAll('.qcard')].some(card=>!card.hidden));
 const bank=await boot({bank:true});assert.equal([...bank.document.querySelectorAll('.qcard')].filter(card=>!card.hidden).length,1,'registro do banco abre para editar');
 const locked=await boot({status:'enviada',questions});locked.ctx.EditorTools.focusQuestion(1);assert.equal([...locked.document.querySelectorAll('.qcard')].filter(card=>!card.hidden).length,1,'consulta também seleciona uma questão');
 // Reordering moves entire question objects and keeps editor/preview pointing to the same question.
 const sortable=await boot({questions:[
  {type:'discursiva',text:'Primeira',lines:4,answerStyle:'linhas',expectedAnswer:'Resposta preservada',points:'2'},
  {type:'marcarx',text:'Segunda',items:[{text:'A',checked:true},{text:'B',checked:false}],markLayout:'tres_colunas',points:'3'},
  {type:'discursiva',text:'Terceira',lines:8,answerStyle:'linhas',points:'5'}]});
 sortable.ctx.EditorTools.focusQuestion(1);
 sortable.run('state.collapsedQuestions={0:true,1:false,2:true}');
 const original=sortable.run('JSON.stringify(state.questions)');
 sortable.ctx.EditorTools.moveQuestion(0,2);
 assert.deepEqual(JSON.parse(sortable.run('JSON.stringify(state.questions.map(q=>q.text))')),['Segunda','Terceira','Primeira']);
 assert.equal(sortable.run('state.activeQuestionIndex'),0);
 assert.equal(sortable.ctx.EditorTools.previewSelection,0);
 assert.equal(sortable.run('state.collapsedQuestions[0]'),false);
 assert.equal(sortable.run('state.questions[2].expectedAnswer'),'Resposta preservada');
 assert.equal(sortable.run('state.questions[0].markLayout'),'tres_colunas');
 await sortable.run('saveToCloud()');
 assert.equal(JSON.parse(sortable.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions[0].text,'Segunda');
 await sortable.ctx.EditorTools.travelHistory(-1);
 assert.equal(sortable.run('JSON.stringify(state.questions)'),original,'desfazer restaura todos os dados e a ordem');
 sortable.ctx.EditorTools.moveQuestion(2,0);
 assert.equal(sortable.run('state.questions[0].text'),'Terceira','arraste para cima');
 const lockedBefore=locked.run('JSON.stringify(state.questions)');
 locked.ctx.EditorTools.moveQuestion(0,1);assert.equal(locked.run('JSON.stringify(state.questions)'),lockedBefore);
 // Controlled layout for the drag lifecycle; actual visual movement is checked in the browser.
 const dragApp=await boot({questions:[0,1,2].map(i=>({type:'discursiva',text:'Arraste '+i,points:'1',lines:2,answerStyle:'linhas'}))});
 const nav=dragApp.document.getElementById('questionOutline');
 dragApp.document.getElementById('questionOverview').open=true;
 dragApp.ctx.requestAnimationFrame=()=>1;dragApp.ctx.cancelAnimationFrame=()=>{};
 dragApp.ctx.removeEventListener=(...args)=>dragApp.document.removeEventListener(...args);
 dragApp.ctx.matchMedia=()=>({matches:false});
 nav.getBoundingClientRect=()=>({top:0,left:0,right:500,bottom:280});
 nav.scrollTop=0;Object.defineProperty(nav,'clientTop',{value:0});
 const layout=()=>[...nav.children].forEach(row=>{
  Object.defineProperty(row,'offsetTop',{configurable:true,get:()=>[...nav.children].indexOf(row)*84});
  Object.defineProperty(row,'offsetHeight',{configurable:true,value:76});
  row.getBoundingClientRect=()=>({top:row.offsetTop,left:0,right:500,bottom:row.offsetTop+76,width:500,height:76});
 });
 const pointer=(node,type,y,x=100)=>{
  const e=new dragApp.ctx.Event(type,{bubbles:true,cancelable:true});
  Object.assign(e,{pointerId:1,isPrimary:true,button:0,pointerType:'mouse',clientX:x,clientY:y});node.dispatchEvent(e);return e;
 };
 const dragOriginal=dragApp.run('JSON.stringify(state.questions)');
 layout();pointer(nav.firstElementChild.querySelector('button'),'pointerdown',30);
 pointer(dragApp.document,'pointermove',225);
 assert(dragApp.document.querySelector('.question-outline-floating'),'card follows the pointer');
 assert.equal(nav.lastElementChild.dataset.questionIndex,'0','other rows make space before dropping');
 assert.equal(dragApp.run('JSON.stringify(state.questions)'),dragOriginal,'dragging does not save an intermediate order');
 const placeholder=nav.lastElementChild;dragApp.ctx.EditorTools.updatePreview();assert.equal(nav.lastElementChild,placeholder,'preview refresh cannot replace an active drag');
 const escape=new dragApp.ctx.Event('keydown',{bubbles:true,cancelable:true});escape.key='Escape';dragApp.document.dispatchEvent(escape);
 assert.equal(dragApp.run('JSON.stringify(state.questions)'),dragOriginal);
 assert(!dragApp.document.querySelector('.question-outline-floating'));assert.equal(nav.firstElementChild.dataset.questionIndex,'0');
 layout();pointer(nav.firstElementChild.querySelector('button'),'pointerdown',30);pointer(dragApp.document,'pointermove',225);pointer(dragApp.document,'pointerup',225);
 assert.equal(dragApp.run('state.questions[2].text'),'Arraste 0','drop commits exactly the previewed order');
 const moved=dragApp.run('JSON.stringify(state.questions)');
 layout();pointer(nav.firstElementChild.querySelector('button'),'pointerdown',30);pointer(dragApp.document,'pointermove',225);pointer(dragApp.document,'pointerup',225,900);
 assert.equal(dragApp.run('JSON.stringify(state.questions)'),moved,'drop outside cancels');
 // A quick touch swipe remains scrollable; a held touch becomes a drag.
 const touch=(node,type,y)=>{
  const e=new dragApp.ctx.Event(type,{bubbles:true,cancelable:true});const point={identifier:7,clientX:100,clientY:y};
  e.touches=type==='touchend'?[]:[point];e.changedTouches=[point];node.dispatchEvent(e);return e;
 };
 layout();touch(nav.firstElementChild.querySelector('button'),'touchstart',30);
 const swipe=touch(dragApp.document,'touchmove',60);assert(!swipe.defaultPrevented);assert.equal(dragApp.ctx.EditorTools.outlineDrag,null);
 touch(nav.firstElementChild.querySelector('button'),'touchstart',30);
 dragApp.timers.get(dragApp.ctx.EditorTools.outlineDrag.holdTimer)();
 const heldMove=touch(dragApp.document,'touchmove',225);assert(heldMove.defaultPrevented,'held touch drags instead of scrolling');
 dragApp.event(dragApp.document,'touchcancel');assert.equal(dragApp.run('JSON.stringify(state.questions)'),moved);assert(!dragApp.document.querySelector('.question-outline-floating'));
 console.log('OK QUESTAO UNICA lista, seleção, nova, fechar, exclusão, banco, salvamento e consulta');
})().catch(e=>{console.error(e);process.exitCode=1});
