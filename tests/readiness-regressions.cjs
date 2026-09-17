const assert=require('node:assert/strict');
const safety=require('../js/exam-safety.js');
const {boot}=require('./editor-flows.cjs');
const question=(type,fields={})=>({type,text:'Leia e responda.',points:'10',...fields});
const exam=q=>({title:'Ciências',subject:'Ciências',class_name:'1A',total_value:'10',questions:[q]});
const check=q=>safety.inspectExam(exam(q));
const img='data:image/png;base64,AAAA';
const valid=[
 question('discursiva'), question('espaco_livre'), question('problema_matematico'),
 question('multipla',{options:['A','B'],correctOption:0}),
 question('vf',{items:[{text:'Afirmação',answer:'F'}]}),
 question('marcarx',{markMode:'checklist',items:[{text:'Observe'}]}),
 question('expressao_matematica',{expressions:[{latex:'1+1',answer:'2'}]}),
 question('sequencia_numerica',{sequences:[{items:'1, __',answer:'2'}]}),
 question('silabas',{words:[{word:'CASA',answer:'CA-SA'}]}),
 question('leitura_escrita',{words:['Árvore']}),
 question('lacunas',{items:[{text:'A planta precisa de ___.',answer:'água'}]}),
 question('lacunas',{text:'A planta precisa de ___.',answers:['água']}),
 question('subitens',{items:[{imageDataUrl:img}]}),
 question('ordenacao',{items:[{text:'A',order:2},{text:'B',order:1}]}),
 question('sequencia_imagens',{items:[{imageDataUrl:img,order:1}]}),
 question('legenda_imagens',{items:[{imageDataUrl:img,answer:'Árvore'}]}),
 question('grade_imagens',{showAnswerLines:false,items:[{imageDataUrl:img}]}),
 question('identificar_imagem',{imageDataUrl:img,showAnswerList:false,markers:[{label:'A'}]}),
 question('relacione',{pairs:[{left:'A',right:'B'}],rightOrder:[0]}),
 question('relacione_imagens',{pairs:[{imageDataUrl:img,word:'Árvore'}],wordOrder:[0]}),
 question('associacao_setas',{leftItems:['A'],rightItems:['B']}),
 question('associacao_imagem_imagem',{leftItems:[{imageDataUrl:img}],rightItems:[{imageDataUrl:img}],rightOrder:[0]}),
 question('tabela',{headers:['A'],rows:[['']]}),
];
for(const q of valid){const before=JSON.stringify(q);assert.deepEqual(check(q),[],q.type);assert.equal(JSON.stringify(q),before);}
const invalid=[
 ['expressao_matematica',{expressions:[{latex:'1+1',answer:'  '}]},'Resposta do item 1'],
 ['expressao_matematica',{expressions:[]},'Adicione expressões'],
 ['vf',{items:[{text:'',answer:''}]},'gabarito V/F'],
 ['marcarx',{markMode:'unica',items:[{text:'A',checked:true},{text:'B',checked:true}]},'somente uma'],
 ['imagem',{imageDataUrl:img,imageAnswerType:'marcarx',items:[{text:'A'}]},'Marque'],
 ['multipla',{options:['A','B'],correctOption:''},'Marque'],
 ['multipla',{options:['A'],correctOption:0},'duas alternativas'],
 ['lacunas',{items:[{text:'Sem espaço',answer:''}]},'sublinhados'],
 ['relacione',{pairs:[{left:'A',right:' '}]},'Texto direito'],
 ['relacione_imagens',{pairs:[{word:'Árvore'}]},'Imagem do item 1'],
 ['legenda_imagens',{items:[{imageDataUrl:img,answer:''}]},'Resposta do item 1'],
 ['sequencia_numerica',{sequences:[{items:'1,__'}]},'Resposta'],
 ['silabas',{words:[{word:'CASA'}]},'Resposta'],
 ['matematica_coluna',{operations:[]},'operação'],
 ['subitens',{items:[{text:' '}]},'Subitem 1'],
 ['grade_imagens',{showAnswerLines:true,items:[{imageDataUrl:img}]},'correção manual'],
 ['identificar_imagem',{imageDataUrl:img,markers:[{}]},'Resposta'],
];
for(const [type,fields,text] of invalid){const issues=check(question(type,fields));assert(issues.some(i=>i.index===0&&i.message.includes(text)),type+': '+JSON.stringify(issues));assert(!issues.some(i=>i.blocking),type);}
for(const orders of [[1,1],[0,2],[1,3],[1,1.5],[1,'2']]){
 const q=question('ordenacao',{items:orders.map(order=>({text:'Item',order}))});
 assert(check(q).some(i=>i.blocking&&i.message.includes('Ordem')),JSON.stringify(orders));
}
for(const order of [[0,0],[0],[-1,1],[0,2],'0,1']){
 assert(check(question('relacione',{pairs:[{left:'A',right:'B'},{left:'C',right:'D'}],rightOrder:order})).some(i=>i.blocking));
}
assert(check(question('associacao_setas',{leftItems:['A'],rightItems:[]})).some(i=>i.blocking));
assert(check(question('tabela',{headers:['A'],rows:[['a','b']]})).some(i=>i.blocking));
assert(check(question('relacione',{pairs:'invalid'})).some(i=>i.blocking));
assert(check(question('lacunas',{items:[null]})).some(i=>i.blocking));
console.log('OK CONFERENCIA campos por tipo, formatos abertos, ordens, pares e imutabilidade');
(async()=>{
 const app=await boot({questions:[question('discursiva',{points:'5'}),question('expressao_matematica',{points:'5',expressions:[{latex:'1+1',answer:''}]})]});
 app.ctx.EditorTools.updatePreview();
 const buttons=[...app.document.querySelectorAll('#examIssues button')];
 const button=buttons.find(el=>el.textContent.includes('Questão 2: Resposta'));
 assert(button,'aviso aparece no editor real');
 let focused;app.ctx.EditorTools.focusQuestion=index=>{focused=index};app.event(button,'click');assert.equal(focused,1);
 app.run("state.questions[1].expressions[0].answer='2'");app.ctx.EditorTools.updatePreview();
 assert(!app.document.getElementById('examIssues').textContent.includes('Resposta do item'));
 assert.equal(app.document.getElementById('readinessSummary').textContent,'Nenhuma pendência automática');
 // Invalid ordering must remain saveable as a draft, but not be sent for review.
 app.run("state.questions=[{type:'ordenacao',text:'Ordene',points:'10',items:[{text:'A',order:1},{text:'B',order:1}]}]");
 await app.run('saveToCloud()');
 assert(app.requests.some(r=>r.options.method==='PATCH'));
 const count=app.requests.filter(r=>r.options.method==='PATCH').length;
 await app.ctx.EditorTools.sendToCoordination();
 assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,count);
 console.log('OK CONFERENCIA navegação do aviso, atualização, rascunho e bloqueio do envio');
})().catch(e=>{console.error(e);process.exitCode=1});
