const assert = require('node:assert/strict');

global.CONFIG = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test',
  IMAGE_STORAGE_ENABLED: true,
  IMAGE_STORAGE_BUCKET: 'exam-images',
};

const calls = [];
const signedResponses = [];
global.fetch = async (url, options) => {
  calls.push({ url, options });
  if (url.includes('/object/sign/')) {
    const path = url.split('/object/sign/exam-images/')[1];
    const shape = signedResponses.shift() || 'object';
    const suffix = `/object/sign/exam-images/${path}?token=signed`;
    const signedURL = shape === 'absolute'
      ? `https://project.supabase.co/storage/v1${suffix}`
      : shape === 'prefixed' ? `/storage/v1${suffix}` : suffix;
    return { ok: true, json: async () => ({ signedURL }) };
  }
  return { ok: true, json: async () => ({}) };
};

const modulePath = require.resolve('../js/image-storage.js');
const freshStorage = () => {
  delete require.cache[modulePath];
  delete global.ExamImageStorage;
  return require(modulePath);
};
const storage = freshStorage();
const auth = {
  session: { access_token: 'access-test' },
  isAuthenticated: () => true,
  ensureAccessToken: async () => 'access-test',
  getCurrentUser: () => ({ id: 'teacher-1' }),
};

(async () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  const source = { image, nested: [{ image }], text: 'enunciado' };
  const stored = await storage.persistTree(source, { auth, scope: 'exam-1' });
  assert.match(stored.image, /^storage:\/\/exam-images\/teacher-1\/exam-1\/.+\.png$/);
  assert.equal(stored.nested[0].image, stored.image, 'identical image should reuse one object');
  assert.equal(calls.filter(call => call.options.method === 'POST' && !call.url.includes('/object/sign/')).length, 1);
  assert.equal(source.image, image, 'source data should remain unchanged');

  const resolved = await storage.resolveTree(stored, { auth, scope: 'exam-1' });
  assert.match(resolved.image, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/exam-images\//);
  assert.equal(storage.isRenderableImage(resolved.image), true);
  assert.equal(storage.isRenderableImage('https://attacker.invalid/image.png'), false);

  const savedAgain = await storage.persistTree(resolved, { auth, scope: 'exam-1' });
  assert.equal(savedAgain.image, stored.image, 'signed URL should return to its durable reference');

  for (const shape of ['prefixed', 'absolute']) {
    signedResponses.push(shape);
    const session = freshStorage();
    const reopened = await session.resolveTree(stored, { auth, scope: 'exam-1' });
    assert.match(reopened.image, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\/exam-images\//);
    assert.equal(reopened.image.includes('/storage/v1/storage/v1/'), false, `${shape} must not duplicate the API prefix`);
  }

  signedResponses.push('object');
  const newSession = freshStorage();
  const expiredLegacyUrl = resolved.image.replace('/storage/v1/object/sign/', '/object/sign/').replace('token=signed', 'token=expired');
  const durableDraft = newSession.durableTree({ image: expiredLegacyUrl, original: stored.image });
  assert.equal(durableDraft.image, stored.image, 'old drafts should recover the object path without an in-memory map');
  const recovered = await newSession.resolveTree(durableDraft, { auth, scope: 'exam-1' });
  assert.match(recovered.image, /\/storage\/v1\/object\/sign\/exam-images\/.+token=signed$/);
  const persistedAfterRestart = await newSession.persistTree(recovered, { auth, scope: 'exam-1' });
  assert.equal(persistedAfterRestart.image, stored.image, 'a reopened draft must never save its temporary URL');

  await assert.rejects(
    () => newSession.persistTree({ image: 'https://project.supabase.co/object/sign/other-bucket/file.png?token=old' }, { auth, scope: 'exam-1' }),
    /referencia permanente recuperavel/,
    'unrecoverable project signed URLs must block persistence',
  );

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
  assert.equal(compatible.image, pendingImage, 'missing bucket should preserve the legacy Base64 payload');
  assert.equal(usedFallback, true, 'missing bucket should notify the caller about compatibility mode');
  console.log('OK REG imagens usam referencias permanentes e renovam URLs em nova sessao');
})().catch(error => { console.error(error); process.exitCode = 1; });
