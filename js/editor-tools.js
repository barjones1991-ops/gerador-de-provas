/* Fluxos do editor. Dados reais continuam passando pelo AuthManager e pelas policies do banco. */
const EditorTools = {
  loading: true, initialized: false, applyingHistory: false, history: [], historyIndex: -1,
  bankId: new URLSearchParams(window.location.search).get('bank'), bankRecord: null,
  previewTimer: null, persistTimer: null, historyTimer: null, previewReady: false,
  forceSnapshot: true, previewQuestionCount: -1, dirtyQuestions: new Set(),
  reviewHistory: [], sending: false,
  isTeacher() { return Boolean(auth?.hasRole?.(['teacher'], currentProfile)); },
  offerDraftRecovery(draft) {
    autoSaveReady = false; setEditorLoading(true);
    document.getElementById('draftRecoveryChoice')?.remove();
    const choice = document.createElement('section'); choice.id = 'draftRecoveryChoice';
    choice.setAttribute('aria-label', 'Recuperação de alterações');
    const message = document.createElement('p');
    message.textContent = 'Há alterações que não chegaram à nuvem. Escolha qual versão usar; decidir depois mantém sua cópia guardada.';
    choice.appendChild(message);
    const finish = () => { choice.remove(); autoSaveReady = true; setEditorLoading(false); applyReviewLock(); };
    const recover = document.createElement('button'); recover.type = 'button'; recover.textContent = 'Recuperar alterações';
    recover.onclick = () => {
      if (auth.getCurrentUser()?.id !== editorUserId) return;
      try {
        const content = JSON.parse(draft.content);
        const questions = content.questions.map(ExamSafety.normalizeQuestion);
        if (this.bankId && questions.length !== 1) throw new Error('O rascunho do banco deve conter uma questão. Sua cópia foi mantida para conferência.');
        if (!content.school || typeof content.school !== 'object') throw new Error('Dados da avaliação inválidos.');
        state.school = content.school; state.questions = questions; state.logoDataUrl = content.logoDataUrl || '';
        finish(); applyStateToInputs(); this.refreshBankFields(); renderAll();
      } catch (error) { showToast(error.message || 'Não foi possível recuperar. Sua cópia foi mantida.', 'err'); }
    };
    const discard = document.createElement('button'); discard.type = 'button'; discard.textContent = 'Descartar rascunho e usar versão salva';
    discard.onclick = () => {
      if (auth.getCurrentUser()?.id !== editorUserId || !confirm('Descartar definitivamente estas alterações locais?')) return;
      localStorage.removeItem(pendingDraftKey()); finish(); setAutoSaveHint('Alterações salvas automaticamente');
    };
    const later = document.createElement('button'); later.type = 'button'; later.textContent = 'Decidir depois';
    later.onclick = () => { window.location.href = 'dashboard.html'; };
    choice.append(recover, discard, later); document.getElementById('lastSaved').after(choice); recover.focus();
  },
  workflowLocked() {
    return ['aprovada', 'bloqueada'].includes(currentReviewStatus)
      || (this.isTeacher() && ['enviada', 'em_revisao'].includes(currentReviewStatus));
  },
  async sendToCoordination() {
    if (this.sending || !this.canEdit() || this.bankId || currentExamOwnerId !== editorUserId) return;
    if (!await flushAutoSaveBeforeAction()) return;
    if (this.sending || !this.canEdit()) return;
    if (examFingerprint() !== lastSavedFingerprint) { showToast('Aguarde o salvamento das últimas alterações e envie novamente.', 'err'); return; }
    const score = getScoreCheck();
    if (!state.questions.length || !score.isConsistent || ExamSafety.inspectExam(state).some(issue => issue.blocking)) {
      document.getElementById('readinessDetails').open = true;
      this.updatePreview(); return;
    }
    this.sending = true; applyReviewLock(); this.refreshActions();
    const history = [...this.reviewHistory, { action:'enviada', reviewer:currentProfile.full_name || auth.getCurrentUser().email, date:new Date().toISOString(), notes:'' }];
    try {
      const rows = await auth.authenticatedRequest(`/exams?id=eq.${encodeURIComponent(currentExamId)}&updated_at=eq.${encodeURIComponent(currentExamVersion)}&select=id,updated_at`, {
        method:'PATCH', headers:{Prefer:'return=representation'},
        body:JSON.stringify({ review_status:'enviada', is_draft:false, is_published:true, review_history:history }),
      });
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].updated_at) throw new Error('A prova mudou. Reabra para conferir antes de enviar.');
      currentExamVersion = rows[0].updated_at; currentReviewStatus = 'enviada'; this.reviewHistory = history;
      applyReviewLock(); setAutoSaveHint('Somente consulta');
    } catch (error) { showToast(error.message, 'err'); }
    finally { this.sending = false; applyReviewLock(); this.refreshActions(); }
  },
  canEdit() {
    try {
      return !this.loading && !this.sending && autoSaveReady && !this.workflowLocked()
        && auth?.getCurrentUser()?.id === editorUserId;
    } catch { return false; }
  },
  lockControl(node, locked) {
    if (locked) {
      if (node._permissionDisabled === undefined) node._permissionDisabled = Boolean(node.disabled);
      node.disabled = true;
    } else if (node._permissionDisabled !== undefined) {
      node.disabled = node._permissionDisabled;
      delete node._permissionDisabled;
    }
  },
  updateQuestionSummaries() {
    document.querySelectorAll('.qcard').forEach(card => {
      const q = state.questions[Number(card.dataset.questionIndex)];
      if (!q) return;
      const summary = card.querySelector('.qhead-subtitle');
      const text = String(q.text || '').trim() || 'Sem enunciado ainda';
      if (summary) { summary.textContent = text; summary.title = text; }
    });
  },
  changed() {
    if (!this.initialized) return;
    this.updateQuestionSummaries();
    const index = document.activeElement?.closest?.('.qcard')?.dataset.questionIndex;
    if (index == null) this.forceSnapshot = true; else this.dirtyQuestions.add(Number(index));
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.updatePreview(), 180);
    if (!this.canEdit()) return;
    setAutoSaveHint('Alterações pendentes');
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.recordHistory(), 500);
    // Limita também serialização/localStorage, não apenas a requisição de rede.
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      if (!this.canEdit()) return;
      preservePendingDraft();
      if (!this.bankId) scheduleAutoSave();
    }, 650);
  },
  resetHistory() {
    clearTimeout(this.historyTimer);
    this.history = [examFingerprint()]; this.historyIndex = 0;
    this.refreshActions(); this.updatePreview();
  },
  recordHistory() {
    if (!this.canEdit() || this.applyingHistory) return;
    const snapshot = examFingerprint();
    if (this.history[this.historyIndex] === snapshot) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    let bytes = this.history.reduce((sum, entry) => sum + entry.length * 2, 0);
    while (this.history.length > 2 && (this.history.length > 30 || bytes > 24 * 1024 * 1024)) {
      bytes -= this.history.shift().length * 2;
    }
    this.historyIndex = this.history.length - 1;
    this.refreshActions();
  },
  travelHistory(direction) {
    if (!this.canEdit()) return;
    clearTimeout(this.historyTimer);
    this.recordHistory();
    const next = this.historyIndex + direction;
    if (next < 0 || next >= this.history.length) return;
    this.historyIndex = next; this.applyingHistory = true;
    try {
      const snapshot = JSON.parse(this.history[next]);
      state.school = snapshot.school;
      state.questions = snapshot.questions.map(ExamSafety.normalizeQuestion);
      state.logoDataUrl = snapshot.logoDataUrl;
      state.collapsedQuestions = {};
      if (state.activeQuestionIndex >= state.questions.length) state.activeQuestionIndex = null;
      applyStateToInputs(); this.refreshBankFields(); renderAll();
      // Defaults de apresentação não criam uma nova ação nem descartam o ramo Refazer.
      this.history[next] = examFingerprint();
    } finally { this.applyingHistory = false; }
    preservePendingDraft(); this.changed(); this.refreshActions();
  },
  refreshActions() {
    if (!this.initialized) return;
    const enabled = this.canEdit();
    const send = document.getElementById('sendCoordinationBtn');
    if (send) {
      send.hidden = Boolean(this.bankId) || currentExamOwnerId !== editorUserId || this.workflowLocked();
      send.disabled = !enabled;
      send.textContent = this.sending ? 'Enviando…' : currentReviewStatus === 'devolvida' ? 'Reenviar para coordenação' : 'Enviar para coordenação';
    }
    const teacher = this.isTeacher();
    document.getElementById('viewEditBtn').textContent = this.workflowLocked() ? 'Consultar questões' : 'Editar';
    document.getElementById('mainPrintBtn').hidden = teacher;
    document.querySelector('.settings-wrap').hidden = teacher;
    const note = document.getElementById('teacherFeedback');
    if (note) {
      note.hidden = !['rascunho','devolvida'].includes(currentReviewStatus) || !currentReviewNotes;
      note.textContent = `Ajustes solicitados pela coordenação: ${currentReviewNotes}`;
    }
    const undo = document.getElementById('undoBtn'), redo = document.getElementById('redoBtn');
    if (undo) undo.disabled = !enabled || this.historyIndex <= 0;
    if (redo) redo.disabled = !enabled || this.historyIndex >= this.history.length - 1;
    const bankSave = document.getElementById('saveBankRecordBtn');
    if (bankSave) bankSave.disabled = !enabled || this.bankSaving;
    document.querySelectorAll('.free-image-remove, .free-image-resize').forEach(node => this.lockControl(node, !enabled));
  },
  enhanceFields() {
    const panel = document.querySelector('.card.no-print');
    if (!panel) return;
    panel.querySelectorAll('.qcard').forEach(card => {
      const index = Number(card.dataset.questionIndex);
      const q = state.questions[index];
      const summary = card.querySelector('.qnum');
      if (summary) {
        summary.setAttribute('aria-expanded', String(!card.hidden));
        summary.setAttribute('aria-label', `Questão ${index + 1}: fechar edição`);
        summary.title = 'Fechar edição desta questão';
        if (this.bankId) summary.disabled = true;
      }
      if (!state.collapsedQuestions[index] && q && !card.querySelector('.free-image-fields')) this.addImageFields(card, q, index);
    });
    panel.querySelectorAll('.qcard').forEach(card => {
      const index = Number(card.dataset.questionIndex), q = state.questions[index];
      if (q && !state.collapsedQuestions[index]) {
        this.organizeQuestionChrome(card, q, index);
        this.organizeAlternatives(card, q, index);
        this.organizeAnswerItemImages(card, q, index);
        this.embedFieldImages(card, q);
      }
    });
    panel.querySelectorAll('label').forEach((label, i) => {
      if (label.htmlFor) return;
      const field = label.querySelector('input,select,textarea') || label.nextElementSibling?.matches('input,select,textarea') && label.nextElementSibling;
      if (!field) return;
      if (!field.id) field.id = `field-${i}`;
      label.htmlFor = field.id;
    });
    document.querySelectorAll('input, select, textarea').forEach((field, i) => {
      if (field.type === 'hidden' || field.hasAttribute('aria-label')) return;
      if (field.id && document.querySelector(`label[for="${field.id}"]`)) return;
      const question = field.closest('.qcard')?.dataset.questionIndex;
      const row = field.closest('.option-row');
      const rowIndex = row ? [...row.parentElement.children].filter(node => node.classList.contains('option-row')).indexOf(row) + 1 : 0;
      const choiceName = row && ['radio','checkbox'].includes(field.type) ? 'Marcar alternativa ' + String.fromCharCode(64 + rowIndex) : '';
      const name = field.title || field.placeholder || choiceName || field.closest('label')?.textContent || field.dataset.k ||
        (field.type === 'file' ? 'Selecionar imagem' : field.tagName === 'SELECT' ? 'Selecionar opção' : 'Preencher resposta');
      field.setAttribute('aria-label', `${question === undefined ? '' : `Questão ${Number(question) + 1}: `}${name.trim()}`);
    });
    this.refreshActions();
  },
  organizeQuestionChrome(card, q, index) {
    if (card.dataset.questionChromeOrganized) return;
    card.dataset.questionChromeOrganized = 'true'; card.classList.add('compact-question-editor');
    card.querySelectorAll('.prop-sec').forEach(node => {
      if (node.textContent === 'Conteúdo e respostas') node.remove();
    });
    const headActions = document.createElement('div');
    headActions.className = 'qhead-actions question-head-actions alternatives-head-actions';
    const scoring = card.querySelector('.question-scoring');
    if (scoring) {
      const scoreField = scoring.querySelector('.q-head-field');
      scoreField.classList.add('question-score', 'alternative-score');
      scoreField.querySelector('label').textContent = 'Valor';
      const scoreInput = scoreField.querySelector('input');
      scoreInput.inputMode = 'decimal';
      scoreInput.setAttribute('aria-label', `Questão ${index + 1}: valor`);
      headActions.appendChild(scoreField); scoring.remove();
    }
    const questionRemove = card.querySelector('.question-footer button[title="Remover questão"]');
    if (questionRemove) {
      questionRemove.textContent = '🗑'; questionRemove.classList.add('question-remove-icon');
      questionRemove.setAttribute('aria-label', `Excluir questão ${index + 1}`);
      headActions.appendChild(questionRemove);
    }
    if (headActions.children.length) card.querySelector('.qhead').appendChild(headActions);
    const presentation = card.querySelector('.question-presentation');
    if (presentation) {
      const numberLabel = presentation.querySelector('.question-check');
      const numberInput = numberLabel.querySelector('input');
      numberLabel.classList.add('question-number-toggle');
      numberLabel.replaceChildren(numberInput, document.createTextNode('Número na prova'));
      numberInput.setAttribute('aria-label', 'Mostrar número da questão na prova');
      numberLabel.title = 'Desmarque para ocultar o número desta questão na prova';
      card.querySelector('.qhead-left-copy').appendChild(numberLabel);
      presentation.remove();
    }
      const settings = card.querySelector('.question-settings');
      const input = settings?.querySelector('[data-k="bncc"]');
      if (input) {
        settings.classList.add('question-bncc');
        settings.querySelector('label').textContent = 'Código BNCC';
        input.setAttribute('aria-label', 'Código BNCC (opcional)');
        const summary = settings.querySelector('summary');
        const updateCode = () => {
          const code = input.value.trim();
          summary.textContent = code ? `Código BNCC · ${code}` : 'Código BNCC (opcional)';
        };
        updateCode();
        input.addEventListener('input', updateCode);
      }
    if (!['multipla','marcarx'].includes(q.type)) {
      const images = card.querySelector('.question-images');
      if (images && !images.closest('.question-images-details')) {
        const details = document.createElement('details'); details.className = 'question-images-details';
        const summary = document.createElement('summary'); summary.textContent = 'Imagens (opcional)';
        images.querySelector('h3')?.remove(); images.before(details); details.append(summary, images);
      }
    }
    card.querySelectorAll('button').forEach(button => {
      const label = button.textContent.trim().replace(/^[＋+]\s*/, '');
      if (/^Adicionar\b/i.test(label) && !/imagem/i.test(label)) button.classList.add('content-add-action');
    });
    const footer = card.querySelector('.question-footer');
    const bank = footer?.querySelector('button[title="Salvar no banco de questões"]');
    if (bank) bank.textContent = 'Guardar no banco para reutilizar';
    if (footer && !footer.children.length) footer.remove();
  },
  embedFieldImages(card, q) {
    if (card.dataset.fieldImagesEmbedded) return;
    card.dataset.fieldImagesEmbedded = 'true';
    const text = card.querySelector('textarea[data-k="text"]');
    let toolbar = card.querySelector('.image-use-wrap');
    let panel = card.querySelector('.image-edit-panel');
    if (text && !toolbar && (q.freeImages?.length || card.querySelector('[data-batch-images]'))) {
      toolbar = document.createElement('div'); toolbar.className = 'image-use-wrap';
      panel = document.createElement('div'); panel.className = 'image-edit-panel hidden';
      const button = document.createElement('button'); button.type = 'button';
      button.addEventListener('click', () => {
        if (!this.canEdit()) return;
        panel.classList.toggle('hidden');
        button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
      });
      toolbar.appendChild(button);
    }
    if (text && toolbar && panel) {
      const shell = document.createElement('div'); shell.className = 'field-image-shell enunciation-image-field';
      text.before(shell); shell.append(text, toolbar, panel);
      text.setAttribute('aria-label', 'Enunciado');
      const trigger = toolbar.querySelector('button');
      trigger.classList.add('field-image-trigger');
      trigger.title = 'Adicionar ou editar imagem do enunciado';
      trigger.setAttribute('aria-label', trigger.title);
      panel.id = `enunciation-image-${card.dataset.questionIndex}`;
      trigger.setAttribute('aria-controls', panel.id);
      const images = card.querySelector('.question-images');
      if (images) {
        const oldDetails = images.closest('.question-images-details');
        images.querySelector('h3')?.remove();
        images.querySelector(':scope > p')?.remove();
        images.classList.add('enunciation-extra-images');
        shell.appendChild(images); oldDetails?.remove();
        if (q.freeImages?.length) panel.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
      }
      const menu = toolbar.querySelector('.image-use-menu');
      if (menu) {
        const more = document.createElement('details'); more.className = 'field-image-more';
        const summary = document.createElement('summary'); summary.textContent = 'Mais opções de imagem';
        more.append(summary, menu); shell.appendChild(more);
      }
    }
    card.querySelectorAll('.alternative-main, .answer-item-main').forEach((main, i) => {
      const details = main.querySelector('.alternative-image, .answer-item-image');
      if (!details) return;
      main.classList.add('field-image-shell');
      details.classList.add('field-image-details');
      const summary = details.querySelector('summary'); summary.classList.add('field-image-trigger');
      const image = q.type === 'vf' ? q.items?.[i]?.imageDataUrl : q.optionImages?.[i]?.dataUrl;
      details.open = Boolean(image);
    });
    const images = card.querySelector('.question-images');
    if (images && !images.closest('.enunciation-image-field')) {
      if (!q.freeImages?.length && !images.querySelector('[data-batch-images]')) {
        const wrapper = images.closest('.question-images-details');
        if (wrapper) wrapper.remove(); else images.remove();
        return;
      }
      let details = images.closest('.question-images-details');
      if (!details) {
        details = document.createElement('details'); details.className = 'question-images-details';
        const summary = document.createElement('summary'); details.appendChild(summary);
        images.before(details); details.appendChild(images); images.querySelector('h3')?.remove();
      }
      details.querySelector('summary').textContent = 'Imagens complementares';
      if (q.freeImages?.length) details.open = true;
    }
  },
  chooseSingleAnswer(q, index, select) {
    select.value = q.markMode;
    const card = document.getElementById(`question-${index}`);
    card.querySelector('.single-answer-choice')?.remove();
    const choice = document.createElement('fieldset'); choice.className = 'single-answer-choice';
    const legend = document.createElement('legend'); legend.textContent = 'Qual resposta deve continuar correta?'; choice.appendChild(legend);
    const hint = document.createElement('p'); hint.textContent = 'Escolha uma das respostas marcadas. As demais deixarão de fazer parte do gabarito.'; choice.appendChild(hint);
    q.items.forEach((item, i) => {
      if (!item.checked) return;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${String.fromCharCode(65 + i)}) ${item.text || 'Alternativa sem texto'}`;
      button.dataset.keepAnswer = i;
      button.addEventListener('click', () => {
        if (!this.canEdit()) return;
        q.items.forEach((other, j) => { other.checked = j === i; other.answer = ''; });
        q.markMode = 'unica'; renderAll();
        document.getElementById(`question-${index}`)?.querySelector('[data-k="markMode"]')?.focus();
      }); choice.appendChild(button);
    });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Manter várias respostas';
    cancel.addEventListener('click', () => { choice.remove(); select.focus(); }); choice.appendChild(cancel);
    select.parentElement.appendChild(choice); choice.querySelector('button')?.focus();
  },
  organizeAlternatives(card, q, index) {
    if (!['multipla','marcarx'].includes(q.type) || ['vf','checklist'].includes(q.markMode) || card.dataset.alternativesOrganized) return;
    card.dataset.alternativesOrganized = 'true'; card.classList.add('alternatives-editor');
    card.querySelectorAll('.prop-sec').forEach(node => { if (node.textContent === 'Conteúdo e respostas') node.remove(); });
    card.querySelectorAll('label').forEach(node => { if (node.textContent === 'Alternativas') node.remove(); });
    const options = [...card.querySelectorAll('.option-row')];
    const group = options[0]?.parentElement;
    if (group) {
      const hint = document.createElement('p'); hint.className = 'small alternatives-instruction';
      hint.textContent = q.markMode === 'multipla' ? 'Marque todas as respostas corretas para o gabarito.' : 'Marque a resposta correta para o gabarito.';
      group.parentElement.querySelector(':scope > .small')?.remove(); group.before(hint);
    }
    const layout = card.querySelector('[data-k="markLayout"]')?.parentElement;
    if (layout) {
      layout.querySelector('label').textContent = 'Organização das alternativas';
    }
    options.forEach((row, i) => {
      const letter = String.fromCharCode(65 + i);
      row.querySelector('input[type="radio"],input[type="checkbox"]')?.setAttribute('aria-label', `Marcar alternativa ${letter} como correta`);
      const correct = q.type === 'multipla' ? q.correctOption === i : !!q.items[i]?.checked;
      row.classList.toggle('is-correct', correct);
      row.querySelector('input[type="radio"],input[type="checkbox"]')?.addEventListener('change', () => {
        options.forEach((other,j) => other.classList.toggle('is-correct', q.type === 'multipla' ? q.correctOption === j : !!q.items[j]?.checked));
      });
      const textInput = row.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="file"])');
      const remove = row.querySelector('button');
      if (remove) { remove.textContent = '×'; remove.title = `Remover alternativa ${letter}`; remove.setAttribute('aria-label', remove.title); remove.classList.add('alternative-remove'); }
      const details = document.createElement('details'); details.className = 'alternative-image';
      const summary = document.createElement('summary');
      summary.textContent = q.optionImages?.[i]?.dataUrl ? `Imagem ${letter}` : 'Imagem';
      summary.title = `Adicionar ou editar imagem da alternativa ${letter}`;
      summary.setAttribute('aria-label', summary.title); details.appendChild(summary);
      details.appendChild(createImagePicker({
        getImage: () => q.optionImages?.[i] || {},
        getSize: () => q.optionImages?.[i]?.imageSize,
        setSize: value => { q.optionImages[i].imageSize = value; },
        setImage: (dataUrl, fileName) => { if (!Array.isArray(q.optionImages)) q.optionImages = []; q.optionImages[i] = {...q.optionImages[i],dataUrl,fileName}; summary.textContent = `Imagem ${letter}`; renderPreview(); },
        clearImage: () => { if (q.optionImages) q.optionImages[i] = {dataUrl:'',fileName:''}; summary.textContent = 'Imagem'; renderPreview(); }
      }));
      if (textInput) {
        const main = document.createElement('div'); main.className = 'alternative-main';
        textInput.replaceWith(main); main.append(textInput, details);
      } else row.appendChild(details);
    });
    const addOption = [...card.querySelectorAll('button')].find(button => button.textContent === 'Adicionar alternativa');
    if (addOption) addOption.classList.add('alternative-add');
    const bank = card.querySelector('.question-footer button[title="Salvar no banco de questões"]');
    if (bank) bank.textContent = 'Guardar no banco para reutilizar';
  },
  organizeAnswerItemImages(card, q) {
    const supported = q.type === 'vf'
      || (q.type === 'texto_base' && q.answerType === 'multipla')
      || (q.type === 'imagem' && ['multipla', 'marcarx'].includes(q.imageAnswerType));
    if (!supported || card.dataset.answerItemImagesOrganized) return;
    card.dataset.answerItemImagesOrganized = 'true';
    card.classList.add('answer-item-images-editor');
    [...card.querySelectorAll('.option-row')].forEach((row, itemIndex) => {
      const textInput = row.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="file"])');
      if (!textInput) return;
      const label = q.type === 'vf' ? `afirmação ${itemIndex + 1}` : `alternativa ${String.fromCharCode(65 + itemIndex)}`;
      const getStoredImage = () => q.type === 'vf' ? q.items?.[itemIndex] || {} : q.optionImages?.[itemIndex] || {};
      const details = document.createElement('details');
      details.className = 'answer-item-image';
      const summary = document.createElement('summary');
      const storedImage = getStoredImage();
      summary.textContent = storedImage.imageDataUrl || storedImage.dataUrl ? 'Imagem ✓' : 'Imagem';
      summary.title = `Adicionar ou editar imagem da ${label}`;
      summary.setAttribute('aria-label', summary.title);
      details.appendChild(summary);
      details.appendChild(createImagePicker({
        getSize: () => getStoredImage().imageSize,
        setSize: value => { getStoredImage().imageSize = value; },
        getImage: () => {
          const image = getStoredImage();
          return q.type === 'vf'
            ? { dataUrl: image.imageDataUrl || '', fileName: image.imageFileName || '' }
            : image;
        },
        setImage: (dataUrl, fileName) => {
          if (q.type === 'vf') {
            q.items[itemIndex].imageDataUrl = dataUrl;
            q.items[itemIndex].imageFileName = fileName;
          } else {
            if (!Array.isArray(q.optionImages)) q.optionImages = [];
            q.optionImages[itemIndex] = { ...q.optionImages[itemIndex], dataUrl, fileName };
          }
          summary.textContent = 'Imagem ✓';
          renderPreview();
        },
        clearImage: () => {
          if (q.type === 'vf') {
            q.items[itemIndex].imageDataUrl = '';
            q.items[itemIndex].imageFileName = '';
          } else if (Array.isArray(q.optionImages)) {
            q.optionImages[itemIndex] = { dataUrl: '', fileName: '' };
          }
          summary.textContent = 'Imagem';
          renderPreview();
        },
      }));
      const main = document.createElement('div');
      main.className = 'answer-item-main';
      textInput.replaceWith(main);
      main.append(textInput, details);
    });
  },
  addImageFields(card, question, index) {
    if (!question.freeImages?.length) return;
    const group = document.createElement('fieldset'); group.className = 'free-image-fields';
    const legend = document.createElement('legend'); legend.textContent = 'Imagens adicionadas'; group.appendChild(legend);
    question.freeImages.forEach((image, imageIndex) => {
      const row = document.createElement('div'); row.className = 'image-control-row';
      const title = document.createElement('strong'); title.textContent = `Imagem ${imageIndex + 1}`; row.appendChild(title);
      if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image.dataUrl || '')) {
        const thumbnail = document.createElement('img'); thumbnail.src = image.dataUrl;
        thumbnail.alt = image.fileName || `Imagem ${imageIndex + 1}`;
        thumbnail.className = 'extra-image-thumbnail'; row.appendChild(thumbnail);
      }
      for (const [key, name, min, max] of [['width', 'Largura', 40, 700], ['height', 'Altura', 30, 1000], ['offsetY', 'Distância do topo', 0, 500]]) {
        const label = document.createElement('label'); label.textContent = name + ' (px)';
        const field = document.createElement('input'); field.type = 'number'; field.min = min; field.max = max;
        field.value = image[key] ?? (key === 'width' ? 180 : key === 'height' ? 120 : 0);
        field.addEventListener('input', () => { if (!this.canEdit()) return; image[key] = Math.max(min, Math.min(max, Number(field.value) || min)); this.changed(); });
        label.appendChild(field); row.appendChild(label);
      }
      const label = document.createElement('label'); label.textContent = 'Alinhamento';
      const align = document.createElement('select'); align.innerHTML = '<option value="left">Esquerda</option><option value="right">Direita</option>';
      align.value = image.align === 'right' ? 'right' : 'left';
      align.addEventListener('change', () => { if (this.canEdit()) { image.align = align.value; this.changed(); } });
      label.appendChild(align); row.appendChild(label);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover imagem';
      remove.addEventListener('click', () => { if (this.canEdit()) { question.freeImages.splice(imageIndex, 1); renderAll(); } });
      row.appendChild(remove); group.appendChild(row);
    });
    card.querySelector('.question-images')?.appendChild(group);
  },
  updatePreview() {
    if (!this.initialized) return;
    clearTimeout(this.previewTimer);
    this.updateQuestionSummaries();
    const title = document.getElementById('activeExamTitle');
    if (title) title.textContent = this.bankId ? 'Editar questão do banco' : state.school.examTitle || 'Prova sem título';
    const issues = ExamSafety.inspectExam(state);
    const list = document.getElementById('examIssues');
    if (list) {
      list.replaceChildren();
      issues.forEach(issue => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = issue.message;
        button.addEventListener('click', () => this.focusQuestion(issue.index)); list.appendChild(button);
      });
      document.getElementById('readinessSummary').textContent = issues.length
        ? `Revisar · ${issues.length} ${issues.length === 1 ? 'pendência' : 'pendências'}`
        : 'Conferência concluída';
    }
    const nav = document.getElementById('questionOutline');
    if (nav) {
      const overviewSummary = document.querySelector('#questionOverview > summary');
      if (overviewSummary) overviewSummary.textContent = `Questões da prova (${state.questions.length})`;
      nav.replaceChildren();
      state.questions.forEach((q, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${index + 1}. ${String(q.text || typeLabel[q.type] || 'Questão').slice(0, 70)}`;
        if (index === state.activeQuestionIndex) button.setAttribute('aria-current','true');
        button.dataset.questionType = typeLabel[q.type] || q.type;
        button.title = `${index + 1}. ${q.text || ''}`;
        button.addEventListener('click', () => this.focusQuestion(index)); nav.appendChild(button);
      });
    }
    this.filterQuestions();
    const empty = document.getElementById('editorSelectionHint');
    if (empty) empty.hidden = Number.isInteger(state.activeQuestionIndex) || Boolean(this.bankId);
    this.refreshPreviewNavigation();
    const frame = document.getElementById('canonicalPreview');
    if (frame && this.previewReady) {
      if (!this.forceSnapshot && this.previewQuestionCount === state.questions.length && this.dirtyQuestions.size) {
        for (const index of this.dirtyQuestions) frame.contentWindow.postMessage({ type:'exam-preview-patch', index, question:state.questions[index] }, location.origin);
      } else frame.contentWindow.postMessage({ type: 'exam-preview', exam: {
        school: state.school, questions: state.questions, logoDataUrl: state.logoDataUrl,
      }, answerKey: Boolean(document.getElementById('previewAnswerKey')?.checked) }, location.origin);
      if (Number.isInteger(this.pendingPreviewFocus)) {
        const index = Math.min(this.pendingPreviewFocus, state.questions.length - 1);
        if (index >= 0) {
          const viewport = frame.closest('.preview-scroll');
          if (viewport) viewport.scrollTop = 0;
          frame.contentWindow.postMessage({type:'exam-preview-focus',index}, location.origin);
        }
        this.pendingPreviewFocus = null;
      }
      this.forceSnapshot = false; this.previewQuestionCount = state.questions.length; this.dirtyQuestions.clear();
    }
    this.refreshActions();
  },
  previewQuestion(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.questions.length) return;
    this.previewSelection = index; this.pendingPreviewFocus = index;
    document.body.dataset.editorView = 'preview';
    this.updatePreview();
  },
  refreshPreviewNavigation() {
    const select = document.getElementById('previewQuestionSelect');
    if (!select) return;
    const count = state.questions.length;
    this.previewSelection = Math.max(0, Math.min(this.previewSelection || 0, count - 1));
    select.replaceChildren();
    state.questions.forEach((q,index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = (index + 1) + '. ' + (String(q.text || '').trim() || 'Sem enunciado').slice(0,70);
      select.appendChild(option);
    });
    select.value = String(this.previewSelection); select.disabled = !count;
    document.getElementById('previewPrevious').disabled = !count || this.previewSelection === 0;
    document.getElementById('previewNext').disabled = !count || this.previewSelection >= count - 1;
  },
  focusQuestion(index) {
    document.body.dataset.editorView = 'edit';
    if (index == null || index < 0) { document.getElementById('examDetails').open = true; document.getElementById('examTitle').focus(); return; }
    if (!Number.isInteger(index) || index >= state.questions.length) return;
    state.activeQuestionIndex = index;
    const overview = document.getElementById('questionOverview');
    if (overview) overview.open = false;
    this.previewSelection = index;
    this.pendingPreviewFocus = index;
    state.collapsedQuestions[index] = false; renderAll(false);
    this.updatePreview();
    const card = document.getElementById(`question-${index}`);
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); card?.querySelector('textarea,input,button')?.focus();
  },
  async openPrint(answerKey) {
    if (this.isTeacher()) { document.body.dataset.editorView = 'preview'; this.updatePreview(); return; }
    if (this.bankId) { showToast('Use Inserir na prova para imprimir esta questão em uma avaliação.', 'err'); return; }
    if (auth?.getCurrentUser()?.id !== editorUserId) { showToast('A conta mudou. Reabra a prova na conta correta.', 'err'); return; }
    this.recordHistory();
    if (!await flushAutoSaveBeforeAction()) return;
    const issues = ExamSafety.inspectExam(state);
    if (issues.some(issue => issue.blocking)) {
      document.getElementById('readinessDetails').open = true; this.updatePreview();
      showToast('Corrija os erros indicados na conferência antes de imprimir.', 'err'); return;
    }
    if (issues.length && !confirm(`Há ${issues.length} ponto(s) para conferir, como campos ou gabaritos incompletos. Continuar para a impressão?`)) return;
    // Carrega novamente a versão persistida; nenhum estado local de prova aprovada vai para impressão.
    location.href = `print.html?id=${encodeURIComponent(currentExamId)}${answerKey ? '&gabarito=1' : ''}`;
  },
  openModal(modal) {
    this.modal = modal; this.modalReturn = document.activeElement;
    document.body.classList.add('dialog-open');
    modal.querySelector('input,button,[tabindex]')?.focus();
  },
  closeModal() {
    this.modal = null; document.body.classList.remove('dialog-open');
    this.modalReturn?.focus(); this.modalReturn = null;
  },
  async loadBank() {
    setEditorLoading(true);
    try {
      const user = auth.getCurrentUser(); editorUserId = user.id;
      currentProfile = await auth.loadCurrentProfile();
      if (!currentProfile) throw new Error('Perfil indisponível.');
      const rows = await auth.authenticatedRequest(`/question_bank?id=eq.${encodeURIComponent(this.bankId)}&select=*`);
      const row = rows?.[0];
      if (!row || row.user_id !== user.id || !row.updated_at) throw new Error('Questão indisponível ou sem permissão de edição.');
      this.bankRecord = row;
      state.questions = [ExamSafety.normalizeQuestion(row.question)]; state.collapsedQuestions = {};
      state.school = { ...defaultSchool, subject: row.subject || '', className: row.grade || '',
        bankTitle: row.title || '', bankGrade: row.grade || '', bankSkill: row.skill || '',
        bankDifficulty: row.difficulty || 'media', bankScope: getBankItemScope(row), totalValue: row.question.points || '0,0' };
      state.logoDataUrl = ''; currentExamVersion = row.updated_at; currentReviewStatus = 'rascunho';
      currentExamOwnerId = user.id; autoSaveReady = true;
      applyStateToInputs(); renderAll(); lastSavedFingerprint = examFingerprint();
      setEditorLoading(false); this.resetHistory(); this.refreshBankFields(); restorePendingDraft();
      document.getElementById('cloudUser').textContent = user.email;
      setAutoSaveHint('Alterações salvas automaticamente');
      applyModuleNavigation();
    } catch (error) {
      autoSaveReady = false; setAutoSaveHint(error.message); document.getElementById('retryLoadBtn').hidden = false;
    }
  },
  refreshBankFields() {
    if (!this.bankId) return;
    document.querySelectorAll('[data-bank-field]').forEach(field => { field.value = state.school[field.dataset.bankField] || ''; });
  },
  async saveBank() {
    if (!this.canEdit() || !this.bankRecord || this.bankSaving) return false;
    const fingerprint = examFingerprint();
    if (fingerprint === lastSavedFingerprint) return true;
    this.bankSaving = true; this.refreshActions(); preservePendingDraft();
    try {
      if (state.questions.length !== 1) throw new Error('Este registro deve conter exatamente uma questão. Seu rascunho foi preservado.');
      const question = ExamSafety.normalizeQuestion(state.questions[0]);
      if (new Blob([JSON.stringify(question)]).size > 1700 * 1024) throw new Error('Questão muito pesada para o banco.');
      const payload = { title: state.school.bankTitle || questionTitle(question), subject: state.school.subject || '',
        grade: state.school.bankGrade || '', skill: state.school.bankSkill || '', difficulty: state.school.bankDifficulty || 'media',
        question_type: question.type, question, ...buildBankScopePayload(state.school.bankScope || 'private') };
      const rows = await auth.authenticatedRequest(`/question_bank?id=eq.${encodeURIComponent(this.bankId)}&updated_at=eq.${encodeURIComponent(currentExamVersion)}&select=id,updated_at`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload),
      });
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].updated_at) throw new Error('O registro mudou em outra aba. Seu rascunho foi preservado; reabra para comparar.');
      currentExamVersion = rows[0].updated_at; lastSavedFingerprint = fingerprint;
      if (examFingerprint() === fingerprint) localStorage.removeItem(pendingDraftKey()); else preservePendingDraft();
      setAutoSaveHint('Alterações salvas automaticamente'); return true;
    } catch (error) { showToast(error.message, 'err'); setAutoSaveHint('Erro ao salvar'); return false; }
    finally { this.bankSaving = false; this.refreshActions(); }
  },
  init() {
    this.initialized = true;
    document.body.dataset.editorView = new URLSearchParams(location.search).get('view') === 'preview' ? 'preview' : 'edit';
    if (this.bankId) document.body.classList.add('bank-mode');
    const panel = document.querySelector('.card.no-print');
    panel.id = 'editorPanel';
    const heading = panel.querySelector('h2');
    const general = heading.nextElementSibling;
    const details = document.createElement('details'); details.id = 'examDetails'; details.open = false;
    const summary = document.createElement('summary'); summary.textContent = 'Dados da avaliação'; details.append(summary, general); heading.after(details);
    const editorColumn = document.createElement('section'); editorColumn.className = 'editor-column';
    panel.before(editorColumn); editorColumn.appendChild(panel);
    const headingRow = document.createElement('div'); headingRow.className = 'editor-panel-heading';
    heading.textContent = 'Edição da prova'; editorColumn.prepend(headingRow); headingRow.appendChild(heading);
    const top = document.createElement('div'); top.className = 'editor-primary-actions';
    top.innerHTML = '<div class="editor-context"><a class="editor-back-link" href="dashboard.html">← Minhas provas</a><strong id="activeExamTitle">Editor da prova</strong></div><div class="editor-work-actions"><span class="editor-view-switch"><button id="viewEditBtn" type="button">Editar</button><button id="viewPreviewBtn" type="button">Só prévia</button></span><button id="mainPrintBtn" type="button" class="primary">Imprimir / PDF</button><button id="saveBankRecordBtn" type="button" class="primary">Salvar no banco</button></div>';
    document.querySelector('.editor-actionbar-inner').prepend(top);
    const createQuestion = document.querySelector('.top-new-question');
    if (createQuestion) {
      const createButton = createQuestion.querySelector('#topNewQuestionBtn');
      if (createButton) createButton.textContent = '+ Nova questão';
      headingRow.appendChild(createQuestion);
    }
    const dashboardLink = document.querySelector('.app-sidebar .app-nav-link[href="dashboard.html"]');
    if (dashboardLink) dashboardLink.textContent = '← Minhas provas';
    const send = document.createElement('button'); send.id = 'sendCoordinationBtn'; send.type = 'button'; send.className = 'primary';
    send.textContent = 'Enviar para coordenação'; send.onclick = () => this.sendToCoordination();
    const cloudBar = document.getElementById('cloudBar');
    const status = cloudBar?.querySelector('.topbar-status');
    const settings = cloudBar?.querySelector('.settings-wrap');
    const login = document.getElementById('loginLink');
    if (settings) top.lastElementChild.appendChild(settings);
    if (login) top.lastElementChild.appendChild(login);
    top.lastElementChild.appendChild(send);
    if (status) top.lastElementChild.appendChild(status);
    if (cloudBar) cloudBar.classList.add('topbar-panel-hidden');
    const feedback = document.createElement('p'); feedback.id = 'teacherFeedback'; feedback.hidden = true; details.before(feedback);
    if (typeof ResizeObserver !== 'undefined') {
      const bar = document.querySelector('.editor-actionbar');
      new ResizeObserver(() => document.documentElement.style.setProperty('--editor-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`)).observe(bar);
    }
    const undoButton = document.getElementById('undoBtn'), redoButton = document.getElementById('redoBtn');
    if (undoButton) undoButton.onclick = () => this.travelHistory(-1);
    if (redoButton) redoButton.onclick = () => this.travelHistory(1);
    document.getElementById('viewEditBtn').onclick = () => { document.body.dataset.editorView = 'edit'; this.resizePreview(); };
    document.getElementById('viewPreviewBtn').onclick = () => { document.body.dataset.editorView = 'preview'; this.updatePreview(); this.resizePreview(); };
    document.getElementById('mainPrintBtn').onclick = () => this.openPrint(false);
    document.getElementById('saveBankRecordBtn').onclick = () => this.saveBank();
    const overview = document.createElement('details'); overview.id = 'questionOverview';
    overview.innerHTML = '<summary>Questões da prova</summary><input id="questionSearch" type="search" aria-label="Buscar questão" placeholder="Buscar por enunciado ou tipo"><p id="questionSearchEmpty" class="small" hidden>Nenhuma questão encontrada.</p><nav id="questionOutline" aria-label="Navegar pelas questões"></nav>';
    details.after(overview);
    document.getElementById('questionSearch').oninput = () => this.filterQuestions();
    const readiness = document.createElement('details'); readiness.id = 'readinessDetails';
    readiness.innerHTML = '<summary id="readinessSummary">Conferir prova</summary><p class="small">Esta conferência verifica preenchimento, pontuação e estrutura do gabarito. Revise também o conteúdo e as respostas antes de aplicar a prova.</p><div id="examIssues"></div>';
    overview.after(readiness);
    const selectionHint = document.createElement('p'); selectionHint.id = 'editorSelectionHint'; selectionHint.textContent = 'Selecione uma questão em “Questões da prova” ou crie uma nova para começar.'; readiness.after(selectionHint);
    const preview = document.createElement('section'); preview.id = 'canonicalPreviewPanel';
    preview.innerHTML = '<div class="preview-toolbar"><div class="preview-options"><strong>Prévia da prova</strong><label class="preview-answer-key"><input class="sr-only" type="checkbox" id="previewAnswerKey" aria-label="Mostrar gabarito na prévia"><span>Ver respostas</span></label><select class="sr-only" id="previewZoom" aria-label="Zoom da prévia"><option value="fit" selected>Ajustar à largura</option></select></div><div class="preview-navigation"><button type="button" id="previewPrevious" aria-label="Questão anterior na prévia" title="Questão anterior">‹</button><label class="sr-only" for="previewQuestionSelect">Ir à questão</label><select id="previewQuestionSelect" aria-label="Ir à questão na prévia"></select><button type="button" id="previewNext" aria-label="Próxima questão na prévia" title="Próxima questão">›</button></div></div><div class="preview-scroll"><iframe id="canonicalPreview" src="print.html?preview=1&v=20260921-word-search" title="Prévia da prova em formato A4"></iframe></div>';
    document.getElementById('previewRoot').parentElement.appendChild(preview);
    document.getElementById('previewQuestionSelect').onchange = event => this.previewQuestion(Number(event.target.value));
    document.getElementById('previewPrevious').onclick = () => this.previewQuestion(this.previewSelection - 1);
    document.getElementById('previewNext').onclick = () => this.previewQuestion(this.previewSelection + 1);
    document.getElementById('previewAnswerKey').onchange = () => { this.forceSnapshot = true; this.updatePreview(); };
    document.getElementById('previewZoom').onchange = () => this.resizePreview();
    if (typeof ResizeObserver !== 'undefined') {
      const workspaceObserver = new ResizeObserver(() => this.resizePreview());
      workspaceObserver.observe(preview); workspaceObserver.observe(editorColumn);
    }
    window.addEventListener('resize', () => this.resizePreview());
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.source === document.getElementById('canonicalPreview').contentWindow && event.data?.type === 'exam-preview-ready') { this.previewReady = true; this.updatePreview(); }
    });
    // All implemented types have an explicit creation path and a short example.
    const select = document.getElementById('qtypeSelect'); select.replaceChildren();
    const groups = {};
    const category = type => ['multipla','vf','marcarx','relacione','associacao_setas'].includes(type) ? 'Alternativas e relações'
      : ['discursiva','texto_base','subitens','lacunas','ordenacao'].includes(type) ? 'Escrita e interpretação'
      : ['matematica_coluna','expressao_matematica','problema_matematico','sequencia_numerica','tabela'].includes(type) ? 'Matemática e dados'
      : ['ditado','silabas','leitura_escrita','caca_palavras','cruzadinha'].includes(type) ? 'Linguagem e alfabetização' : 'Imagens e desenho';
    for (const [type, label] of Object.entries(typeLabel)) {
      if (!templates[type] || ['multipla','associacao_setas'].includes(type)) continue;
      const name = category(type);
      if (!groups[name]) { groups[name] = document.createElement('optgroup'); groups[name].label = name; select.appendChild(groups[name]); }
      const option = document.createElement('option'); option.value = type; option.textContent = label; groups[name].appendChild(option);
    }
    buildTopQuestionMenu();
    document.querySelectorAll('#topQuestionMenu button[data-type]').forEach(button => {
      const example = templates[button.dataset.type]();
      const hint = document.createElement('small'); hint.textContent = example.text || 'Escreva o enunciado e configure as respostas.'; button.appendChild(hint);
    });
    for (const [buttonId, menuId] of [['topNewQuestionBtn', 'topQuestionMenu'], ['settingsBtn', 'settingsMenu']]) {
      const button = document.getElementById(buttonId); button.setAttribute('aria-controls', menuId); button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => {
        const open = !document.getElementById(menuId).classList.contains('hidden'); button.setAttribute('aria-expanded', String(open));
        if (open) document.getElementById(menuId).querySelector('button,a')?.focus();
      });
    }
    this.setupQuestionPicker(category);
    if (this.bankId) this.buildBankFields(details);
    document.addEventListener('click', event => {
      if (event.target.closest('#editorPanel, #topQuestionMenu') && this.canEdit()) this.recordHistory();
      if (!this.canEdit() && event.target.closest('#editorPanel, #topQuestionMenu')) {
        // Reading/navigation remain available; any data-changing controls are blocked.
        if (!event.target.closest('summary,#questionOutline,#questionSearch,#examIssues,.qnum')) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (this.modal) { if (this.modal.dismiss) this.modal.dismiss(); else { this.modal.classList.remove('show'); this.closeModal(); } }
        document.querySelectorAll('.top-question-menu,.settings-menu').forEach(menu => menu.classList.add('hidden'));
        document.querySelectorAll('[aria-expanded="true"][aria-controls]').forEach(button => { button.setAttribute('aria-expanded', 'false'); button.focus(); });
      }
      if (this.modal && event.key === 'Tab') {
        const nodes = [...this.modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node => !node.disabled && !node.hidden);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!this.modal.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if ((event.ctrlKey || event.metaKey) && ['z','y','s','p'].includes(event.key.toLowerCase())) {
        const key = event.key.toLowerCase();
        if (key === 'p') { event.preventDefault(); this.openPrint(false); }
        else if (key === 's') { event.preventDefault(); this.bankId ? this.saveBank() : flushAutoSaveBeforeAction(); }
        else { event.preventDefault(); this.travelHistory(key === 'y' || event.shiftKey ? 1 : -1); }
      }
    });
    window.addEventListener('auth-session-changed', () => { this.refreshActions(); try { applyReviewLock(); } catch {} });
    this.enhanceFields(); this.updatePreview();
  },
  syncPreviewHeight() {
    const preview = document.getElementById('canonicalPreviewPanel');
    const editor = document.querySelector('.editor-column');
    if (!preview) return;
    if (document.body.dataset.editorView !== 'edit' || window.innerWidth <= 1150 || !editor) {
      preview.style.removeProperty('--editor-column-height'); return;
    }
    const editorHeight = Math.ceil(editor.getBoundingClientRect().height);
    const hasOpenQuestion = Boolean(this.bankId) || Number.isInteger(state.activeQuestionIndex);
    const viewportHeight = Math.max(360, Math.floor(window.innerHeight - preview.getBoundingClientRect().top - 24));
    const height = hasOpenQuestion ? editorHeight : Math.max(editorHeight, viewportHeight);
    if (height > 0) preview.style.setProperty('--editor-column-height', `${height}px`);
  },
  resizePreview() {
    const frame = document.getElementById('canonicalPreview');
    const viewport = frame?.parentElement;
    if (!viewport?.clientWidth) return;
    this.syncPreviewHeight();
    const fit = Math.min(1, (viewport.clientWidth - 2) / 850);
    const zoom = document.getElementById('previewZoom').value === 'fit' ? fit : Number(document.getElementById('previewZoom').value);
    frame.style.zoom = String(zoom);
    const availableHeight = Math.max(260, viewport.clientHeight, window.innerHeight - viewport.getBoundingClientRect().top - 24);
    frame.style.height = `${availableHeight / zoom}px`;
    viewport.style.maxHeight = 'none';
    document.getElementById('viewEditBtn').setAttribute('aria-pressed', String(document.body.dataset.editorView === 'edit'));
    document.getElementById('viewPreviewBtn').setAttribute('aria-pressed', String(document.body.dataset.editorView === 'preview'));
  },
  filterQuestions() {
    const query = (document.getElementById('questionSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
    let visible = 0;
    document.querySelectorAll('#questionOutline button').forEach(button => {
      button.hidden = !`${button.textContent} ${button.dataset.questionType}`.toLocaleLowerCase('pt-BR').includes(query);
      if (!button.hidden) visible++;
    });
    const empty = document.getElementById('questionSearchEmpty');
    if (empty) empty.hidden = visible > 0 || !query;
  },
  setupQuestionPicker(category) {
    const menu = document.getElementById('topQuestionMenu');
    menu.setAttribute('role','dialog'); menu.setAttribute('aria-modal','true'); menu.setAttribute('aria-label','Escolher tipo de questão');
    const types = [...menu.querySelectorAll('button[data-type]')];
    const bank = menu.querySelector('[data-action="bank"]');
    menu.replaceChildren();
    const header = document.createElement('div'); header.className = 'picker-header';
    header.innerHTML = '<h2>Nova questão</h2><button type="button" data-picker-close aria-label="Fechar escolha de questão">Fechar</button>';
    const filters = document.createElement('div'); filters.className = 'picker-filters';
    filters.innerHTML = '<input type="search" aria-label="Buscar tipo de questão" placeholder="Que tipo de questão você quer criar?"><select aria-label="Categoria de questão"><option value="">Todas as categorias</option></select>';
    const select = filters.querySelector('select');
    [...new Set(types.map(b => category(b.dataset.type)))].forEach(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); });
    const grid = document.createElement('div'); grid.className = 'picker-grid';
    const samples = { multipla:'◉ A   ○ B   ○ C', vf:'(V) Afirmação   (F) Afirmação', marcarx:'Uma resposta correta ou várias: ◉ A / ☑ A ☑ B', discursiva:'Resposta: __________________', matematica_coluna:'12 + 8 = ____', lacunas:'A planta precisa de ____.', espaco_livre:'▧ Espaço para desenhar', tabela:'Grupo | Quantidade', subitens:'a) Pergunta   b) Pergunta', problema_matematico:'3 sementes + 2 sementes. Quantas ao todo?', ordenacao:'2 → 1 → 3 • Ordene as etapas', relacione:'Olhos → Ver • Ouvidos → Ouvir', expressao_matematica:'(2 + 3) × 4 = ____' };
    types.forEach(button => {
      button.dataset.category = category(button.dataset.type);
      const hint = button.querySelector('small');
      if (hint && samples[button.dataset.type]) hint.textContent = samples[button.dataset.type];
      grid.append(button);
    });
    const empty = document.createElement('p'); empty.textContent = 'Nenhum tipo encontrado. Tente outro termo.'; empty.hidden = true;
    const sticky = document.createElement('div'); sticky.className = 'picker-sticky';
    sticky.append(header, filters);
    if (bank) sticky.append(bank);
    menu.append(sticky, grid, empty);
    const close = () => { menu.classList.add('hidden'); document.getElementById('topNewQuestionBtn').setAttribute('aria-expanded','false'); document.getElementById('topNewQuestionBtn').focus(); };
    header.querySelector('button').onclick = close;
    document.addEventListener('click', event => {
      if (!menu.classList.contains('hidden') && !event.target.closest('#topQuestionMenu,#topNewQuestionBtn')) {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      }
    }, true);
    const filter = () => { let found = 0; const query = filters.querySelector('input').value.toLocaleLowerCase('pt-BR'); types.forEach(button => { button.hidden = !(button.textContent.toLocaleLowerCase('pt-BR').includes(query) && (!select.value || select.value === button.dataset.category)); if (!button.hidden) found++; }); empty.hidden = found > 0; };
    filters.querySelector('input').oninput = filter; select.onchange = filter;
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const nodes = [...menu.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.hidden);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  },
  buildBankFields(details) {
    const group = document.createElement('fieldset'); group.id = 'bankEditFields';
    const legend = document.createElement('legend'); legend.textContent = 'Registro original do banco'; group.appendChild(legend);
    for (const [key, title] of [['bankTitle','Título'], ['subject','Disciplina'], ['bankGrade','Série/ano'], ['bankSkill','Habilidade'], ['bankDifficulty','Dificuldade'], ['bankScope','Compartilhamento']]) {
      const label = document.createElement('label'); label.textContent = title;
      const field = document.createElement(['bankDifficulty','bankScope'].includes(key) ? 'select' : 'input'); field.dataset.bankField = key;
      if (key === 'bankDifficulty') field.innerHTML = '<option value="facil">Fácil</option><option value="media">Média</option><option value="dificil">Difícil</option>';
      if (key === 'bankScope') field.innerHTML = '<option value="private">Privada</option><option value="school">Minha escola</option><option value="public">Pública</option>';
      field.addEventListener('input', () => { if (this.canEdit()) { state.school[key] = field.value; this.changed(); } });
      label.appendChild(field); group.appendChild(label);
    }
    details.after(group);
  },
};
window.EditorTools = EditorTools;
document.addEventListener('DOMContentLoaded', () => EditorTools.init());
