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
  let revision = 0, running = null, focusIndex = null, engine = null, failed = null, lastSuggestion = null;

  function outerHeight(node) {
    const rect = node.getBoundingClientRect?.();
    if (!rect) return 0;
    const style = window.getComputedStyle?.(node);
    return rect.height + (parseFloat(style?.marginTop) || 0) + (parseFloat(style?.marginBottom) || 0);
  }

  function detectSpaceSuggestion() {
    const pages = Array.from(output.querySelectorAll('.pagedjs_page'));
    for (let pageIndex = 0; pageIndex < pages.length - 1; pageIndex++) {
      const page = pages[pageIndex];
      const nextPage = pages[pageIndex + 1];
      const area = page.querySelector('.pagedjs_page_content,.pagedjs_area') || page;
      const blocks = Array.from(page.querySelectorAll('.question-block[data-question-index]'));
      const nextBlocks = Array.from(nextPage.querySelectorAll('.question-block[data-question-index]'));
      if (!blocks.length || nextBlocks.length < 2) continue;

      const areaRect = area.getBoundingClientRect?.();
      const lastRect = blocks.at(-1)?.getBoundingClientRect?.();
      const available = (areaRect?.bottom || 0) - (lastRect?.bottom || 0);
      // Pequenas sobras são normais; a sugestão só aparece para um ganho perceptível.
      if (available < 56) continue;

      const target = nextBlocks[0];
      if (target.dataset.unnumbered === 'true') continue;
      const toIndex = Number(target.dataset.questionIndex);
      let best = null;
      for (let position = 1; position < nextBlocks.length; position++) {
        const candidate = nextBlocks[position];
        if (candidate.dataset.unnumbered === 'true') continue;
        // Não atravessa blocos sem número, que podem funcionar como apoio da questão seguinte.
        if (nextBlocks.slice(0, position).some(node => node.dataset.unnumbered === 'true')) break;
        const fromIndex = Number(candidate.dataset.questionIndex);
        const height = outerHeight(candidate);
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex <= toIndex || height <= 0 || height > available - 12) continue;
        if (!best || height > best.questionHeightPx) {
          best = {
            fromIndex, toIndex, page: pageIndex + 1,
            availablePx: Math.round(available), questionHeightPx: Math.round(height),
          };
        }
      }
      if (best) return best;
    }
    return null;
  }

  function reportSuggestion(value) {
    lastSuggestion = value;
    window.reportExamSpaceSuggestion?.(value);
  }
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
        reportSuggestion(detectSpaceSuggestion());
        if (focusIndex !== null) window.focusPreviewQuestion(focusIndex);
        break;
      } catch (error) {
        stage.remove(); failed = error;
        document.body.classList.remove('paper-ready');
        output.replaceChildren();
        reportSuggestion(null);
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
    suggestion() { return lastSuggestion; },
    reset() { enabled = false; revision++; output.replaceChildren(); document.body.classList.remove('paper-ready'); reportSuggestion(null); }
  };
})();
