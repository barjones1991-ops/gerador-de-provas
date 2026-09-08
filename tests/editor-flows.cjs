const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const Safety = require('../js/exam-safety.js');

async function boot({ bank = false, loggedIn = true, preview = false, status = 'rascunho', questions = [{ type:'discursiva', text:'Questão original', points:'10,0', lines:5 }], grade = '6A' } = {}) {
  const { document, window: dom } = parseHTML(read('editor.html'));
  // linkedom implementa DOM, não navegação, layout ou temporização de um navegador.
  const selectProto = dom.HTMLSelectElement.prototype;
  if (!Object.getOwnPropertyDescriptor(selectProto, 'value').set) {
    Object.defineProperty(selectProto, 'value', {
      configurable:true,
      get() { return this.querySelector('option[selected]')?.value || this.querySelector('option')?.value || ''; },
      set(value) { for (const option of this.querySelectorAll('option')) { if (option.value === String(value)) option.setAttribute('selected',''); else option.removeAttribute('selected'); } },
    });
  }
  const storage = new Map(), timers = new Map(), requests = [];
  let timerId = 0;
  const location = { origin:'https://example.invalid', href:'https://example.invalid/app/editor.html' + (bank ? '?bank=b1' : '?id=e1'), search:bank ? '?bank=b1' : '?id=e1' };
  if (preview) location.search += '&view=preview';
  const ctx = { document, location, console, URL, URLSearchParams, Blob, Event:dom.Event, CustomEvent:dom.CustomEvent,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    setInterval() {}, clearInterval() {}, confirm:() => true, alert() {}, navigator:{},
    localStorage:{ getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,String(value)), removeItem:key => storage.delete(key) },
    addEventListener:(...args) => document.addEventListener(...args), dispatchEvent:(event) => document.dispatchEvent(event), open(url) { ctx.opened = url; },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  const exam = { id:'e1', user_id:'u1', title:'Prova preservada', school_name:'Escola A', teacher:'Autor original', class_name:'5A',
    subject:'Matemática', instructions:'', term:'', total_value:'10,0', questions, updated_at:'v1', review_status:status, logo_data_url:'' };
  const auth = { isAuthenticated:() => loggedIn, getCurrentUser:() => ({ id:'u1', email:'teste@example.invalid' }),
    loadCurrentProfile:async () => ({ id:'u1', role:'teacher', school_id:null, school_grade:grade }),
    hasRole:roles => roles.includes('teacher'), canReviewExams:() => false, canAccessPrintQueue:() => false, canManageSchools:() => false, canManageUsers:() => false,
    authenticatedRequest:async (url, options = {}) => {
      requests.push({ url, options });
      if (options.method === 'PATCH') return [{ id:bank ? 'b1':'e1', updated_at:'v2', review_status:status }];
      if (url.startsWith('/profiles')) return [{ full_name:'Outro nome', school_grade:grade, disciplines:['Matemática'], school_id:null }];
      if (url.startsWith('/question_bank')) return [{ id:'b1', user_id:'u1', updated_at:'v1', title:'Registro original', question:questions[0], subject:'Matemática', grade:'5A', is_public:false }];
      return [exam];
    },
  };
  vm.createContext(ctx);
  for (const script of document.querySelectorAll('script')) {
    const src = script.getAttribute('src');
    if (src?.startsWith('https:')) continue;
    vm.runInContext(src ? read(src) : script.textContent, ctx, { filename:src || 'editor-inline.js' });
  }
  ctx.initAuthManager = () => auth;
  document.dispatchEvent(new dom.Event('DOMContentLoaded'));
  for (let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve));
  return { ctx, document, auth, requests, storage, timers, run:code => vm.runInContext(code,ctx), event:(node,type) => node.dispatchEvent(new dom.Event(type,{ bubbles:true, cancelable:true })) };
}

async function main() {
  let count = 0;
  const test = async (name, fn) => { await fn(); console.log('OK EDITOR',name); count++; };
  await test('login conserva destino de banco e consulta', async () => {
    for (const options of [{bank:true,loggedIn:false},{preview:true,loggedIn:false}]) {
      const app = await boot(options);
      const target = new URLSearchParams(app.ctx.location.href.split('?')[1]).get('return_to');
      assert.equal(target,options.bank ? 'editor.html?bank=b1' : 'editor.html?id=e1&view=preview');
    }
  });
  await test('carregar preserva turma, autor e campos vazios; sem PATCH involuntario', async () => {
    const app = await boot();
    assert.equal(app.run('state.school.className'),'5A');
    assert.equal(app.run('state.school.teacher'),'Autor original');
    assert.equal(app.run('state.school.instructions'),'');
    assert.equal(app.run('state.school.term'),'');
    assert.equal(app.ctx.EditorTools.canEdit(),true);
    assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,0);
  });
  await test('todos os tipos tem entrada e controles renderizaveis', async () => {
    const app = await boot();
    for (const type of app.run('Object.keys(templates)')) {
      app.run(`state.questions = [templates[${JSON.stringify(type)}]()]; state.collapsedQuestions = {}; renderAll();`);
      assert(app.document.querySelector(`#qtypeSelect option[value="${type}"]`),type);
      assert(app.document.querySelector('.qcard'),type);
    }
  });
  await test('remover questao, desfazer e refazer preservam conteudo', async () => {
    const app = await boot();
    app.run('state.collapsedQuestions = {}; renderAll();');
    const remove = [...app.document.querySelectorAll('.qcard button')].find(b=>b.title==='Remover questão');
    app.event(remove,'click'); assert.equal(app.run('state.questions.length'),0);
    app.ctx.EditorTools.travelHistory(-1); assert.equal(app.run('state.questions[0].text'),'Questão original');
    app.ctx.EditorTools.travelHistory(1); assert.equal(app.run('state.questions.length'),0);
  });
  await test('salvar nao reabilita remocao abaixo do minimo', async () => {
    const app = await boot({questions:[{type:'multipla',text:'Escolha',points:'10,0',options:['A','B'],correctOption:0}]});
    app.run('state.collapsedQuestions = {}; renderAll(); applyReviewLock();');
    const remove = [...app.document.querySelectorAll('.option-row button')].find(b=>b.textContent==='Remover');
    assert(remove.disabled);
    app.event(remove,'click'); assert.equal(app.run('state.questions[0].options.length'),2);
  });
  await test('tabela reinstala controles e permite editar alternativas', async () => {
    const app = await boot();
    app.run('state.questions=[templates.tabela()]; state.collapsedQuestions={}; renderAll();');
    const add = [...app.document.querySelectorAll('button')].find(b=>b.textContent==='+ Adicionar linha');
    app.event(add,'click');
    const field = app.document.querySelector('[data-k="answerType"]'); field.value='multipla'; app.event(field,'input');
    assert.equal(app.run('state.questions[0].answerType'),'multipla');
    assert(app.document.querySelector('input[name="table-answer-0"]'));
  });
  await test('professor consulta prova aprovada sem comandos de impressao', async () => {
    const app = await boot({status:'aprovada',questions:[{type:'discursiva',text:'Original',points:'10,0',freeImages:[{dataUrl:'data:image/png;base64,AA==',width:180,height:120}]}]});
    assert.equal(app.ctx.EditorTools.canEdit(),false);
    app.run('duplicateQuestion(0); addQuestionOfType("discursiva");');
    assert.equal(app.run('state.questions.length'),1);
    await app.run('saveToCloud()'); assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,0);
    await app.ctx.EditorTools.openPrint(false); assert.equal(app.document.body.dataset.editorView,'preview');
    assert.equal(app.document.getElementById('mainPrintBtn').hidden,true);
  });
  await test('editar banco abre modo separado e PATCH atualiza registro original com versao', async () => {
    const app = await boot();
    app.ctx.currentQuestionBankResults=[{id:'b1',user_id:'u1',question:{type:'discursiva',text:'Acervo'}}];
    app.run('editBankQuestion(0)'); assert.equal(app.run('state.questions.length'),1); assert(app.ctx.opened.includes('?bank=b1'));
    const bank = await boot({bank:true});
    bank.run('state.questions[0].text="Atualizada";');
    assert.equal(await bank.ctx.EditorTools.saveBank(),true);
    const req=bank.requests.find(r=>r.options.method==='PATCH'); assert(req.url.startsWith('/question_bank?id=eq.b1&updated_at=eq.v1'));
    assert.equal(JSON.parse(req.options.body).question.text,'Atualizada');
    assert(!bank.requests.some(r=>r.options.method==='POST'||r.url.startsWith('/exams')));
  });
  await test('campos hostis e alinhamento passam pelo contrato compartilhado', async () => {
    const app = await boot();
    for (const [type,key] of [['ditado','wordCount'],['problema_matematico','calcLines']]) {
      app.run(`state.questions=[ExamSafety.normalizeQuestion({type:${JSON.stringify(type)},text:'X',${key}:'1" data-injected="sim'})]; state.collapsedQuestions={}; renderAll();`);
      assert.equal(app.document.querySelector('[data-injected]'),null);
    }
    assert.equal(Safety.normalizeQuestion({type:'imagem',imageAlign:'lado_direita'}).imageAlign,'lado_direita');
    assert.throws(()=>Safety.normalizeQuestion({type:'multipla',options:'invalido'}));
  });
  await test('numeros brasileiros e avisos pedagogicos', async () => {
    assert.equal(Safety.operationAnswer({num1:'1.000',num2:'2',op:'+'}),'1.002');
    assert.equal(Safety.operationAnswer({num1:'1,5',num2:'2',op:'×'}),'3');
    assert(Safety.operationAnswer({num1:'1',num2:'3',op:'÷'}).startsWith('≈'));
    assert(Safety.operationAnswer({num1:'1',num2:'0',op:'÷'}).startsWith('?'));
    assert(Safety.inspectExam({school:{totalValue:'10,0'},questions:[]}).some(i=>i.blocking));
    assert(Safety.inspectExam({school:{totalValue:'10,0'},questions:[{type:'multipla',text:'Escolha',points:'10,0',options:['A','B'],correctOption:null}]}).some(i=>i.message.includes('correta')));
  });
  await test('impressao renderiza todos os tipos e atualiza somente a questao alterada', async () => {
    const app = await boot();
    const questions = app.run('Object.values(templates).map(create => create())');
    const { document } = parseHTML(read('print.html'));
    const ctx = { document, ExamSafety:Safety, URLSearchParams, URL, console, location:{search:''},
      window:{location:{search:''}}, addEventListener() {}, setTimeout() {}, clearTimeout() {} };
    vm.createContext(ctx);
    // Inclui todas as funções reais do renderer, sem disparar loadExam ou rede.
    for (const script of document.querySelectorAll('script:not([src])')) vm.runInContext(script.textContent,ctx);
    ctx.exam = { title:'Teste de impressão', questions, total_value:'29,0' };
    vm.runInContext('currentExam=exam; renderExam(exam,true)',ctx);
    assert.equal(document.querySelectorAll('.question-block').length,questions.length);
    const untouched = document.querySelectorAll('.question-block')[1];
    vm.runInContext('patchPreviewQuestion(0,{...currentExam.questions[0],text:"Texto atualizado"})',ctx);
    assert(document.querySelector('.question-block').textContent.includes('Texto atualizado'));
    assert.equal(document.querySelectorAll('.question-block')[1],untouched);
    vm.runInContext('renderExam({questions:[{type:"ditado",wordCount:"1\\\" data-injected=\\\"sim",text:"Teste",points:"1,0"}]})',ctx);
    assert.equal(document.querySelector('[data-injected]'),null);
  });
  await test('digitacao agrupa copia local e perguntas recolhidas nao montam seus formularios', async () => {
    const questions = Array.from({length:100}, (_,i)=>({type:'discursiva',text:`Questão ${i+1}`,points:'0,1',lines:5}));
    const app = await boot({questions});
    assert(app.document.querySelectorAll('#questionsEditor input:not([type="file"]),#questionsEditor textarea').length < 10);
    for (let i=0;i<100;i++) { app.run(`state.questions[0].text='Texto ${i}'`); app.ctx.EditorTools.changed(); }
    assert.equal(app.storage.size,1); // Somente editExamId; nenhuma cópia por tecla.
    const persist = app.timers.get(app.ctx.EditorTools.persistTimer); persist();
    const saved = [...app.storage.entries()].find(([key])=>key.startsWith('gerador-provas-pending'));
    assert(saved[1].includes('Texto 99'));
    assert(!app.requests.some(r=>r.options.method==='PATCH'));
  });
  await test('conflito no banco preserva rascunho e nao anuncia sucesso', async () => {
    const app = await boot({bank:true}); app.run('state.questions[0].text="Minha alteração"');
    app.auth.authenticatedRequest = async () => [];
    assert.equal(await app.ctx.EditorTools.saveBank(),false);
    assert([...app.storage.entries()].some(([key,value])=>key.includes('bank:b1')&&value.includes('Minha alteração')));
    assert.equal(app.run('currentExamVersion'),'v1');
  });
  await test('envio confirmado bloqueia edicao e preserva historico', async () => {
    const app = await boot();
    await app.ctx.EditorTools.sendToCoordination();
    assert.equal(app.run('currentReviewStatus'),'enviada');
    assert.equal(app.ctx.EditorTools.canEdit(),false);
    const sent = app.requests.filter(r => r.options.method === 'PATCH').map(r => JSON.parse(r.options.body));
    assert.equal(sent.at(-1).review_status,'enviada');
    assert.equal(sent.at(-1).review_history.at(-1).action,'enviada');
  });
  await test('falha de envio conserva edicao e estado anterior', async () => {
    const app = await boot();
    app.auth.authenticatedRequest = async () => [];
    await app.ctx.EditorTools.sendToCoordination();
    assert.equal(app.run('currentReviewStatus'),'rascunho');
    assert.equal(app.ctx.EditorTools.canEdit(),true);
  });
  await test('revisao impede escrita e devolucao conserva orientacao ao salvar', async () => {
    for (const status of ['enviada','em_revisao']) {
      const app = await boot({status});
      assert.equal(app.ctx.EditorTools.canEdit(),false);
      assert(app.document.getElementById('lastSaved').textContent.includes('consulta'));
      assert.equal(await app.run('saveToCloud()'),false);
      assert.equal(app.requests.filter(r=>r.options.method==='PATCH').length,0);
    }
    const app = await boot({status:'devolvida'});
    app.run("currentReviewNotes='Rever enunciado'; state.questions[0].text='Corrigida'");
    await app.run('saveToCloud()');
    assert.equal(app.run('currentReviewStatus'),'devolvida');
    assert.equal(app.run('currentReviewNotes'),'Rever enunciado');
    assert(app.document.getElementById('teacherFeedback').textContent.includes('Rever enunciado'));
  });
  console.log(`${count} fluxos do editor aprovados em DOM isolado.`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode=1; });
module.exports = { boot };
