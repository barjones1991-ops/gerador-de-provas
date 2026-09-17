(function () {
  'use strict';
  if (!window.Paged || !window.requestAnimationFrame) return;
  const source = document.getElementById('root');
  const output = document.createElement('div');
  output.id = 'paper-preview';
  source.after(output);
  // Only the document's print rules enter the pagination engine, never its screen UI.
  function rules(list) {
    return Array.from(list).map(rule => rule.type === 4
      ? (rule.conditionText && !rule.conditionText.includes('print') ? '' : rules(rule.cssRules))
      : rule.cssText).join('\n');
  }
  const css = Array.from(document.querySelectorAll('style[data-exam-layout]'))
    .map(style => rules(style.sheet.cssRules)).join('\n') + '\n@page { size:210mm 297mm; margin:8mm 9mm 10mm; }';
  let enabled = true;
  let revision = 0, running = null, focusIndex = null, engine = null, failed = null;
  async function paginate() {
    while (enabled) {
      const version = revision;
      await Promise.all(Array.from(source.querySelectorAll('img')).map(img => img.decode?.().catch(() => {})));
      if (document.fonts?.ready) await document.fonts.ready;
      const stage = document.createElement('div');
      stage.className = 'paper-staging';
      document.body.append(stage);
      try {
        engine?.polisher.destroy();
        engine = new window.Paged.Previewer();
        await engine.preview(source.innerHTML, [{ [location.href]: css }], stage);
        if (!enabled || version !== revision) { stage.remove(); continue; }
        output.replaceChildren(...stage.childNodes);
        stage.remove();
        document.body.classList.add('paper-ready');
        failed = null;
        output.removeAttribute('aria-busy');
        if (focusIndex !== null) window.focusPreviewQuestion(focusIndex);
        break;
      } catch (error) {
        stage.remove(); failed = error;
        document.body.classList.remove('paper-ready');
        output.replaceChildren();
        console.error('Falha ao paginar a prova', error);
        break;
      }
    }
  }
  window.ExamPagination = {
    schedule() {
      enabled = true;
      revision++;
      output.setAttribute('aria-busy', 'true');
      if (!running) running = Promise.resolve().then(paginate).finally(() => { running = null; });
      return running;
    },
    focus(index) {
      focusIndex = index;
      return output.querySelector(`.question-block[data-question-index="${index}"]`);
    },
    async ready() {
      await running;
      if (failed) throw new Error('Não foi possível preparar as páginas. Reabra a prova antes de imprimir.');
    },
    reset() { enabled = false; revision++; output.replaceChildren(); document.body.classList.remove('paper-ready'); }
  };
})();
