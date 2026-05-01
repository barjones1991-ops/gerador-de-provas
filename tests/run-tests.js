const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'login.html', 'dashboard.html', 'editor.html', 'print.html', 'coordenacao.html'];
const jsFiles = ['config.js', 'js/auth.js'];
const questionTypes = [
  'multipla',
  'discursiva',
  'vf',
  'marcarx',
  'lacunas',
  'relacione',
  'imagem',
  'relacione_imagens',
  'texto_base',
  'matematica_coluna',
  'producao_textual',
  'ditado',
  'ordenacao',
  'problema_matematico',
  'espaco_livre',
];

let failures = 0;

function filePath(file) {
  return path.join(root, file);
}

function read(file) {
  return fs.readFileSync(filePath(file), 'utf8');
}

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => pass(name))
        .catch((error) => fail(name, error));
    }
    pass(name);
    return Promise.resolve();
  } catch (error) {
    fail(name, error);
    return Promise.resolve();
  }
}

function pass(name) {
  console.log(`OK   ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`FAIL ${name}`);
  console.error(`     ${error.message || error}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(values) {
  return [...new Set(values)];
}

function extractInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function localTargetExists(target) {
  if (!target || target.startsWith('#')) return true;
  if (/^(https?:|mailto:|tel:|javascript:)/i.test(target)) return true;
  const cleaned = target.split('#')[0].split('?')[0];
  if (!cleaned || cleaned.includes('${')) return true;
  return fs.existsSync(filePath(cleaned));
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.normalize(path.join(root, requested));

    if (!target.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(target) });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function requestStatus(port, page) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/${page}` }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => Object.keys(store).forEach((key) => delete store[key]),
  };
}

async function main() {
  await test('required project files exist', () => {
    [...htmlFiles, ...jsFiles, 'setup_supabase.sql', 'CLAUDE.md'].forEach((file) => {
      assert(fs.existsSync(filePath(file)), `${file} is missing`);
    });
  });

  for (const file of htmlFiles) {
    await test(`${file} has valid inline script syntax`, () => {
      const html = read(file);
      extractInlineScripts(html).forEach((script, index) => {
        try {
          new Function(script);
        } catch (error) {
          throw new Error(`inline script ${index + 1}: ${error.message}`);
        }
      });
    });

    await test(`${file} has no duplicate ids`, () => {
      const ids = [...read(file).matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
      const duplicates = unique(ids.filter((id, index) => ids.indexOf(id) !== index));
      assert(duplicates.length === 0, `duplicate ids: ${duplicates.join(', ')}`);
    });

    await test(`${file} links and local scripts point to existing files`, () => {
      const html = read(file);
      const targets = [
        ...[...html.matchAll(/\bhref=["']([^"']+)["']/g)].map((match) => match[1]),
        ...[...html.matchAll(/\bsrc=["']([^"']+)["']/g)].map((match) => match[1]),
      ];
      const missing = targets.filter((target) => !localTargetExists(target));
      assert(missing.length === 0, `missing targets: ${missing.join(', ')}`);
    });
  }

  for (const file of jsFiles) {
    await test(`${file} has valid JavaScript syntax`, () => {
      new Function(read(file));
    });
  }

  await test('config.js exposes window.CONFIG with Supabase URLs', () => {
    const sandbox = {
      console,
      window: { addEventListener: () => {} },
      document: { createElement: () => ({ style: {}, innerHTML: '' }), body: { innerHTML: '', appendChild: () => {} } },
      module: { exports: {} },
    };
    vm.runInNewContext(read('config.js'), sandbox, { filename: 'config.js' });
    const config = sandbox.window.CONFIG || sandbox.module.exports;
    assert(config.SUPABASE_URL && config.SUPABASE_URL.includes('supabase.co'), 'SUPABASE_URL is not configured');
    assert(config.API_URL && config.AUTH_URL, 'API_URL or AUTH_URL missing');
    assert(!config.SUPABASE_URL.includes('seu-projeto'), 'placeholder Supabase URL still present');
  });

  await test('AuthManager loads, signs out, and handles empty authenticated response', async () => {
    global.localStorage = makeLocalStorage({
      'supabase.auth.token': JSON.stringify({
        access_token: 'token',
        user: { id: 'u1', email: 'teacher@example.com' },
      }),
    });
    global.fetch = async () => ({
      ok: true,
      headers: { get: () => '' },
      text: async () => '',
    });

    delete require.cache[require.resolve(path.join(root, 'js/auth.js'))];
    const { AuthManager } = require(path.join(root, 'js/auth.js'));
    const auth = new AuthManager({
      API_URL: 'https://example.supabase.co/rest/v1',
      AUTH_URL: 'https://example.supabase.co/auth/v1',
      SUPABASE_ANON_KEY: 'anon',
    });

    assert(auth.isAuthenticated(), 'session should load from localStorage');
    const response = await auth.authenticatedRequest('/exams?id=eq.1', { method: 'DELETE' });
    assert(response === '', 'empty text response should be returned');
    await auth.signOut();
    assert(!auth.isAuthenticated(), 'signOut should clear session');

    delete global.fetch;
    delete global.localStorage;
  });

  await test('editor supports every expected question type', () => {
    const editor = read('editor.html');
    questionTypes.forEach((type) => {
      assert(editor.includes(`value="${type}"`) || editor.includes(`${type}:`), `${type} missing in editor`);
      assert(editor.includes(`q.type === '${type}'`) || editor.includes(`type: '${type}'`), `${type} render/template missing`);
    });
    assert(editor.includes('saveQuestionToBank'), 'question bank save function missing');
    assert(editor.includes('loadQuestionBank'), 'question bank search function missing');
    assert(editor.includes('questionBankModal'), 'question bank modal missing');
    assert(editor.includes('editBankQuestion'), 'question bank edit action missing');
    assert(editor.includes('deleteBankQuestion'), 'question bank delete action missing');
    assert(editor.includes('toggleBankQuestionVisibility'), 'question bank visibility action missing');
    assert(editor.includes('handleQuestionBankAction'), 'question bank delegated action handler missing');
    assert(editor.includes('data-bank-action="insert"'), 'question bank insert action data attribute missing');
    assert(editor.includes('data-bank-action="visibility"'), 'question bank visibility data attribute missing');
    assert(editor.includes('Questão pública'), 'public question label missing');
    assert(editor.includes('Criada por você'), 'own question label missing');
    assert(editor.includes('readImageFile'), 'image upload helper missing');
    assert(editor.includes('STORAGE_KEY_BASE'), 'base draft storage key missing');
    assert(editor.includes('useUserDraftStorage'), 'user-scoped draft storage missing');
    assert(editor.includes('resetStateToDefault'), 'draft reset helper missing');
    assert(editor.includes('applyReviewLock'), 'review lock helper missing');
    assert(editor.includes("['aprovada', 'bloqueada']"), 'approved/blocked lock statuses missing');
    assert(editor.includes('correctOption'), 'multiple choice correct option missing');
    assert(editor.includes('Adicionar alternativa'), 'multiple choice add option action missing');
    assert(editor.includes('Adicionar afirmação'), 'true/false add item action missing');
    assert(editor.includes("item.answer = 'V'"), 'true/false answer V missing');
    assert(editor.includes("item.answer = 'F'"), 'true/false answer F missing');
    assert(editor.includes('Adicionar item'), 'mark-x add item action missing');
    assert(editor.includes('item.checked'), 'mark-x checked answer missing');
    assert(editor.includes('markLayout'), 'mark-x layout setting missing');
    assert(editor.includes('Duas colunas'), 'mark-x two-column option missing');
    assert(editor.includes('mark-grid two-columns'), 'mark-x two-column class missing');
    assert(editor.includes('normalizeLacunasQuestion'), 'fill-blanks normalizer missing');
    assert(editor.includes('Adicionar lacuna'), 'fill-blanks add blank action missing');
    assert(editor.includes('Frases com lacunas'), 'fill-blanks multi sentence editor missing');
    assert(editor.includes('Hoje tivemos que __________ depois do meio dia pois nos atrasamos.'), 'fill-blanks example sentence missing');
    assert(editor.includes('normalizeRelacioneImagensQuestion'), 'image-word match normalizer missing');
    assert(editor.includes('Adicionar par imagem-palavra'), 'image-word add pair action missing');
    assert(editor.includes('Embaralhar palavras'), 'image-word shuffle action missing');
    assert(editor.includes('wordOrder'), 'image-word order missing');
    assert(editor.includes('answerStyle'), 'discursive answer style missing');
    assert(editor.includes('Linhas pautadas'), 'discursive ruled lines option missing');
    assert(editor.includes('Caixa de resposta'), 'discursive answer box option missing');
    assert(editor.includes('Espaco em branco'), 'discursive blank space option missing');
    assert(editor.includes('imageAnswerType'), 'image answer type missing');
    assert(editor.includes('Tipo de resposta da imagem'), 'image answer type control missing');
    assert(editor.includes('Alternativas da imagem'), 'image multiple-choice options missing');
    assert(editor.includes('Itens para marcar'), 'image mark-x items missing');
    assert(editor.includes('imageSize'), 'image size control missing');
    assert(editor.includes('imageAlign'), 'image alignment control missing');
    assert(editor.includes('imageCaption'), 'image caption control missing');
    assert(editor.includes('Largura total'), 'image full width option missing');
    assert(editor.includes('pvChipScoreStatus'), 'score status chip missing');
    assert(editor.includes('Pontuacao confere'), 'score match message missing');
    assert(editor.includes('ponto(s) ${direction} do total'), 'score mismatch warning missing');
    assert(editor.includes('collapsedQuestions'), 'collapsed questions state missing');
    assert(editor.includes('toggleQuestionCollapsed'), 'question collapse toggle missing');
    assert(editor.includes('Recolher'), 'collapse question action missing');
    assert(editor.includes('Expandir'), 'expand question action missing');
    assert(editor.includes('instructionTemplates'), 'instruction templates missing');
    assert(editor.includes('instructionTemplate'), 'instruction template selector missing');
    assert(editor.includes('Prova padrão'), 'default instruction template missing');
    assert(editor.includes('Recuperação'), 'recovery instruction template missing');
  });

  await test('question bank search listener is attached after function declaration', () => {
    const editor = read('editor.html');
    const functionIndex = editor.indexOf('async function loadQuestionBank()');
    const listenerIndex = editor.indexOf("addEventListener('click', loadQuestionBank)");
    assert(functionIndex !== -1, 'loadQuestionBank function missing');
    assert(listenerIndex !== -1, 'loadQuestionBank click listener missing');
    assert(listenerIndex > functionIndex, 'loadQuestionBank listener is attached before the function exists');
  });

  await test('editor does not overwrite exam owner when saving existing exam', () => {
    const editor = read('editor.html');
    const patchIndex = editor.indexOf('if (currentExamId)');
    const createIndex = editor.indexOf('payload.user_id = auth.getCurrentUser().id');
    assert(patchIndex !== -1, 'currentExamId save branch missing');
    assert(createIndex !== -1, 'new exam user_id assignment missing');
    assert(createIndex > patchIndex, 'user_id should only be assigned inside new exam branch');
    assert(editor.includes('currentExamOwnerId'), 'current exam owner tracking missing');
    assert(editor.includes('currentReviewNotes'), 'review notes state missing');
    assert(editor.includes('getReviewPayloadForSave'), 'review payload helper missing');
  });

  await test('print page renders image-based question types', () => {
    const print = read('print.html');
    ['imagem', 'relacione_imagens'].forEach((type) => {
      assert(print.includes(`q.type === '${type}'`), `${type} missing in print renderer`);
    });
    assert(print.includes('renderAnswerKey'), 'print answer key renderer missing');
    assert(print.includes('gabarito'), 'print answer key query toggle missing');
    assert(print.includes("q.type === 'vf'"), 'print true/false renderer missing');
    assert(print.includes("item.answer ? `${i + 1}-${item.answer}`"), 'print true/false answer key missing');
    assert(print.includes("q.type === 'marcarx'"), 'print mark-x renderer missing');
    assert(print.includes('!!item.checked'), 'print mark-x answer key missing');
    assert(print.includes('mark-grid two-columns'), 'print mark-x two-column layout missing');
    assert(print.includes("q.type === 'relacione'"), 'print match-columns renderer missing');
    assert(print.includes('relacioneAnswer'), 'print match-columns answer key missing');
    assert(print.includes('rightOrder'), 'print match-columns order missing');
    assert(print.includes("q.type === 'lacunas'"), 'print fill-blanks renderer missing');
    assert(print.includes('normalizeLacunasQuestion'), 'print fill-blanks normalizer missing');
    assert(print.includes('answerArea'), 'print answer area helper missing');
    assert(print.includes("style === 'caixa'"), 'print answer box style missing');
    assert(print.includes("style === 'espaco'"), 'print blank answer style missing');
    assert(print.includes('imageAnswerType'), 'print image answer type missing');
    assert(print.includes("q.type === 'imagem' && q.imageAnswerType === 'multipla'"), 'print image multiple-choice answer key missing');
    assert(print.includes("q.type === 'imagem' && q.imageAnswerType === 'marcarx'"), 'print image mark-x answer key missing');
    assert(print.includes('imageFigure'), 'print image figure helper missing');
    assert(print.includes('image-caption'), 'print image caption missing');
    assert(print.includes('relacioneImagensAnswer'), 'print image-word answer key missing');
    assert(print.includes('wordOrder'), 'print image-word order missing');
    assert(print.includes('STORAGE_KEY_BASE'), 'print page should use base draft key');
    assert(print.includes('${STORAGE_KEY_BASE}:${auth.getCurrentUser().id}'), 'print page should read user-scoped draft key');
  });

  await test('editor supports structured match-column questions', () => {
    const editor = read('editor.html');
    assert(editor.includes('normalizeRelacioneQuestion'), 'match-column normalizer missing');
    assert(editor.includes('pairs: ['), 'match-column structured pairs missing');
    assert(editor.includes('rightOrder'), 'match-column answer order missing');
    assert(editor.includes('Adicionar par'), 'match-column add pair button missing');
    assert(editor.includes('Embaralhar coluna B'), 'match-column shuffle button missing');
    assert(editor.includes('Pares corretos'), 'match-column editing label missing');
  });

  await test('Supabase SQL includes idempotent policies and question bank', () => {
    const sql = read('setup_supabase.sql');
    assert(sql.includes('CREATE TABLE IF NOT EXISTS question_bank'), 'question_bank table missing');
    assert(sql.includes('DROP POLICY IF EXISTS "Banco de questões: ver próprias ou públicas"'), 'question_bank policy is not idempotent');
    assert(sql.includes('review_status TEXT DEFAULT'), 'exam review_status column missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.is_coordinator_or_admin()'), 'coordinator/admin helper function missing');
    assert(sql.includes('public.is_coordinator_or_admin()'), 'coordinator/admin role policy missing');
    assert(sql.includes('DROP TRIGGER IF EXISTS on_auth_user_created'), 'trigger drop missing');
  });

  await test('coordination page has review actions', () => {
    const page = read('coordenacao.html');
    ['approveExam', 'returnExam', 'blockExam', 'updateReviewStatus'].forEach((name) => {
      assert(page.includes(name), `${name} missing in coordination page`);
    });
    assert(page.includes("profile?.role"), 'coordination role guard missing');
    assert(page.includes('Observação registrada'), 'coordination review note display missing');
  });

  await test('teacher dashboard shows returned review notes', () => {
    const dashboard = read('dashboard.html');
    assert(dashboard.includes('Devolutiva da coordenação'), 'dashboard returned note display missing');
    assert(dashboard.includes('review_notes'), 'dashboard review_notes field missing');
  });

  await test('local HTTP server returns 200 for public pages', async () => {
    const server = await startServer();
    const port = server.address().port;
    try {
      for (const page of htmlFiles) {
        const status = await requestStatus(port, page);
        assert(status === 200, `${page} returned ${status}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
