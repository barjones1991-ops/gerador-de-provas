const assert = require('node:assert/strict');

global.CONFIG = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test',
  IMAGE_STORAGE_ENABLED: true,
  IMAGE_STORAGE_BUCKET: 'exam-images',
};

let uuidSequence = 1;
global.crypto = { randomUUID: () => `10000000-0000-4000-8000-${String(uuidSequence++).padStart(12, '0')}` };
const calls = [];
const signedResponses = [];
const objects = new Map();
const assets = new Map();

global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.includes('?token=signed')) {
    const path = decodeURIComponent(url.split('/object/sign/exam-images/')[1].split('?')[0]);
    return { ok: objects.has(path), status: objects.has(path) ? 200 : 404, blob: async () => objects.get(path) };
  }
  if (url.includes('/object/sign/')) {
    const path = decodeURIComponent(url.split('/object/sign/exam-images/')[1]);
    const shape = signedResponses.shift() || 'object';
    const suffix = `/object/sign/exam-images/${path}?token=signed`;
    const signedURL = shape === 'absolute'
      ? `https://project.supabase.co/storage/v1${suffix}`
      : shape === 'prefixed' ? `/storage/v1${suffix}` : suffix;
    return { ok: true, json: async () => ({ signedURL }) };
  }
  if (options.method === 'POST' && url.includes('/storage/v1/object/exam-images/')) {
    const path = decodeURIComponent(url.split('/storage/v1/object/exam-images/')[1]);
    objects.set(path, options.body);
    return { ok: true, json: async () => ({ Key: path }) };
  }
  if (options.method === 'DELETE' && url.endsWith('/storage/v1/object/exam-images')) {
    for (const path of JSON.parse(options.body).prefixes) objects.delete(path);
    return { ok: true, json: async () => ({}) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const modulePath = require.resolve('../js/image-storage.js');
const freshStorage = () => {
  delete require.cache[modulePath];
  delete global.ExamImageStorage;
  return require(modulePath);
};
const userId = '00000000-0000-4000-8000-000000000004';
const auth = {
  session: { access_token: 'access-test' },
  isAuthenticated: () => true,
  ensureAccessToken: async () => 'access-test',
  getCurrentUser: () => ({ id: userId }),
  authenticatedRequest: async (path, options = {}) => {
    if (path === '/image_assets?select=id,object_name,bucket_id,mime_type,original_name,source_asset_id' && options.method === 'POST') {
      const row = JSON.parse(options.body);
      assets.set(row.id, row);
      return [row];
    }
    if (path.startsWith('/image_assets?id=eq.') && options.method === 'DELETE') {
      assets.delete(decodeURIComponent(path.split('/image_assets?id=eq.')[1]));
      return null;
    }
    if (path.startsWith('/image_assets?id=eq.')) {
      const id = decodeURIComponent(path.split('/image_assets?id=eq.')[1].split('&')[0]);
      return assets.has(id) ? [assets.get(id)] : [];
    }
    return [];
  },
};

(async () => {
  const storage = freshStorage();
  const image = 'data:image/png;base64,aGVsbG8=';
  const source = { image, nested: [{ image }], text: 'enunciado' };
  const stored = await storage.persistTree(source, { auth, scope: 'exam-1' });
  assert.match(stored.image, /^asset:\/\/[0-9a-f-]{36}$/);
  assert.equal(stored.nested[0].image, stored.image, 'imagem repetida deve reutilizar o mesmo asset dentro do documento');
  assert.equal(objects.size, 1);
  assert.equal(assets.size, 1);
  assert.equal(source.image, image, 'a arvore de origem nao deve ser alterada');

  const resolved = await storage.resolveTree(stored, { auth, scope: 'exam-1' });
  assert.match(resolved.image, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/exam-images\//);
  assert.equal(storage.isRenderableImage(resolved.image), true);
  assert.equal(storage.isRenderableImage('https://attacker.invalid/image.png'), false);
  const savedAgain = await storage.persistTree(resolved, { auth, scope: 'exam-1' });
  assert.equal(savedAgain.image, stored.image, 'URL assinada deve voltar para o asset permanente');

  const copied = await storage.cloneTree({ first: stored.image, again: stored.image }, { auth, scope: 'exam-2' });
  assert.notEqual(copied.first, stored.image, 'a copia deve ganhar identidade propria');
  assert.equal(copied.again, copied.first, 'repeticoes internas devem apontar para uma unica copia nova');
  assert.equal(assets.get(storage.assetIdFromRef(copied.first)).source_asset_id, storage.assetIdFromRef(stored.image));
  assert.equal(objects.size, 2, 'a copia deve criar outro arquivo fisico');

  for (const shape of ['prefixed', 'absolute']) {
    signedResponses.push(shape);
    const session = freshStorage();
    const reopened = await session.resolveTree(stored, { auth, scope: 'exam-1' });
    assert.match(reopened.image, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/exam-images\//);
    assert.equal(reopened.image.includes('/storage/v1/storage/v1/'), false);
  }

  const legacyRef = `storage://exam-images/${userId}/legacy/old.png`;
  objects.set(`${userId}/legacy/old.png`, new Blob(['old'], { type: 'image/png' }));
  const session = freshStorage();
  const legacyResolved = await session.resolveTree({ image: legacyRef }, { auth, scope: 'legacy' });
  const expired = legacyResolved.image.replace('/storage/v1/object/sign/', '/object/sign/').replace('token=signed', 'token=expired');
  assert.equal(session.durableTree({ image: expired }).image, legacyRef, 'referencias storage antigas continuam recuperaveis');

  await assert.rejects(
    () => session.persistTree({ image: 'https://project.supabase.co/object/sign/other-bucket/file.png?token=old' }, { auth, scope: 'exam-1' }),
    /referência permanente recuperável/,
  );

  const createdCount = assets.size;
  await storage.discardTree(copied, { auth, scope: 'exam-2' });
  assert.equal(assets.size, createdCount - 1, 'rollback remove o registro do asset copiado');
  assert.equal(objects.size, 2, 'rollback remove apenas o arquivo copiado e preserva o legado de teste');

  const previousFetch = global.fetch;
  const previousWarn = console.warn;
  let usedFallback = false;
  global.fetch = async () => ({ ok: false, status: 404 });
  console.warn = () => {};
  const pendingImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  const compatible = await storage.persistTree({ image: pendingImage }, {
    auth, scope: 'exam-without-bucket', onFallback: () => { usedFallback = true; },
  });
  global.fetch = previousFetch;
  console.warn = previousWarn;
  assert.equal(compatible.image, pendingImage, 'falha de infraestrutura preserva o Base64 compativel');
  assert.equal(usedFallback, true);
  console.log('OK REG imagens centralizadas criam copias independentes, renovam URLs e preservam legado');
})().catch(error => { console.error(error); process.exitCode = 1; });
