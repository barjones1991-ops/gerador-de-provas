const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'exam-decorations.js'), 'utf8'),
  { window, document: {}, getComputedStyle: () => ({ position: 'static' }) },
  { filename: 'js/exam-decorations.js' },
);

const { normalizeItem, normalizeList } = window.ExamDecorations;
const image = 'data:image/png;base64,AAAA';
const bounded = normalizeItem({ imageDataUrl: image, x: 95, width: 60 });
assert.equal(bounded.width, 60);
assert.equal(bounded.x, 40, 'a imagem precisa permanecer dentro da largura da página');

const duplicates = normalizeList([
  { id: 'repetida', imageDataUrl: image },
  { id: 'repetida', imageDataUrl: image },
  { id: 'repetida', imageDataUrl: image },
]);
assert.deepEqual(Array.from(duplicates, item => item.id), ['repetida', 'repetida-2', 'repetida-3']);
assert.equal(new Set(Array.from(duplicates, item => item.id)).size, duplicates.length);
assert.equal(normalizeList(Array.from({ length: 55 }, (_, index) => ({ id: String(index), imageDataUrl: image }))).length, 50);
assert.equal(normalizeItem({}), null);

console.log('OK DECORAÇÕES limites da página, IDs únicos, dados inválidos e limite total');
