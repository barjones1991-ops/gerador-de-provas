/* Armazena imagens fora do JSON da prova e resolve referencias privadas para URLs temporarias. */
(function (root) {
  const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
  const REF_PREFIX = 'storage://';
  const dataToRef = new Map();
  const urlToRef = new Map();
  const refToUrl = new Map();
  let auth = null;
  let scope = 'draft';

  const config = () => root.CONFIG || {};
  const bucket = () => config().IMAGE_STORAGE_BUCKET || 'exam-images';
  const enabled = () => config().IMAGE_STORAGE_ENABLED === true && typeof root.fetch === 'function';
  const cleanPart = value => String(value || 'draft').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 90) || 'draft';
  const isStorageRef = value => typeof value === 'string' && value.startsWith(`${REF_PREFIX}${bucket()}/`);
  const pathFromRef = ref => isStorageRef(ref) ? ref.slice(`${REF_PREFIX}${bucket()}/`.length) : '';

  function projectUrl() {
    return String(config().SUPABASE_URL || '').replace(/\/$/, '');
  }

  function decodePath(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  function referenceFromSignedUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    const mapped = urlToRef.get(value);
    if (mapped) return mapped;
    try {
      const base = new URL(projectUrl() || 'https://invalid.local');
      const parsed = new URL(value, `${base.origin}/`);
      if (parsed.origin !== base.origin) return '';
      const prefixes = [
        `/storage/v1/object/sign/${bucket()}/`,
        `/object/sign/${bucket()}/`,
      ];
      const prefix = prefixes.find(item => parsed.pathname.startsWith(item));
      if (!prefix) return '';
      const path = decodePath(parsed.pathname.slice(prefix.length));
      return path ? `${REF_PREFIX}${bucket()}/${path}` : '';
    } catch { return ''; }
  }

  function isUnrecoverableSignedUrl(value) {
    if (typeof value !== 'string' || !value || referenceFromSignedUrl(value)) return false;
    try {
      const base = new URL(projectUrl() || 'https://invalid.local');
      const parsed = new URL(value, `${base.origin}/`);
      return parsed.origin === base.origin
        && (/^\/storage\/v1\/object\/sign\//.test(parsed.pathname) || /^\/object\/sign\//.test(parsed.pathname));
    } catch { return false; }
  }

  function configure(nextAuth, nextScope) {
    auth = nextAuth || auth;
    scope = cleanPart(nextScope || scope);
  }

  async function token() {
    if (!auth?.isAuthenticated?.()) throw new Error('Entre novamente para enviar imagens.');
    if (auth.ensureAccessToken) await auth.ensureAccessToken();
    const value = auth.session?.access_token;
    if (!value) throw new Error('Sessao indisponivel para enviar imagens.');
    return value;
  }

  function storageUrl(path = '') {
    return `${projectUrl()}/storage/v1/${String(path).replace(/^\/+/, '')}`;
  }

  function signedResponseUrl(value) {
    if (/^https?:\/\//i.test(value)) return value;
    const path = String(value || '').replace(/^\/+/, '');
    if (path.startsWith('storage/v1/')) return `${projectUrl()}/${path}`;
    if (path.startsWith('object/')) return storageUrl(path);
    return storageUrl(path);
  }

  function base64Blob(dataUrl) {
    const match = String(dataUrl).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i);
    if (!match) throw new Error('Formato de imagem invalido.');
    const bytes = root.atob(match[2]);
    const body = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) body[i] = bytes.charCodeAt(i);
    return new Blob([body], { type: match[1].toLowerCase() });
  }

  async function uploadDataUrl(dataUrl) {
    const userId = cleanPart(auth?.getCurrentUser?.()?.id);
    const cacheKey = `${userId}/${scope}:${dataUrl}`;
    if (dataToRef.has(cacheKey)) return dataToRef.get(cacheKey);
    const body = base64Blob(dataUrl);
    const random = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const extension = body.type.includes('png') ? 'png' : body.type.includes('gif') ? 'gif' : body.type.includes('webp') ? 'webp' : 'jpg';
    const path = `${userId}/${scope}/${random}.${extension}`;
    const response = await root.fetch(storageUrl(`object/${bucket()}/${path}`), {
      method: 'POST',
      headers: {
        apikey: config().SUPABASE_ANON_KEY,
        Authorization: `Bearer ${await token()}`,
        'Content-Type': body.type,
        'x-upsert': 'false',
      },
      body,
    });
    if (!response.ok) throw new Error(`Falha ao enviar imagem (${response.status}). Verifique o Storage.`);
    const ref = `${REF_PREFIX}${bucket()}/${path}`;
    dataToRef.set(cacheKey, ref);
    return ref;
  }

  async function signReference(ref) {
    const cached = refToUrl.get(ref);
    if (cached?.expiresAt > Date.now() + 60000) return cached.url;
    if (cached) {
      refToUrl.delete(ref);
      urlToRef.delete(cached.url);
    }
    const path = pathFromRef(ref);
    if (!path || !enabled()) return ref;
    const response = await root.fetch(storageUrl(`object/sign/${bucket()}/${path}`), {
      method: 'POST',
      headers: {
        apikey: config().SUPABASE_ANON_KEY,
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 86400 }),
    });
    if (!response.ok) throw new Error(`Falha ao carregar imagem (${response.status}).`);
    const result = await response.json();
    const signed = result.signedURL || result.signedUrl;
    if (!signed) throw new Error('O Storage nao retornou o endereco da imagem.');
    const url = signedResponseUrl(signed);
    refToUrl.set(ref, { url, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
    urlToRef.set(url, ref);
    return url;
  }

  async function walkAsync(value, transform) {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return Promise.all(value.map(item => walkAsync(item, transform)));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await walkAsync(item, transform)]));
      return Object.fromEntries(entries);
    }
    return value;
  }

  function walkSync(value, transform) {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return value.map(item => walkSync(item, transform));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkSync(item, transform)]));
    return value;
  }

  function durableTree(value) {
    return walkSync(value, item => referenceFromSignedUrl(item) || item);
  }

  async function persistTree(value, options = {}) {
    configure(options.auth, options.scope);
    const durable = durableTree(value);
    let invalidSignedUrl = '';
    walkSync(durable, item => {
      if (!invalidSignedUrl && isUnrecoverableSignedUrl(item)) invalidSignedUrl = item;
      return item;
    });
    if (invalidSignedUrl) throw new Error('Uma imagem temporaria nao possui referencia permanente recuperavel. O rascunho foi preservado.');
    if (!enabled()) return durable;
    const images = [];
    (function collect(item) {
      if (typeof item === 'string' && DATA_IMAGE_RE.test(item) && !images.includes(item)) images.push(item);
      else if (Array.isArray(item)) item.forEach(collect);
      else if (item && typeof item === 'object') Object.values(item).forEach(collect);
    })(durable);
    let done = 0;
    const refs = new Map();
    options.onProgress?.(done, images.length);
    try {
      for (let index = 0; index < images.length; index += 3) {
        await Promise.all(images.slice(index, index + 3).map(async image => {
          refs.set(image, await uploadDataUrl(image));
          done++;
          options.onProgress?.(done, images.length);
        }));
      }
    } catch (error) {
      console.warn('Storage de imagens indisponivel; mantendo dados compativeis.', error);
      options.onFallback?.(error);
      return durable;
    }
    return walkSync(durable, item => refs.get(item) || item);
  }

  async function resolveTree(value, options = {}) {
    configure(options.auth, options.scope);
    const durable = durableTree(value);
    if (!enabled()) return durable;
    return walkAsync(durable, item => isStorageRef(item) ? signReference(item) : item);
  }

  function isRenderableImage(value) {
    const text = String(value || '');
    if (DATA_IMAGE_RE.test(text)) return true;
    if (urlToRef.has(text)) return true;
    try {
      const url = new URL(text);
      const base = new URL(config().SUPABASE_URL || 'https://invalid.local');
      return url.origin === base.origin && url.pathname.includes(`/storage/v1/object/sign/${bucket()}/`);
    } catch { return false; }
  }

  root.ExamImageStorage = { configure, persistTree, resolveTree, durableTree, isStorageRef, isRenderableImage, pathFromRef };
  if (typeof module !== 'undefined') module.exports = root.ExamImageStorage;
})(typeof window !== 'undefined' ? window : globalThis);
