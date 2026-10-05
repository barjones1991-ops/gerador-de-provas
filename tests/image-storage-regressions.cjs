const assert = require('node:assert/strict');

global.CONFIG = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test',
  IMAGE_STORAGE_ENABLED: true,
  IMAGE_STORAGE_BUCKET: 'exam-images',
};

const calls = [];
global.fetch = async (url, options) => {
  calls.push({ url, options });
  if (url.includes('/object/sign/')) {
    const path = url.split('/object/sign/exam-images/')[1];
    return { ok: true, json: async () => ({ signedURL: `/storage/v1/object/sign/exam-images/${path}?token=signed` }) };
  }
  return { ok: true, json: async () => ({}) };
};

const storage = require('../js/image-storage.js');
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
  console.log('OK REG imagens usam Storage privado sem duplicar o mesmo arquivo');
})().catch(error => { console.error(error); process.exitCode = 1; });
