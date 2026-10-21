(function (global) {
  'use strict';

  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
  const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
  const DEFAULT_MAX_OUTPUT_BYTES = 850 * 1024;

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function dataUrlBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.round(base64.length * 3 / 4);
  }

  function isAllowedFile(file) {
    return !!file && ALLOWED_IMAGE_TYPES.has(file.type);
  }

  function isSafeDataUrl(dataUrl) {
    return SAFE_IMAGE_DATA_URL_RE.test(String(dataUrl || ''));
  }

  function canvasOutput(canvas, quality) {
    let output = canvas.toDataURL('image/webp', quality);
    if (!output.startsWith('data:image/webp')) output = canvas.toDataURL('image/jpeg', quality);
    return output;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      if (/^https?:\/\//i.test(String(src || ''))) image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Não foi possível carregar esta imagem.'));
      image.src = String(src || '');
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.onabort = () => reject(new Error('Leitura cancelada.'));
      reader.readAsDataURL(file);
    });
  }

  async function processFile(file, options = {}) {
    const maxFileBytes = options.maxFileBytes || global.CONFIG?.MAX_FILE_SIZE || DEFAULT_MAX_FILE_BYTES;
    const maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
    if (!isAllowedFile(file)) throw new Error('Selecione uma imagem PNG, JPG, WebP ou GIF.');
    if (file.size > maxFileBytes) throw new Error(`Imagem muito grande. Use um arquivo de até ${formatBytes(maxFileBytes)}.`);

    const source = await readFileAsDataUrl(file);
    const image = await loadImage(source);
    const maxSide = options.maxSide || 1400;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

    let output = canvasOutput(canvas, options.quality || 0.82);
    for (const quality of options.qualitySteps || [0.72, 0.62, 0.52]) {
      if (dataUrlBytes(output) <= maxOutputBytes) break;
      output = canvasOutput(canvas, quality);
    }
    const bytes = dataUrlBytes(output);
    if (!isSafeDataUrl(output) || bytes > maxOutputBytes) {
      throw new Error(`Não foi possível reduzir esta imagem para até ${formatBytes(maxOutputBytes)}.`);
    }
    if (options.canEdit && !options.canEdit()) throw new Error('A edição não está mais disponível. Reabra a questão.');
    return { dataUrl: output, fileName: file.name, bytes, width: canvas.width, height: canvas.height };
  }

  async function rotate(dataUrl, degrees) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    const quarterTurn = Math.abs(degrees) % 180 === 90;
    canvas.width = quarterTurn ? image.height : image.width;
    canvas.height = quarterTurn ? image.width : image.height;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((degrees * Math.PI) / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return canvasOutput(canvas, 0.82);
  }

  function openCrop(dataUrl, onConfirm, options = {}) {
    if (options.canEdit && !options.canEdit()) return;
    const events = new AbortController();
    const overlay = document.createElement('div');
    overlay.className = 'crop-modal-overlay';
    const box = document.createElement('div');
    box.className = 'crop-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Recortar imagem');
    const close = () => {
      events.abort();
      overlay.remove();
      options.closeModal?.();
      options.onClose?.();
    };
    overlay.dismiss = close;

    const title = document.createElement('div');
    title.className = 'crop-modal-title';
    title.textContent = 'Recortar imagem';
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = 'Arraste os cantos para ajustar. Arraste dentro da seleção para mover a área que será mantida.';
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'crop-canvas-wrap';
    const displayCanvas = document.createElement('canvas');
    const selection = document.createElement('div');
    selection.className = 'crop-selection';
    selection.style.display = 'none';
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('span');
      handle.className = `crop-handle crop-handle-${corner}`;
      handle.dataset.corner = corner;
      handle.setAttribute('aria-hidden', 'true');
      selection.appendChild(handle);
    }
    canvasWrap.append(displayCanvas, selection);

    let sourceImage = null;
    let displayScale = 1;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let dragMode = 'draw';
    let dragRect = null;
    let activePointer = null;
    let cropX = 0;
    let cropY = 0;
    let cropW = 0;
    let cropH = 0;
    const controls = {};

    const syncSelection = () => {
      if (!displayCanvas.width || !displayCanvas.height) return;
      selection.style.display = 'block';
      selection.style.left = `${cropX / displayCanvas.width * 100}%`;
      selection.style.top = `${cropY / displayCanvas.height * 100}%`;
      selection.style.width = `${cropW / displayCanvas.width * 100}%`;
      selection.style.height = `${cropH / displayCanvas.height * 100}%`;
      if (controls.x) {
        controls.x.value = Math.round(cropX / displayCanvas.width * 100);
        controls.y.value = Math.round(cropY / displayCanvas.height * 100);
        controls.w.value = Math.round(cropW / displayCanvas.width * 100);
        controls.h.value = Math.round(cropH / displayCanvas.height * 100);
      }
    };

    loadImage(dataUrl).then(image => {
      sourceImage = image;
      const max = 640;
      displayScale = Math.min(1, max / Math.max(image.width, image.height));
      displayCanvas.width = Math.max(1, Math.round(image.width * displayScale));
      displayCanvas.height = Math.max(1, Math.round(image.height * displayScale));
      displayCanvas.getContext('2d').drawImage(image, 0, 0, displayCanvas.width, displayCanvas.height);
      cropX = 0;
      cropY = 0;
      cropW = displayCanvas.width;
      cropH = displayCanvas.height;
      syncSelection();
    }).catch(error => {
      close();
      options.showError?.(error.message);
    });

    const pointerPosition = event => {
      const rect = displayCanvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(displayCanvas.width, Math.round((event.clientX - rect.left) * displayCanvas.width / rect.width))),
        y: Math.max(0, Math.min(displayCanvas.height, Math.round((event.clientY - rect.top) * displayCanvas.height / rect.height))),
      };
    };
    canvasWrap.addEventListener('pointerdown', event => {
      if (!sourceImage || (event.button != null && event.button !== 0) || dragging) return;
      event.preventDefault();
      const point = pointerPosition(event);
      startX = point.x;
      startY = point.y;
      dragging = true;
      activePointer = event.pointerId;
      dragMode = event.target.dataset?.corner || (selection.contains(event.target) ? 'move' : 'draw');
      dragRect = { x: cropX, y: cropY, w: cropW, h: cropH };
      if (dragMode === 'draw') { cropX = point.x; cropY = point.y; cropW = 0; cropH = 0; }
      canvasWrap.setPointerCapture?.(event.pointerId);
      syncSelection();
    });
    canvasWrap.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== activePointer) return;
      const point = pointerPosition(event);
      if (dragMode === 'move') {
        cropX = Math.max(0, Math.min(displayCanvas.width - cropW, dragRect.x + point.x - startX));
        cropY = Math.max(0, Math.min(displayCanvas.height - cropH, dragRect.y + point.y - startY));
      } else {
        const anchorX = dragMode === 'draw' ? startX : dragRect.x + (dragMode.includes('w') ? dragRect.w : 0);
        const anchorY = dragMode === 'draw' ? startY : dragRect.y + (dragMode.includes('n') ? dragRect.h : 0);
        cropX = Math.min(anchorX, point.x);
        cropY = Math.min(anchorY, point.y);
        cropW = Math.abs(point.x - anchorX);
        cropH = Math.abs(point.y - anchorY);
      }
      syncSelection();
    });
    const endDrag = event => {
      if (event.pointerId !== activePointer) return;
      if (event.type === 'pointercancel' && dragRect) {
        ({ x: cropX, y: cropY, w: cropW, h: cropH } = dragRect);
        syncSelection();
      }
      dragging = false;
      activePointer = null;
    };
    canvasWrap.addEventListener('pointerup', endDrag);
    canvasWrap.addEventListener('pointercancel', endDrag);
    canvasWrap.addEventListener('lostpointercapture', endDrag);

    const numeric = document.createElement('div');
    numeric.className = 'row two';
    const precise = document.createElement('details');
    precise.className = 'crop-precise';
    const preciseTitle = document.createElement('summary');
    preciseTitle.textContent = 'Ajuste preciso por teclado';
    precise.append(preciseTitle, numeric);
    for (const [key, labelText, value] of [['x', 'Esquerda (%)', 0], ['y', 'Topo (%)', 0], ['w', 'Largura (%)', 100], ['h', 'Altura (%)', 100]]) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.value = String(value);
      controls[key] = input;
      input.addEventListener('input', () => {
        const percentage = name => Math.max(0, Math.min(100, Number(controls[name].value) || 0)) / 100;
        cropX = percentage('x') * displayCanvas.width;
        cropY = percentage('y') * displayCanvas.height;
        cropW = Math.min(percentage('w') * displayCanvas.width, displayCanvas.width - cropX);
        cropH = Math.min(percentage('h') * displayCanvas.height, displayCanvas.height - cropY);
        syncSelection();
      });
      label.appendChild(input);
      numeric.appendChild(label);
    }

    const buttons = document.createElement('div');
    buttons.className = 'crop-modal-btns';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = 'Aplicar recorte';
    confirm.addEventListener('click', () => {
      if (!sourceImage || cropW < 4 || cropH < 4) {
        options.showError?.('Selecione uma área de recorte primeiro.');
        return;
      }
      const output = document.createElement('canvas');
      const originalX = Math.round(cropX / displayScale);
      const originalY = Math.round(cropY / displayScale);
      const originalW = Math.round(cropW / displayScale);
      const originalH = Math.round(cropH / displayScale);
      output.width = originalW;
      output.height = originalH;
      output.getContext('2d').drawImage(sourceImage, originalX, originalY, originalW, originalH, 0, 0, originalW, originalH);
      try {
        const result = canvasOutput(output, 0.82);
        close();
        if (!options.canEdit || options.canEdit()) onConfirm(result);
      } catch (error) {
        options.showError?.('Não foi possível aplicar o recorte. Tente substituir a imagem pelo arquivo original.');
      }
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'outline';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', close);
    buttons.append(cancel, confirm);
    box.append(title, hint, canvasWrap, precise, buttons);
    overlay.appendChild(box);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.body.appendChild(overlay);
    options.openModal?.(overlay);
    return overlay;
  }

  function createPicker(options) {
    let busy = false;
    let editorOverlay = null;
    let cropOverlay = null;
    let presentation = null;
    const wrap = document.createElement('div');
    wrap.className = 'row image-picker';
    let openedFromDocument = false;
    const callerCanEdit = options.canEdit;
    options = { ...options, canEdit: () => (!openedFromDocument || wrap.isConnected) && (!callerCanEdit || callerCanEdit()) };
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'image-launcher';
    const workspace = document.createElement('div');
    workspace.className = 'image-workspace';
    workspace.hidden = true;
    const visual = document.createElement('div');
    visual.className = 'image-workspace-visual';
    const settings = document.createElement('div');
    settings.className = 'image-workspace-settings';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.className = 'visually-hidden';
    fileInput.hidden = true;
    fileInput.tabIndex = -1;
    fileInput.setAttribute('aria-hidden', 'true');
    const drop = document.createElement('div');
    drop.className = 'image-drop';
    drop.setAttribute('role', 'button');
    drop.tabIndex = 0;
    const sizeInfo = document.createElement('div');
    sizeInfo.className = 'img-size-info';
    const sizeControl = document.createElement('label');
    sizeControl.className = 'item-image-size-control';
    sizeControl.appendChild(document.createTextNode('Tamanho na prova'));
    const sizeSelect = document.createElement('select');
    sizeSelect.setAttribute('aria-label', 'Tamanho da imagem');
    sizeSelect.innerHTML = '<option value="small">Pequena</option><option value="medium">Média</option><option value="large">Grande</option>';
    sizeControl.appendChild(sizeSelect);
    sizeSelect.addEventListener('change', () => {
      if (options.canEdit && !options.canEdit()) return;
      options.setSize?.(sizeSelect.value);
      options.onChange?.();
    });

    const actions = document.createElement('div');
    actions.className = 'image-actions';
    const actionButton = (text, title, className = 'outline') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      button.title = title;
      button.setAttribute('aria-label', title);
      actions.appendChild(button);
      return button;
    };
    const replace = actionButton('Trocar imagem', 'Substituir imagem');
    const crop = actionButton('Recortar', 'Recortar imagem');
    const rotateLeft = actionButton('↶ Girar', 'Girar 90° para a esquerda');
    const rotateRight = actionButton('↷ Girar', 'Girar 90° para a direita');
    const remove = actionButton('Remover imagem', 'Remover imagem', 'danger image-remove-action');

    const refresh = () => {
      const image = options.getImage() || {};
      const hasImage = !!image.dataUrl;
      const editable = !options.canEdit || options.canEdit();
      launcher.replaceChildren();
      launcher.disabled = busy || !editable;
      launcher.setAttribute('aria-label', hasImage ? 'Editar imagem' : 'Adicionar imagem');
      if (hasImage) {
        const thumb = document.createElement('img');
        thumb.src = image.dataUrl;
        thumb.alt = '';
        launcher.appendChild(thumb);
      }
      const launcherCopy = document.createElement('span');
      const launcherTitle = document.createElement('strong');
      launcherTitle.textContent = busy ? 'Processando imagem…' : hasImage ? 'Editar imagem' : '+ Adicionar imagem';
      const launcherHint = document.createElement('small');
      launcherHint.textContent = hasImage ? 'Recorte, rotação e apresentação' : 'Escolha um arquivo ou arraste para cá';
      launcherCopy.append(launcherTitle, launcherHint);
      launcher.appendChild(launcherCopy);
      drop.replaceChildren();
      drop.setAttribute('aria-label', hasImage ? 'Substituir imagem' : 'Selecionar imagem do computador');
      drop.setAttribute('aria-busy', String(busy));
      drop.setAttribute('aria-disabled', String(busy || !editable));
      drop.tabIndex = busy || !editable ? -1 : 0;
      fileInput.disabled = busy || !editable;
      if (hasImage) {
        const preview = document.createElement('img');
        preview.src = image.dataUrl;
        preview.alt = image.fileName || 'Imagem da questão';
        drop.appendChild(preview);
        const bytes = dataUrlBytes(image.dataUrl);
        sizeInfo.textContent = 'Arquivo pesado: ' + formatBytes(bytes);
        sizeInfo.className = bytes > 600 * 1024 ? 'img-size-warn' : 'img-size-info';
        if (bytes > 600 * 1024) drop.appendChild(sizeInfo);
        drop.title = 'Trocar imagem';
      } else {
        const empty = document.createElement('div');
        empty.innerHTML = '<strong>Arraste uma imagem aqui</strong><br><span class="small">ou clique para selecionar do computador</span>';
        drop.appendChild(empty);
        drop.title = 'Selecionar imagem';
      }
      sizeControl.hidden = !hasImage || !options.setSize;
      sizeSelect.value = options.getSize?.() || 'small';
      sizeSelect.disabled = busy || !editable;
      [replace, rotateLeft, rotateRight, crop, remove].forEach(button => {
        button.hidden = !hasImage;
        button.disabled = busy || !editable;
      });
    };

    const setBusy = value => {
      busy = Boolean(value);
      refresh();
    };

    const fail = error => options.onError?.(error instanceof Error ? error : new Error(String(error)));
    const applyFile = async file => {
      if (!file || busy || (options.canEdit && !options.canEdit())) return;
      setBusy(true);
      try {
        const processor = options.processFile || processFile;
        const result = await processor(file, { ...options.processing, canEdit: options.canEdit });
        if (options.canEdit && !options.canEdit()) throw new Error('A edição não está mais disponível. Reabra a questão.');
        options.setImage(result.dataUrl, result.fileName);
        if (options.setSize && !options.getSize?.()) options.setSize('small');
        options.onChange?.();
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    };
    const chooseFile = () => {
      if (!busy && (!options.canEdit || options.canEdit())) fileInput.click();
    };
    const closeEditor = (force = false) => {
      if (!editorOverlay || (busy && !force)) return;
      if (cropOverlay) { cropOverlay.dismiss(); cropOverlay = null; }
      workspace.hidden = true;
      wrap.appendChild(workspace);
      editorOverlay.remove();
      editorOverlay = null;
      options.modal?.closeModal?.();
      launcher.focus();
    };
    const openEditor = () => {
      if (busy || editorOverlay || (options.canEdit && !options.canEdit())) return;
      if (!options.getImage()?.dataUrl) { chooseFile(); return; }
      openedFromDocument = wrap.isConnected;
      editorOverlay = document.createElement('div');
      editorOverlay.className = 'image-editor-overlay';
      const dialog = document.createElement('section');
      dialog.className = 'image-editor-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Editar imagem');
      const heading = document.createElement('header');
      heading.innerHTML = '<h2>Editar imagem</h2><p>Ajuste a imagem aqui. Confira sua posição e tamanho na prévia da prova.</p>';
      const footer = document.createElement('footer');
      const note = document.createElement('span');
      note.textContent = 'Os ajustes são aplicados à prova automaticamente.';
      const done = document.createElement('button');
      done.type = 'button'; done.className = 'primary'; done.textContent = 'Concluir';
      done.addEventListener('click', () => closeEditor());
      footer.append(note, done);
      workspace.hidden = false;
      dialog.append(heading, workspace, footer);
      editorOverlay.appendChild(dialog);
      editorOverlay.dismiss = () => closeEditor();
      document.body.appendChild(editorOverlay);
      options.modal?.openModal?.(editorOverlay);
    };
    launcher.addEventListener('click', openEditor);
    wrap.closeImageEditor = () => closeEditor(true);
    launcher.addEventListener('dragover', event => { event.preventDefault(); launcher.classList.add('dragover'); });
    launcher.addEventListener('dragleave', () => launcher.classList.remove('dragover'));
    launcher.addEventListener('drop', event => {
      event.preventDefault(); launcher.classList.remove('dragover');
      applyFile(event.dataTransfer.files?.[0]);
    });
    // Context adapters hand over their real controls, retaining their listeners and stored fields.
    wrap.attachPresentationControls = controls => {
      if (presentation === controls) return;
      presentation = controls;
      settings.appendChild(controls);
    };
    replace.addEventListener('click', chooseFile);
    drop.addEventListener('click', chooseFile);
    drop.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseFile();
      }
    });
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', event => {
      event.preventDefault();
      drop.classList.remove('dragover');
      if (busy || (options.canEdit && !options.canEdit())) return;
      applyFile(event.dataTransfer.files?.[0]);
    });
    fileInput.addEventListener('change', event => {
      applyFile(event.target.files?.[0]);
      event.target.value = '';
    });

    const applyRotation = async (degrees, button) => {
      const image = options.getImage() || {};
      if (!image.dataUrl || busy || (options.canEdit && !options.canEdit())) return;
      setBusy(true);
      try {
        const output = await rotate(image.dataUrl, degrees);
        if (options.canEdit && !options.canEdit()) throw new Error('A edição não está mais disponível. Reabra a questão.');
        options.setImage(output, image.fileName);
        options.onChange?.();
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    };
    rotateLeft.addEventListener('click', () => applyRotation(270, rotateLeft));
    rotateRight.addEventListener('click', () => applyRotation(90, rotateRight));
    crop.addEventListener('click', () => {
      const image = options.getImage() || {};
      if (!image.dataUrl || busy || (options.canEdit && !options.canEdit())) return;
      setBusy(true);
      cropOverlay = openCrop(image.dataUrl, output => {
        options.setImage(output, image.fileName);
        refresh();
        options.onChange?.();
      }, {
        ...(options.modal || {}),
        canEdit: options.canEdit,
        onClose: () => {
          options.modal?.onClose?.();
          setBusy(false);
          cropOverlay = null;
          if (editorOverlay) options.modal?.openModal?.(editorOverlay);
        },
      });
    });
    remove.addEventListener('click', () => {
      if (busy || (options.canEdit && !options.canEdit())) return;
      options.clearImage();
      refresh();
      options.onChange?.();
      closeEditor();
    });

    refresh();
    visual.append(drop, actions);
    const settingsTitle = document.createElement('h3');
    settingsTitle.textContent = 'Na prova';
    settings.appendChild(settingsTitle);
    if (options.setSize) settings.appendChild(sizeControl);
    workspace.append(visual, settings);
    wrap.append(launcher, fileInput, workspace);
    return wrap;
  }

  global.ExamImageEngine = Object.freeze({
    formatBytes,
    dataUrlBytes,
    isAllowedFile,
    isSafeDataUrl,
    processFile,
    rotate,
    openCrop,
    createPicker,
  });
})(window);
