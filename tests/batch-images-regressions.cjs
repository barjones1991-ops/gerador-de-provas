const assert=require('node:assert/strict');const {boot}=require('./editor-flows.cjs');
(async()=>{
 for(const type of ['grade_imagens','sequencia_imagens','legenda_imagens','relacione_imagens']){
  const key=type==='relacione_imagens'?'pairs':'items';
  const q={type,text:'Observe',points:'10',[key]:[{imageDataUrl:'data:image/png;base64,AAAA',imageFileName:'antiga',answer:'Manter',word:'Manter',order:2},{imageDataUrl:'',answer:'Resposta',word:'Palavra',order:1}],wordOrder:[1,0]};
  const app=await boot({questions:[q]});app.run('state.collapsedQuestions={};renderAll()');
  assert(app.document.querySelector('[data-batch-images]').multiple);
  app.ctx.fakeRead=async file=>({imageDataUrl:'data:image/png;base64,'+file,imageFileName:file});
  await app.run("importQuestionImages(state.questions[0],['BBBB','CCCC'],fakeRead)");
  const items=app.run('state.questions[0].'+key);
  assert.equal(items[0].imageFileName,'antiga');assert.equal(items[0][type==='relacione_imagens'?'word':'answer'],'Manter');assert.equal(items[1].imageFileName,'BBBB');assert.equal(items[1][type==='relacione_imagens'?'word':'answer'],type==='relacione_imagens'?'Palavra':'Resposta');assert.equal(items[2].imageFileName,'CCCC');
  if(type==='sequencia_imagens')assert.equal(items[2].order,3);
  if(type==='relacione_imagens')assert.equal(JSON.stringify(app.run('state.questions[0].wordOrder')),'[1,0,2]');
  const before=app.run('JSON.stringify(state.questions[0])');let n=0;
  app.ctx.fakeRead=async file=>{if(++n===2)throw Error('Arquivo inválido');return {imageDataUrl:'data:image/png;base64,DDDD',imageFileName:file}};
  await assert.rejects(app.run("importQuestionImages(state.questions[0],['um','dois'],fakeRead)"),/inválido/);
  assert.equal(app.run('JSON.stringify(state.questions[0])'),before);
  await assert.rejects(app.run("importQuestionImages(state.questions[0],Array(21).fill('x'),fakeRead)"),/20/);
  assert.equal(await app.run('importQuestionImages(state.questions[0],[],fakeRead)'),0);
  await app.run('saveToCloud()');const saved=JSON.parse(app.requests.filter(r=>r.options.method==='PATCH').at(-1).options.body).questions;
  const reopened=await boot({questions:saved});assert.equal(reopened.run('state.questions[0].'+key+'[2].imageFileName'),'CCCC');
 }
 const app=await boot({questions:[{type:'legenda_imagens',text:'Observe',points:'10',items:[{answer:'Original'}]}]});
 app.ctx.fakeRead=async()=>{app.run("state.questions[0].items[0].answer='Editada'");return {imageDataUrl:'data:image/png;base64,AAAA',imageFileName:'nova'}};
 await assert.rejects(app.run("importQuestionImages(state.questions[0],['x'],fakeRead)"),/alterada/);assert.equal(app.run('state.questions[0].items[0].imageDataUrl'),undefined);
 app.ctx.fakeRead=async()=>{app.run('state.questions=[]');return {imageDataUrl:'data:image/png;base64,AAAA',imageFileName:'nova'}};
 await assert.rejects(app.run("importQuestionImages(state.questions[0],['x'],fakeRead)"),/mudou/);
 console.log('OK LOTE quatro tipos, preservação, ordem, persistência, falhas, limites e edição concorrente');
})().catch(e=>{console.error(e);process.exitCode=1});
