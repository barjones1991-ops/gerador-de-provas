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
    title.textContent = 'Recortar imagem — arraste para selecionar a área';
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = 'Clique e arraste sobre a imagem para marcar a área de recorte.';
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'crop-canvas-wrap';
    const displayCanvas = document.createElement('canvas');
    const selection = document.createElement('div');
    selection.className = 'crop-selection';
    selection.style.display = 'none';
    canvasWrap.append(displayCanvas, selection);

    let sourceImage = null;
    let displayScale = 1;
    let startX = 0;
    let startY = 0;
    let dragging = false;
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
    displayCanvas.addEventListener('pointerdown', event => {
      const point = pointerPosition(event);
      startX = point.x;
      startY = point.y;
      dragging = true;
      cropX = point.x;
      cropY = point.y;
      cropW = 0;
      cropH = 0;
      displayCanvas.setPointerCapture?.(event.pointerId);
      syncSelection();
    });
    displayCanvas.addEventListener('pointermove', event => {
      if (!dragging) return;
      const point = pointerPosition(event);
      cropX = Math.min(startX, point.x);
      cropY = Math.min(startY, point.y);
      cropW = Math.abs(point.x - startX);
      cropH = Math.abs(point.y - startY);
      syncSelection();
    });
    const endDrag = () => { dragging = false; };
    displayCanvas.addEventListener('pointerup', endDrag);
    displayCanvas.addEventListener('pointercancel', endDrag);

    const numeric = document.createElement('div');
    numeric.className = 'row two';
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
    confirm.textContent = '✂️ Confirmar recorte';
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
      const result = canvasOutput(output, 0.82);
      close();
      if (!options.canEdit || options.canEdit()) onConfirm(result);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'outline';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', close);
    buttons.append(confirm, cancel);
    box.append(title, hint, canvasWrap, numeric, buttons);
    overlay.appendChild(box);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.body.appendChild(overlay);
    options.openModal?.(overlay);
  }

  function createPicker(options) {
    const wrap = document.createElement('div');
    wrap.className = 'row image-picker';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.className = 'visually-hidden';
    const drop = document.createElement('div');
    drop.className = 'image-drop';
    drop.setAttribute('role', 'button');
    drop.tabIndex = 0;
    const sizeInfo = document.createElement('div');
    sizeInfo.className = 'img-size-info';
    const sizeControl = document.createElement('label');
    sizeControl.className = 'item-image-size-control';
    sizeControl.appendChild(document.createTextNode('Tamanho'));
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
      actions.appendChild(button);
      return button;
    };
    const rotateLeft = actionButton('↶', 'Girar 90° para a esquerda');
    const rotateRight = actionButton('↷', 'Girar 90° para a direita');
    const crop = actionButton('✂', 'Recortar imagem');
    const remove = actionButton('×', 'Remover imagem', 'danger');

    const refresh = () => {
      const image = options.getImage() || {};
      const hasImage = !!image.dataUrl;
      drop.replaceChildren();
      drop.setAttribute('aria-label', hasImage ? 'Substituir imagem' : 'Selecionar imagem do computador');
      if (hasImage) {
        const preview = document.createElement('img');
        preview.src = image.dataUrl;
        preview.alt = image.fileName || 'Imagem da questão';
        drop.appendChild(preview);
        const bytes = dataUrlBytes(image.dataUrl);
        sizeInfo.textContent = formatBytes(bytes) + (bytes > 600 * 1024 ? ' pesado' : '');
        sizeInfo.className = bytes > 600 * 1024 ? 'img-size-warn' : 'img-size-info';
        drop.appendChild(sizeInfo);
      } else {
        const empty = document.createElement('div');
        empty.innerHTML = '<strong>Arraste uma imagem aqui</strong><br><span class="small">ou clique para selecionar do computador</span>';
        drop.appendChild(empty);
      }
      sizeControl.hidden = !hasImage || !options.setSize;
      sizeSelect.value = options.getSize?.() || 'small';
      [rotateLeft, rotateRight, crop, remove].forEach(button => { button.hidden = !hasImage; });
    };

    const fail = error => options.onError?.(error instanceof Error ? error : new Error(String(error)));
    const applyFile = async file => {
      if (!file) return;
      try {
        const processor = options.processFile || processFile;
        const result = await processor(file, { ...options.processing, canEdit: options.canEdit });
        options.setImage(result.dataUrl, result.fileName);
        if (options.setSize && !options.getSize?.()) options.setSize('small');
        refresh();
        options.onChange?.();
      } catch (error) {
        fail(error);
      }
    };
    const chooseFile = () => {
      if (!options.canEdit || options.canEdit()) fileInput.click();
    };
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
      applyFile(event.dataTransfer.files?.[0]);
    });
    fileInput.addEventListener('change', event => {
      applyFile(event.target.files?.[0]);
      event.target.value = '';
    });

    const applyRotation = async (degrees, button) => {
      const image = options.getImage() || {};
      if (!image.dataUrl) return;
      button.disabled = true;
      try {
        const output = await rotate(image.dataUrl, degrees);
        if (!options.canEdit || options.canEdit()) options.setImage(output, image.fileName);
        refresh();
        options.onChange?.();
      } catch (error) {
        fail(error);
      } finally {
        button.disabled = false;
      }
    };
    rotateLeft.addEventListener('click', () => applyRotation(270, rotateLeft));
    rotateRight.addEventListener('click', () => applyRotation(90, rotateRight));
    crop.addEventListener('click', () => {
      const image = options.getImage() || {};
      if (!image.dataUrl) return;
      openCrop(image.dataUrl, output => {
        options.setImage(output, image.fileName);
        refresh();
        options.onChange?.();
      }, options.modal || {});
    });
    remove.addEventListener('click', () => {
      options.clearImage();
      refresh();
      options.onChange?.();
    });

    refresh();
    wrap.append(drop, fileInput, actions);
    if (options.setSize) wrap.appendChild(sizeControl);
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
