const assert=require('node:assert/strict');const {boot}=require('./editor-flows.cjs');
(async()=>{
 const app=await boot({questions:[{type:'discursiva',text:'Plantas',points:'5',lines:3},{type:'matematica_coluna',text:'Resolva',points:'5',operations:[{num1:'2',op:'+',num2:'3',result:''}]}]});
 const hint=app.document.getElementById('lastSaved');assert(hint);const before=hint.textContent;
 app.ctx.EditorTools.focusQuestion(1);assert.equal(hint.textContent,before,'navegação não indica edição pendente');assert(!app.ctx.EditorTools.persistTimer,'navegação não agenda salvamento');
 const card=app.document.querySelector('#question-1');const appearance=card.querySelector('.appearance-settings');assert(appearance && !appearance.open);assert(appearance.querySelector('[data-k="columns"]'));
 assert(card.textContent.indexOf('Operações —') < card.textContent.indexOf('Aparência na prova'));
 const search=app.document.getElementById('questionSearch');search.value='discursativa';search.oninput();assert.equal([...app.document.querySelectorAll('#questionOutline button')].filter(b=>!b.hidden).length,1);
 search.value='inexistente';search.oninput();assert(!app.document.getElementById('questionSearchEmpty').hidden);
 const picker=app.document.getElementById('topQuestionMenu');const filter=picker.querySelector('input');filter.value='matem';filter.oninput();assert.equal([...picker.querySelectorAll('button[data-type]')].filter(b=>!b.hidden).length,3);
 const category=picker.querySelector('select');category.value='Imagens e desenho';filter.value='';category.onchange();assert([...picker.querySelectorAll('button[data-type]')].filter(b=>!b.hidden).every(b=>b.dataset.category==='Imagens e desenho'));
 assert.equal(app.document.getElementById('previewZoom').value,'fit');
 app.document.getElementById('viewPreviewBtn').onclick();assert.equal(app.document.body.dataset.editorView,'preview');app.document.getElementById('viewEditBtn').onclick();assert.equal(app.document.body.dataset.editorView,'edit');
 const text=card.querySelector('[data-k="text"]');text.value='Conta nova';app.event(text,'input');assert(app.ctx.EditorTools.persistTimer,'edição real agenda salvamento');
 console.log('OK UX busca, categorias, navegação sem salvamento, edição, aparência matemática e modos');
})().catch(e=>{console.error(e);process.exitCode=1});
