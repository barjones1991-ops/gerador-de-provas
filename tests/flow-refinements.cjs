const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const {boot} = require('./editor-flows.cjs');
const ExamSafety = require('../js/exam-safety.js');
function extract(file,name,spaces) {
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
  const start=source.indexOf(`${' '.repeat(spaces)}async function ${name}(`);
  assert(start>=0,name);
  const tail=source.slice(start); const end=new RegExp(`^ {${spaces}}}\\s*$`,'m').exec(tail);
  return tail.slice(0,end.index+end[0].length);
}
(async()=>{
  const organized=await boot({questions:[{type:'discursiva',text:'Questão',points:'10,0',freeImages:[{dataUrl:'data:image/png;base64,AA==',width:180,height:120}]}]});
  assert(!organized.document.querySelector('.question-footer'), 'collapsed questions contain only the heading');
  organized.run('state.collapsedQuestions={}; renderAll();');
  assert(!organized.document.querySelector('.q-tools-menu'));
  const card=organized.document.querySelector('.qcard');
  assert(card.querySelector('.question-images .free-image-fields'));
  assert(card.querySelector('.question-footer button[title="Salvar no banco de questões"]'));
  assert(card.querySelector('.qhead button[title="Remover questão"]'));
  assert.equal(card.querySelector('.question-score label').textContent,'Valor');
  assert(!card.querySelector('.question-appearance'));
  assert(card.querySelector('.qhead [data-presentation="number"]'));
  const codePanel=card.querySelector('.question-bncc');
  assert(!codePanel.open);
  assert.equal(codePanel.querySelector('summary').textContent,'Código BNCC (opcional)');
  const code=codePanel.querySelector('[data-k="bncc"]');
  code.value='EF01CI01'; organized.event(code,'input');
  assert.equal(codePanel.querySelector('summary').textContent,'Código BNCC · EF01CI01');
  assert.equal(organized.run('state.questions[0].bncc'),'EF01CI01');
  assert.equal(card.querySelector('[data-k="bncc"]'),code,'digitar preserva o campo');
  const number=card.querySelector('[data-presentation="number"]'); number.checked=false; organized.event(number,'change');
  const answer=card.querySelector('[data-presentation="answer-space"]'); answer.checked=false; organized.event(answer,'change');
  assert.equal(organized.run('state.questions[0].hideNumber'),true);
  assert.equal(organized.run('state.questions[0].showAnswerSpace'),false);
  await organized.run('saveToCloud()');
  const stored=JSON.parse(organized.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions[0];
  assert.equal(stored.hideNumber,true); assert.equal(stored.showAnswerSpace,false);
  assert.equal(stored.freeImages.length,1);
  assert.equal(stored.bncc,'EF01CI01');
  const reopened=await boot({questions:[stored]}); reopened.run('state.collapsedQuestions={}; renderAll();');
  assert.equal(reopened.document.querySelector('.question-bncc summary').textContent,'Código BNCC · EF01CI01');
  assert.equal(reopened.document.querySelector('[data-presentation="number"]').checked,false);
  const locked=await boot({status:'enviada'}); locked.run('state.collapsedQuestions={}; renderAll();');
  assert(locked.document.querySelector('[data-presentation="number"]').disabled);
  assert(locked.document.querySelector('[data-k="bncc"]').disabled);
  assert(locked.document.querySelector('.qhead button[title="Remover questão"]').disabled);
  const record=await boot({bank:true}); record.run('state.collapsedQuestions={}; renderAll();');
  assert(!record.document.querySelector('.question-footer'));
  console.log('OK REFINAMENTO questao sem menu preserva controles salvamento imagens e permissoes');
  for (const bank of [false,true]) {
    const app=await boot({bank}); app.run('state.collapsedQuestions={}; renderAll();');
    assert.equal(app.run('typeof duplicateQuestion'),'undefined');
    assert.equal(app.run('typeof moveQuestion'),'undefined');
    assert(![...app.document.querySelectorAll('.qcard button')].some(b=>['Duplicar','Subir','Descer'].includes(b.textContent)));
    if(bank) assert(!app.document.querySelector('button[title="Remover questão"]'));
  }
  for(const questions of [[],[{type:'discursiva'},{type:'discursiva'}],[{type:'invalido'}]]) {
    const app=await boot({bank:true}); app.run(`state.questions=${JSON.stringify(questions)}`);
    assert.equal(await app.ctx.EditorTools.saveBank(),false);
    assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,0);
    assert(app.storage.has(app.run('pendingDraftKey()')));
  }
  console.log('OK REFINAMENTO banco impede perda por quantidade invalida e acoes removidas');
  for(const action of ['recover','later','discard']) {
    const app=await boot();
    const content=JSON.parse(app.run('examFingerprint()')); content.questions[0].text='Texto recuperado';
    const key=app.run('pendingDraftKey()'); const raw=JSON.stringify({version:'v1',content:JSON.stringify(content)});
    app.storage.set(key,raw); app.run('restorePendingDraft()');
    assert.equal(app.ctx.EditorTools.canEdit(),false);
    const buttons=[...app.document.querySelectorAll('#draftRecoveryChoice button')];
    if(action==='recover') { buttons[0].onclick(); assert.equal(app.run('state.questions[0].text'),'Texto recuperado'); assert(app.ctx.EditorTools.canEdit()); }
    if(action==='later') { buttons[2].onclick(); assert.equal(app.ctx.location.href,'dashboard.html'); assert.equal(app.storage.get(key),raw); }
    if(action==='discard') {
      app.ctx.confirm=()=>false; buttons[1].onclick(); assert.equal(app.storage.get(key),raw);
      app.ctx.confirm=()=>true; buttons[1].onclick(); assert(!app.storage.has(key)); assert.equal(app.run('state.questions[0].text'),'Questão original');
    }
  }
  console.log('OK REFINAMENTO recuperacao exige escolha e conserva copia ao adiar ou cancelar descarte');
  const bad={type:'caca_palavras',text:'Encontre',points:'10,0',wordsText:'A'.repeat(30),gridSize:12};
  const app=await boot({questions:[bad]}); await app.ctx.EditorTools.sendToCoordination();
  assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,0);
  let requests=0;
  const exam={id:'e1',questions:[bad],total_value:'10,0',review_status:'rascunho'};
  const dashboard=vm.createContext({ExamSafety,exams:[exam],hasExamQuestions:()=>true,getExamScoreCheck:()=>({isConsistent:true}),showToast(){},auth:{authenticatedRequest:async()=>{requests++;}}});
  vm.runInContext(extract('dashboard.html','sendToReview',2),dashboard); await dashboard.sendToReview('e1'); assert.equal(requests,0);
  console.log('OK REFINAMENTO painel e editor recusam o mesmo passatempo invalido');
  const fields={newExamSubject:{value:'Matemática'},newExamClass:{value:'5A'},confirmNewExamBtn:{}};
  let payload;
  const create=vm.createContext({document:{getElementById:id=>fields[id]},currentProfile:{school_id:'s1',full_name:'Professor'},localStorage:{setItem(){}},window:{location:{}},showToast(){},auth:{getCurrentUser:()=>({id:'u1'}),authenticatedRequest:async(url,opt)=>{
    if(url.startsWith('/schools'))return [{name:'Escola',logo_data_url:'data:image/png;base64,AA=='}]; payload=JSON.parse(opt.body); return [{id:'e1'}];
  }}});
  vm.runInContext(extract('dashboard.html','createNewExamFromModal',2),create); await create.createNewExamFromModal();
  assert.equal(payload.logo_data_url,'data:image/png;base64,AA==');
  payload=null; create.auth.authenticatedRequest=async()=>{throw new Error('offline');}; await create.createNewExamFromModal(); assert.equal(payload,null); assert.equal(fields.confirmNewExamBtn.disabled,false);
  console.log('OK REFINAMENTO nova prova herda logo e falha escolar nao cria cabecalho incompleto');
  for(const mode of ['active','withdrawn','printed','missing','offline','account']) {
    let prints=0,rendered=null;
    const fresh={id:'e1',title:'Atualizada',review_status:mode==='withdrawn'?'em_revisao':'aprovada',print_status:mode==='printed'?'impressa':'enviada',questions:[]};
    const ctx=vm.createContext({ExamSafety,printing:false,printViewerId:'u1',currentExam:{id:'e1',title:'Antiga'},printProfile:null,Promise,
      printAuth:{getCurrentUser:()=>({id:mode==='account'?'u2':'u1'}),loadCurrentProfile:async()=>({role:'print_operator'}),hasRole:roles=>roles.includes('print_operator'),authenticatedRequest:async()=>{if(mode==='offline')throw new Error('offline');return mode==='missing'?[]:[fresh];}},
      isFromPrintQueue:()=>true,renderExam:exam=>{rendered=exam;},updatePrintToolbar(){},document:{title:'Prova',querySelectorAll:()=>[]},window:{addEventListener(){},print(){prints++;}},setTimeout(){},alert(){},
    });
    vm.runInContext(extract('print.html','printCleanDocument',4),ctx); await ctx.printCleanDocument();
    assert.equal(prints,mode==='active'?1:0,mode); assert.equal(ctx.printing,false);
    if(mode==='active')assert.equal(rendered.title,'Atualizada');
  }
  console.log('OK REFINAMENTO impressao revalida pedido conta e rede e usa conteudo atual');
})().catch(error=>{console.error(error);process.exitCode=1;});
