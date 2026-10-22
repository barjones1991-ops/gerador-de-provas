/* Fluxos do editor. Dados reais continuam passando pelo AuthManager e pelas policies do banco. */
const EditorTools = {
  loading: true, initialized: false, applyingHistory: false, history: [], historyIndex: -1,
  bankId: new URLSearchParams(window.location.search).get('bank'), bankRecord: null,
  previewTimer: null, persistTimer: null, historyTimer: null, previewReady: false,
  forceSnapshot: true, previewQuestionCount: -1, dirtyQuestions: new Set(),
  previewRevision: 0, previewFingerprint: '', previewPaginationPending: false,
  reviewHistory: [], sending: false, spaceSuggestion: null,
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
    recover.onclick = async () => {
      if (auth.getCurrentUser()?.id !== editorUserId) return;
      try {
        const content = JSON.parse(draft.content);
        const imageStorage = globalThis.ExamImageStorage;
        const scope = this.bankId ? `bank-${this.bankId}` : currentExamId;
        const resolved = imageStorage ? await imageStorage.resolveTree(content, { auth, scope }) : content;
        const questions = resolved.questions.map(ExamSafety.normalizeQuestion);
        if (this.bankId && questions.length !== 1) throw new Error('O rascunho do banco deve conter uma questão. Sua cópia foi mantida para conferência.');
        if (!resolved.school || typeof resolved.school !== 'object') throw new Error('Dados da avaliação inválidos.');
        state.school = resolved.school; state.questions = questions; state.logoDataUrl = resolved.logoDataUrl || '';
        state.decorativeImages = window.ExamDecorations?.normalizeList
          ? window.ExamDecorations.normalizeList(resolved.decorativeImages)
          : (Array.isArray(resolved.decorativeImages) ? resolved.decorativeImages : []);
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
      const text = this.plainRichText(q.text || '').trim() || 'Sem enunciado ainda';
      if (summary) { summary.textContent = text; summary.title = text; }
      if (q.type === 'discursiva') this.syncDiscursive(card, q, Number(card.dataset.questionIndex));
      else this.syncStandardQuestion(card, q, Number(card.dataset.questionIndex));
    });
  },
  changed() {
    if (!this.initialized) return;
    this.invalidateSpaceSuggestion(true);
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
  async travelHistory(direction) {
    if (!this.canEdit() || this.applyingHistory) return;
    clearTimeout(this.historyTimer);
    this.recordHistory();
    const next = this.historyIndex + direction;
    if (next < 0 || next >= this.history.length) return;
    this.applyingHistory = true; this.refreshActions();
    try {
      const snapshot = JSON.parse(this.history[next]);
      const imageStorage = globalThis.ExamImageStorage;
      const scope = this.bankId ? `bank-${this.bankId}` : currentExamId;
      const resolved = imageStorage ? await imageStorage.resolveTree(snapshot, { auth, scope }) : snapshot;
      this.historyIndex = next;
      state.school = resolved.school;
      state.questions = resolved.questions.map(ExamSafety.normalizeQuestion);
      state.logoDataUrl = resolved.logoDataUrl;
      state.decorativeImages = window.ExamDecorations?.normalizeList
        ? window.ExamDecorations.normalizeList(resolved.decorativeImages)
        : (Array.isArray(resolved.decorativeImages) ? resolved.decorativeImages : []);
      state.collapsedQuestions = {};
      if (state.activeQuestionIndex >= state.questions.length) state.activeQuestionIndex = null;
      applyStateToInputs(); this.refreshBankFields(); renderAll();
      // Defaults de apresentação não criam uma nova ação nem descartam o ramo Refazer.
      this.history[next] = examFingerprint();
    } catch (error) {
      showToast(error.message || 'Não foi possível restaurar as imagens deste histórico.', 'err');
      return;
    } finally { this.applyingHistory = false; this.refreshActions(); }
    preservePendingDraft(); this.changed(); this.refreshActions();
  },
  refreshActions() {
    if (!this.initialized) return;
    const enabled = this.canEdit() && !this.applyingHistory;
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
    document.querySelectorAll('#questionOutline .question-outline-remove').forEach(node => { node.disabled = !enabled || Boolean(this.bankId); });
    const decorationButton = document.getElementById('decorationModeBtn');
    if (decorationButton) {
      decorationButton.hidden = Boolean(this.bankId);
      decorationButton.disabled = !enabled || Boolean(this.bankId);
    }
    document.querySelectorAll('#decorationBar button, #decorationBar select').forEach(node => this.lockControl(node, !enabled));
    document.querySelectorAll('.free-image-remove, .free-image-resize').forEach(node => this.lockControl(node, !enabled));
  },
  questionFingerprint() {
    const content = JSON.stringify(state.questions);
    let hash = 2166136261;
    for (let index = 0; index < content.length; index++) {
      hash ^= content.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${state.questions.length}:${(hash >>> 0).toString(36)}`;
  },
  invalidateSpaceSuggestion(pending = false) {
    this.spaceSuggestion = null;
    this.previewPaginationPending = Boolean(pending);
    const notice = document.getElementById('layoutOptimization');
    const button = document.getElementById('layoutOptimizationBtn');
    if (notice) notice.hidden = true;
    if (button) button.disabled = true;
  },
  setSpaceSuggestion(suggestion, context = {}) {
    const revision = Number(context.revision ?? suggestion?.revision);
    const fingerprint = context.fingerprint ?? suggestion?.fingerprint;
    const belongsToCurrentRevision = Number.isInteger(revision)
      && revision === this.previewRevision
      && fingerprint === this.previewFingerprint
      && fingerprint === this.questionFingerprint();
    if (!belongsToCurrentRevision) return false;
    if (context.pending === true) { this.invalidateSpaceSuggestion(true); return false; }
    this.previewPaginationPending = false;
    const valid = suggestion && Number.isInteger(suggestion.fromIndex) && Number.isInteger(suggestion.toIndex)
      && suggestion.fromIndex > suggestion.toIndex && suggestion.fromIndex < state.questions.length;
    this.spaceSuggestion = valid ? { ...suggestion, revision, fingerprint } : null;
    const notice = document.getElementById('layoutOptimization');
    const copy = document.getElementById('layoutOptimizationCopy');
    const button = document.getElementById('layoutOptimizationBtn');
    if (!notice || !copy || !button) return valid;
    notice.hidden = !valid || Boolean(this.bankId);
    if (!valid) { button.disabled = true; return false; }
    copy.textContent = `A questão ${suggestion.fromIndex + 1} pode aproveitar o espaço livre da página ${suggestion.page}.`;
    button.disabled = !this.canEdit();
    return true;
  },
  applySpaceSuggestion() {
    const suggestion = this.spaceSuggestion;
    if (!suggestion || !this.canEdit()) return;
    const belongsToCurrentRevision = suggestion.revision === this.previewRevision
      && suggestion.fingerprint === this.previewFingerprint
      && suggestion.fingerprint === this.questionFingerprint()
      && !this.previewPaginationPending;
    if (!belongsToCurrentRevision) { this.invalidateSpaceSuggestion(true); return; }
    const { fromIndex, toIndex } = suggestion;
    if (fromIndex <= toIndex || fromIndex >= state.questions.length || toIndex < 0) {
      this.invalidateSpaceSuggestion(); return;
    }
    const accepted = confirm(`Mover a questão ${fromIndex + 1} para antes da questão ${toIndex + 1}?\n\nIsso aproveita melhor o espaço da página ${suggestion.page}, mas altera a ordem das questões.`);
    if (!accepted) return;
    this.recordHistory();
    this.applyingHistory = true;
    try {
      const [question] = state.questions.splice(fromIndex, 1);
      state.questions.splice(toIndex, 0, question);
      state.activeQuestionIndex = toIndex;
      state.collapsedQuestions = {};
      this.previewSelection = toIndex;
      this.pendingPreviewFocus = toIndex;
      this.forceSnapshot = true;
      this.invalidateSpaceSuggestion(true);
      renderAll();
    } finally { this.applyingHistory = false; }
    this.recordHistory();
    showToast('Diagramação otimizada. Use Desfazer se quiser restaurar a ordem anterior.', 'ok');
  },
  moveQuestion(fromIndex, toIndex) {
    if (!this.canEdit() || this.applyingHistory || this.bankId || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
      || fromIndex < 0 || toIndex < 0 || fromIndex >= state.questions.length || toIndex >= state.questions.length
      || fromIndex === toIndex) return;
    const remapIndex = index => {
      if (!Number.isInteger(index)) return index;
      if (index === fromIndex) return toIndex;
      if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
      if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
      return index;
    };
    this.recordHistory();
    const [question] = state.questions.splice(fromIndex, 1);
    state.questions.splice(toIndex, 0, question);
    if (Number.isInteger(state.activeQuestionIndex)) state.activeQuestionIndex = remapIndex(state.activeQuestionIndex);
    if (Number.isInteger(this.previewSelection)) this.previewSelection = remapIndex(this.previewSelection);
    const nextCollapsed = {};
    for (let oldIndex = 0; oldIndex < state.questions.length; oldIndex++) {
      nextCollapsed[remapIndex(oldIndex)] = Boolean(state.collapsedQuestions[oldIndex]);
    }
    state.collapsedQuestions = nextCollapsed;
    this.pendingPreviewFocus = this.previewSelection;
    renderAll();
  },
  startOutlineDrag(event, item, nav) {
    const touchMode = event.type === 'touchstart';
    if (touchMode) {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      event = {target:event.target,isPrimary:true,button:0,clientX:touch.clientX,clientY:touch.clientY,pointerId:touch.identifier};
    }
    if (this.outlineDrag || !event.isPrimary || event.button !== 0 || !this.canEdit() || this.applyingHistory || this.bankId
      || event.target.closest('.question-outline-remove')) return;
    const rows = [...nav.children], questions = [...state.questions];
    const fromIndex = Number(item.dataset.questionIndex);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const drag = { started:false, settling:false, x:event.clientX, y:event.clientY, frame:null, ghost:null };
    this.outlineDrag = drag;
    const valid = () => this.canEdit() && !this.applyingHistory && nav.isConnected && nav.closest('details').open
      && state.questions.length === questions.length && questions.every((question,index) => state.questions[index] === question);
    const animateRows = change => {
      const others = rows.filter(row => row !== item && !row.hidden);
      const previous = new Map(others.map(row => [row,row.getBoundingClientRect().top]));
      others.forEach(row => row.getAnimations?.().forEach(animation => animation.cancel()));
      change();
      others.forEach(row => {
        const delta = previous.get(row) - row.getBoundingClientRect().top;
        if (delta && !reducedMotion) row.animate?.([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],
          {duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
      });
    };
    const position = () => {
      if (!drag.started || drag.settling) return;
      const bounds = nav.getBoundingClientRect();
      drag.ghost.style.transform = `translate3d(${Math.max(-18,Math.min(18,drag.x-event.clientX))}px,${drag.y-event.clientY}px,0) scale(1.015)`;
      if (drag.x < bounds.left - 40 || drag.x > bounds.right + 40) return;
      // Use layout positions, not the in-flight animation transforms, for hit testing.
      const others = [...nav.children].filter(row => row !== item && !row.hidden);
      const before = others.find(row => drag.y < bounds.top + nav.clientTop + row.offsetTop - nav.scrollTop + row.offsetHeight / 2);
      const anchor = before || others.at(-1)?.nextSibling || null;
      if (anchor !== item && item.nextSibling !== anchor) animateRows(() => nav.insertBefore(item,anchor));
    };
    const tick = time => {
      if (!valid()) { end(false); return; }
      const bounds = nav.getBoundingClientRect();
      const elapsed = Math.min(32,time - (drag.lastTime || time)); drag.lastTime = time;
      if (drag.x >= bounds.left - 40 && drag.x <= bounds.right + 40) {
        const edge = 44;
        const speed = drag.y < bounds.top + edge ? -Math.min(1,(bounds.top+edge-drag.y)/edge)
          : drag.y > bounds.bottom-edge ? Math.min(1,(drag.y-bounds.bottom+edge)/edge) : 0;
        nav.scrollTop += speed * elapsed * .65;
      }
      position(); drag.frame = requestAnimationFrame(tick);
    };
    const activate = () => {
      drag.started = true; this.recordHistory();
      const rect = item.getBoundingClientRect();
      drag.ghost = item.cloneNode(true); drag.ghost.classList.add('question-outline-floating');
      drag.ghost.setAttribute('aria-hidden','true'); drag.ghost.inert = true;
      Object.assign(drag.ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
      document.body.appendChild(drag.ghost);
      item.style.height = `${rect.height}px`; item.classList.add('is-placeholder');
      nav.classList.add('is-sorting'); document.body.classList.add('question-outline-sorting');
      if (!touchMode) item.setPointerCapture?.(event.pointerId);
      position(); drag.frame = requestAnimationFrame(tick);
    };
    const move = next => {
      if (next.pointerId !== event.pointerId || drag.settling) return;
      drag.x = next.clientX; drag.y = next.clientY;
      if (!drag.started && Math.hypot(drag.x-event.clientX,drag.y-event.clientY) >= (touchMode ? 8 : 5)) {
        if (touchMode) { end(false); return; } // An immediate swipe keeps native scrolling.
        activate();
      }
      if (drag.started) { next.preventDefault(); position(); }
    };
    const cleanup = commit => {
      if (this.outlineDrag !== drag) return;
      const destination = [...nav.children].indexOf(item);
      const mayCommit = commit && valid();
      cancelAnimationFrame(drag.frame);
      drag.ghost?.remove();
      rows.forEach(row => row.getAnimations?.().forEach(animation => animation.cancel()));
      item.classList.remove('is-placeholder'); item.style.removeProperty('height');
      nav.classList.remove('is-sorting'); document.body.classList.remove('question-outline-sorting');
      if (item.hasPointerCapture?.(event.pointerId)) item.releasePointerCapture(event.pointerId);
      this.outlineDrag = null;
      if (mayCommit && destination !== fromIndex) this.moveQuestion(fromIndex,destination);
      // Restore the DOM on cancellation, and refresh numbering after a successful drop.
      if (drag.started) {
        this.updatePreview();
        const focusIndex = mayCommit ? destination : fromIndex;
        nav.querySelector(`[data-question-index="${focusIndex}"] .question-outline-open`)?.focus({preventScroll:true});
        const status = document.getElementById('questionOutlineStatus');
        if (status) status.textContent = mayCommit && destination !== fromIndex
          ? `Questão movida para a posição ${destination + 1}.` : 'Ordem das questões mantida.';
      }
    };
    const end = commit => {
      if (this.outlineDrag !== drag) return;
      document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
      document.removeEventListener('pointercancel',cancel); document.removeEventListener('keydown',key,true);
      document.removeEventListener('touchmove',touchMove); document.removeEventListener('touchend',touchEnd);
      document.removeEventListener('touchcancel',cancel); clearTimeout(drag.holdTimer);
      window.removeEventListener('blur',cancel);
      cancelAnimationFrame(drag.frame);
      if (drag.started) this.outlineSuppressClickUntil = Date.now() + 400;
      if (commit && drag.started && valid() && !drag.settling && !reducedMotion && drag.ghost.animate) {
        drag.settling = true;
        const target = item.getBoundingClientRect(), origin = drag.ghost;
        const animation = origin.animate([{transform:origin.style.transform},
          {transform:`translate3d(${target.left-parseFloat(origin.style.left)}px,${target.top-parseFloat(origin.style.top)}px,0) scale(1)`}],
          {duration:150,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
        animation.finished.then(() => cleanup(true),() => cleanup(false));
      } else cleanup(commit && drag.started);
    };
    const up = next => {
      if (next.pointerId !== event.pointerId) return;
      drag.x = next.clientX; drag.y = next.clientY; position();
      const rect = nav.getBoundingClientRect();
      end(drag.x >= rect.left-40 && drag.x <= rect.right+40 && drag.y >= rect.top-40 && drag.y <= rect.bottom+40);
    };
    const cancel = () => end(false);
    const key = next => { if (next.key === 'Escape') { next.preventDefault(); next.stopImmediatePropagation(); end(false); } };
    const touchInput = next => {
      const touch = [...next.changedTouches].find(point => point.identifier === event.pointerId);
      return touch && {pointerId:touch.identifier,clientX:touch.clientX,clientY:touch.clientY,preventDefault:() => next.preventDefault()};
    };
    const touchMove = next => {
      if (next.touches.length > 1) { end(false); return; }
      const input = touchInput(next); if (input) move(input);
    };
    const touchEnd = next => {
      const input = touchInput(next);
      if (input) { if (drag.started) next.preventDefault(); up(input); }
    };
    drag.cancel = cancel;
    if (touchMode) {
      drag.holdTimer = setTimeout(() => { if (valid()) activate(); else end(false); },220);
      document.addEventListener('touchmove',touchMove,{passive:false}); document.addEventListener('touchend',touchEnd,{passive:false});
      document.addEventListener('touchcancel',cancel);
    } else {
      document.addEventListener('pointermove',move,{passive:false}); document.addEventListener('pointerup',up);
      document.addEventListener('pointercancel',cancel);
    }
    document.addEventListener('keydown',key,true);
    window.addEventListener('blur',cancel);
  },
  removeQuestion(index) {
    if (!this.canEdit() || this.bankId || !Number.isInteger(index) || index < 0 || index >= state.questions.length) return;
    const label = this.plainRichText(state.questions[index].text || '').trim().slice(0,100);
    const detail = label ? `\n\n“${label}${label.length === 100 ? '…' : ''}”` : '';
    if (!confirm(`Excluir a questão ${index + 1}?${detail}\n\nEssa ação pode ser desfeita pelo botão Desfazer.`)) return;
    state.questions.splice(index, 1);
    if (state.activeQuestionIndex === index) state.activeQuestionIndex = null;
    else if (Number.isInteger(state.activeQuestionIndex) && state.activeQuestionIndex > index) state.activeQuestionIndex -= 1;
    if (this.previewSelection === index) this.previewSelection = state.questions.length ? Math.min(index, state.questions.length - 1) : 0;
    else if (this.previewSelection > index) this.previewSelection -= 1;
    const nextCollapsed = {};
    state.questions.forEach((_, questionIndex) => {
      nextCollapsed[questionIndex] = Boolean(state.collapsedQuestions[questionIndex >= index ? questionIndex + 1 : questionIndex]);
    });
    state.collapsedQuestions = nextCollapsed;
    this.pendingPreviewFocus = state.questions.length ? this.previewSelection : null;
    renderAll();
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
        this.organizeDiscursive(card, q, index);
        this.organizeStandardQuestion(card, q, index);
        this.organizeImagePanels(card);
        this.addMathStatementTools(card, q);
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
    this.enhanceRichTextFields(panel);
    this.refreshActions();
  },
  sanitizeRichTextHtml(value, isHtml = false) {
    const prefix = '\u2063rich1:';
    const rawValue = String(value ?? '');
    if (!isHtml && !rawValue.startsWith(prefix)) {
      return rawValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    const template = document.createElement('template');
    template.innerHTML = isHtml ? rawValue : rawValue.slice(prefix.length);
    const escapeText = text => text.replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[char]));
    const serialize = node => {
      if (node.nodeType === 3) return escapeText(node.nodeValue || '');
      if (node.nodeType !== 1) return '';
      const content = [...node.childNodes].map(serialize).join('');
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return '<br>';
      if (['b','strong'].includes(tag)) return `<strong>${content}</strong>`;
      if (['i','em'].includes(tag)) return `<em>${content}</em>`;
      if (tag === 'span' && node.getAttribute('data-font-size') === '14') return `<span data-font-size="14">${content}</span>`;
      if (['div','p'].includes(tag)) return `${content}<br>`;
      return content;
    };
    return [...template.content.childNodes].map(serialize).join('').replace(/(?:<br>)+$/g, '');
  },
  plainRichText(value) {
    const prefix = '\u2063rich1:';
    const rawValue = String(value ?? '');
    if (!rawValue.startsWith(prefix)) return rawValue;
    const template = document.createElement('template');
    template.innerHTML = rawValue.slice(prefix.length);
    return template.content.textContent || '';
  },
  enhanceRichTextFields(panel) {
    if (!this.richTextToolbar) {
      const toolbar = document.createElement('div');
      toolbar.className = 'exam-rich-toolbar';
      toolbar.hidden = true;
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Formatação do texto selecionado');
      const commands = [
        { label:'N', title:'Negrito', command:'bold', className:'is-bold' },
        { label:'I', title:'Itálico', command:'italic', className:'is-italic' },
        { label:'14', title:'Alternar tamanho: padrão ou grande (14 pt)', command:'large', className:'is-large' },
      ];
      for (const item of commands) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = item.label; button.title = item.title;
        button.setAttribute('aria-label', item.title); button.className = item.className;
        button.addEventListener('pointerdown', event => event.preventDefault());
        button.addEventListener('click', () => this.applyRichTextCommand(item.command));
        toolbar.appendChild(button);
      }
      document.body.appendChild(toolbar);
      this.richTextToolbar = toolbar;
      document.addEventListener('selectionchange', () => this.updateRichTextToolbar());
    }
    panel.querySelectorAll('.qcard textarea, .qcard input[type="text"]').forEach(field => {
      if (field.dataset.richTextEnhanced || field.disabled || field.readOnly) return;
      if (['bncc','wordList','wordsText'].includes(field.dataset.k)) return;
      const questionIndex = Number(field.closest('.qcard')?.dataset.questionIndex);
      if (field.dataset.k === 'text' && state.questions[questionIndex]?.type === 'problema_matematico') return;
      field.dataset.richTextEnhanced = 'true';
      const editable = document.createElement('div');
      editable.className = 'exam-rich-editor';
      field.classList.forEach(className => editable.classList.add(className));
      editable.contentEditable = 'true';
      editable.spellcheck = true;
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-multiline', String(field.tagName === 'TEXTAREA'));
      editable.setAttribute('aria-label', field.getAttribute('aria-label') || field.placeholder || 'Campo de texto');
      editable.dataset.richField = 'true';
      const fieldStyle = typeof getComputedStyle === 'function' ? getComputedStyle(field) : null;
      if (fieldStyle) {
        editable.style.fontFamily = fieldStyle.fontFamily;
        editable.style.fontSize = fieldStyle.fontSize;
        editable.style.lineHeight = fieldStyle.lineHeight;
        editable.style.color = fieldStyle.color;
      }
      if (field.id) editable.id = `${field.id}-rich`;
      if (field.placeholder) editable.dataset.placeholder = field.placeholder;
      if (field.tagName === 'TEXTAREA') {
        editable.style.minHeight = `${Math.max(76, field.clientHeight || field.rows * 24 || 90)}px`;
      }
      editable.innerHTML = this.sanitizeRichTextHtml(field.value);
      field.classList.add('exam-rich-source');
      field.insertAdjacentElement('afterend', editable);
      const label = field.id && panel.querySelector(`label[for="${field.id}"]`);
      if (label) label.htmlFor = editable.id;
      const sync = () => {
        const safeHtml = this.sanitizeRichTextHtml(editable.innerHTML, true);
        if (/<(?:strong|em|span data-font-size="14")>/.test(safeHtml)) field.value = `\u2063rich1:${safeHtml}`;
        else {
          const plain = document.createElement('div'); plain.innerHTML = safeHtml.replace(/<br>/g, '\n');
          field.value = plain.textContent || '';
        }
        field.dispatchEvent(new Event('input', { bubbles:true }));
      };
      editable.addEventListener('input', sync);
      editable.addEventListener('paste', event => {
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
        sync();
      });
      editable.addEventListener('drop', event => {
        event.preventDefault();
        const text = event.dataTransfer?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
        sync();
      });
      editable.addEventListener('keydown', event => {
        if (field.tagName !== 'TEXTAREA' && event.key === 'Enter') event.preventDefault();
        if ((event.ctrlKey || event.metaKey) && ['b','i'].includes(event.key.toLowerCase())) {
          event.preventDefault(); this.applyRichTextCommand(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
        }
      });
      editable.addEventListener('mouseup', () => { this.richTextActive = editable; this.updateRichTextToolbar(); });
      editable.addEventListener('keyup', () => { this.richTextActive = editable; this.updateRichTextToolbar(); });
      editable.addEventListener('focus', () => { this.richTextActive = editable; this.updateRichTextToolbar(); });
      editable.addEventListener('blur', () => setTimeout(() => {
        if (!this.richTextToolbar?.contains(document.activeElement)) this.richTextToolbar.hidden = true;
      }, 120));
    });
  },
  updateRichTextToolbar() {
    const toolbar = this.richTextToolbar, active = this.richTextActive;
    if (!toolbar) return;
    if (!active || !active.isConnected) { toolbar.hidden = true; return; }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !active.contains(selection.anchorNode) || !active.contains(selection.focusNode)) { toolbar.hidden = true; return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    const left = Math.max(8, Math.min(window.innerWidth - toolbar.offsetWidth - 8, rect.left + rect.width / 2 - toolbar.offsetWidth / 2));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(8, rect.top - toolbar.offsetHeight - 8)}px`;
  },
  applyRichTextCommand(command) {
    const active = this.richTextActive, selection = window.getSelection();
    if (!active || !selection || selection.isCollapsed || !active.contains(selection.anchorNode) || !active.contains(selection.focusNode)) return;
    if (command === 'bold' || command === 'italic') document.execCommand(command, false);
    else if (command === 'large') {
      const range = selection.getRangeAt(0);
      let wrapper = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer.closest?.('span[data-font-size="14"]')
        : range.commonAncestorContainer.parentElement?.closest('span[data-font-size="14"]');
      if (wrapper && active.contains(wrapper) && wrapper.contains(range.startContainer) && wrapper.contains(range.endContainer)) {
        wrapper.replaceWith(...wrapper.childNodes);
      } else {
        const span = document.createElement('span'); span.dataset.fontSize = '14';
        span.appendChild(range.extractContents()); range.insertNode(span);
        selection.removeAllRanges(); const selected = document.createRange(); selected.selectNodeContents(span); selection.addRange(selected);
      }
    }
    active.dispatchEvent(new Event('input', { bubbles:true }));
    this.updateRichTextToolbar();
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
          if (q.type !== 'discursiva' && !card.dataset.standardQuestionOrganized) summary.textContent = code ? `Código BNCC · ${code}` : 'Código BNCC (opcional)';
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
  organizeDiscursive(card, q, index) {
    if (q.type !== 'discursiva' || card.dataset.discursiveOrganized) return;
    card.dataset.discursiveOrganized = 'true';
    card.classList.add('discursive-editor');
    const body = card.querySelector(':scope > .row');
    const statement = card.querySelector('.question-essentials');
    const format = card.querySelector('[data-k="answerStyle"]');
    const controls = format.parentElement.parentElement;
    const answerToggle = card.querySelector('[data-presentation="answer-space"]').closest('label');
    const criteria = card.querySelector('[data-k="expectedAnswer"]');
    const settings = card.querySelector('.question-settings');
    const footer = card.querySelector('.question-footer');
    const icon = name => this.questionIcon(name);
    const blockHeading = (heading, name, description) => this.questionBlockHeading(heading, name, description);
    const makeSection = (name, className) => {
      const section = document.createElement('section'); section.className = `discursive-section ${className}`;
      const heading = document.createElement('h3'); heading.textContent = name;
      heading.id = `discursive-${className}-${index}`; section.setAttribute('aria-labelledby', heading.id);
      section.appendChild(heading); return section;
    };
    const content = makeSection('Enunciado', 'discursive-content');
    const contentHeading = content.querySelector('h3');
    content.appendChild(blockHeading(contentHeading, 'document', 'Texto que será exibido ao aluno na prova.'));
    const text = statement.querySelector('textarea');
    const label = statement.querySelector('label');
    label.classList.add('sr-only');
    content.appendChild(statement);
    const trigger = content.querySelector('.image-use-wrap > button');
    if (trigger) {
      trigger.classList.add('discursive-image-button');
      trigger.classList.remove('primary'); trigger.classList.add('outline');
      const panel = content.querySelector('.image-edit-panel');
      if (panel) {
        const expanded = this.hasStatementImage(q);
        panel.classList.toggle('hidden', !expanded);
        trigger.setAttribute('aria-expanded', String(expanded));
      }
    }
    const answer = makeSection('Resposta do aluno', 'discursive-response');
    const answerHeader = document.createElement('div'); answerHeader.className = 'discursive-response-heading';
    answer.appendChild(answerHeader);
    answerHeader.append(blockHeading(answer.querySelector('h3'), 'settings', 'Defina o espaço para o aluno responder na prova.'), answerToggle);
    const answerCheck = answerToggle.querySelector('input');
    answerToggle.classList.add('discursive-space-switch');
    answerCheck.setAttribute('aria-label', 'Mostrar espaço para o aluno responder');
    const switchTrack = document.createElement('span'); switchTrack.className = 'discursive-switch-track'; switchTrack.setAttribute('aria-hidden','true');
    const switchCopy = document.createElement('span'); switchCopy.className = 'discursive-switch-copy';
    const switchTitle = document.createElement('strong'); switchTitle.textContent = 'Reservar espaço';
    const switchHint = document.createElement('span'); switchHint.textContent = 'Deixa um espaço para o aluno responder na prova.';
    switchCopy.append(switchTitle, switchHint); answerToggle.replaceChildren(answerCheck, switchTrack, switchCopy);
    controls.classList.add('discursive-response-controls');
    answer.appendChild(controls);
    const hint = card.querySelector('.answer-space-hint'); controls.appendChild(hint);
    hint.id = `discursive-space-hint-${index}`;
    controls.querySelector('[data-k="lines"]').setAttribute('aria-describedby', hint.id);
    const responseState = document.createElement('p'); responseState.className = 'discursive-response-state';
    answer.appendChild(responseState);
    const check = document.createElement('button'); check.type = 'button'; check.className = 'discursive-check-preview';
    check.textContent = 'Conferir na prova →';
    check.addEventListener('click', () => {
      if (window.innerWidth <= 1150) this.previewQuestion(index);
      else { this.pendingPreviewFocus = index; this.updatePreview(); }
    });
    const correction = makeSection('Resposta esperada', 'discursive-correction');
    const correctionTitle = correction.querySelector('h3');
    const privateNote = document.createElement('span'); privateNote.className = 'discursive-private-badge';
    privateNote.append(icon('lock'), document.createTextNode('Só no gabarito')); correctionTitle.appendChild(privateNote);
    correction.appendChild(blockHeading(correctionTitle, 'bulb', 'Não aparece na prova do aluno. Serve como referência para a correção.'));
    const criteriaBlock = criteria.parentElement;
    criteriaBlock.querySelector('label').classList.add('sr-only');
    criteriaBlock.querySelector('label').textContent = 'Resposta esperada ou critérios de correção (opcional)';
    criteria.placeholder = 'Descreva a resposta esperada ou os critérios de correção (opcional).';
    correction.appendChild(criteriaBlock);
    const number = card.querySelector('.question-number-toggle');
    number.replaceChildren(number.querySelector('input'), document.createTextNode('Exibir numeração na prova'));
    settings.prepend(number); settings.prepend(settings.querySelector('summary'));
    settings.classList.add('discursive-settings');
    const settingsSummary = settings.querySelector('summary'); settingsSummary.replaceChildren();
    const settingsTitle = document.createElement('strong'); settingsTitle.className = 'discursive-settings-title';
    settingsSummary.appendChild(blockHeading(settingsTitle, 'sliders', 'Opções complementares de configuração da questão.'));
    const updateSettings = () => {
      const code = settings.querySelector('[data-k="bncc"]').value.trim();
      settingsTitle.textContent = `Ajustes complementares${code ? ` · BNCC ${code}` : ''}`;
    };
    settings.querySelector('[data-k="bncc"]').addEventListener('input', updateSettings); updateSettings();
    const printedNumber = document.createElement('span'); printedNumber.className = 'discursive-print-number';
    card.querySelector('.qhead-left-copy').appendChild(printedNumber);
    const close = card.querySelector('.qnum'); close.textContent = '×'; close.classList.add('discursive-close');
    card.querySelector('.question-head-actions').appendChild(close);
    const remove = card.querySelector('.question-remove-icon');
    if (remove && footer) { remove.classList.remove('question-remove-icon'); remove.textContent = 'Excluir questão'; footer.appendChild(remove); }
    const bank = footer?.querySelector('[title="Salvar no banco de questões"]');
    if (bank) { bank.textContent = ''; bank.append(icon('database'), document.createTextNode('Guardar no banco de questões')); }
    if (footer) footer.insertBefore(check, remove || null);
    body.querySelectorAll(':scope > .prop-sec').forEach(node => node.remove());
    body.prepend(content); content.after(answer); answer.after(correction); correction.after(settings);
    for (const input of [text, criteria]) {
      input.addEventListener('input', () => this.fitDiscursiveText(input));
      this.fitDiscursiveText(input);
      window.requestAnimationFrame?.(() => { if (input.isConnected) this.fitDiscursiveText(input); });
    }
    this.syncDiscursive(card, q, index);
  },
  questionIcon(name) {
      const paths = {
        document:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 12h8M8 16h6"/>',
        settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
        bulb:'<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4z"/>',
        sliders:'<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
        lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
        database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
      };
      const node = document.createElement('span'); node.className = `discursive-icon discursive-icon-${name}`;
      node.setAttribute('aria-hidden','true');
      node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
      return node;
  },
  questionBlockHeading(heading, name, description) {
      const wrapper = document.createElement('div'); wrapper.className = 'discursive-block-heading';
      const copy = document.createElement('div'); copy.className = 'discursive-block-copy';
      const hint = document.createElement('p'); hint.textContent = description;
      copy.append(heading, hint); wrapper.append(this.questionIcon(name), copy); return wrapper;
  },
  questionItemField(input, title) {
    const label = document.createElement('label'); label.className = 'standard-item-field';
    const caption = document.createElement('span'); caption.textContent = title;
    label.append(caption,input); return label;
  },
  organizeStandardQuestion(card, q, index) {
    if (!q || q.type === 'discursiva' || card.dataset.standardQuestionOrganized) return;
    const body = card.querySelector(':scope > .row');
    const essentials = card.querySelector('.question-essentials');
    if (!body || !essentials) return;
    card.dataset.standardQuestionOrganized = 'true';
    card.classList.add('standard-question-editor');
    const profiles = {
      multipla:['Alternativas','Marque a resposta correta junto da alternativa.'],
      marcarx: q.markMode === 'vf' ? ['Afirmações','Defina V ou F em cada afirmação para o gabarito.']
        : q.markMode === 'checklist' ? ['Itens para marcar','O aluno marca os itens; esta lista não tem gabarito.']
        : ['Alternativas',q.markMode === 'multipla' ? 'Marque todas as respostas corretas junto das alternativas.' : 'Marque a resposta correta junto da alternativa.'],
      vf:['Afirmações','Defina V ou F em cada afirmação para o gabarito.'],
      lacunas:['Frases com lacunas','Escreva a frase com ___ e informe a resposta no campo verde de cada item.'],
      relacione:['Pares correspondentes','Preencha os pares corretos. A coluna direita pode ser embaralhada para a prova.'],
      associacao_setas:['Pares correspondentes','Cadastre os pares corretos; a coluna direita será embaralhada na prova.'],
      relacione_imagens:['Imagens e palavras','Escolha uma imagem e escreva a palavra que a identifica. Confira a atividade montada na prévia.'],
      imagem:['Resposta do aluno','Escolha a forma de resposta para a imagem.'],
      interpretacao_imagem:['Perguntas sobre a imagem','Cadastre as perguntas e configure o espaço de resposta.'],
      texto_base:['Resposta do aluno','Escolha como o aluno responderá à leitura.'],
      subitens:['Subitens','Escreva os comandos e configure o espaço de resposta de cada item.'],
      matematica_coluna:['Operações','Os resultados são calculados automaticamente e aparecem apenas no gabarito.'],
      expressao_matematica:['Expressões matemáticas','Digite como no papel: 1/2, (3^3)/5 ou √(49/81). Use os botões para inserir símbolos.'],
      ditado:['Resposta do aluno','Defina a quantidade de espaços para as palavras ditadas.'],
      ordenacao:['Frases ou etapas','O número junto de cada frase define sua ordem correta.'],
      problema_matematico:['Resposta e cálculo','Configure os espaços de escrita e de rascunho.'],
      espaco_livre:['Espaço do aluno','Defina a área para escrita ou desenho.'],
      tabela:['Resposta do aluno','Defina como o aluno responderá à tabela.'],
      sequencia_numerica:['Sequências numéricas','Use ___ nas lacunas e informe as respostas junto de cada sequência.'],
      leitura_escrita:['Palavras e frases','Cadastre o conteúdo para leitura e cópia.'],
      silabas:['Palavras e sílabas','Escolha o exercício e preencha a resposta junto de cada palavra.'],
      sequencia_imagens:['Sequência de imagens','O número junto de cada imagem define sua ordem correta.'],
      comparar_imagens:['Resposta do aluno','Configure o espaço para comparar as duas imagens.'],
      legenda_imagens:['Imagens para nomear','A resposta de cada imagem fica no campo verde do gabarito.'],
      associacao_imagem_imagem:['Pares de imagens','Mantenha as duas imagens de cada par lado a lado.'],
      grade_imagens:['Grade de imagens','Cada figura reúne sua legenda e sua resposta esperada.'],
      identificar_imagem:['Partes numeradas','Informe o nome de cada parte. Abra o ícone de imagem no enunciado para posicionar os números.'],
      caca_palavras:['Montagem do caça-palavras','Defina as palavras e confira a grade na prévia.'],
      cruzadinha:['Pistas e respostas','Cada pista permanece junto da resposta que define seus quadrinhos.'],
    };
    const profile = profiles[q.type] || ['Atividade','Configure o conteúdo e a resposta da atividade.'];
    const section = (name, tone, description, key) => {
      const node = document.createElement('section');
      node.className = `discursive-section standard-${key} discursive-${tone}`;
      const heading = document.createElement('h3'); heading.textContent = name;
      heading.id = `question-${index}-${key}`; node.setAttribute('aria-labelledby', heading.id);
      node.appendChild(this.questionBlockHeading(heading, tone === 'content' ? 'document' : tone === 'correction' ? 'bulb' : 'settings', description));
      return node;
    };
    const content = section('Enunciado','content','Texto que será exibido ao aluno na prova.','content');
    essentials.querySelector('label')?.classList.add('sr-only');
    content.appendChild(essentials);
    const activity = section(profile[0],'response',profile[1],'activity');
    const activityBody = document.createElement('div'); activityBody.className = 'standard-activity-body';
    activity.appendChild(activityBody);
    const settings = card.querySelector('.question-settings');
    const footer = card.querySelector('.question-footer');
    const criteria = card.querySelector('[data-k="expectedAnswer"]')?.parentElement;
    const answerLabel = card.querySelector('[data-presentation="answer-space"]')?.closest('label');
    const hints = card.querySelector('.answer-space-hint');
    const original = [...body.children].filter(node => node !== settings && node !== footer && node !== criteria && node !== answerLabel && node !== hints);
    original.forEach(node => {
      if (node.matches('.prop-sec')) node.remove();
      else activityBody.appendChild(node);
    });
    body.prepend(content); content.after(activity);
    // These types combine support material and answer controls in one legacy
    // wrapper. Move whole control groups, preserving their handlers and lists.
    const fieldGroup = key => card.querySelector(`[data-k="${key}"]`)?.parentElement;
    let support = null;
    const moveSupport = (node, name) => {
      if (!node) return;
      if (name) {
        if (!support) support = section(name,'content','Conteúdo de apoio que acompanha a questão.','support');
        support.appendChild(node);
      } else content.appendChild(node);
    };
    if (q.type === 'texto_base') moveSupport(fieldGroup('textBase'),'Texto-base');
    if (['imagem','interpretacao_imagem','comparar_imagens','identificar_imagem'].includes(q.type)) {
      const root = activityBody.querySelector(':scope > .row');
      if (root) {
        if (q.type === 'imagem') {
          const mode = fieldGroup('imageAnswerType');
          const lines = fieldGroup('lines')?.parentElement;
          const choices = root.querySelector('.option-row')?.parentElement;
          if (mode) activityBody.appendChild(mode);
          if (lines) activityBody.appendChild(lines);
          if (choices) activityBody.appendChild(choices);
          if (lines) lines.classList.add('standard-answer-options');
        } else if (q.type === 'interpretacao_imagem') {
          const prompts = [...root.children].find(node => node.querySelector('input[placeholder="Pergunta 1"]'));
          if (prompts) activityBody.appendChild(prompts);
          const options = fieldGroup('lines')?.parentElement;
          if (options) { options.classList.add('standard-answer-options'); activityBody.appendChild(options); }
        } else if (q.type === 'comparar_imagens') {
          const options = fieldGroup('lines')?.parentElement;
          if (options) { options.classList.add('standard-answer-options'); activityBody.appendChild(options); }
        } else {
          const markers = root.querySelector('[data-marker-row]')?.parentElement;
          if (markers) activityBody.appendChild(markers);
          const list = fieldGroup('showAnswerList'); if (list) activityBody.appendChild(list);
        }
        this.embedSupportImages(card, root, q, index);
      }
    }
    if (q.type === 'tabela') {
      const table = activityBody.firstElementChild;
      const options = fieldGroup('answerType')?.parentElement;
      const choices = table?.querySelector('input[type="radio"]')?.closest('.row');
      if (options) activityBody.prepend(options);
      if (choices) activityBody.appendChild(choices);
      moveSupport(table,'Tabela da atividade');
    }
    const batch = card.querySelector('.question-image-batch');
    if (batch) activityBody.prepend(batch);
    let correction = null;
    if (criteria || q.type === 'ditado') {
      correction = section(q.type === 'ditado' ? 'Palavras do ditado' : 'Resposta esperada','correction',
        'Uso do professor: este conteúdo aparece somente no gabarito.','correction');
      const badge = document.createElement('span'); badge.className = 'discursive-private-badge';
      badge.append(this.questionIcon('lock'),document.createTextNode('Só no gabarito'));
      correction.querySelector('h3').appendChild(badge);
      if (criteria) {
        criteria.querySelector('label')?.classList.add('sr-only');
        correction.appendChild(criteria);
      }
      if (q.type === 'ditado') {
        const words = fieldGroup('wordList');
        words.querySelector('label').classList.add('sr-only'); correction.appendChild(words);
        const count = fieldGroup('wordCount');
        activityBody.replaceChildren(count);
      }
    }
    // Formatting stays available under a single supplementary disclosure.
    // Essential response modes and item answers remain alongside the activity.
    const number = card.querySelector('.question-number-toggle');
    if (settings) {
      settings.classList.add('standard-settings','discursive-settings');
      const summary = settings.querySelector('summary'); summary.replaceChildren();
      const title = document.createElement('strong'); title.className = 'discursive-settings-title';
      summary.appendChild(this.questionBlockHeading(title,'sliders','Numeração, BNCC e apresentação na prova.'));
      if (number) {
        number.replaceChildren(number.querySelector('input'), document.createTextNode('Exibir numeração na prova'));
        summary.after(number);
      }
      const update = () => { const code = settings.querySelector('[data-k="bncc"]').value.trim(); title.textContent = `Ajustes complementares${code ? ` · BNCC ${code}` : ''}`; };
      settings.querySelector('[data-k="bncc"]').addEventListener('input',update); update();
      activityBody.querySelectorAll(':scope > .appearance-settings').forEach(node => settings.appendChild(node));
      if (q.type === 'subitens') { const config = fieldGroup('labelStyle'); if (config) settings.appendChild(config); }
      if (q.type === 'leitura_escrita') { const columns = fieldGroup('columns'); if (columns) settings.appendChild(columns); }
      if (q.type === 'grade_imagens') { const columns = fieldGroup('columns'); if (columns) settings.appendChild(columns); }
    }
    if (answerLabel) {
      answerLabel.classList.add('discursive-space-switch');
      const check = answerLabel.querySelector('input');
      const track = document.createElement('span'); track.className = 'discursive-switch-track'; track.setAttribute('aria-hidden','true');
      const copy = document.createElement('span'); copy.className = 'discursive-switch-copy';
      const label = document.createElement('strong'); label.textContent = 'Reservar espaço'; copy.appendChild(label);
      answerLabel.replaceChildren(check,track,copy);
      activity.querySelector('.discursive-block-heading').appendChild(answerLabel);
      const message = document.createElement('p'); message.className = 'standard-response-state discursive-response-state';
      message.textContent = 'A questão será impressa sem espaço para escrever ou desenhar.';
      activityBody.appendChild(message);
    }
    if (hints) activityBody.appendChild(hints);
    activityBody.querySelectorAll(':scope > .row > label:first-child').forEach(label => {
      if (!label.querySelector('input,textarea,select')) label.classList.add('sr-only');
    });
    if (['vf','marcarx','multipla','lacunas','relacione','relacione_imagens','ordenacao','sequencia_imagens','legenda_imagens','cruzadinha'].includes(q.type)) {
      activityBody.querySelectorAll(':scope > .row > .small').forEach(hint => hint.remove());
    }
    activityBody.querySelectorAll('.math-editor-heading, .expression-editor-heading').forEach(heading => heading.remove());
    if (q.type === 'caca_palavras') {
      const words = fieldGroup('wordsText');
      words.classList.add('standard-full-width'); words.parentElement.prepend(words);
    }
    const title = card.querySelector('.qhead-left-name'); title.textContent = this.printedQuestionLabel(index);
    const caption = document.createElement('span'); caption.className = 'discursive-print-number';
    card.querySelector('.qhead-left-copy').appendChild(caption);
    const close = card.querySelector('.qnum'); close.textContent = '×'; close.classList.add('discursive-close');
    card.querySelector('.question-head-actions').appendChild(close);
    if (footer) {
      const remove = card.querySelector('.question-remove-icon');
      if (remove) { remove.classList.remove('question-remove-icon'); remove.textContent = 'Excluir questão'; footer.appendChild(remove); }
      const bank = footer.querySelector('[title="Salvar no banco de questões"]');
      if (bank) { bank.replaceChildren(this.questionIcon('database'),document.createTextNode('Guardar no banco de questões')); }
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'discursive-check-preview';
      preview.textContent = 'Conferir na prova →';
      preview.addEventListener('click',() => {
        if (window.innerWidth <= 1150) this.previewQuestion(index);
        else { this.pendingPreviewFocus = index; this.updatePreview(); }
      });
      footer.insertBefore(preview,remove || null);
    }
    body.prepend(content);
    content.after(activity); if (support) content.after(support);
    if (correction) activity.after(correction);
    if (settings) body.appendChild(settings); if (footer) body.appendChild(footer);
    this.syncStandardQuestion(card,q,index);
  },
  syncStandardQuestion(card, q, index) {
    if (!card.classList.contains('standard-question-editor')) return;
    card.querySelector('.enunciation-image-field .field-image-trigger')?.classList.toggle('has-image',
      Boolean(q.imageDataUrl || q.image1DataUrl || q.image2DataUrl || q.freeImages?.length
        || q.headerImage?.dataUrl || q.headerImage?.items?.some(item => item.dataUrl)));
    card.querySelector('.qhead-left-name').textContent = this.printedQuestionLabel(index);
    card.querySelector('.discursive-print-number').textContent = `${typeLabel[q.type] || q.type}${this.bankId ? '' : ` · item ${index + 1} da lista`}`;
    card.querySelector('.qnum').setAttribute('aria-label',`Fechar edição: ${this.printedQuestionLabel(index)}`);
    const openAnswer = q.type !== 'imagem' || !q.imageAnswerType || q.imageAnswerType === 'discursiva';
    const toggle = card.querySelector('[data-presentation="answer-space"]')?.closest('label');
    if (toggle) toggle.hidden = !openAnswer;
    card.querySelectorAll('.standard-answer-options, .answer-space-hint').forEach(node => {
      node.hidden = !openAnswer || q.showAnswerSpace === false;
    });
    const message = card.querySelector('.standard-response-state');
    if (message) message.hidden = !openAnswer || q.showAnswerSpace !== false;
    const hint = card.querySelector('.answer-space-hint');
    if (hint) hint.textContent = (q.answerStyle === 'linhas' ? 'De 1 a 40 linhas.' : 'De 1 a 40 linhas equivalentes de altura.')
      + (q.type === 'interpretacao_imagem' ? ' O espaço vale para cada pergunta.' : '');
    // Hide only response-space fields, never content or the response-mode selector.
    card.querySelectorAll('.standard-activity [data-k="lines"], .standard-activity [data-k="calcLines"], .standard-activity [data-k="answerStyle"], .standard-activity [data-k="height"], .standard-activity [data-k="borderStyle"]').forEach(input => {
      input.parentElement.hidden = !openAnswer || Boolean(toggle && q.showAnswerSpace === false)
        || (q.type === 'tabela' && q.answerType !== 'discursiva');
    });
  },
  organizeImagePanels(card) {
    // Preserve the original controls/listeners: this is presentation, not a new data format.
    card.querySelectorAll('.image-picker').forEach(picker => {
      const layout = picker.nextElementSibling;
      if (!layout || !layout.querySelector('select option[value="small"]') || !layout.querySelector('label')) return;
      if (layout.classList.contains('image-layout-controls')) return;
      layout.classList.add('image-layout-controls');
      layout.querySelectorAll('label').forEach(label => {
        if (/^Tamanho(?: da imagem)?$/.test(label.textContent.trim())) label.textContent = 'Tamanho na prova';
        if (label.textContent.trim() === 'Legenda') label.textContent = 'Legenda na prova — opcional';
        if (label.textContent.trim() === 'Alinhamento') label.textContent = 'Posição';
      });
      picker.attachPresentationControls?.(layout);
    });
  },
  fitDiscursiveText(input) {
    if (!input?.getClientRects?.().length) return;
    input.style.height = 'auto';
    input.style.height = `${Math.max(input.dataset.k === 'text' ? 96 : 76, Math.min(320, input.scrollHeight + 2))}px`;
  },
  printedQuestionLabel(index) {
    const question = state.questions[index];
    if (!question) return '';
    if (this.bankId) return 'Questão do banco';
    return question.hideNumber ? 'Bloco sem número' : `Questão ${state.questions.slice(0, index + 1).filter(item => !item.hideNumber).length}`;
  },
  syncDiscursive(card, q, index) {
    if (!card.classList.contains('discursive-editor')) return;
    const controls = card.querySelector('.discursive-response-controls');
    controls.hidden = q.showAnswerSpace === false;
    const responseState = card.querySelector('.discursive-response-state');
    responseState.hidden = q.showAnswerSpace !== false;
    responseState.textContent = 'A questão será impressa sem espaço para escrever a resposta.';
    const lines = card.querySelector('[data-k="lines"]');
    const label = lines.parentElement.querySelector('label');
    label.textContent = q.answerStyle === 'linhas' ? 'Número de linhas' : 'Altura (em linhas)';
    label.title = 'De 1 a 40 linhas. Em caixas e espaços em branco, o número define a altura equivalente.';
    card.querySelector('[data-k="answerStyle"]').parentElement.querySelector('label').textContent = 'Formato da resposta';
    card.querySelector('.discursive-title-option label').lastChild.textContent = ' Com título';
    lines.setAttribute('aria-label', q.answerStyle === 'linhas' ? 'Quantidade de linhas' : 'Altura do espaço em linhas equivalentes');
    card.querySelector('.answer-space-hint').textContent = q.answerStyle === 'linhas'
      ? 'De 1 a 40 linhas.' : `Equivalente a ${q.lines} ${Number(q.lines) === 1 ? 'linha' : 'linhas'} de escrita. De 1 a 40.`;
    card.querySelector('.qhead-left-name').textContent = this.printedQuestionLabel(index);
    card.querySelector('.discursive-print-number').textContent = this.bankId ? 'Discursiva' : `Discursiva · item ${index + 1} da lista`;
    card.querySelector('.qnum').setAttribute('aria-label', `Fechar edição: ${this.printedQuestionLabel(index)}`);
    const trigger = card.querySelector('.enunciation-image-field > .image-use-wrap > button');
    if (trigger) {
      trigger.classList.add('discursive-image-button');
      const hasImage = Boolean(q.headerImage?.dataUrl || q.headerImage?.items?.some(item => item.dataUrl) || q.freeImages?.length);
      trigger.textContent = hasImage ? 'Imagem do enunciado' : 'Adicionar imagem';
      trigger.classList.toggle('has-image', hasImage);
    }
    card.querySelectorAll('.header-image-layout select option').forEach(option => {
      if (option.parentElement.dataset.imageDisposition) return;
      if (option.value === 'lado_esquerda') option.textContent = 'Imagem à esquerda do texto';
      if (option.value === 'lado_direita') option.textContent = 'Imagem à direita do texto';
    });
  },
  hasStatementImage(q) {
    return Boolean(q.imageDataUrl || q.image1DataUrl || q.image2DataUrl
      || q.headerImage?.dataUrl || q.headerImage?.items?.some(item => item.dataUrl)
      || q.freeImages?.some(item => item.dataUrl) || q.extraImages?.some(item => item.dataUrl));
  },
  embedFieldImages(card, q) {
    if (card.dataset.fieldImagesEmbedded) return;
    card.dataset.fieldImagesEmbedded = 'true';
    const text = card.querySelector('textarea[data-k="text"]');
    let toolbar = card.querySelector('.image-use-wrap');
    let panel = card.querySelector('.image-edit-panel');
    // Batch uploads populate activity items, not the statement image.
    const batch = card.querySelector('[data-batch-images]')?.closest('.row');
    if (batch) {
      const details = document.createElement('details'); details.className = 'question-image-batch';
      const summary = document.createElement('summary'); summary.textContent = 'Adicionar várias imagens aos itens';
      batch.before(details); details.append(summary, batch);
      card.querySelector(':scope > .row').appendChild(details);
    }
    if (text && !toolbar && q.freeImages?.length) {
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
      const expanded = this.hasStatementImage(q);
      panel.classList.toggle('hidden', !expanded);
      trigger.setAttribute('aria-expanded', String(expanded));
      const images = card.querySelector('.question-images');
      if (images) {
        const oldDetails = images.closest('.question-images-details');
        images.querySelector('h3')?.remove();
        images.querySelector(':scope > p')?.remove();
        images.classList.add('enunciation-extra-images');
        shell.appendChild(images); oldDetails?.remove();
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
  embedSupportImages(card, root, q, index) {
    // Reuse the native image controls and callbacks; never create headerImage
    // for types whose renderer consumes imageDataUrl / images instead.
    const text = card.querySelector('textarea[data-k="text"]');
    text.setAttribute('aria-label','Enunciado');
    let shell = text.closest('.enunciation-image-field');
    if (!shell) {
      shell = document.createElement('div'); shell.className = 'field-image-shell enunciation-image-field';
      text.before(shell); shell.appendChild(text);
      const toolbar = document.createElement('div'); toolbar.className = 'image-use-wrap';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'field-image-trigger';
      button.title = 'Adicionar ou editar imagem do enunciado';
      button.setAttribute('aria-label', button.title);
      button.textContent = button.title;
      const panel = document.createElement('div'); panel.className = 'image-edit-panel hidden';
      panel.id = `enunciation-image-${index}`;
      button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded','false');
      button.addEventListener('click', () => {
        if (!this.canEdit()) return;
        panel.classList.toggle('hidden');
        button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
      });
      toolbar.appendChild(button); shell.append(toolbar, panel);
    }
    const panel = shell.querySelector(':scope > .image-edit-panel');
    const expanded = this.hasStatementImage(q);
    panel.classList.toggle('hidden', !expanded);
    const button = shell.querySelector('.field-image-trigger');
    button.setAttribute('aria-expanded',String(expanded));
    button.classList.toggle('has-image', Boolean(q.imageDataUrl || q.freeImages?.length
      || q.image1DataUrl || q.image2DataUrl));
    panel.prepend(root);
    const extras = root.querySelector('.native-extra-images');
    if (extras) {
      const details = document.createElement('details'); details.className = 'native-extra-images-details';
      details.open = Boolean(q.extraImages?.some(item => item.dataUrl));
      const summary = document.createElement('summary'); summary.textContent = 'Imagens adicionais (até 2 extras)';
      extras.before(details); details.append(summary,extras);
    }
  },
  addMathStatementTools(card, q) {
    if (q.type !== 'problema_matematico' || card.dataset.mathStatementTools) return;
    const input = card.querySelector('textarea[data-k="text"]');
    if (!input) return;
    card.dataset.mathStatementTools = 'true';
    const tools = document.createElement('div');
    tools.className = 'math-statement-tools';
    tools.setAttribute('aria-label', 'Inserir matemática no enunciado');
    const options = [
      { label: 'Fração', sample: '1/2', start: 0, end: 1, selected: value => `${value}/2` },
      { label: 'Potência', sample: '3^2', start: 2, end: 3, selected: value => `${value}^2` },
      { label: 'Raiz', sample: '√()', start: 2, end: 2, selected: value => `√(${value})` },
      { label: '×', sample: ' × ' },
      { label: '÷', sample: ' ÷ ' },
    ];
    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'outline'; button.textContent = option.label;
      button.title = `Inserir ${option.label.toLowerCase()} no enunciado`;
      button.disabled = !this.canEdit();
      button.addEventListener('click', () => {
        if (!this.canEdit()) return;
        const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
        const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
        const selected = input.value.slice(start, end);
        const insertion = selected && option.selected ? option.selected(selected) : option.sample;
        input.value = input.value.slice(0, start) + insertion + input.value.slice(end);
        const selectionStart = selected ? start + insertion.length : start + (option.start ?? insertion.length);
        const selectionEnd = selected ? selectionStart : start + (option.end ?? option.start ?? insertion.length);
        input.focus();
        if (input.setSelectionRange) input.setSelectionRange(selectionStart, selectionEnd);
        else { input.selectionStart = selectionStart; input.selectionEnd = selectionEnd; }
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      tools.appendChild(button);
    });
    const hint = document.createElement('span');
    hint.textContent = 'Escreva normalmente: 1/2, 3^2 ou √(25).';
    tools.appendChild(hint);
    input.after(tools);
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
      if (q.type === 'multipla') {
        const badge = document.createElement('span'); badge.className = 'alternative-badge'; badge.textContent = letter;
        badge.setAttribute('aria-hidden','true'); row.prepend(badge); row.classList.add('legacy-alternative-row');
      }
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
    if (addOption) {
      addOption.classList.add('alternative-add');
      let actionRow = addOption.closest('.question-action-row');
      if (!actionRow) {
        actionRow = document.createElement('div');
        actionRow.className = 'question-action-row';
        addOption.before(actionRow);
        actionRow.appendChild(addOption);
      }
      actionRow.classList.add('alternative-actions');
      if (q.showAnswerSpace === true) {
        const control = document.createElement('div');
        control.className = 'alternative-space-control';
        const label = document.createElement('label');
        label.textContent = 'Linhas';
        const input = document.createElement('input');
        input.type = 'number'; input.min = '1'; input.max = '40'; input.inputMode = 'numeric';
        input.value = ExamSafety.answerLineCount(q.answerLines, 3);
        input.setAttribute('aria-label', 'Quantidade de linhas do espa\u00e7o de resposta');
        input.disabled = !this.canEdit();
        input.addEventListener('input', () => {
          if (!this.canEdit()) return;
          q.answerLines = ExamSafety.answerLineCount(input.value, 3);
          renderPreview();
        });
        input.addEventListener('change', () => {
          input.value = ExamSafety.answerLineCount(input.value, 3);
        });
        const removeSpace = document.createElement('button');
        removeSpace.type = 'button'; removeSpace.className = 'alternative-space-remove';
        removeSpace.textContent = '\u00d7'; removeSpace.title = 'Remover espa\u00e7o de resposta';
        removeSpace.setAttribute('aria-label', removeSpace.title);
        removeSpace.disabled = !this.canEdit();
        removeSpace.addEventListener('click', () => {
          if (!this.canEdit()) return;
          q.showAnswerSpace = false;
          renderAll();
        });
        label.appendChild(input); control.append(label, removeSpace); actionRow.appendChild(control);
      } else {
        const addSpace = document.createElement('button');
        addSpace.type = 'button'; addSpace.className = 'outline alternative-space-add';
        addSpace.textContent = 'Adicionar espa\u00e7o';
        addSpace.disabled = !this.canEdit();
        addSpace.addEventListener('click', () => {
          if (!this.canEdit()) return;
          q.showAnswerSpace = true;
          q.answerLines = ExamSafety.answerLineCount(q.answerLines, 3);
          renderAll();
        });
        actionRow.appendChild(addSpace);
      }
    }
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
      document.getElementById('readinessDetails').classList.toggle('readiness-clear', issues.length === 0 && !this.spaceSuggestion);
    }
    const nav = document.getElementById('questionOutline');
    if (nav && !this.outlineDrag) {
      const overviewSummary = document.querySelector('#questionOverview > summary');
      if (overviewSummary) overviewSummary.textContent = `Questões da prova (${state.questions.length})`;
      const outlineScroll = nav.scrollTop;
      nav.replaceChildren();
      state.questions.forEach((q, index) => {
        const item = document.createElement('div'); item.className = 'question-outline-item'; item.dataset.questionIndex = String(index);
        const canManage = !this.bankId;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'question-outline-open';
        const number = document.createElement('span'); number.className = 'question-outline-number'; number.textContent = String(index + 1);
        const copy = document.createElement('span'); copy.className = 'question-outline-copy';
        const caption = document.createElement('span'); caption.className = 'question-outline-caption';
        caption.textContent = this.plainRichText(q.text || '').trim() || 'Sem enunciado';
        const type = document.createElement('span'); type.className = 'question-outline-type'; type.textContent = typeLabel[q.type] || q.type;
        copy.append(caption,type); button.append(number,copy);
        button.setAttribute('aria-label',`Questão ${index + 1}: ${caption.textContent}`);
        if (index === state.activeQuestionIndex) button.setAttribute('aria-current','true');
        button.dataset.questionType = typeLabel[q.type] || q.type;
        button.title = `${index + 1}. ${this.plainRichText(q.text || '')}`;
        button.addEventListener('click', () => this.focusQuestion(index));
        item.addEventListener('click', next => {
          if (this.outlineDrag?.started || Date.now() < (this.outlineSuppressClickUntil || 0)) { next.preventDefault(); next.stopImmediatePropagation(); }
        },true);
        item.appendChild(button);
        if (canManage) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'question-outline-remove';
          remove.textContent = '×'; remove.title = `Excluir questão ${index + 1}`; remove.setAttribute('aria-label', `Excluir questão ${index + 1}`);
          remove.disabled = !this.canEdit(); remove.addEventListener('click', () => this.removeQuestion(index)); item.appendChild(remove);
        }
        item.addEventListener('pointerdown', next => { if (next.pointerType !== 'touch') this.startOutlineDrag(next,item,nav); });
        item.addEventListener('touchstart', next => this.startOutlineDrag(next,item,nav),{passive:true});
        item.addEventListener('contextmenu', next => { if (this.outlineDrag?.started) next.preventDefault(); });
        item.addEventListener('dragstart', next => next.preventDefault());
        button.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
        button.addEventListener('keydown', next => {
          if (!next.altKey || !['ArrowUp','ArrowDown'].includes(next.key) || !this.canEdit() || this.bankId || this.outlineDrag) return;
          next.preventDefault();
          const destination = Math.max(0,Math.min(state.questions.length-1,index+(next.key === 'ArrowUp' ? -1 : 1)));
          this.moveQuestion(index,destination); this.updatePreview();
          nav.querySelector(`[data-question-index="${destination}"] .question-outline-open`)?.focus({preventScroll:true});
          const status = document.getElementById('questionOutlineStatus');
          if (status) status.textContent = `Questão na posição ${destination+1}.`;
        });
        nav.appendChild(item);
      });
      nav.scrollTop = outlineScroll;
    }
    this.filterQuestions();
    const empty = document.getElementById('editorSelectionHint');
    if (empty) empty.hidden = Number.isInteger(state.activeQuestionIndex) || Boolean(this.bankId);
    this.refreshPreviewNavigation();
    const frame = document.getElementById('canonicalPreview');
    if (frame && this.previewReady) {
      const revision = ++this.previewRevision;
      const fingerprint = this.questionFingerprint();
      this.previewFingerprint = fingerprint;
      this.invalidateSpaceSuggestion(true);
      if (!this.forceSnapshot && this.previewQuestionCount === state.questions.length && this.dirtyQuestions.size) {
        for (const index of this.dirtyQuestions) frame.contentWindow.postMessage({
          type:'exam-preview-patch', index, question:state.questions[index], revision, fingerprint,
        }, location.origin);
      } else frame.contentWindow.postMessage({ type: 'exam-preview', exam: {
        school: state.school, questions: state.questions, logoDataUrl: state.logoDataUrl,
        decorativeImages: state.decorativeImages,
      }, answerKey: Boolean(document.getElementById('previewAnswerKey')?.checked), revision, fingerprint }, location.origin);
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
      option.textContent = (index + 1) + '. ' + (this.plainRichText(q.text || '').trim() || 'Sem enunciado').slice(0,70);
      select.appendChild(option);
    });
    select.value = String(this.previewSelection); select.disabled = !count;
    const caption = document.getElementById('previewQuestionCaption');
    if (caption) caption.textContent = count ? this.printedQuestionLabel(this.previewSelection) : '';
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
      const imageStorage = globalThis.ExamImageStorage;
      imageStorage?.configure(auth, `bank-${this.bankId}`);
      const resolvedQuestion = imageStorage ? await imageStorage.resolveTree(row.question, { auth, scope: `bank-${this.bankId}` }) : row.question;
      state.questions = [ExamSafety.normalizeQuestion(resolvedQuestion)]; state.collapsedQuestions = {};
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
      setAutoSaveHint('Enviando imagens...');
      const imageStorage = globalThis.ExamImageStorage;
      const storedQuestion = imageStorage ? await imageStorage.persistTree(question, { auth, scope: `bank-${this.bankId}`,
        onProgress: (done, total) => total && setAutoSaveHint(`Enviando imagens ${done}/${total}`),
        onFallback: () => setAutoSaveHint('Storage indisponível; usando salvamento compatível') }) : question;
      const payload = { title: state.school.bankTitle || questionTitle(question), subject: state.school.subject || '',
        grade: state.school.bankGrade || '', skill: state.school.bankSkill || '', difficulty: state.school.bankDifficulty || 'media',
        question_type: question.type, question: storedQuestion, ...buildBankScopePayload(state.school.bankScope || 'private') };
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
    document.getElementById('questionSearch').oninput = () => { this.outlineDrag?.cancel(); this.filterQuestions(); };
    const outlineHint = document.createElement('p'); outlineHint.className = 'question-outline-hint';
    outlineHint.textContent = 'Arraste para mudar a ordem. No celular, segure antes de arrastar.';
    document.getElementById('questionSearch').after(outlineHint);
    const outlineStatus = document.createElement('span'); outlineStatus.id = 'questionOutlineStatus';
    outlineStatus.className = 'sr-only'; outlineStatus.setAttribute('role','status'); overview.appendChild(outlineStatus);
    overview.addEventListener('toggle', () => { if (!overview.open) this.outlineDrag?.cancel(); });
    const readiness = document.createElement('details'); readiness.id = 'readinessDetails';
    readiness.innerHTML = '<summary id="readinessSummary">Conferir prova</summary><p class="small">Esta conferência verifica preenchimento, pontuação, estrutura do gabarito e oportunidades de melhorar a diagramação. Revise também o conteúdo e as respostas antes de aplicar a prova.</p><div id="examIssues"></div><div id="layoutOptimization" class="layout-optimization" hidden><div><strong>Sugestão de diagramação</strong><span id="layoutOptimizationCopy"></span></div><button id="layoutOptimizationBtn" type="button">Sugerir otimização de espaço</button></div>';
    overview.after(readiness);
    document.getElementById('layoutOptimizationBtn').onclick = () => this.applySpaceSuggestion();
    const selectionHint = document.createElement('p'); selectionHint.id = 'editorSelectionHint'; selectionHint.textContent = 'Selecione uma questão em “Questões da prova” ou crie uma nova para começar.'; readiness.after(selectionHint);
    const contextControls = document.createElement('div'); contextControls.className = 'editor-context-controls';
    details.before(contextControls); contextControls.append(details, overview, readiness);
    const preview = document.createElement('section'); preview.id = 'canonicalPreviewPanel';
preview.innerHTML = '<div class="preview-toolbar"><div class="preview-options"><strong>Prévia da prova</strong><div class="preview-tools"><button type="button" id="decorationModeBtn" class="outline">Decorar prova</button><label class="preview-answer-key"><input class="sr-only" type="checkbox" id="previewAnswerKey" aria-label="Mostrar gabarito na prévia"><span>Ver respostas</span></label><select class="sr-only" id="previewZoom" aria-label="Zoom da prévia"><option value="fit" selected>Ajustar à largura</option></select></div></div><div id="decorationBar" class="decoration-bar" hidden><span id="decorationStatus">Arraste as imagens pela página.</span><button id="addDecorationBtn" type="button">+ Adicionar imagem</button><label>Página <select id="decorationPage" aria-label="Página da imagem decorativa"></select></label><button id="decorationRotateLeft" type="button" title="Girar para a esquerda">↶</button><button id="decorationRotateRight" type="button" title="Girar para a direita">↷</button><button id="decorationCrop" type="button">Recortar</button><button id="replaceDecorationBtn" type="button">Substituir</button><button id="removeDecorationBtn" type="button" class="danger">Remover</button><button id="finishDecorationBtn" type="button" class="primary">Concluir</button><input id="decorationFileInput" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div><div class="preview-navigation"><button id="previewPrevious" type="button" aria-label="Questão anterior na prévia" title="Questão anterior">‹</button><label class="sr-only" for="previewQuestionSelect">Ir à questão</label><select id="previewQuestionSelect" aria-label="Ir à questão na prévia"></select><button id="previewNext" type="button" aria-label="Próxima questão na prévia" title="Próxima questão">›</button></div></div><div class="preview-scroll"><div id="decorationEditorLayer" class="decoration-editor-layer" aria-label="Imagens decorativas da prova"></div><iframe id="canonicalPreview" src="print.html?preview=1&v=20261021-imageworkspace1" title="Prévia da prova em formato A4"></iframe></div>';
    const previewCaption = document.createElement('span'); previewCaption.id = 'previewQuestionCaption';
    preview.querySelector('.preview-options > strong').appendChild(previewCaption);
    document.getElementById('previewRoot').parentElement.appendChild(preview);
    document.getElementById('previewQuestionSelect').onchange = event => this.previewQuestion(Number(event.target.value));
    document.getElementById('previewPrevious').onclick = () => this.previewQuestion(this.previewSelection - 1);
    document.getElementById('previewNext').onclick = () => this.previewQuestion(this.previewSelection + 1);
    document.getElementById('previewAnswerKey').onchange = () => { this.forceSnapshot = true; this.updatePreview(); };
    document.getElementById('previewZoom').onchange = () => this.resizePreview();
    window.initDecorationEditor?.();
    if (typeof ResizeObserver !== 'undefined') {
      const workspaceObserver = new ResizeObserver(() => this.resizePreview());
      workspaceObserver.observe(preview); workspaceObserver.observe(editorColumn);
    }
    window.addEventListener('resize', () => {
      this.resizePreview();
      document.querySelectorAll('.discursive-editor textarea').forEach(input => this.fitDiscursiveText(input));
    });
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== document.getElementById('canonicalPreview').contentWindow) return;
      if (event.data?.type === 'exam-preview-ready') { this.previewReady = true; this.updatePreview(); return; }
      if (event.data?.type === 'exam-preview-space-suggestion') this.setSpaceSuggestion(event.data.suggestion, event.data);
      if (event.data?.type === 'exam-preview-paginated') window.refreshDecorationLayer?.(event.data.pages);
    });
    // Available creation types have a short example; retired types remain readable in saved exams.
    const select = document.getElementById('qtypeSelect'); select.replaceChildren();
    const groups = {};
    const category = type => ['multipla','vf','marcarx','relacione','associacao_setas'].includes(type) ? 'Alternativas e relações'
      : ['discursiva','texto_base','subitens','lacunas','ordenacao'].includes(type) ? 'Escrita e interpretação'
      : ['matematica_coluna','expressao_matematica','problema_matematico','sequencia_numerica','tabela'].includes(type) ? 'Matemática e dados'
      : ['ditado','silabas','leitura_escrita','caca_palavras','cruzadinha'].includes(type) ? 'Linguagem e alfabetização' : 'Imagens e desenho';
    for (const [type, label] of Object.entries(typeLabel)) {
      if (!templates[type] || ['multipla','associacao_setas','imagem','interpretacao_imagem'].includes(type)) continue;
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
    const availableHeight = document.body.dataset.editorView === 'edit' && window.innerWidth > 1150
      ? Math.max(260, viewport.clientHeight)
      : Math.max(260, viewport.clientHeight, window.innerHeight - viewport.getBoundingClientRect().top - 24);
    frame.style.height = `${availableHeight / zoom}px`;
    viewport.style.maxHeight = 'none';
    document.getElementById('viewEditBtn').setAttribute('aria-pressed', String(document.body.dataset.editorView === 'edit'));
    document.getElementById('viewPreviewBtn').setAttribute('aria-pressed', String(document.body.dataset.editorView === 'preview'));
    window.refreshDecorationLayer?.();
  },
  filterQuestions() {
    const query = (document.getElementById('questionSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
    let visible = 0;
    document.querySelectorAll('#questionOutline .question-outline-item').forEach(item => {
      const button = item.querySelector('.question-outline-open');
      item.hidden = !`${button?.textContent || ''} ${button?.dataset.questionType || ''}`.toLocaleLowerCase('pt-BR').includes(query);
      if (!item.hidden) visible++;
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
    header.innerHTML = '<div class="picker-title-block"><span>Adicionar conteúdo</span><h2>Escolha o tipo de questão</h2><p>Comece por um modelo e personalize o enunciado e as respostas.</p></div><button class="picker-close" type="button" data-picker-close aria-label="Fechar escolha de questão"><span aria-hidden="true">×</span></button>';
    const filters = document.createElement('div'); filters.className = 'picker-filters';
    filters.innerHTML = '<label class="picker-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Buscar tipo de questão" placeholder="Buscar um tipo de questão..."></label><select aria-label="Categoria de questão"><option value="">Todas as categorias</option></select>';
    const select = filters.querySelector('select');
    [...new Set(types.map(b => category(b.dataset.type)))].forEach(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); });
    const grid = document.createElement('div'); grid.className = 'picker-grid';
    const samples = { multipla:'◉ A   ○ B   ○ C', vf:'(V) Afirmação   (F) Afirmação', marcarx:'Uma resposta correta ou várias: ◉ A / ☑ A ☑ B', discursiva:'Resposta: __________________', matematica_coluna:'12 + 8 = ____', lacunas:'A planta precisa de ____.', espaco_livre:'▧ Espaço para desenhar', tabela:'Grupo | Quantidade', subitens:'a) Pergunta   b) Pergunta', problema_matematico:'3 sementes + 2 sementes. Quantas ao todo?', ordenacao:'2 → 1 → 3 • Ordene as etapas', relacione:'Olhos → Ver • Ouvidos → Ouvir', expressao_matematica:'(2 + 3) × 4 = ____' };
    const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
    const iconBodies = {
      choice:'<circle cx="5" cy="6" r="2"></circle><path d="m4.2 6 .6.7 1.2-1.5M10 6h9M3 12h4M10 12h9M3 18h4M10 18h9"></path>',
      trueFalse:'<rect x="3" y="4" width="7" height="7" rx="2"></rect><path d="m5 7.5 1.3 1.3L8.5 6M15 6l5 5M20 6l-5 5"></path><rect x="3" y="14" width="7" height="7" rx="2"></rect><path d="M14 17.5h7"></path>',
      write:'<path d="M4 20h4l10.8-10.8a2.1 2.1 0 0 0-3-3L5 17v3ZM13.8 8.2l3 3M4 12h5M4 7h7"></path>',
      draw:'<path d="m5 12 9-9 4 4-9 9-5 1 1-5ZM13 4l4 4M4 21c3-4 5 2 8-1s5-2 8 0"></path>',
      fill:'<path d="M4 6h16M4 12h5M15 12h5M4 18h16"></path><path d="M10 14h4" stroke-width="2.6"></path>',
      book:'<path d="M3 5.5A3.5 3.5 0 0 1 6.5 3H11v16H6.5A3.5 3.5 0 0 0 3 21V5.5ZM21 5.5A3.5 3.5 0 0 0 17.5 3H13v16h4.5A3.5 3.5 0 0 1 21 21V5.5Z"></path>',
      readWrite:'<path d="M3 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3V5ZM21 5h-7a2 2 0 0 0-2 2v5"></path><path d="m14 17 5-5 2 2-5 5-3 1 1-3Z"></path>',
      order:'<path d="M8 6h11M8 12h11M8 18h11M4 4v4M2.5 6 4 4.5 5.5 6M4 20v-4M2.5 18 4 19.5 5.5 18"></path>',
      list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"></path>',
      relation:'<circle cx="5" cy="7" r="2"></circle><circle cx="19" cy="17" r="2"></circle><circle cx="5" cy="17" r="2"></circle><circle cx="19" cy="7" r="2"></circle><path d="M7 7h10M7 17h10"></path>',
      image:'<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="8" cy="9" r="2"></circle><path d="m4 17 5-5 4 4 3-3 4 4"></path>',
      images:'<rect x="6" y="3" width="15" height="14" rx="2"></rect><path d="M18 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M9 13l3-3 4 4 2-2 3 3"></path>',
      imageRelation:'<rect x="3" y="5" width="8" height="8" rx="2"></rect><path d="m4 12 2.5-2.5L10 13M13 7h8M13 11h6M11 9h2"></path><path d="M5 17h14"></path>',
      imageSequence:'<rect x="2" y="5" width="5" height="8" rx="1"></rect><rect x="9.5" y="5" width="5" height="8" rx="1"></rect><rect x="17" y="5" width="5" height="8" rx="1"></rect><path d="M7 9h2.5M14.5 9H17M4.5 17v3M11 18.5h2M19 17c1-1 2.5.5 1 1.5 1.5 1 0 2-1 1.5"></path>',
      imagePair:'<rect x="2" y="5" width="8" height="12" rx="2"></rect><rect x="14" y="5" width="8" height="12" rx="2"></rect><path d="m3 15 2.5-3 3.5 4M15 15l2.5-3 3.5 4M10 11h4"></path>',
      caption:'<rect x="4" y="3" width="16" height="12" rx="2"></rect><path d="m5 14 4-4 3 3 2-2 5 4M7 19h10M9 22h6"></path>',
      compare:'<rect x="3" y="5" width="8" height="14" rx="2"></rect><rect x="13" y="5" width="8" height="14" rx="2"></rect><path d="M7 9h.01M17 9h.01M6 15h2M16 15h2"></path>',
      grid:'<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M9 3v18M15 3v18M3 9h18M3 15h18"></path>',
      target:'<rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="15" cy="10" r="3"></circle><path d="M15 5v2M15 13v2M10 10h2M18 10h2M5 17l4-4 3 3"></path>',
      math:'<rect x="4" y="2" width="16" height="20" rx="3"></rect><path d="M7 6h10M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"></path>',
      expression:'<text x="3" y="14.5" fill="currentColor" stroke="none" font-size="10" font-weight="800">x+y</text><path d="M3 18h18M17 5l4 4M21 5l-4 4"></path>',
      problem:'<path d="M4 4h16v13H8l-4 4V4Z"></path><path d="M8 9h8M12 6v6M8 14h5"></path>',
      table:'<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M9 4v16M15 4v16"></path>',
      numbers:'<circle cx="5" cy="12" r="3"></circle><circle cx="12" cy="12" r="3"></circle><circle cx="19" cy="12" r="3"></circle><path d="M5 11v2M11 11.2c.3-.8 1.8-.8 2 0 .2.7-.8 1-2 2h2M18 11c.8-1 2.3 0 1 1 1.3 1 0 2-1 1"></path>',
      mic:'<rect x="8" y="3" width="8" height="12" rx="4"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"></path>',
      letters:'<path d="M4 19 9 5l5 14M6 14h6M15 10h5M17.5 7.5v5"></path>',
      search:'<circle cx="10" cy="10" r="6"></circle><path d="m15 15 5 5M7 8h6M7 11h4"></path>',
      crossword:'<path d="M4 4h6v6H4zM10 10h6v6h-6zM16 16h4v4h-4zM16 4h4v6h-4zM4 16h6v4H4z"></path>'
    };
    const iconTypes = {
      marcarx:'choice', vf:'trueFalse', discursiva:'write', lacunas:'fill', texto_base:'book', ordenacao:'order', subitens:'list', relacione:'relation', relacione_imagens:'imageRelation', espaco_livre:'draw', sequencia_imagens:'imageSequence', comparar_imagens:'compare', legenda_imagens:'caption', associacao_imagem_imagem:'imagePair', grade_imagens:'grid', identificar_imagem:'target', matematica_coluna:'math', expressao_matematica:'expression', problema_matematico:'problem', tabela:'table', sequencia_numerica:'numbers', ditado:'mic', leitura_escrita:'readWrite', silabas:'letters', caca_palavras:'search', cruzadinha:'crossword'
    };
    const categoryTones = { 'Escrita e interpretação':'writing', 'Alternativas e relações':'choice', 'Imagens e desenho':'image', 'Matemática e dados':'math', 'Linguagem e alfabetização':'language' };
    types.forEach(button => {
      const categoryName = category(button.dataset.type);
      button.dataset.category = categoryName;
      button.dataset.tone = categoryTones[categoryName] || 'choice';
      const hint = button.querySelector('small');
      if (hint && samples[button.dataset.type]) hint.textContent = samples[button.dataset.type];
      const label = [...button.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).filter(Boolean).join(' ') || button.dataset.type;
      const icon = document.createElement('span'); icon.className = 'picker-type-icon'; icon.setAttribute('aria-hidden','true');
      icon.innerHTML = svg(iconBodies[iconTypes[button.dataset.type]] || iconBodies.list);
      const title = document.createElement('strong'); title.className = 'picker-type-title'; title.textContent = label;
      button.classList.add('picker-type-card');
      button.replaceChildren(icon, title, hint || '');
      button.setAttribute('aria-label', `${label}. ${hint?.textContent || 'Criar este tipo de questão.'}`);
      grid.append(button);
    });
    const empty = document.createElement('p'); empty.textContent = 'Nenhum tipo encontrado. Tente outro termo.'; empty.hidden = true;
    const sticky = document.createElement('div'); sticky.className = 'picker-sticky';
    sticky.append(header, filters);
    if (bank) {
      bank.classList.add('picker-bank-action');
      bank.innerHTML = `<span class="picker-bank-icon" aria-hidden="true">${svg('<ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>')}</span><span class="picker-bank-copy"><strong>Usar questão do banco</strong><small>Reaproveite uma questão já cadastrada.</small></span><span class="picker-bank-arrow" aria-hidden="true">→</span>`;
      bank.setAttribute('aria-label','Usar uma questão já cadastrada no banco');
      sticky.append(bank);
    }
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
