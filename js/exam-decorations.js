(function (global) {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function normalizeItem(raw, index = 0) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const dataUrl = String(item.imageDataUrl || item.dataUrl || '');
    if (!dataUrl) return null;
    return {
      id: String(item.id || `decoration-${index + 1}`),
      imageDataUrl: dataUrl,
      imageFileName: String(item.imageFileName || item.fileName || `Decoração ${index + 1}`),
      page: Math.max(1, Math.round(Number(item.page) || 1)),
      x: clamp(item.x ?? 70, 0, 95),
      y: clamp(item.y ?? 8, 0, 95),
      width: clamp(item.width ?? 16, 5, 60),
      rotation: clamp(item.rotation ?? 0, -180, 180),
    };
  }

  function normalizeList(value) {
    return (Array.isArray(value) ? value : []).map(normalizeItem).filter(Boolean).slice(0, 50);
  }

  function pageElements(root) {
    return Array.from(root?.querySelectorAll?.('.pagedjs_page') || []);
  }

  function clear(root) {
    root?.querySelectorAll?.('.exam-decoration-layer').forEach(layer => layer.remove());
  }

  function renderPaged(root, value) {
    if (!root) return 0;
    clear(root);
    const pages = pageElements(root);
    if (!pages.length) return 0;
    const items = normalizeList(value);
    for (const item of items) {
      const page = pages[item.page - 1];
      if (!page) continue;
      const surface = page.querySelector('.pagedjs_pagebox') || page;
      if (getComputedStyle(surface).position === 'static') surface.style.position = 'relative';
      let layer = surface.querySelector(':scope > .exam-decoration-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'exam-decoration-layer';
        layer.setAttribute('aria-hidden', 'true');
        surface.appendChild(layer);
      }
      const figure = document.createElement('div');
      figure.className = 'exam-decoration';
      figure.style.left = `${item.x}%`;
      figure.style.top = `${item.y}%`;
      figure.style.width = `${item.width}%`;
      figure.style.transform = `rotate(${item.rotation}deg)`;
      const image = document.createElement('img');
      image.src = item.imageDataUrl;
      image.alt = '';
      image.draggable = false;
      figure.appendChild(image);
      layer.appendChild(figure);
    }
    return items.length;
  }

  global.ExamDecorations = Object.freeze({ normalizeItem, normalizeList, pageElements, clear, renderPaged });
})(window);
