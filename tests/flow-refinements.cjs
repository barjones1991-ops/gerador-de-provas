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
