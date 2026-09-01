const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['index.html', 'login.html', 'dashboard.html', 'editor.html', 'print.html', 'coordenacao.html', 'schools.html', 'impressao.html', 'master.html'];
const jsFiles = ['config.js', 'js/auth.js'];
const questionTypes = [
  'multipla',
  'discursiva',
  'vf',
  'marcarx',
  'lacunas',
  'relacione',
  'imagem',
  'interpretacao_imagem',
  'relacione_imagens',
  'texto_base',
  'matematica_coluna',
  'ditado',
  'caca_palavras',
  'cruzadinha',
  'ordenacao',
  'problema_matematico',
  'espaco_livre',
  'tabela',
  'associacao_setas',
  'sequencia_numerica',
  'leitura_escrita',
  'silabas',
  'sequencia_imagens',
  'comparar_imagens',
  'legenda_imagens',
  'associacao_imagem_imagem',
  'grade_imagens',
  'identificar_imagem',
  'subitens',
  'expressao_matematica',
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
    [...htmlFiles, ...jsFiles, 'setup_supabase.sql', 'CLAUDE.md', '.env.example', 'SEGURANCA_BACKUP_ESCALA.md', '.github/workflows/supabase-keepalive.yml'].forEach((file) => {
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

  await test('security operation files avoid private credentials', () => {
    const envExample = read('.env.example');
    const gitignore = read('.gitignore');
    const guide = read('SEGURANCA_BACKUP_ESCALA.md');

    assert(envExample.includes('SUPABASE_URL=https://seu-projeto.supabase.co'), '.env.example should use placeholder URL');
    assert(envExample.includes('SUPABASE_ANON_KEY=cole-a-anon-key-publica-aqui'), '.env.example should use placeholder anon key');
    assert(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(envExample), '.env.example should not contain JWT values');
    assert(gitignore.split(/\r?\n/).includes('.env'), '.gitignore should ignore .env');
    assert(gitignore.split(/\r?\n/).includes('.env.local'), '.gitignore should ignore .env.local');
    assert(!gitignore.split(/\r?\n/).includes('.env.example'), '.gitignore should keep .env.example trackable');
    assert(guide.includes('Seguranca') && guide.includes('Backup') && guide.includes('Escala'), 'security guide should cover security, backup and scale');
    assert(guide.includes('SECURITY DEFINER'), 'security guide should call out SECURITY DEFINER review');
    assert(guide.includes('select=*') && guide.includes('paginacao'), 'security guide should document scale risks');
  });

  await test('Supabase keepalive workflow is safe to publish', () => {
    const workflow = read('.github/workflows/supabase-keepalive.yml');

    assert(workflow.includes('schedule:'), 'keepalive workflow should run on a schedule');
    assert(workflow.includes('workflow_dispatch:'), 'keepalive workflow should allow manual run');
    assert(workflow.includes('secrets.SUPABASE_URL'), 'keepalive workflow should use SUPABASE_URL secret');
    assert(workflow.includes('secrets.SUPABASE_ANON_KEY'), 'keepalive workflow should use SUPABASE_ANON_KEY secret');
    assert(workflow.includes('/rest/v1/profiles?select=id&limit=1'), 'keepalive workflow should query a small profiles payload');
    assert(!/https:\/\/[^\s"']+\.supabase\.co/.test(workflow), 'keepalive workflow should not hardcode a Supabase project URL');
    assert(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(workflow), 'keepalive workflow should not contain JWT values');
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
    assert(editor.includes('changeBankQuestionScope'), 'question bank scope action missing');
    assert(editor.includes('toggleBankQuestionVisibility'), 'legacy question bank visibility action missing');
    assert(editor.includes('handleQuestionBankAction'), 'question bank delegated action handler missing');
    assert(editor.includes('data-bank-action="insert"'), 'question bank insert action data attribute missing');
    assert(editor.includes('bankSaveScope'), 'question bank save scope control missing');
    assert(editor.includes('bankScopeFilter'), 'question bank scope filter missing');
    assert(editor.includes('data-bank-scope-action'), 'question bank scope select data attribute missing');
    assert(editor.includes('bankScopeLabel(scope)'), 'question bank scope label missing');
    assert(editor.includes('Criada por voce'), 'own question label missing');
    assert(editor.includes('readImageFile'), 'image upload helper missing');
    assert(editor.includes('MAX_IMAGE_FILE_BYTES'), 'editor image upload should reject oversized source files');
    assert(editor.includes('SAFE_IMAGE_DATA_URL_RE'), 'editor should validate image data URLs');
    assert(editor.includes('safeImageAttr'), 'editor should render images through a safe src helper');
    assert(!editor.includes('gerador-provas-state-v1'), 'editor should not use local browser draft storage');
    assert(!editor.includes('loadSavedState'), 'editor should not restore local browser drafts');
    assert(editor.includes('initializeNewExamState'), 'editor should initialize new exams without local draft restore');
    assert(editor.includes('resetStateToDefault'), 'draft reset helper missing');
    assert(!editor.includes('defaultQuestions'), 'new exams should start empty without default example questions');
    assert(!editor.includes('Exemplo de questão'), 'editor should not seed example questions');
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
    assert(editor.includes('Interpretação de imagem'), 'image interpretation type label missing');
    assert(editor.includes('Perguntas sobre a imagem'), 'image interpretation prompts editor missing');
    assert(editor.includes('+ Adicionar pergunta'), 'image interpretation add prompt action missing');
    assert(editor.includes('Grade de imagens'), 'image grid type label missing');
    assert(editor.includes('gradeDisplayMode'), 'image grid display mode missing');
    assert(editor.includes('+ Imagem na grade'), 'image grid add action missing');
    assert(editor.includes('grade-img-grid'), 'image grid preview class missing');
    assert(editor.includes('Identificar partes da imagem'), 'identify image type label missing');
    assert(editor.includes('+ Parte numerada'), 'identify image add marker action missing');
    assert(editor.includes('identify-marker'), 'identify image marker class missing');
    assert(editor.includes('showAnswerList'), 'identify image answer list setting missing');
    assert(editor.includes('imageSize'), 'image size control missing');
    assert(editor.includes('imageAlign'), 'image alignment control missing');
    assert(editor.includes('imageCaption'), 'image caption control missing');
    assert(editor.includes('Largura total'), 'image full width option missing');
    assert(editor.includes('pvChipScoreStatus'), 'score status chip missing');
    assert(editor.includes('Pontuacao confere'), 'score match message missing');
    assert(editor.includes('ponto(s) ${direction} do total'), 'score mismatch warning missing');
    assert(editor.includes('collapsedQuestions'), 'collapsed questions state missing');
    assert(editor.includes('toggleQuestionCollapsed'), 'question collapse toggle missing');
    assert(editor.includes('collapseAllQuestions'), 'cloud-loaded exams should start with questions collapsed');
    assert(editor.includes('Recolher'), 'collapse question action missing');
    assert(editor.includes('Expandir'), 'expand question action missing');
    assert(editor.includes('instructionTemplates'), 'instruction templates missing');
    assert(editor.includes('instructionTemplate'), 'instruction template selector missing');
    assert(editor.includes('function applyInstructionTemplate'), 'instruction template changes should use a dedicated apply function');
    assert(editor.includes('applyInstructionTemplate(event.target.value)'), 'instruction template selector should apply the selected template');
    assert(editor.includes('const instructionText = instructionTemplates[templateKey]'), 'instruction template apply function should read the selected template text');
    assert(editor.includes("el('instructions').value = instructionText"), 'instruction template should update the instructions textarea');
    assert(editor.includes('syncSchoolFromInputs();\r\n      renderPreview();\r\n      saveState();') || editor.includes('syncSchoolFromInputs();\n      renderPreview();\n      saveState();'), 'instruction template should sync, preview, and autosave');
    assert(editor.includes('Prova padrão'), 'default instruction template missing');
    assert(editor.includes('Recuperação'), 'recovery instruction template missing');
    assert(editor.includes('buildWordSearch'), 'word search generator missing');
    assert(editor.includes('renderWordSearch'), 'word search renderer missing');
    assert(editor.includes('app-sidebar') && editor.includes('Editor de provas'), 'editor should use module sidebar navigation');
    assert(editor.includes('applyModuleNavigation'), 'editor should apply module navigation permissions');
    assert(editor.includes('showWordList'), 'word search word-list visibility option missing');
    assert(editor.includes('Mostrar legenda de palavras'), 'word search legend visibility control missing');
    assert(editor.includes('math-division-svg'), 'math column division SVG layout missing');
    assert(editor.includes('divisionOp'), 'math column division renderer missing');
    assert(editor.includes('width="${width}" height="${height}"'), 'math column division SVG should not stretch to full card width');
    assert(editor.includes('x2="${leftW}" y2="38"'), 'math column division vertical key should stop at the horizontal bar');
    assert(editor.includes('buildCrossword'), 'crossword grid generator missing');
    assert(editor.includes('renderCrossword'), 'crossword renderer missing');
    assert(editor.includes('Horizontais'), 'crossword horizontal clues missing');
    assert(editor.includes('Verticais'), 'crossword vertical clues missing');
    assert(editor.includes('crosswordSeed'), 'crossword reorder seed missing');
    assert(editor.includes('Reordenar cruzadinha'), 'crossword reorder button missing');
    assert(editor.includes('caca_palavras'), 'word search type missing');
    assert(editor.includes('cruzadinha'), 'crossword type missing');
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
    assert(print.includes("q.type === 'interpretacao_imagem'"), 'print image interpretation renderer missing');
    assert(print.includes("q.type === 'grade_imagens'"), 'print image grid renderer missing');
    assert(print.includes('grade-img-grid'), 'print image grid class missing');
    assert(print.includes("q.type === 'identificar_imagem'"), 'print identify image renderer missing');
    assert(print.includes('identify-marker'), 'print identify image marker class missing');
    assert(print.includes('imageFigure'), 'print image figure helper missing');
    assert(print.includes('safeImageAttr') && print.includes('SAFE_IMAGE_DATA_URL_RE'), 'print page should render only safe image data URLs');
    assert(print.includes('image-caption'), 'print image caption missing');
    assert(print.includes('relacioneImagensAnswer'), 'print image-word answer key missing');
    assert(print.includes('wordOrder'), 'print image-word order missing');
    assert(print.includes('renderWordSearch'), 'print word search renderer missing');
    assert(print.includes('showWordList === false'), 'print word search should allow hiding word list');
    assert(print.includes('math-division-svg'), 'print math division SVG layout missing');
    assert(print.includes('divisionOp'), 'print math division renderer missing');
    assert(print.includes('width="${width}" height="${height}"'), 'print math division SVG should not stretch to full card width');
    assert(print.includes('x2="${leftW}" y2="37"'), 'print math division vertical key should stop at the horizontal bar');
    assert(print.includes('buildCrossword'), 'print crossword grid generator missing');
    assert(print.includes('renderCrossword'), 'print crossword renderer missing');
    assert(!print.includes('STORAGE_KEY_BASE'), 'print page should not use local draft storage');
    assert(print.includes('Nenhuma prova selecionada'), 'print page should ask for a selected/saved exam when no id is provided');
  });

  await test('editor supports structured match-column questions', () => {
    const editor = read('editor.html');
    assert(editor.includes('normalizeRelacioneQuestion'), 'match-column normalizer missing');
    assert(editor.includes('pairs: ['), 'match-column structured pairs missing');
    assert(editor.includes('rightOrder'), 'match-column answer order missing');
    assert(editor.includes('Adicionar par'), 'match-column add pair button missing');
    assert(editor.includes('Embaralhar lado direito'), 'match-column shuffle button missing');
    assert(editor.includes('Pares corretos'), 'match-column editing label missing');
    assert(editor.includes('connect-match'), 'match-column line connector layout missing');
    assert(editor.includes('connect-dot'), 'match-column connector dots missing');
  });

  await test('Supabase SQL includes idempotent policies and question bank', () => {
    const sql = read('setup_supabase.sql');
    assert(sql.includes('CREATE TABLE IF NOT EXISTS question_bank'), 'question_bank table missing');
    assert(sql.includes('DROP POLICY IF EXISTS "Banco de questões: ver próprias ou públicas"'), 'question_bank policy is not idempotent');
    assert(sql.includes('review_status TEXT DEFAULT'), 'exam review_status column missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.is_coordinator_or_admin()'), 'coordinator/admin helper function missing');
    assert(sql.includes('public.is_coordinator_or_admin()'), 'coordinator/admin role policy missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.normalized_role(raw_role TEXT)'), 'normalized role helper function missing');
    assert(sql.includes("WHEN 'admin' THEN 'master'"), 'legacy admin role should normalize to master');
    assert(sql.includes("WHEN 'coordenadora' THEN 'coordinator'"), 'legacy coordinator role should normalize to coordinator');
    assert(sql.includes("WHEN 'professor' THEN 'teacher'"), 'legacy professor role should normalize to teacher');
    assert(sql.includes("WHEN 'impressao' THEN 'print_operator'"), 'legacy print role should normalize to print_operator');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.is_master()'), 'master helper function missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.is_school_owner'), 'school owner helper function missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.can_manage_school'), 'school management helper function missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.can_manage_profile'), 'profile management helper function missing');
    assert(sql.includes("public.normalized_role(target_profile.role) IN ('coordinator', 'teacher', 'print_operator')"), 'school owner should manage only school staff roles');
    assert(sql.includes("public.normalized_role(target_profile.role) = 'teacher'"), 'coordinator should manage only teachers');
    assert(sql.includes('WITH CHECK (public.is_master() OR public.can_manage_profile(id))'), 'profile manager updates should validate final profile state');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.can_review_exam'), 'exam review helper function missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.prevent_empty_exam_review'), 'Supabase should block empty exams from entering review statuses');
    assert(sql.includes('prevent_empty_exam_review_before_write'), 'empty exam review trigger missing');
    assert(sql.includes("COALESCE(NEW.review_status, 'rascunho') IN ('enviada', 'em_revisao', 'aprovada')"), 'empty exam trigger should guard review statuses');
    assert(sql.includes('public.exam_questions_count(NEW.questions) = 0'), 'empty exam trigger should count JSONB questions');
    assert(/UPDATE exams\r?\nSET review_status = 'rascunho'/.test(sql), 'setup SQL should reset already-sent empty exams');
    assert(sql.includes('DROP TRIGGER IF EXISTS on_auth_user_created'), 'trigger drop missing');
    assert(sql.includes('review_history'), 'review_history column missing');
    assert(sql.includes('CREATE TABLE IF NOT EXISTS schools'), 'schools table missing');
    assert(sql.includes("classes JSONB DEFAULT '[]'") && sql.includes("ALTER TABLE schools ADD COLUMN IF NOT EXISTS classes JSONB DEFAULT '[]'"), 'schools classes column missing');
    assert(sql.includes('school_id'), 'school_id in profiles missing');
    assert(!/CREATE TABLE IF NOT EXISTS profiles[\s\S]*?\);[\s\S]*?school_name TEXT/.test(sql.split('-- 2. Tabela de provas')[0]), 'profiles should not keep legacy school_name column');
    assert(sql.includes('ALTER TABLE profiles DROP COLUMN IF EXISTS school_name'), 'setup SQL should drop legacy profile school_name');
    assert(sql.includes('INSERT INTO public.profiles (id, email, full_name)'), 'new auth profiles should be created without school_name');
    assert(sql.includes('ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS school_id'), 'question bank school scope column missing');
    assert(sql.includes('CREATE TABLE IF NOT EXISTS user_invites'), 'user invite table missing');
    assert(sql.includes('canceled_by UUID REFERENCES auth.users') && sql.includes('canceled_at TIMESTAMPTZ'), 'user invites should keep cancellation metadata');
    assert(sql.includes('ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS canceled_at'), 'canceled_at migration missing');
    assert(sql.includes('AND canceled_at IS NULL'), 'accept invite should reject canceled invites');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.accept_user_invite'), 'accept invite RPC missing');
    assert(sql.includes('token TEXT UNIQUE'), 'invite token column missing');
    assert(sql.includes('profiles_manager_roles_require_school'), 'manager profile roles should require school constraint');
    assert(sql.includes("public.normalized_role(role) NOT IN ('school_owner', 'coordinator', 'print_operator')"), 'owner/coordinator/print profiles should require school_id');
    assert(sql.includes('user_invites_school_roles_require_school'), 'school invite roles should require school constraint');
    assert(sql.includes("role NOT IN ('teacher', 'coordinator', 'school_owner', 'print_operator', 'impressao')"), 'school invites should require school_id');
    assert(sql.includes('NOT VALID'), 'new constraints should avoid blocking existing data during migration');
    assert(sql.includes("public.normalized_role(role) IN ('teacher', 'coordinator', 'print_operator')"), 'school owner invite role restriction missing');
    assert(sql.includes("public.current_user_role() = 'coordinator'") && sql.includes("public.normalized_role(role) = 'teacher'"), 'coordinator should only manage teacher invites');
    assert(sql.includes("set_config('app.accepting_invite', 'true', TRUE)"), 'accept invite should bypass self-managed field trigger intentionally');
    assert(sql.includes("current_setting('app.accepting_invite', TRUE)"), 'profile managed fields trigger should recognize invite acceptance');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.grade_list_contains_class'), 'grade/class review scope helper missing');
    assert(sql.includes("public.grade_list_contains_class(current_profile.school_grade, exam.class_name)"), 'coordinator review access should be limited by assigned grades');
    assert(sql.includes("public.normalized_role(current_profile.role) = 'school_owner'"), 'school owner should keep full school review access');
    assert(sql.includes('print_status TEXT DEFAULT') && sql.includes('print_copies INTEGER') && sql.includes('print_notes TEXT'), 'print queue columns missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.can_print_exam'), 'print access helper missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.mark_exam_printed'), 'mark printed RPC missing');
    assert(sql.includes('CREATE OR REPLACE FUNCTION public.prevent_invalid_print_request'), 'Supabase should block invalid print requests');
    assert(sql.includes('prevent_invalid_print_request_before_write'), 'invalid print request trigger missing');
    assert(sql.includes("COALESCE(NEW.print_status, 'nao_enviada') IN ('enviada', 'impressa')"), 'print trigger should guard printed/pending statuses');
    assert(sql.includes("COALESCE(NEW.review_status, 'rascunho') <> 'aprovada'"), 'print trigger should require approved exams');
    assert(/UPDATE exams\r?\nSET print_status = 'nao_enviada'/.test(sql), 'setup SQL should reset invalid print requests');
    assert(sql.includes('NEW.print_copies = GREATEST(1, COALESCE(NEW.print_copies, 1))'), 'print trigger should normalize copy count');
    assert(sql.includes("public.normalized_role(current_profile.role) IN ('school_owner', 'print_operator')"), 'print queue access should include school owners and print operators');
    assert(sql.includes('force_password_change'), 'forced password change flag missing');
    assert(sql.includes('admin_reset_user_password'), 'admin password reset RPC missing');
    assert(sql.includes("extensions.crypt('123456', extensions.gen_salt('bf'))"), 'admin password reset should set temporary password 123456 with Supabase pgcrypto schema');
    assert(sql.includes('raw_user_meta_data') && sql.includes('"force_password_change": true'), 'admin password reset should mark Auth metadata for forced password change');
    assert(sql.includes("FOR DELETE USING (") && sql.includes("COALESCE(review_status, 'rascunho') NOT IN ('aprovada', 'bloqueada')"), 'approved/blocked exams should not be deletable by teacher');
    assert(sql.includes('protect_profile_managed_fields'), 'profile managed fields protection trigger missing');
    assert(sql.includes('NEW.school_id = OLD.school_id'), 'profile school_id should be protected from self updates');
    assert(sql.includes('NEW.school_grade = OLD.school_grade'), 'profile school_grade should be protected from self updates');
    assert(sql.includes('NEW.disciplines = OLD.disciplines'), 'profile disciplines should be protected from self updates');
    assert(sql.includes('FOR INSERT WITH CHECK (public.is_master())'), 'only master should create schools');
    assert(sql.includes('FOR DELETE USING (public.is_master())'), 'only master should delete schools');
    assert(sql.includes("SET role = 'master'") && sql.includes("WHERE email = 'yesley@msn.com'"), 'initial owner should be promoted to master');
  });

  await test('AuthManager exposes access profile helpers', () => {
    const auth = read('js/auth.js');
    assert(auth.includes('normalizeRole(role)'), 'role normalizer missing');
    assert(auth.includes("admin: 'master'"), 'admin alias missing');
    assert(auth.includes("coordenadora: 'coordinator'"), 'coordinator alias missing');
    assert(auth.includes("professor: 'teacher'"), 'teacher alias missing');
    assert(auth.includes("impressao: 'print_operator'"), 'print alias missing');
    assert(auth.includes('async loadCurrentProfile'), 'current profile loader missing');
    assert(auth.includes('canManageSchools'), 'school management helper missing');
    assert(auth.includes('canManageUsers'), 'user management helper missing');
    assert(auth.includes('canReviewExams'), 'exam review helper missing');
    assert(auth.includes('canAccessPrintQueue'), 'print queue helper missing');
    assert(auth.includes('canEditExam'), 'exam edit helper missing');
    assert(auth.includes('canDeleteExam'), 'exam delete helper missing');
    assert(auth.includes('canManageQuestionBank'), 'question bank helper missing');
  });

  await test('editor organizes question card into labelled sections', () => {
    const editor = read('editor.html');
    assert(editor.includes('prop-sec'), 'prop-sec section header class missing');
    assert(editor.includes("secEnun.textContent = 'Enunciado'"), 'Enunciado section header missing');
    assert(editor.includes("secContent.textContent = 'Conteúdo'"), 'Conteúdo section header missing');
    assert(editor.includes("secPontuacao.textContent = 'Pontuação e configurações'"), 'Pontuação section header missing');
  });

  await test('editor supports extra images in imagem type', () => {
    const editor = read('editor.html');
    assert(editor.includes('extraImages'), 'extraImages field missing in editor');
    assert(editor.includes('Adicionar imagem extra'), 'extra image add button missing');
    assert(editor.includes('Imagens adicionais'), 'extra images label missing');
  });

  await test('print page supports extra images in imagem type', () => {
    const print = read('print.html');
    assert(print.includes('extraImages'), 'extraImages field missing in print');
    assert(print.includes('extraImgsHtml'), 'extra images HTML var missing');
  });

  await test('editor supports freely positioned images per question', () => {
    const editor = read('editor.html');
    const print = read('print.html');
    assert(editor.includes('q.freeImages'), 'editor should store free images on each question');
    assert(editor.includes('Imagem livre'), 'editor should expose free image action');
    assert(editor.includes('readImageFile(file, (dataUrl) => {'), 'free image upload should use compressed image reader');
    assert(editor.includes('function buildFreeImagesHtml'), 'editor should render free images');
    assert(editor.includes('function initFreeImageInteractions'), 'editor should allow free image interaction');
    assert(editor.includes('free-image-resize'), 'editor should expose resize handle');
    assert(editor.includes('free-image-remove'), 'editor should expose remove button');
    assert(editor.includes('shape-outside: margin-box;'), 'free images should make text flow around them');
    assert(editor.includes("img.align = moveEvent.clientX > blockRect.left + blockRect.width / 2 ? 'right' : 'left';"), 'dragging should move free image between text-flow sides');
    assert(editor.includes('img.offsetY = Math.max(0, Math.min(500, base.offsetY + dy));'), 'dragging should allow vertical free image movement');
    assert(print.includes('function buildFreeImagesHtml'), 'print page should render free images');
    assert(print.includes('.free-image-item.right'), 'print page should support right-aligned free images');
    assert(print.includes('margin-top:${offsetY}px;'), 'print page should preserve vertical free image offset');
    assert(print.includes('${buildFreeImagesHtml(q)}'), 'print page should place free images before flowing text');
  });

  await test('print output avoids browser header/footer metadata where possible', () => {
    const editor = read('editor.html');
    const print = read('print.html');
    assert(editor.includes('function printCleanDocument()'), 'editor should use clean print wrapper');
    assert(print.includes('function printCleanDocument()'), 'print page should use clean print wrapper');
    assert(print.includes('onclick="printCleanDocument()"'), 'print page button should call clean print wrapper');
    assert(editor.includes("document.title = ' ';"), 'editor should clear title while printing');
    assert(print.includes("document.title = ' ';"), 'print page should clear title while printing');
    assert(editor.includes('margin: 8mm 9mm 10mm 9mm;'), 'editor should use compact printable page margins');
    assert(print.includes('@page { size: A4 portrait; margin: 8mm 9mm 10mm; }'), 'print page should use compact printable page margins');
    assert(editor.includes('.question-block {\n        margin: 0 0 12px 0;') || editor.includes('.question-block {\r\n        margin: 0 0 12px 0;'), 'editor print should reduce space between questions');
    assert(print.includes('.question-block { margin: 0 0 12px; }'), 'print page should reduce space between questions');
    assert(print.includes('.qtext { margin-top: 4px; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; }'), 'print page should use compact wrapping question text');
    assert(editor.includes('overflow-wrap: anywhere; word-break: break-word; max-width: 100%;'), 'editor preview should wrap long question text');
    assert(print.includes('overflow-wrap: anywhere; word-break: break-word; max-width: 100%;'), 'print page should wrap long question text');
  });

  await test('coordination page has review history', () => {
    const page = read('coordenacao.html');
    assert(page.includes('review_history'), 'review_history missing in coordination page');
    assert(page.includes('toggleHistory'), 'history toggle function missing');
    assert(page.includes('history-log'), 'history log CSS class missing');
    assert(page.includes('openReturnModal'), 'return modal opener missing');
    assert(page.includes('returnModalOverlay'), 'return modal element missing');
  });

  await test('dashboard has term and review status filters', () => {
    const dashboard = read('dashboard.html');
    assert(dashboard.includes('termFilter'), 'term filter missing');
    assert(dashboard.includes('reviewStatusFilter'), 'review status filter missing');
    assert(dashboard.includes('currentTerm'), 'currentTerm state missing');
    assert(dashboard.includes('currentReviewStatus'), 'currentReviewStatus state missing');
    assert(dashboard.includes('schools.html'), 'schools link missing in dashboard');
    assert(dashboard.includes('auth.loadCurrentProfile'), 'dashboard should load current profile through AuthManager');
    assert(dashboard.includes('auth.canReviewExams(currentProfile)'), 'dashboard should use role helper for coordination access');
    assert(dashboard.includes('auth.canManageSchools(currentProfile)'), 'dashboard should use role helper for school access');
    assert(dashboard.includes('auth.canDeleteExam(exam, currentProfile)'), 'dashboard should use delete permission helper');
    assert(dashboard.includes('`/exams?user_id=eq.${user.id}&order=created_at.desc&select=*`'), 'dashboard should load only current user exams');
    assert(dashboard.includes('filter((exam) => exam.user_id === user.id)'), 'dashboard should defensively keep only owned exams');
    assert(dashboard.includes('navPrintLink') && dashboard.includes('auth.canAccessPrintQueue(currentProfile)'), 'dashboard should link allowed users to print queue');
    assert(dashboard.includes('app-sidebar') && dashboard.includes('Módulos do sistema'), 'dashboard should use module sidebar navigation');
    assert(dashboard.includes("auth.hasRole(['print_operator'], currentProfile)") && dashboard.includes("newExamBtn').style.display = 'none'"), 'print operators should not create exams from dashboard');
    assert(dashboard.includes('const canCreateExam = !auth.hasRole([\'print_operator\'], currentProfile)'), 'empty dashboard state should also hide creation for print operators');
    assert(!dashboard.includes('gerador-provas-state-v1'), 'new exam should not clear local browser drafts');
    assert(dashboard.includes('Enviar revisão'), 'dashboard should use a clear review action label');
    assert(!dashboard.includes('>Coord.</button>'), 'dashboard should not use abbreviated Coord. action');
    assert(!dashboard.includes('Publicar</button>'), 'dashboard should not expose a parallel publish action');
    assert(dashboard.includes("Provas aprovadas ou bloqueadas não podem ser deletadas."), 'dashboard should guard locked exam delete');
    assert(!dashboard.includes('profileGradeInput'), 'teacher profile should not expose duplicate editable grade');
    assert(dashboard.includes('Escola, série e disciplinas são definidas pela coordenação.'), 'teacher profile should clarify coordination-owned fields');
    assert(!dashboard.includes('school_name: currentProfile.school_name'), 'new exam should not use legacy profile school_name');
    assert(!dashboard.includes('school_grade: grade'), 'teacher profile save should not update coordination-owned school_grade');
    assert(dashboard.includes('function getExamQuestions(exam)'), 'dashboard should normalize exam questions before counting them');
    assert(dashboard.includes("typeof exam?.questions === 'string'"), 'dashboard should handle question payloads returned as JSON strings');
    assert(dashboard.includes('questions: getExamQuestions(exam)'), 'dashboard should normalize loaded exams before rendering actions');
    assert(dashboard.includes('if (!hasExamQuestions(exam))'), 'send-to-review should use normalized question count');
    assert(dashboard.includes('qCount > 0 && !locked && !reviewInProgress'), 'dashboard should not send empty exams to review');
  });

  await test('editor uses professor profile classes and keeps student date printable', () => {
    const editor = read('editor.html');
    const print = read('print.html');
    assert(editor.includes('<select id="className">'), 'class field should be a select in the editor');
    assert(editor.includes('currentProfile = await auth.loadCurrentProfile()'), 'editor should load current profile for school-scoped features');
    assert(editor.includes('select=full_name,school_id,school_grade,disciplines'), 'editor profile defaults should depend on school_id, not profile school_name');
    assert(!editor.includes('profile.school_name'), 'editor should not fall back to legacy profile school_name');
    assert(editor.includes('buildBankScopePayload(scope)'), 'editor should save question bank scope through scope payload helper');
    assert(editor.includes('school_id: currentProfile.school_id'), 'editor should save school scope on question bank items when available');
    assert(editor.includes('school_grade,disciplines'), 'editor profile query should fetch teacher grade/classes');
    assert(editor.includes('function normalizeClassList'), 'editor should normalize one or many profile classes');
    assert(editor.includes('function setClassOptions'), 'editor should populate class options');
    assert(editor.includes('if (unique.length === 1 && !current) state.school.className = unique[0];'), 'single class should be selected automatically');
    assert(editor.includes("subject: '',"), 'default subject should be empty so the placeholder is not a selectable discipline');
    assert(editor.includes('function isPlaceholderDiscipline'), 'editor should detect placeholder discipline names');
    assert(editor.includes("['disciplina', 'diciplina', 'selecionar disciplina']"), 'editor should filter placeholder and typo discipline labels');
    assert(editor.includes('function normalizeDisciplineList'), 'editor should clean profile/school discipline lists');
    assert(editor.includes('const currentVal = isPlaceholderDiscipline(state.school.subject) ?'), 'editor should not re-add placeholder subject as an option');
    assert(!editor.includes('profileInfo'), 'editor should not show profile summary under the exam editor title');
    assert(!editor.includes('Dados incorretos? Atualize seu perfil'), 'editor should not show profile maintenance link inside the exam form');
    assert(!editor.includes('logoUploadFallback'), 'editor should not show logo fallback upload inside the removed profile summary');
    assert(!editor.includes('id="date"'), 'date should not be editable in the editor form');
    assert(editor.includes("el('pvDate').textContent = state.school.date ? state.school.date : '____/____/______';"), 'editor preview should keep student date placeholder');
    assert(print.includes("exam.date || '____/____/______'"), 'print page should keep student date placeholder');
    assert(editor.indexOf('<label>Valor total</label>') > editor.indexOf('<label>Bimestre/Etapa</label>'), 'total value should remain in the metadata editor after term');
  });

  await test('new exam flow does not use local browser drafts', () => {
    const editor = read('editor.html');
    const dashboard = read('dashboard.html');
    const index = read('index.html');
    const login = read('login.html');
    const print = read('print.html');
    assert(index.includes('href="login.html?return_to=editor.html%3Fnew%3D1"'), 'home create action should require login with editor return');
    assert(dashboard.includes('id="newExamModal"'), 'dashboard should ask for subject/class before creating a new exam');
    assert(dashboard.includes('id="newExamSubject"') && dashboard.includes('id="newExamClass"'), 'new exam modal should collect subject and class');
    assert(dashboard.includes('return uniqueCleanList(currentProfile.disciplines, { discipline: true });'), 'new exam modal should only list disciplines linked to the logged-in profile');
    assert(dashboard.includes('Nenhuma disciplina vinculada'), 'new exam modal should explain when the profile has no linked disciplines');
    assert(dashboard.includes('subjectSelect.disabled = disciplines.length === 0'), 'new exam subject select should be disabled without linked disciplines');
    assert(dashboard.includes('classSelect.disabled = classes.length === 0'), 'new exam class select should be disabled without linked classes');
    assert(dashboard.includes('Peca para a coordenacao vincular'), 'new exam modal should explain missing profile links before creation');
    assert(dashboard.includes('confirmBtn.disabled = !canCreate'), 'new exam create action should be disabled until profile links are ready');
    assert(dashboard.indexOf("newExamBtn').addEventListener('click', openNewExamModal)") < dashboard.indexOf('await loadExams();'), 'new exam button should open modal before exam loading finishes');
    assert(dashboard.includes('z-index: 200'), 'new exam modal should render above the app chrome');
    assert(dashboard.includes('async function createNewExamFromModal'), 'dashboard should create the new exam before opening the editor');
    assert(dashboard.includes("method: 'POST'") && dashboard.includes("window.location.href = `editor.html?id=${encodeURIComponent(newId)}`"), 'dashboard should save the exam and open editor with its id');
    assert(editor.includes("const forceNewExam = editorParams.get('new') === '1'"), 'editor should detect forced new exam mode');
    assert(editor.includes("const examIdFromUrl = editorParams.get('id')"), 'editor should open exams directly from the id URL parameter');
    assert(editor.includes('if (forceNewExam) localStorage.removeItem(\'editExamId\')'), 'forced new exam should clear editExamId');
    assert(editor.includes('function scheduleAutoSave'), 'editor should autosave saved exams after edits');
    assert(editor.includes('saveToCloud({ auto: true })'), 'autosave should reuse cloud save');
    assert(editor.includes('autoSaveReady = Boolean(currentExamId)'), 'autosave should only start after a cloud exam is loaded');
    assert(editor.includes('function flushAutoSaveBeforeAction'), 'editor should expose a flush save before leaving/printing');
    assert(editor.includes("document.querySelectorAll('.app-sidebar a[href], #settingsMenu a[href]')"), 'editor navigation links should flush autosave before leaving');
    assert(editor.includes('if (ok) window.location.href = destination'), 'editor should navigate only after successful flush save');
    assert(editor.includes('runAfterAutosave(printCleanDocument)'), 'editor print actions should save before printing');
    assert(!editor.includes('saveCloudBtn'), 'editor should not show a manual save button when autosave is active');
    assert(editor.includes('Salvando alteracoes...'), 'editor should show autosave progress in the status line');
    assert(editor.includes('function setAutoSaveHint'), 'editor should have a calm autosave hint helper');
    assert(editor.includes('Alteracoes salvas automaticamente.'), 'editor should explain autosave before the first edit');
    assert(editor.includes('Ultimo salvamento: ${hora}'), 'editor should update autosave status through the hint helper after saving');
    assert(!editor.includes('gerador-provas-state-v1'), 'editor should not write local browser drafts');
    assert(!editor.includes('activeStorageKey'), 'editor should not track a local draft storage key');
    assert(!editor.includes('localDraftAutosaveEnabled'), 'editor should not autosave local browser drafts');
    assert(editor.includes('login.html?return_to=${encodeURIComponent(returnTo)}'), 'editor should redirect anonymous users to login with return_to');
    assert(login.includes('function getSafeReturnTo()'), 'login should validate return_to');
    assert(login.includes('async function goAfterAuth()'), 'login should return asynchronously after auth');
    assert(login.includes('getSafeReturnTo() || await getDefaultDestinationForRole()'), 'login should prefer safe return_to before role destination');
    assert(login.includes('getDefaultDestinationForRole'), 'login should choose default destination by role');
    assert(!print.includes('gerador-provas-state-v1'), 'print should not read local browser drafts');
    assert(print.includes('Nenhuma prova selecionada'), 'print should require a saved/selected exam when no id is provided');
    assert(print.includes('login.html?return_to=${encodeURIComponent(returnTo)}'), 'print should redirect anonymous users with return_to');
  });

  await test('critical flow fixes are guarded', () => {
    const coordination = read('coordenacao.html');
    const editor = read('editor.html');
    assert(coordination.includes('const examId = pendingReturnId;'), 'return modal should capture pending id before closing');
    assert(coordination.indexOf('const examId = pendingReturnId;') < coordination.indexOf('closeReturnModal();'), 'return id should be captured before modal close');
    assert(coordination.includes("updateReviewStatus(examId, 'devolvida'"), 'return action should use captured id');
    assert(editor.includes('if (!response.ok)'), 'new exam save should check Supabase response.ok');
    assert(editor.includes('Supabase não retornou o ID da prova criada.'), 'new exam save should fail if Supabase does not return id');
    assert(coordination.includes("confirm('Aprovar esta prova"), 'approve action should require confirmation');
    assert(coordination.includes("confirm('Desaprovar esta prova"), 'unapprove action should require confirmation');
    assert(coordination.includes("confirm('Bloquear esta prova"), 'block action should require confirmation');
    assert(coordination.includes("confirm('Desbloquear esta prova"), 'unblock action should require confirmation');
    assert(coordination.includes('const isLocked = Boolean(exam.locked_at) || isApproved || isBlocked;'), 'coordination should detect locked exams from locked_at or status');
    assert(coordination.includes('const canApprove = !isApproved && !isLocked;'), 'coordination should hide incompatible approve action');
    assert(coordination.includes('const canUnapprove = isApproved;'), 'coordination should show unapprove action for approved exams');
    assert(coordination.includes('const canReturn = !isLocked;'), 'coordination should hide incompatible return action');
    assert(coordination.includes('const canUnblock = isLocked;'), 'coordination should show unblock action for locked exams');
    assert(editor.includes("['topNewQuestionBtn', 'openBankBtn']"), 'review lock should cover top editor actions');
    assert(editor.includes('#topQuestionMenu button, #questionBankModal button[data-bank-action]'), 'review lock should cover menus and bank actions');
    assert(/try \{\r?\n        const totalImageBytes = imagePayloadBytes\(\);/.test(editor), 'autosave image payload limit should run inside try/finally');
    assert(editor.lastIndexOf('autoSaveInFlight = false;') > editor.indexOf('const totalImageBytes = imagePayloadBytes();'), 'autosave should always release in-flight state after payload validation');
  });

  await test('schools admin page exists and is valid', () => {
    const page = read('schools.html');
    assert(page.includes('loadSchools'), 'loadSchools function missing');
    assert(page.includes('addSchool'), 'addSchool function missing');
    assert(page.includes('linkProfessor'), 'linkProfessor function missing');
    assert(page.includes('createInvite'), 'school page should create invite links');
    assert(page.includes('/user_invites'), 'school page should persist invite records');
    assert(page.includes('renderAccessSummary'), 'school page should render access migration summary');
    assert(page.includes('accessSummarySection'), 'school page should include access summary section');
    assert(page.includes('withoutSchool'), 'school page should flag users without school');
    assert(page.includes('pendingInvites'), 'school page should count pending invites');
    assert(page.includes('expiredInvites'), 'school page should count expired invites');
    assert(page.includes('loadInvites'), 'school page should list generated invites');
    assert(page.includes('deleteInvite'), 'school page should allow canceling unused invites');
    assert(page.includes('invitesSection'), 'school page should render invite management section');
    assert(page.includes('/user_invites?select=*&order=created_at.desc'), 'school page should load invite records');
    assert(page.includes('accepted_at'), 'school page should distinguish accepted invites');
    assert(page.includes('expires_at'), 'school page should distinguish expired invites');
    assert(page.includes('buildInviteLink(invite.token)'), 'school page should show reusable pending invite links');
    assert(page.includes('accepted_at=is.null'), 'invite cancel should only target unused invites');
    assert(page.includes('buildInviteLink'), 'school page should build login invite links');
    assert(page.includes('inviteRoleSelect'), 'school page should choose invited access role');
    assert(page.includes('deleteSchool'), 'deleteSchool function missing');
    assert(page.includes('school_id'), 'school_id reference missing');
    assert(page.includes('auth.canManageSchools(currentProfile)') && page.includes('auth.canManageUsers(currentProfile)'), 'role guard helper reference missing');
    assert(page.includes('se-logo-preview'), 'school edit should show logo preview');
    assert(page.includes('readCompressedLogo(file, (dataUrl) => {'), 'school logo upload should be compressed before preview/save');
    assert(page.includes('preview.src = dataUrl'), 'school logo change should update preview before save');
    assert(page.includes('MAX_LOGO_DATA_URL_BYTES'), 'school logo upload should have a compressed payload limit');
    assert(!page.includes('const GRADE_OPTIONS = ['), 'school page should not depend on fixed grade options');
    assert(page.includes('linkGradeCheckboxes'), 'link professor flow should allow multiple grade checkboxes');
    assert(page.includes('newSchoolClassTags') && page.includes('addNewSchoolClass'), 'school page should manage school-level classes');
    assert(page.includes('function saveSchoolClasses') && page.includes('JSON.stringify({ classes })'), 'school page should persist school classes');
    assert(page.includes('function getSchoolClasses') && page.includes('renderGradeCheckboxesHtml(`pe-grades-${p.id}`, profGrades, school)'), 'user class choices should come from selected school');
    assert(page.includes('pe-grades-${p.id}'), 'professor edit should allow multiple grade checkboxes');
    assert(page.includes("getCheckedValues('linkGradeCheckboxes').join(', ')"), 'link professor should save multiple grades');
    assert(page.includes("getCheckedValues(`pe-grades-${profId}`).join(', ')"), 'professor edit should save multiple grades');
    assert(page.includes('promoteProfessor'), 'school page should allow promoting a professor');
    assert(page.includes("changeProfileRole(profId, 'coordinator')"), 'professor promotion should update role to coordinator');
    assert(page.includes('roleLabel(role)'), 'school page should label access roles');
    assert(page.includes('canChangeTeamRole'), 'school page should guard role changes');
    assert(page.includes('canChangeTeamSchool'), 'school page should guard profile school changes');
    assert(page.includes('renderProfileSchoolSelect'), 'school page should let managers choose profile access school');
    assert(page.includes('data-profile-school-select'), 'profile school select marker missing');
    assert(page.includes('getProfileSchoolId(profile)'), 'role changes should read selected profile school');
    assert(page.includes("['school_owner', 'coordinator', 'print_operator'].includes(role) && !schoolId"), 'owner/coordinator/print role should require a school');
    assert(page.includes('update.school_id = schoolId'), 'profile role changes should persist selected school');
    assert(page.includes('Selecione a escola de acesso deste perfil.'), 'existing-user linking should require access school');
    assert(page.includes('renderRoleSelect'), 'school page should render role select');
    assert(page.includes("role=in.(professor,teacher,coordenadora,coordinator,impressao,print_operator,school_owner,admin,master)"), 'school page should list all school access roles');
    assert(page.includes("role === 'school_owner' && !auth.hasRole(['master'], currentProfile)"), 'only master should assign school owner role');
    assert(page.includes('function canManageInvites()'), 'school page should centralize invite permission');
    assert(page.includes("auth.hasRole(['master', 'school_owner', 'coordinator'], currentProfile)"), 'master, school owner and coordinator should manage invites');
    assert(page.includes("auth.hasRole(['coordinator'], currentProfile) && role !== 'teacher'"), 'coordinator should only invite teachers');
    assert(page.includes('print_operator'), 'school page should support print operator role');
    assert(page.includes('Impressao'), 'school page should label print operator role');
    assert(page.includes("role === 'school_owner' && !auth.hasRole(['master'], currentProfile)"), 'only master should invite school owner role');
    assert(page.includes("document.getElementById('linkProfBtn').style.display = 'none'"), 'existing-user linking should remain master-only');
    assert(page.includes("Apenas o acesso master pode vincular usuarios existentes."), 'non-master existing-user linking should be blocked');
    assert(page.includes('Promover a coordenador(a)'), 'professor list should show promotion action');
    assert(page.includes("if (invite.canceled_at) return { key: 'canceled'"), 'school invites should show canceled status');
    assert(page.includes('Convites cancelados'), 'school access summary should count canceled invites');
    assert(page.includes('Gerenciar Escola'), 'school page should use singular management title');
    assert(page.includes('Checklist da escola'), 'school checklist title should focus on the current school');
    assert(page.includes('Cadastro da escola'), 'school readiness should call the first step school registration');
    assert(!page.includes('Definir responsavel'), 'school readiness should not ask the logged owner to define itself as responsible');
    assert(page.includes('Escola cadastrada'), 'school list label should be singular in school management');
    assert(page.includes('Convidar ou vincular usuario a esta escola'), 'invite section should refer to this school');
    assert(!page.includes("['Master', counts.master || 0]"), 'school access summary should not count master users');
    assert(page.includes('schoolReadinessSection') && page.includes('schoolReadinessList'), 'school page should show readiness checklist');
    assert(page.includes('function renderSchoolReadiness'), 'school page should compute onboarding readiness');
    assert(page.includes('const hasDisciplines = schools.some'), 'readiness should check school disciplines');
    assert(page.includes('const hasClasses = schools.some'), 'readiness should check school classes');
    assert(page.includes("title: 'Definir turmas'"), 'readiness should include class setup step');
    assert(page.includes("auth.normalizeRole(p.role) === 'coordinator'"), 'readiness should check coordinator assignment');
    assert(page.includes("auth.normalizeRole(p.role) === 'teacher'"), 'readiness should check teacher assignment');
    assert(page.includes("inviteStatus(invite).key === 'pending'"), 'readiness should check active invites');
    assert(page.includes('newSchoolCard') && page.includes("document.getElementById('newSchoolCard')"), 'school page should keep new school form targeted by id');
    assert(page.includes('navMasterLink'), 'school page should include master navigation tab');
    assert(page.includes('canceled_at:is.null') || page.includes('canceled_at=is.null'), 'cancel invite should target only active invites');
    assert(page.includes("method: 'PATCH'") && page.includes('canceled_by: auth.getCurrentUser().id'), 'cancel invite should persist cancellation instead of deleting history');
    assert(page.includes('resetProfessorPassword'), 'school page should allow resetting a professor password');
    assert(page.includes('/rpc/admin_reset_user_password'), 'password reset should call admin reset RPC');
    assert(page.includes('target_profile_id: profId'), 'password reset should send target profile id');
    assert(!page.includes('linkGradeSelect'), 'school page should not use a single grade select for linking');
  });

  await test('master page separates global administration', () => {
    const page = read('master.html');
    const login = read('login.html');
    const modules = ['dashboard.html', 'editor.html', 'coordenacao.html', 'impressao.html', 'schools.html'];
    assert(page.includes('Painel Master'), 'master page title missing');
    assert(page.includes("auth.hasRole(['master'], profile)"), 'master page should be restricted to master role');
    assert(page.includes('/schools?order=name.asc&select=*'), 'master page should load schools');
    assert(page.includes('/profiles?role=in.(professor,teacher,coordenadora,coordinator,impressao,print_operator,school_owner,admin,master)'), 'master page should load all managed profile roles');
    assert(page.includes('/user_invites?order=created_at.desc&select=*'), 'master page should load invites');
    assert(page.includes('masterSummaryGrid'), 'master page should render global summary');
    assert(page.includes('masterSchoolList'), 'master page should render school map');
    assert(page.includes('schools.html#newSchoolCard'), 'master page should link to school creation');
    assert(page.includes('schools.html#linkProfessorCard'), 'master page should link to existing-user linking');
    assert(page.includes('schools.html#accessSummarySection'), 'master page should link to access summary');
    assert(login.includes("role === 'master'") && login.includes("return 'master.html'"), 'login should send master to master page');
    modules.forEach((file) => {
      const modulePage = read(file);
      assert(modulePage.includes('navMasterLink'), `${file} should include master navigation tab`);
      assert(modulePage.includes("['master']"), `${file} should only show master navigation for master role`);
    });
  });
  await test('login enforces password change after admin reset', () => {
    const page = read('login.html');
    const auth = read('js/auth.js');
    assert(page.includes('isForcedPasswordChange'), 'forced password change mode missing');
    assert(page.includes('requiresPasswordChange'), 'forced password change profile check missing');
    assert(page.includes('force_password_change'), 'login should read forced password flag');
    assert(page.indexOf('select=force_password_change') < page.indexOf('user_metadata'), 'login should prefer profile flag before Auth metadata fallback');
    assert(page.includes("password === '123456'"), 'login should reject keeping temporary password');
    assert(page.includes('force_password_change: false'), 'login should clear forced password flag after update');
    assert(auth.includes('async updatePassword(newPassword, metadata = null)'), 'AuthManager updatePassword should accept metadata');
    assert(auth.includes('...(metadata ? { data: metadata } : {})'), 'AuthManager updatePassword should send metadata to Supabase Auth');
    assert(auth.includes('data?.user || (data?.id ? data : null)'), 'AuthManager updatePassword should refresh local session from Supabase user response');
    assert(auth.includes('this.session.user.user_metadata') && auth.includes('...metadata'), 'AuthManager updatePassword should merge metadata into local session');
  });

  await test('login redirects by access role when no return target exists', () => {
    const page = read('login.html');
    assert(page.includes("role === 'master'") && page.includes("return 'master.html'"), 'master should default to master page');
    assert(page.includes("role === 'school_owner'") && page.includes("return 'schools.html'"), 'school owner should default to schools page');
    assert(page.includes("role === 'coordinator'") && page.includes("return 'coordenacao.html'"), 'coordinator should default to coordination page');
    assert(page.includes("role === 'print_operator'") && page.includes("return 'impressao.html'"), 'print operator should default to print queue');
    assert(page.includes("return 'dashboard.html'"), 'teacher and fallback should default to dashboard');
    assert(!page.includes('id="school"'), 'signup should not collect free-text school_name');
    assert(!page.includes('school_name: school'), 'signup should not send legacy profile school_name');
    assert(page.includes("auth.loadCurrentProfile('id,role,school_id,force_password_change')"), 'login should load profile before role redirect');
    assert(page.includes('function getInviteToken()'), 'login should read invite token');
    assert(page.includes('/rpc/accept_user_invite'), 'login should accept invite through RPC');
    assert(page.includes('await acceptPendingInvite()'), 'login should apply invite before redirect');
  });

  await test('dashboard allows the current user to change password', () => {
    const page = read('dashboard.html');
    assert(page.includes('profilePasswordInput'), 'profile modal should include new password input');
    assert(page.includes('profilePasswordConfirmInput'), 'profile modal should include password confirmation input');
    assert(page.includes('changeOwnPassword'), 'dashboard should define password change handler');
    assert(page.includes('auth.updatePassword(password, { force_password_change: false })'), 'dashboard password change should clear Auth forced password metadata');
    assert(page.includes('force_password_change: false'), 'dashboard password change should clear profile forced password flag');
    assert(page.includes("password === '123456'"), 'dashboard should reject keeping the temporary password');
    assert(page.includes('requiresPasswordChange()'), 'dashboard should check forced password change state');
    assert(page.includes('return Boolean(currentProfile.force_password_change)'), 'dashboard forced password check should use profile flag as source of truth');
    assert(page.includes("document.getElementById('profileModal').classList.remove('show')"), 'dashboard should close profile modal after successful password change');
  });

  await test('coordination page has review actions', () => {
    const page = read('coordenacao.html');
    ['approveExam', 'unapproveExam', 'returnExam', 'blockExam', 'unblockExam', 'updateReviewStatus'].forEach((name) => {
      assert(page.includes(name), `${name} missing in coordination page`);
    });
    assert(page.includes('auth.canReviewExams(profile)'), 'coordination role guard missing');
    assert(page.includes("auth.loadCurrentProfile('id,email,full_name,role,school_id,school_grade')"), 'coordination should load assigned grades');
    assert(page.includes('function canCurrentProfileReviewExam'), 'coordination should filter exams by current profile scope');
    assert(page.includes('normalizeGradeList(profile?.school_grade)'), 'coordination should compare exams against coordinator grades');
    assert(page.includes('printModalOverlay'), 'coordination should have print request modal');
    assert(page.includes('print_copies') && page.includes('print_notes'), 'coordination should send print copies and notes');
    assert(page.includes('Reenviar para impressão'), 'coordination should allow resending printed exams');
    assert(page.includes('Observação registrada'), 'coordination review note display missing');
    assert(page.includes('id="subjectFilter"') && page.includes('id="classFilter"'), 'coordination should expose subject and class filters');
    assert(page.includes("renderSelectFilter('subjectFilter', reviews.map(r => r.subject)") && page.includes("renderSelectFilter('classFilter', reviews.map(r => r.class_name)"), 'coordination should populate subject and class filters from reviews');
    assert(page.includes('if (subject) filtered = filtered.filter((exam) => exam.subject === subject);'), 'coordination should filter by subject');
    assert(page.includes('if (className) filtered = filtered.filter((exam) => exam.class_name === className);'), 'coordination should filter by class');
    assert(page.includes('history-panel') && page.includes('he-notes') && page.includes('Historico de revisao'), 'coordination should render readable review history');
  });

  await test('print queue page receives and completes print jobs', () => {
    const page = read('impressao.html');
    const print = read('print.html');
    const auth = read('js/auth.js');
    const sql = read('setup_supabase.sql');
    assert(page.includes('Fila de impressão'), 'print queue page title missing');
    assert(page.includes("auth.canAccessPrintQueue(profile)"), 'print queue guard missing');
    assert(auth.includes("return this.hasRole(['master', 'school_owner', 'print_operator'], profile);"), 'frontend should allow school owners to access the print queue');
    assert(sql.includes("public.normalized_role(current_profile.role) IN ('school_owner', 'print_operator')"), 'Supabase print permission should match frontend school owner access');
    assert(page.includes("print_status=in.(enviada,impressa)"), 'print queue should load pending and printed jobs');
    assert(page.includes('/rpc/mark_exam_printed'), 'print queue should mark jobs as printed through RPC');
    assert(page.includes('PDF bloqueado'), 'printed jobs should hide PDF action');
    assert(print.includes('id="markPrintedBtn"'), 'print PDF should expose mark-printed action from queue');
    assert(print.includes('id="printQueueLink"'), 'print PDF should link back to queue when opened from queue');
    assert(print.includes("get('from') === 'impressao'"), 'print PDF should detect queue origin');
    assert(print.includes('/rpc/mark_exam_printed'), 'print PDF should mark the current job as printed through RPC');
    assert(print.includes("auth.hasRole(['master', 'school_owner', 'print_operator'], profile)"), 'print PDF mark action should match print queue roles');
    assert(print.includes('currentExam = data[0]') && print.includes('renderExam(currentExam)'), 'print PDF should render the loaded exam state');
    assert(print.includes("auth.hasRole(['print_operator'], profile)") && print.includes("data[0].print_status === 'impressa'"), 'print page should block printed jobs for print operator');
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
