/* Fluxos do editor. Dados reais continuam passando pelo AuthManager e pelas policies do banco. */
const EditorTools = {
  loading: true, initialized: false, applyingHistory: false, history: [], historyIndex: -1,
  bankId: new URLSearchParams(window.location.search).get('bank'), bankRecord: null,
  previewTimer: null, persistTimer: null, historyTimer: null, previewReady: false,
  forceSnapshot: true, previewQuestionCount: -1, dirtyQuestions: new Set(),
  canEdit() {
    try {
      return !this.loading && autoSaveReady && !['aprovada', 'bloqueada'].includes(currentReviewStatus)
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
  changed() {
    if (!this.initialized) return;
    const index = document.activeElement?.closest?.('.qcard')?.dataset.questionIndex;
    if (index == null) this.forceSnapshot = true; else this.dirtyQuestions.add(Number(index));
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.updatePreview(), 180);
    if (!this.canEdit()) return;
    setAutoSaveHint(this.bankId ? 'Alterações pendentes no banco de questões.' : 'Alterações pendentes.');
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
      applyStateToInputs(); this.refreshBankFields(); renderAll();
      // Defaults de apresentação não criam uma nova ação nem descartam o ramo Refazer.
      this.history[next] = examFingerprint();
    } finally { this.applyingHistory = false; }
    preservePendingDraft(); this.changed(); this.refreshActions();
  },
  refreshActions() {
    if (!this.initialized) return;
    const enabled = this.canEdit();
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
        summary.setAttribute('aria-expanded', String(!state.collapsedQuestions[index]));
        summary.setAttribute('aria-label', `Questão ${index + 1}: ${state.collapsedQuestions[index] ? 'expandir' : 'recolher'}`);
      }
      if (!state.collapsedQuestions[index] && q && !card.querySelector('.free-image-fields')) this.addImageFields(card, q, index);
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
      const name = field.title || field.placeholder || field.closest('div')?.querySelector('label')?.textContent || field.dataset.k || 'Campo';
      field.setAttribute('aria-label', `${question === undefined ? '' : `Questão ${Number(question) + 1}: `}${name.trim()} ${i + 1}`);
    });
    this.refreshActions();
  },
  addImageFields(card, question, index) {
    if (!question.freeImages?.length) return;
    const group = document.createElement('fieldset'); group.className = 'free-image-fields';
    const legend = document.createElement('legend'); legend.textContent = 'Posição e tamanho das imagens livres'; group.appendChild(legend);
    question.freeImages.forEach((image, imageIndex) => {
      const row = document.createElement('div'); row.className = 'image-control-row';
      const title = document.createElement('strong'); title.textContent = `Imagem ${imageIndex + 1}`; row.appendChild(title);
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
    card.appendChild(group);
  },
  updatePreview() {
    if (!this.initialized) return;
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
      document.getElementById('readinessSummary').textContent = issues.length ? `${issues.length} ponto(s) para conferir` : 'Conferência sem pendências';
    }
    const nav = document.getElementById('questionOutline');
    if (nav) {
      nav.replaceChildren();
      state.questions.forEach((q, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${index + 1}. ${String(q.text || typeLabel[q.type] || 'Questão').slice(0, 70)}`;
        button.addEventListener('click', () => this.focusQuestion(index)); nav.appendChild(button);
      });
    }
    const frame = document.getElementById('canonicalPreview');
    if (frame && this.previewReady) {
      if (!this.forceSnapshot && this.previewQuestionCount === state.questions.length && this.dirtyQuestions.size) {
        for (const index of this.dirtyQuestions) frame.contentWindow.postMessage({ type:'exam-preview-patch', index, question:state.questions[index] }, location.origin);
      } else frame.contentWindow.postMessage({ type: 'exam-preview', exam: {
        school: state.school, questions: state.questions, logoDataUrl: state.logoDataUrl,
      }, answerKey: Boolean(document.getElementById('previewAnswerKey')?.checked) }, location.origin);
      this.forceSnapshot = false; this.previewQuestionCount = state.questions.length; this.dirtyQuestions.clear();
    }
    this.refreshActions();
  },
  focusQuestion(index) {
    document.body.dataset.editorView = 'edit';
    if (index == null || index < 0) { document.getElementById('examDetails').open = true; document.getElementById('examTitle').focus(); return; }
    state.collapsedQuestions[index] = false; renderAll();
    const card = document.getElementById(`question-${index}`);
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); card?.querySelector('textarea,input,button')?.focus();
  },
  async openPrint(answerKey) {
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
      setAutoSaveHint('Questão carregada. Use Salvar no banco para confirmar alterações.');
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
    const question = ExamSafety.normalizeQuestion(state.questions[0]);
    if (new Blob([JSON.stringify(question)]).size > 1700 * 1024) { showToast('Questão muito pesada para o banco.', 'err'); return false; }
    this.bankSaving = true; this.refreshActions(); preservePendingDraft();
    try {
      const payload = { title: state.school.bankTitle || questionTitle(question), subject: state.school.subject || '',
        grade: state.school.bankGrade || '', skill: state.school.bankSkill || '', difficulty: state.school.bankDifficulty || 'media',
        question_type: question.type, question, ...buildBankScopePayload(state.school.bankScope || 'private') };
      const rows = await auth.authenticatedRequest(`/question_bank?id=eq.${encodeURIComponent(this.bankId)}&updated_at=eq.${encodeURIComponent(currentExamVersion)}&select=id,updated_at`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload),
      });
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].updated_at) throw new Error('O registro mudou em outra aba. Seu rascunho foi preservado; reabra para comparar.');
      currentExamVersion = rows[0].updated_at; lastSavedFingerprint = fingerprint;
      if (examFingerprint() === fingerprint) localStorage.removeItem(pendingDraftKey()); else preservePendingDraft();
      setAutoSaveHint('Registro original atualizado no banco.'); return true;
    } catch (error) { showToast(error.message, 'err'); setAutoSaveHint('Não foi possível atualizar o banco. Rascunho preservado.'); return false; }
    finally { this.bankSaving = false; this.refreshActions(); }
  },
  init() {
    this.initialized = true;
    document.body.dataset.editorView = 'edit';
    if (this.bankId) document.body.classList.add('bank-mode');
    const panel = document.querySelector('.card.no-print');
    panel.id = 'editorPanel';
    const heading = panel.querySelector('h2');
    const general = heading.nextElementSibling;
    const details = document.createElement('details'); details.id = 'examDetails'; details.open = true;
    const summary = document.createElement('summary'); summary.textContent = 'Dados da avaliação'; details.append(summary, general); heading.after(details);
    const top = document.createElement('div'); top.className = 'editor-primary-actions';
    top.innerHTML = '<strong id="activeExamTitle">Editor da prova</strong><div><button id="undoBtn" type="button" disabled>Desfazer</button><button id="redoBtn" type="button" disabled>Refazer</button><button id="viewEditBtn" type="button">Editar</button><button id="viewPreviewBtn" type="button">Prévia A4</button><button id="mainPrintBtn" type="button" class="primary">Imprimir / PDF</button><button id="saveBankRecordBtn" type="button" class="primary">Salvar no banco</button></div>';
    document.querySelector('.editor-actionbar-inner').prepend(top);
    if (typeof ResizeObserver !== 'undefined') {
      const bar = document.querySelector('.editor-actionbar');
      new ResizeObserver(() => document.documentElement.style.setProperty('--editor-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`)).observe(bar);
    }
    document.getElementById('undoBtn').onclick = () => this.travelHistory(-1);
    document.getElementById('redoBtn').onclick = () => this.travelHistory(1);
    document.getElementById('viewEditBtn').onclick = () => { document.body.dataset.editorView = 'edit'; };
    document.getElementById('viewPreviewBtn').onclick = () => { document.body.dataset.editorView = 'preview'; this.updatePreview(); };
    document.getElementById('mainPrintBtn').onclick = () => this.openPrint(false);
    document.getElementById('saveBankRecordBtn').onclick = () => this.saveBank();
    const overview = document.createElement('details'); overview.id = 'questionOverview';
    overview.innerHTML = '<summary>Questões da prova</summary><nav id="questionOutline" aria-label="Navegar pelas questões"></nav>';
    details.after(overview);
    const readiness = document.createElement('details'); readiness.id = 'readinessDetails';
    readiness.innerHTML = '<summary id="readinessSummary">Conferir prova</summary><div id="examIssues"></div>';
    overview.after(readiness);
    const preview = document.createElement('section'); preview.id = 'canonicalPreviewPanel';
    preview.innerHTML = '<div class="preview-options"><strong>Prévia A4</strong><label><input type="checkbox" id="previewAnswerKey"> Mostrar gabarito</label><label>Zoom <select id="previewZoom"><option value="0.6">60%</option><option value="0.8" selected>80%</option><option value="1">100%</option></select></label></div><p class="small">Mesma diagramação da impressão. As quebras finais são calculadas pelo navegador ao imprimir.</p><div class="preview-scroll"><iframe id="canonicalPreview" src="print.html?preview=1" title="Prévia da prova em formato A4"></iframe></div>';
    document.getElementById('previewRoot').parentElement.appendChild(preview);
    document.getElementById('previewAnswerKey').onchange = () => { this.forceSnapshot = true; this.updatePreview(); };
    document.getElementById('previewZoom').onchange = event => { document.getElementById('canonicalPreview').style.zoom = event.target.value; };
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
      if (!templates[type]) continue;
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
    if (this.bankId) this.buildBankFields(details);
    document.addEventListener('click', event => {
      if (event.target.closest('#editorPanel, #topQuestionMenu') && this.canEdit()) this.recordHistory();
      if (!this.canEdit() && event.target.closest('#editorPanel, #topQuestionMenu')) {
        // Reading/navigation remain available; any data-changing controls are blocked.
        if (!event.target.closest('summary,#questionOutline,#examIssues,.qnum')) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (this.modal) { if (this.modal.dismiss) this.modal.dismiss(); else { this.modal.classList.remove('show'); this.closeModal(); } }
        document.querySelectorAll('.top-question-menu,.settings-menu,.q-tools-menu').forEach(menu => menu.classList.add('hidden'));
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
