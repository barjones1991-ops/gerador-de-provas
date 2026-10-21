const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

function bootEngine({ imageMock = class {} } = {}) {
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  const selectPrototype = window.HTMLSelectElement.prototype;
  if (!Object.getOwnPropertyDescriptor(selectPrototype, 'value').set) {
    Object.defineProperty(selectPrototype, 'value', {
      configurable: true,
      get() { return this.querySelector('option[selected]')?.value || this.querySelector('option')?.value || ''; },
      set(value) {
        for (const option of this.querySelectorAll('option')) {
          if (option.value === String(value)) option.setAttribute('selected', '');
          else option.removeAttribute('selected');
        }
      },
    });
  }
  const context = vm.createContext({
    window,
    document: window.document,
    AbortController,
    console,
    setTimeout,
    clearTimeout,
    Image: imageMock,
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'image-engine.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'js/image-engine.js' });
  return { window, document: window.document, engine: window.ExamImageEngine };
}

const fire = (window, node, type) => node.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
const settle = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  {
    const { window, document, engine } = bootEngine();
    let editable = true;
    let cleared = 0;
    const picker = engine.createPicker({
      getImage: () => ({ dataUrl: 'data:image/png;base64,AAAA', fileName: 'teste.png' }),
      setImage: () => {},
      clearImage: () => { cleared += 1; },
      canEdit: () => editable,
    });
    document.body.appendChild(picker);
    const file = picker.querySelector('input[type="file"]');
    const remove = picker.querySelector('button[aria-label="Remover imagem"]');
    assert.equal(file.tabIndex, -1);
    assert.equal(file.hidden, true);
    assert.equal(file.getAttribute('aria-hidden'), 'true');
    assert(remove, 'ações por ícone precisam de nome acessível');
    assert.equal(remove.textContent, 'Remover imagem');
    assert.equal(picker.querySelector('[aria-label="Recortar imagem"]').textContent, 'Recortar');
    let picked = 0;
    file.click = () => { picked++; };
    fire(window, picker.querySelector('button[aria-label="Substituir imagem"]'), 'click');
    assert.equal(picked, 1, 'troca explícita reutiliza a seleção de arquivo');
    assert.equal(picker.querySelector('.img-size-info'), null, 'peso normal não ocupa a miniatura');
    editable = false;
    fire(window, remove, 'click');
    assert.equal(cleared, 0, 'remoção não pode alterar uma prova bloqueada durante a interação');
  }

  {
    const { window, document, engine } = bootEngine({ imageMock: class {
      constructor() { this.width = 400; this.height = 300; }
      set src(value) { this.onload(); }
    } });
    const create = document.createElement.bind(document);
    let drawn;
    document.createElement = name => {
      const el = create(name);
      if (name === 'canvas') {
        el.getContext = () => ({ drawImage(...args) { drawn = args; } });
        el.toDataURL = () => 'data:image/webp;base64,AAAA';
        el.getBoundingClientRect = () => ({ left:0, top:0, width:400, height:300 });
      }
      return el;
    };
    let applied = 0;
    engine.openCrop('data:image/png;base64,AAAA', () => applied++);
    await settle();
    const overlay = document.querySelector('.crop-modal-overlay');
    const wrap = overlay.querySelector('.crop-canvas-wrap');
    const inputs = [...overlay.querySelectorAll('.crop-precise input')];
    assert.equal(overlay.querySelectorAll('.crop-handle').length, 4);
    assert.equal(overlay.querySelector('.crop-precise').hasAttribute('open'), false);
    const pointer = (node, type, x, y) => {
      const event = new window.Event(type, { bubbles:true, cancelable:true });
      Object.assign(event, { pointerId:1, button:0, clientX:x, clientY:y });
      node.dispatchEvent(event);
    };
    pointer(overlay.querySelector('.crop-handle-se'), 'pointerdown', 400, 300);
    pointer(wrap, 'pointermove', 200, 150);
    pointer(wrap, 'pointerup', 200, 150);
    assert.deepEqual(inputs.map(input => Number(input.value)), [0,0,50,50]);
    pointer(overlay.querySelector('.crop-selection'), 'pointerdown', 100, 75);
    pointer(wrap, 'pointermove', 140, 105);
    pointer(wrap, 'pointerup', 140, 105);
    assert.deepEqual(inputs.map(input => Number(input.value)), [10,10,50,50]);
    pointer(overlay.querySelector('.crop-handle-nw'), 'pointerdown', 40, 30);
    pointer(wrap, 'pointermove', 80, 60);
    pointer(wrap, 'pointercancel', 80, 60);
    assert.deepEqual(inputs.map(input => Number(input.value)), [10,10,50,50], 'cancelar gesto preserva seleção anterior');
    inputs[2].value = '25'; fire(window, inputs[2], 'input');
    fire(window, overlay.querySelector('.primary'), 'click');
    assert.equal(applied, 1);
    assert.deepEqual(drawn.slice(1,5), [40,30,100,150], 'recorte aplica exatamente a seleção movida/ajustada');
    assert.equal(document.querySelector('.crop-modal-overlay'), null);
    engine.openCrop('data:image/png;base64,AAAA', () => applied++);
    await settle();
    fire(window, document.querySelector('.crop-modal-btns .outline'), 'click');
    assert.equal(applied, 1, 'cancelar não altera a imagem');
  }

  {
    const { window, document, engine } = bootEngine();
    let resolveProcessing;
    let calls = 0;
    let image = null;
    const picker = engine.createPicker({
      getImage: () => image || {},
      setImage: (dataUrl, fileName) => { image = { dataUrl, fileName }; },
      clearImage: () => { image = null; },
      canEdit: () => true,
      processFile: () => {
        calls += 1;
        return new Promise(resolve => { resolveProcessing = resolve; });
      },
    });
    document.body.appendChild(picker);
    const file = picker.querySelector('input[type="file"]');
    Object.defineProperty(file, 'files', { configurable: true, value: [{ name: 'primeira.png' }] });
    fire(window, file, 'change');
    assert.equal(picker.querySelector('.image-drop').getAttribute('aria-busy'), 'true');
    assert.equal(file.disabled, true);
    Object.defineProperty(file, 'files', { configurable: true, value: [{ name: 'segunda.png' }] });
    fire(window, file, 'change');
    assert.equal(calls, 1, 'uma segunda operação não pode concorrer com a primeira');
    resolveProcessing({ dataUrl: 'data:image/png;base64,BBBB', fileName: 'primeira.png' });
    await settle();
    assert.deepEqual(image, { dataUrl: 'data:image/png;base64,BBBB', fileName: 'primeira.png' });
    assert.equal(picker.querySelector('.image-drop').getAttribute('aria-busy'), 'false');
    assert.equal(file.disabled, false);
  }

  const engineSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'image-engine.js'), 'utf8');
  assert(
    /openCrop\(image\.dataUrl, output => \{\s*options\.setImage\(output, image\.fileName\);\s*refresh\(\);\s*options\.onChange/.test(engineSource),
    'o recorte precisa atualizar a miniatura depois de receber o novo conteúdo',
  );

  console.log('OK MOTOR DE IMAGENS bloqueio, concorrência e acessibilidade dos controles');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
