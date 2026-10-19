const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

function bootEngine() {
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
    Image: class {},
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
    editable = false;
    fire(window, remove, 'click');
    assert.equal(cleared, 0, 'remoção não pode alterar uma prova bloqueada durante a interação');
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
