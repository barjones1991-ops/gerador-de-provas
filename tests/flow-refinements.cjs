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
  assert(card.querySelector('.question-footer button[title="Remover questão"]'));
  assert.equal(card.querySelector('.question-score label').textContent,'Valor');
  assert(!card.querySelector('.question-appearance'));
  assert(card.querySelector('.discursive-settings [data-presentation="number"]'));
  const codePanel=card.querySelector('.question-bncc');
  assert(!codePanel.open);
  assert.equal(codePanel.querySelector('.discursive-settings-title').textContent,'Ajustes complementares');
  const code=codePanel.querySelector('[data-k="bncc"]');
  code.value='EF01CI01'; organized.event(code,'input');
  assert.equal(codePanel.querySelector('.discursive-settings-title').textContent,'Ajustes complementares · BNCC EF01CI01');
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
  assert.equal(reopened.document.querySelector('.discursive-settings-title').textContent,'Ajustes complementares · BNCC EF01CI01');
  assert.equal(reopened.document.querySelector('[data-presentation="number"]').checked,false);
  const locked=await boot({status:'enviada'}); locked.run('state.collapsedQuestions={}; renderAll();');
  assert(locked.document.querySelector('[data-presentation="number"]').disabled);
  assert(locked.document.querySelector('[data-k="bncc"]').disabled);
  assert(locked.document.querySelector('.question-footer button[title="Remover questão"]').disabled);
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
    if(action==='recover') { await buttons[0].onclick(); assert.equal(app.run('state.questions[0].text'),'Texto recuperado'); assert(app.ctx.EditorTools.canEdit()); }
    if(action==='later') { buttons[2].onclick(); assert.equal(app.ctx.location.href,'dashboard.html'); assert.equal(app.storage.get(key),raw); }
    if(action==='discard') {
      app.ctx.confirm=()=>false; buttons[1].onclick(); assert.equal(app.storage.get(key),raw);
      app.ctx.confirm=()=>true; buttons[1].onclick(); assert(!app.storage.has(key)); assert.equal(app.run('state.questions[0].text'),'Questão original');
    }
  }
  console.log('OK REFINAMENTO recuperacao exige escolha e conserva copia ao adiar ou cancelar descarte');
  const draftSource=await boot();
  const signed=`${draftSource.ctx.CONFIG.SUPABASE_URL}/object/sign/exam-images/u1/e1/old.png?token=expired`;
  draftSource.run(`state.questions[0].imageDataUrl=${JSON.stringify(signed)}; preservePendingDraft();`);
  const draftKey=draftSource.run('pendingDraftKey()');
  const savedDraft=draftSource.storage.get(draftKey);
  const durableContent=JSON.parse(JSON.parse(savedDraft).content);
  assert.equal(durableContent.questions[0].imageDataUrl,'storage://exam-images/u1/e1/old.png');
  draftSource.run("EditorTools.resetHistory(); state.questions[0].text='Alterada'; EditorTools.recordHistory();");
  assert(JSON.parse(draftSource.ctx.EditorTools.history[0]).questions[0].imageDataUrl.startsWith('storage://'));
  await draftSource.ctx.EditorTools.travelHistory(-1);
  assert.equal(draftSource.run('state.questions[0].imageDataUrl'),'storage://exam-images/u1/e1/old.png');
  const restarted=await boot();
  restarted.storage.set(restarted.run('pendingDraftKey()'),savedDraft);
  restarted.run('restorePendingDraft()');
  await restarted.document.querySelector('#draftRecoveryChoice button').onclick();
  await restarted.run('saveToCloud()');
  const recoveredPayload=JSON.parse(restarted.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body);
  assert.equal(recoveredPayload.questions[0].imageDataUrl,'storage://exam-images/u1/e1/old.png');
  console.log('OK REFINAMENTO rascunho e historico preservam referencias duraveis em nova sessao');
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
  const create=vm.createContext({document:{getElementById:id=>fields[id]},currentProfile:{school_id:'s1',full_name:'Professor'},uniqueCleanList:value=>Array.isArray(value)?value:[],checkCreatedExam:async()=>null,localStorage:{setItem(){}},window:{location:{}},showToast(){},auth:{getCurrentUser:()=>({id:'u1'}),authenticatedRequest:async(url,opt)=>{
    if(url.startsWith('/schools'))return [{name:'Escola',logo_data_url:'data:image/png;base64,AA==',classes:['5A'],disciplines:['Matemática']}]; payload=JSON.parse(opt.body); return [{id:'e1'}];
  }}});
  vm.runInContext(extract('dashboard.html','createNewExamFromModal',2),create); await create.createNewExamFromModal();
  assert.equal(payload.logo_data_url,'data:image/png;base64,AA==');
  payload=null; fields.newExamClass.value='Turma removida'; await create.createNewExamFromModal(); assert.equal(payload,null);
  fields.newExamClass.value='5A';
  payload=null; create.auth.authenticatedRequest=async()=>{throw new Error('offline');}; await create.createNewExamFromModal(); assert.equal(payload,null); assert.equal(fields.confirmNewExamBtn.disabled,false);
  console.log('OK REFINAMENTO nova prova herda logo e falha escolar nao cria cabecalho incompleto');
  const duplicateRequests=[];
  const duplicateSource={id:'old',school_id:'old-school',school_name:'Escola antiga',logo_data_url:'old-logo',title:'Prova',questions:[],decorative_images:[]};
  const duplicate=vm.createContext({exams:[duplicateSource],currentProfile:{school_id:'new-school',full_name:'Professora atual'},pendingExamOperations:new Set(),renderExams(){},showToast(){},checkCreatedExam:async()=>null,localStorage:{setItem(){}},window:{location:{}},
    loadExamContent:async exam=>exam,auth:{getCurrentUser:()=>({id:'u1',email:'atual@example.com'}),authenticatedRequest:async(url,opt)=>{
      if(url.startsWith('/schools'))return [{name:'Escola atual',logo_data_url:'new-logo'}];
      duplicateRequests.push(JSON.parse(opt.body)); return [{id:'copy'}];
    }},globalThis:{crypto:{randomUUID:()=> 'copy'}},
  });
  vm.runInContext(extract('dashboard.html','duplicateExam',2),duplicate);
  await Promise.all([duplicate.duplicateExam('old'), duplicate.duplicateExam('old')]);
  assert.equal(duplicateRequests[0].school_name,'Escola atual');
  assert.equal(duplicateRequests[0].logo_data_url,'new-logo');
  assert.equal(duplicateRequests[0].teacher,'Professora atual');
  assert.equal(duplicateRequests.length,1);
  console.log('OK REFINAMENTO copia usa cabecalho da escola atual apos mudanca de vinculo');
  let releaseClassSave;
  const classSaveGate=new Promise(resolve=>{releaseClassSave=resolve;});
  const classPayloads=[];
  const cleanedClassPayloads=[];
  const classSaves=vm.createContext({pendingClassSaves:new Set(),queuedClassSaves:new Map(),currentProfile:{},
    getUniqueList:value=>[...new Set(value)],cleanupRemovedSchoolClasses:async(id,value)=>{cleanedClassPayloads.push(value);return {updated:0};},showToast(){},
    loadSchools:async()=>{},loadProfessors:async()=>{},loadInvites:async()=>{},Promise,
    auth:{canManageSchools:()=>true,authenticatedRequest:async(url,opt)=>{classPayloads.push(JSON.parse(opt.body).classes);if(classPayloads.length===1)await classSaveGate;return [{id:'s1'}];}},
    document:{getElementById:()=>null},
  });
  vm.runInContext(extract('schools.html','saveSchoolClasses',2),classSaves);
  const firstClassSave=classSaves.saveSchoolClasses('s1',['1A']);
  await classSaves.saveSchoolClasses('s1',['1A','2A']);
  releaseClassSave(); await firstClassSave; await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(classPayloads,[['1A'],['1A','2A']]);
  assert.deepEqual(cleanedClassPayloads,[['1A','2A']]);
  console.log('OK REFINAMENTO alteracoes rapidas de turmas preservam a lista mais recente');
  const dashboardSource=fs.readFileSync(path.join(__dirname,'..','dashboard.html'),'utf8').replace(/\r\n/g,'\n');
  const disciplineStart=dashboardSource.indexOf('  function getNewExamDisciplines()');
  const disciplineEnd=dashboardSource.indexOf('  function getCurrentSchoolClasses()',disciplineStart);
  const disciplineContext=vm.createContext({
    currentProfile:{disciplines:['Matemática']},currentSchool:{disciplines:[]},
    uniqueCleanList:value=>Array.isArray(value)?value:[],
  });
  vm.runInContext(dashboardSource.slice(disciplineStart,disciplineEnd),disciplineContext);
  assert.deepEqual([...disciplineContext.getNewExamDisciplines()],[], 'escola sem disciplinas nao deve reativar vinculos antigos');
  const disciplineUpdates=[];
  const disciplineCleanup=vm.createContext({teamProfiles:[{id:'p1',role:'teacher',school_id:'s1',disciplines:['Matemática']}],invites:[{id:'i1',role:'teacher',school_id:'s1',disciplines:['Matemática']}],
    getUniqueList:value=>Array.isArray(value)?[...new Set(value)]:[],filterDisciplinesBySchool:(values,official)=>values.filter(value=>official.includes(value)),Promise,
    auth:{normalizeRole:role=>role,authenticatedRequest:async(url,opt)=>{disciplineUpdates.push({url,body:JSON.parse(opt.body)});return [{id:url.includes('p1')?'p1':'i1'}];}},
  });
  vm.runInContext(extract('schools.html','cleanupRemovedSchoolDisciplines',2),disciplineCleanup);
  await disciplineCleanup.cleanupRemovedSchoolDisciplines('s1',[]);
  assert.equal(disciplineUpdates.length,2);
  assert(disciplineUpdates.every(update=>Array.isArray(update.body.disciplines)&&update.body.disciplines.length===0));
  console.log('OK REFINAMENTO remocao da ultima disciplina bloqueia vinculos antigos');

  let discardedRecoveredLogo=false;
  const schoolFields={'se-name-s1':{value:'Escola'},'se-city-s1':{value:'Cidade'},'se-email-s1':{value:'contato@escola.test'}};
  let committedSchool=null;
  const schoolMessages=[];
  const schoolRecovery=vm.createContext({currentProfile:{},pendingSchoolSaves:new Set(),queuedSchoolSaves:new Set(),pendingLogos:{s1:'data:image/png;base64,AA=='},
    document:{getElementById:id=>schoolFields[id]||null},showToast:(message,type)=>schoolMessages.push({message,type}),loadSchools:async()=>{},
    window:{ExamImageStorage:{persistTree:async()=>({logo:'asset://10000000-0000-4000-8000-000000000001'}),discardTree:async()=>{discardedRecoveredLogo=true;}}},
    auth:{canManageSchools:()=>true,authenticatedRequest:async(url,opt={})=>{
      if(opt.method==='PATCH'){committedSchool={id:'s1',...JSON.parse(opt.body)};throw new Error('timeout depois do commit');}
      return committedSchool?[committedSchool]:[];
    }},
  });
  vm.runInContext(extract('schools.html','saveSchoolEdit',2),schoolRecovery);
  await schoolRecovery.saveSchoolEdit('s1');
  assert.equal(discardedRecoveredLogo,false,'logo confirmado no banco nao pode ser descartado');
  assert.equal('s1' in schoolRecovery.pendingLogos,false);
  assert.match(schoolMessages.at(-1).message,/confirmação foi recuperada/);
  console.log('OK REFINAMENTO edicao escolar preserva logo confirmado apos timeout');

  const inviteFields={linkSchoolSelect:{value:'s1'},linkProfEmail:{value:'prof@escola.test'},inviteRoleSelect:{value:'teacher'},linkGradeCheckboxes:{},linkResult:{textContent:'',innerHTML:''},createInviteBtn:{disabled:false}};
  let invitePosts=0,inviteReads=0,uuidCalls=0,committedInvite=null;
  const postedInviteIds=[];
  const inviteRecovery=vm.createContext({currentProfile:{school_id:'s1'},pendingInviteAttempt:null,crypto:{randomUUID:()=>{uuidCalls++;return '10000000-0000-4000-8000-000000000099';}},
    document:{getElementById:id=>inviteFields[id],querySelectorAll:()=>[]},getCheckedValues:()=>['5A'],canManageInvites:()=>true,
    buildInviteLink:token=>`login.html?invite=${token}`,esc:value=>String(value),showToast(){},loadInvites:async()=>{},
    auth:{hasRole:roles=>roles.includes('coordinator'),getCurrentUser:()=>({id:'u1'}),authenticatedRequest:async(url,opt={})=>{
      if(opt.method==='POST'){invitePosts++;const body=JSON.parse(opt.body);postedInviteIds.push(body.id);committedInvite={...body,token:'token-confirmado'};throw new Error(invitePosts===1?'timeout depois do commit':'chave duplicada');}
      inviteReads++;if(inviteReads===1)throw new Error('rede ainda indisponivel');
      return committedInvite?[committedInvite]:[];
    }},
  });
  vm.runInContext(extract('schools.html','createInvite',2),inviteRecovery);
  await inviteRecovery.createInvite();
  await inviteRecovery.createInvite();
  assert.equal(new Set(postedInviteIds).size,1,'nova tentativa deve reutilizar o UUID cuja confirmacao ficou incerta');
  assert.equal(uuidCalls,1);
  assert.match(inviteFields.linkResult.innerHTML,/token-confirmado/);
  console.log('OK REFINAMENTO convite recupera a criacao pelo UUID conhecido');

  const printMessages=[];
  const printFields={printCopiesInput:{value:'2'},printNotesInput:{value:''},confirmPrintBtn:{disabled:false}};
  const printRecovery=vm.createContext({pendingPrintId:'e1',reviews:[{id:'e1',review_status:'aprovada',print_status:'impressa',updated_at:'antiga'}],pendingActions:new Set(),
    document:{getElementById:id=>printFields[id]},getReviewActions:()=>({print:true}),renderReviews(){},closePrintModal(){throw new Error('nao deveria confirmar');},
    showToast:(message,type)=>printMessages.push({message,type}),loadExamState:async()=>({id:'e1',print_status:'impressa',print_requested_at:'pedido-antigo',print_requested_by:'u1'}),
    auth:{getCurrentUser:()=>({id:'u1'}),authenticatedRequest:async()=>[]},
  });
  vm.runInContext(extract('coordenacao.html','sendToPrint',2),printRecovery);
  await printRecovery.sendToPrint();
  assert.equal(printMessages.at(-1).type,'error','estado impresso antigo nao confirma um novo reenvio');
  console.log('OK REFINAMENTO reenvio de impressao exige identidade da tentativa atual');
  let releaseProfileSave;
  const profileSaveGate=new Promise(resolve=>{releaseProfileSave=resolve;});
  const profilePayloads=[];
  const profileSaves=vm.createContext({pendingProfileUpdates:new Set(),queuedProfileUpdates:new Map(),
    auth:{authenticatedRequest:async(url,opt)=>{profilePayloads.push(JSON.parse(opt.body));if(profilePayloads.length===1)await profileSaveGate;return [{id:'p1'}];}},
  });
  vm.runInContext(extract('schools.html','persistProfileUpdate',2),profileSaves);
  const firstProfileSave=profileSaves.persistProfileUpdate('p1',{role:'coordinator'});
  await profileSaves.persistProfileUpdate('p1',{role:'teacher',school_grade:'2A'});
  releaseProfileSave(); await firstProfileSave;
  assert.deepEqual(profilePayloads,[{role:'coordinator'},{role:'teacher',school_grade:'2A'}]);
  console.log('OK REFINAMENTO alteracoes rapidas de perfil preservam a ultima escolha');
  for(const mode of ['active','withdrawn','printed','missing','offline','account']) {
    let prints=0,rendered=null;
    const fresh={id:'e1',title:'Atualizada',review_status:mode==='withdrawn'?'em_revisao':'aprovada',print_status:mode==='printed'?'impressa':'enviada',questions:[]};
    const ctx=vm.createContext({ExamSafety,printing:false,printViewerId:'u1',currentExam:{id:'e1',title:'Antiga'},printProfile:null,Promise,
      printAuth:{getCurrentUser:()=>({id:mode==='account'?'u2':'u1'}),loadCurrentProfile:async()=>({role:'print_operator'}),hasRole:roles=>roles.includes('print_operator'),authenticatedRequest:async()=>{if(mode==='offline')throw new Error('offline');return mode==='missing'?[]:[fresh];}},
      isFromPrintQueue:()=>true,renderExam:exam=>{rendered=exam;},updatePrintToolbar(){},waitForPrintableImages:async()=>{},document:{title:'Prova',querySelectorAll:()=>[]},window:{addEventListener(){},print(){prints++;}},setTimeout(){},alert(){},
    });
    vm.runInContext(extract('print.html','printCleanDocument',4),ctx); await ctx.printCleanDocument();
    assert.equal(prints,mode==='active'?1:0,mode); assert.equal(ctx.printing,false);
    if(mode==='active')assert.equal(rendered.title,'Atualizada');
  }
  console.log('OK REFINAMENTO impressao revalida pedido conta e rede e usa conteudo atual');
})().catch(error=>{console.error(error);process.exitCode=1;});
