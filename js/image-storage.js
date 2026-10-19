/* Gerenciador central de imagens: identidade, upload, cópia, resolução e limpeza. */
(function (root) {
  const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
  const STORAGE_REF_PREFIX = 'storage://';
  const ASSET_REF_PREFIX = 'asset://';
  const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_OBJECT_BYTES = 5 * 1024 * 1024;
  const dataToRef = new Map();
  const urlToRef = new Map();
  const refToUrl = new Map();
  const assetRecords = new Map();
  const assetRequests = new Map();
  const signingRequests = new Map();
  let auth = null;
  let scope = 'draft';

  const config = () => root.CONFIG || {};
  const bucket = () => config().IMAGE_STORAGE_BUCKET || 'exam-images';
  const enabled = () => config().IMAGE_STORAGE_ENABLED === true && typeof root.fetch === 'function';
  const cleanPart = value => String(value || 'draft').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 90) || 'draft';
  const isStorageRef = value => typeof value === 'string' && value.startsWith(`${STORAGE_REF_PREFIX}${bucket()}/`);
  const isAssetRef = value => typeof value === 'string' && value.startsWith(ASSET_REF_PREFIX) && ASSET_ID_RE.test(value.slice(ASSET_REF_PREFIX.length));
  const assetIdFromRef = ref => isAssetRef(ref) ? ref.slice(ASSET_REF_PREFIX.length) : '';
  const pathFromRef = ref => isStorageRef(ref) ? ref.slice(`${STORAGE_REF_PREFIX}${bucket()}/`.length) : '';

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
      const prefixes = [`/storage/v1/object/sign/${bucket()}/`, `/object/sign/${bucket()}/`];
      const prefix = prefixes.find(item => parsed.pathname.startsWith(item));
      if (!prefix) return '';
      const path = decodePath(parsed.pathname.slice(prefix.length));
      return path ? `${STORAGE_REF_PREFIX}${bucket()}/${path}` : '';
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
    if (!auth?.isAuthenticated?.()) throw new Error('Entre novamente para acessar imagens.');
    if (auth.ensureAccessToken) await auth.ensureAccessToken();
    const value = auth.session?.access_token;
    if (!value) throw new Error('Sessão indisponível para acessar imagens.');
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
    if (!match) throw new Error('Formato de imagem inválido.');
    const bytes = root.atob(match[2]);
    const body = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index++) body[index] = bytes.charCodeAt(index);
    return new Blob([body], { type: match[1].toLowerCase() });
  }

  function extensionForMime(mime) {
    const type = String(mime || '').toLowerCase();
    if (type === 'image/png') return 'png';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
    throw new Error('Formato de imagem não permitido.');
  }

  async function registerAsset(record) {
    const rows = await auth.authenticatedRequest('/image_assets?select=id,object_name,bucket_id,mime_type,original_name,source_asset_id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(record),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.id) throw new Error('Não foi possível registrar a imagem.');
    assetRecords.set(row.id, row);
    return `${ASSET_REF_PREFIX}${row.id}`;
  }

  async function removeObject(objectName) {
    const response = await root.fetch(storageUrl(`object/${bucket()}`), {
      method: 'DELETE',
      headers: {
        apikey: config().SUPABASE_ANON_KEY,
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [objectName] }),
    });
    if (!response.ok && response.status !== 404) throw new Error(`Falha ao excluir imagem (${response.status}).`);
  }

  async function deleteAssetRecord(id) {
    const rows = await auth.authenticatedRequest(`/image_assets?id=eq.${encodeURIComponent(id)}&select=id`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id) {
      throw new Error('A remoção do registro da imagem não foi confirmada.');
    }
  }

  async function discardAsset(ref) {
    if (!isAssetRef(ref)) return;
    const record = await getAssetRecord(ref);
    await removeObject(record.object_name);
    await deleteAssetRecord(record.id);
    assetRecords.delete(record.id);
    refToUrl.delete(ref);
  }

  async function discardTree(value, options = {}) {
    configure(options.auth, options.scope);
    const refs = collectUnique(durableTree(value), isAssetRef);
    const results = await Promise.allSettled(refs.map(discardAsset));
    return {
      removed: results.filter(result => result.status === 'fulfilled').length,
      failed: results.filter(result => result.status === 'rejected').length,
    };
  }

  async function uploadBlob(body, options = {}) {
    configure(options.auth, options.scope);
    if (!enabled()) throw new Error('O armazenamento de imagens não está configurado.');
    if (!(body instanceof Blob)) throw new Error('Arquivo de imagem inválido.');
    if (body.size > MAX_OBJECT_BYTES) throw new Error('A imagem ultrapassa o limite de 5 MB.');
    const extension = extensionForMime(body.type);
    const userId = auth?.getCurrentUser?.()?.id;
    if (!userId) throw new Error('Usuário indisponível para enviar imagens.');
    const assetId = root.crypto?.randomUUID?.();
    if (!assetId) throw new Error('Este navegador não consegue criar uma identidade segura para a imagem. Atualize o navegador.');
    const objectName = `${cleanPart(userId)}/${cleanPart(options.scope || scope)}/${assetId}.${extension}`;
    const response = await root.fetch(storageUrl(`object/${bucket()}/${objectName}`), {
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
    try {
      return await registerAsset({
        id: assetId,
        owner_id: userId,
        bucket_id: bucket(),
        object_name: objectName,
        mime_type: body.type,
        byte_size: body.size,
        original_name: String(options.originalName || '').slice(0, 255) || null,
        source_asset_id: options.sourceAssetId || null,
      });
    } catch (error) {
      try { await removeObject(objectName); } catch {}
      throw error;
    }
  }

  async function uploadDataUrl(dataUrl, options = {}) {
    configure(options.auth, options.scope);
    const userId = cleanPart(auth?.getCurrentUser?.()?.id);
    const cacheKey = `${userId}/${scope}:${dataUrl}`;
    if (!options.forceNew && dataToRef.has(cacheKey)) return dataToRef.get(cacheKey);
    const ref = await uploadBlob(base64Blob(dataUrl), options);
    if (!options.forceNew) dataToRef.set(cacheKey, ref);
    return ref;
  }

  async function getAssetRecord(ref) {
    const id = assetIdFromRef(ref);
    if (!id) throw new Error('Referência de imagem inválida.');
    if (assetRecords.has(id)) return assetRecords.get(id);
    if (assetRequests.has(id)) return assetRequests.get(id);
    const request = (async () => {
      const rows = await auth.authenticatedRequest(`/image_assets?id=eq.${encodeURIComponent(id)}&select=id,object_name,bucket_id,mime_type,original_name,source_asset_id`);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row?.object_name) throw new Error('Imagem indisponível ou sem permissão de acesso.');
      assetRecords.set(id, row);
      return row;
    })();
    assetRequests.set(id, request);
    try { return await request; } finally { assetRequests.delete(id); }
  }

  async function objectNameForRef(ref) {
    if (isAssetRef(ref)) return (await getAssetRecord(ref)).object_name;
    const legacyPath = pathFromRef(ref);
    if (legacyPath) return legacyPath;
    throw new Error('Referência de imagem inválida.');
  }

  async function signReference(ref, options = {}) {
    if (!options.force) {
      const cached = refToUrl.get(ref);
      if (cached?.expiresAt > Date.now() + 60000) return cached.url;
      if (signingRequests.has(ref)) return signingRequests.get(ref);
    }
    const cached = refToUrl.get(ref);
    if (cached) {
      refToUrl.delete(ref);
      urlToRef.delete(cached.url);
    }
    if (!enabled()) return ref;
    const request = (async () => {
      const objectName = await objectNameForRef(ref);
      const response = await root.fetch(storageUrl(`object/sign/${bucket()}/${objectName}`), {
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
      if (!signed) throw new Error('O Storage não retornou o endereço da imagem.');
      const url = signedResponseUrl(signed);
      refToUrl.set(ref, { url, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
      urlToRef.set(url, ref);
      return url;
    })();
    signingRequests.set(ref, request);
    try { return await request; } finally { signingRequests.delete(ref); }
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

  function collectUnique(value, predicate) {
    const found = [];
    (function collect(item) {
      if (typeof item === 'string' && predicate(item) && !found.includes(item)) found.push(item);
      else if (Array.isArray(item)) item.forEach(collect);
      else if (item && typeof item === 'object') Object.values(item).forEach(collect);
    })(value);
    return found;
  }

  function assertDurable(value) {
    let invalid = '';
    walkSync(value, item => {
      if (!invalid && isUnrecoverableSignedUrl(item)) invalid = item;
      return item;
    });
    if (invalid) throw new Error('Uma imagem temporária não possui referência permanente recuperável. O rascunho foi preservado.');
  }

  async function persistTree(value, options = {}) {
    configure(options.auth, options.scope);
    const durable = durableTree(value);
    assertDurable(durable);
    if (!enabled()) return durable;
    const images = collectUnique(durable, item => DATA_IMAGE_RE.test(item));
    let done = 0;
    const refs = new Map();
    options.onProgress?.(done, images.length);
    try {
      for (let index = 0; index < images.length; index += 3) {
        await Promise.all(images.slice(index, index + 3).map(async image => {
          refs.set(image, await uploadDataUrl(image, options));
          done++;
          options.onProgress?.(done, images.length);
        }));
      }
    } catch (error) {
      console.warn('Storage de imagens indisponível; mantendo dados compatíveis.', error);
      options.onFallback?.(error);
      return durable;
    }
    return walkSync(durable, item => refs.get(item) || item);
  }

  async function copyReference(ref, options = {}) {
    const sourceAssetId = assetIdFromRef(ref) || null;
    const sourceRecord = sourceAssetId ? await getAssetRecord(ref) : null;
    const signedUrl = await signReference(ref);
    const response = await root.fetch(signedUrl);
    if (!response.ok) throw new Error(`Não foi possível copiar uma imagem (${response.status}).`);
    const blob = await response.blob();
    return uploadBlob(blob, {
      ...options,
      forceNew: true,
      sourceAssetId,
      originalName: sourceRecord?.original_name || options.originalName,
    });
  }

  async function cloneTree(value, options = {}) {
    configure(options.auth, options.scope);
    const durable = durableTree(value);
    assertDurable(durable);
    const sources = collectUnique(durable, item => DATA_IMAGE_RE.test(item) || isAssetRef(item) || isStorageRef(item));
    if (!sources.length) return durable;
    if (!enabled()) throw new Error('O Storage precisa estar ativo para criar uma cópia independente.');
    const replacements = new Map();
    const created = [];
    let done = 0;
    options.onProgress?.(done, sources.length);
    try {
      for (const source of sources) {
        const ref = DATA_IMAGE_RE.test(source)
          ? await uploadDataUrl(source, { ...options, forceNew: true })
          : await copyReference(source, options);
        replacements.set(source, ref);
        created.push(ref);
        done++;
        options.onProgress?.(done, sources.length);
      }
      return walkSync(durable, item => replacements.get(item) || item);
    } catch (error) {
      await Promise.allSettled(created.map(discardAsset));
      throw error;
    }
  }

  async function resolveTree(value, options = {}) {
    configure(options.auth, options.scope);
    const durable = durableTree(value);
    if (!enabled()) return durable;
    return walkAsync(durable, item => (isAssetRef(item) || isStorageRef(item)) ? signReference(item, options) : item);
  }

  async function refreshUrl(value, options = {}) {
    configure(options.auth, options.scope);
    const ref = referenceFromSignedUrl(value);
    return ref ? signReference(ref, { force: true }) : value;
  }

  async function cleanupOrphanedAssets(options = {}) {
    configure(options.auth, options.scope);
    if (!enabled() || !auth?.getCurrentUser?.()?.id) return { removed: 0, failed: 0 };
    const days = Math.max(1, Math.min(90, Number(options.days) || 7));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const ownerFilter = options.all ? '' : `&owner_id=eq.${encodeURIComponent(auth.getCurrentUser().id)}`;
    const rows = await auth.authenticatedRequest(`/image_assets?orphaned_at=lt.${encodeURIComponent(cutoff)}${ownerFilter}&select=id,object_name&order=orphaned_at.asc&limit=20`);
    let removed = 0;
    let failed = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      try {
        await removeObject(row.object_name);
        await deleteAssetRecord(row.id);
        assetRecords.delete(row.id);
        removed++;
      } catch (error) {
        failed++;
        console.warn('Não foi possível limpar uma imagem sem uso.', error);
      }
    }
    return { removed, failed };
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

  root.ExamImageStorage = {
    configure, persistTree, cloneTree, resolveTree, durableTree, refreshUrl,
    cleanupOrphanedAssets, discardAsset, discardTree, isStorageRef, isAssetRef,
    isRenderableImage, pathFromRef, assetIdFromRef,
  };
  if (typeof module !== 'undefined') module.exports = root.ExamImageStorage;
})(typeof window !== 'undefined' ? window : globalThis);
