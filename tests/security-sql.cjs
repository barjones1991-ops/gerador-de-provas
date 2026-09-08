const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const schoolA = uuid(100), schoolB = uuid(200);
let checks = 0;
(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, email_confirmed_at TIMESTAMPTZ,
        raw_user_meta_data JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
      CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE SQL STABLE AS
        $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    `);
    const setup = fs.readFileSync(path.join(root, 'setup_supabase.sql'), 'utf8').replace(/\r\n/g, '\n');
    const schoolMigration = fs.readFileSync(path.join(root, 'migrations/20260908_02_escola_da_prova.sql'), 'utf8').replace(/\r\n/g, '\n');
    assert(setup.includes(schoolMigration.split('BEGIN;')[1].replace(/COMMIT;\s*$/, '').trim()));
    // Parte anterior a escola fixa: exercita uma atualizacao com acervo legado real.
    const legacySetup = setup.split('-- Migracao 20260908_02_escola_da_prova')[0] + '\nCOMMIT;';
    await db.exec(legacySetup);
    await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.exams, public.schools,
        public.question_bank, public.user_invites TO authenticated;
      GRANT SELECT ON public.exams, public.profiles, public.user_invites TO anon;
      INSERT INTO public.schools(id,name) VALUES ('${schoolA}','Escola A'), ('${schoolB}','Escola B');`);
    const roles = ['master', 'school_owner', 'coordinator', 'teacher', 'print_operator', 'teacher', 'school_owner', 'coordinator', 'print_operator', 'teacher'];
    for (let i = 0; i < roles.length; i++) {
      await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [uuid(i + 1), `test${i + 1}@example.invalid`]);
      await db.query('UPDATE public.profiles SET role=$1, school_id=$2, school_grade=$3 WHERE id=$4', [roles[i], i === 9 ? null : i >= 5 ? schoolB : schoolA, '5A', uuid(i + 1)]);
    }
    const legacyExam = uuid(290), personalExam = uuid(291);
    await db.query('INSERT INTO exams(id,user_id) VALUES ($1,$2),($3,$4)', [legacyExam, uuid(4), personalExam, uuid(10)]);
    await db.exec(schoolMigration);
    assert.equal((await db.query('SELECT school_id FROM exams WHERE id=$1', [legacyExam])).rows[0].school_id, schoolA);
    assert.equal((await db.query('SELECT school_id FROM exams WHERE id=$1', [personalExam])).rows[0].school_id, null);
    checks++; console.log('OK SQL migracao preenche escola legada e preserva prova pessoal');
    async function asUser(n, sql, params = []) {
      return db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE authenticated');
        await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uuid(n), email: `test${n}@example.invalid` })]);
        return tx.query(sql, params);
      });
    }
    async function denied(label, n, sql, params = []) {
      await assert.rejects(() => asUser(n, sql, params), undefined, label);
      checks++; console.log('OK SQL', label);
    }
    await denied('coordenador nao promove professor a master', 3, "UPDATE profiles SET role='master' WHERE id=$1", [uuid(4)]);
    await denied('dono nao promove professor a dono', 2, "UPDATE profiles SET role='school_owner' WHERE id=$1", [uuid(4)]);
    await denied('dono nao transfere professor a outra escola', 2, 'UPDATE profiles SET school_id=$1 WHERE id=$2', [schoolB, uuid(4)]);
    await asUser(4, "UPDATE profiles SET email='outro@example.invalid',role='master' WHERE id=$1", [uuid(4)]);
    const self = (await asUser(4, 'SELECT email,role FROM profiles WHERE id=$1', [uuid(4)])).rows[0];
    assert.equal(self.role, 'teacher'); assert.equal(self.email, 'test4@example.invalid'); checks++;
    await asUser(3, "UPDATE profiles SET school_grade='5A, 5B' WHERE id=$1", [uuid(4)]); checks++;
    const exam = uuid(300);
    await asUser(4, `INSERT INTO exams(id,user_id,title,class_name,questions,total_value) VALUES ($1,$2,'Rascunho','5A','[{"type":"multipla","points":"10,0"}]','10,0')`, [exam, uuid(4)]); checks++;
    assert.equal((await asUser(4, 'SELECT school_id FROM exams WHERE id=$1', [exam])).rows[0].school_id, schoolA); checks++;
    await denied('criacao nao aceita escola forjada', 4, 'INSERT INTO exams(user_id,school_id) VALUES ($1,$2)', [uuid(4), schoolB]);
    await denied('professor nao transfere escola da prova', 4, 'UPDATE exams SET school_id=$1 WHERE id=$2', [schoolB, exam]);
    await denied('coordenador nao remove escola da prova', 3, 'UPDATE exams SET school_id=NULL WHERE id=$1', [exam]);
    await denied('master do app nao transfere acervo por PATCH', 1, 'UPDATE exams SET school_id=$1 WHERE id=$2', [schoolB, exam]);
    await denied('professor nao cria prova aprovada', 4, `INSERT INTO exams(user_id,review_status,questions,total_value) VALUES ($1,'aprovada','[{"points":"10,0"}]','10,0')`, [uuid(4)]);
    await denied('operador nao cria prova', 5, 'INSERT INTO exams(user_id) VALUES ($1)', [uuid(5)]);
    await denied('coordenador nao troca proprietario da prova', 3, 'UPDATE exams SET user_id=$1 WHERE id=$2', [uuid(3), exam]);
    const invisible = await asUser(6, 'SELECT * FROM exams WHERE id=$1', [exam]);
    assert.equal(invisible.rows.length, 0); checks++;
    await asUser(4, "UPDATE exams SET review_status='enviada' WHERE id=$1", [exam]);
    await asUser(3, "UPDATE exams SET review_status='aprovada',locked_at=now(),reviewed_by=$1 WHERE id=$2", [uuid(3), exam]); checks++;
    const locked = await asUser(4, "UPDATE exams SET title='Proibido' WHERE id=$1 RETURNING id", [exam]);
    assert.equal(locked.rows.length, 0); checks++;
    await asUser(3, "UPDATE exams SET print_status='enviada',print_requested_by=$1 WHERE id=$2", [uuid(3), exam]);
    await asUser(5, 'SELECT public.mark_exam_printed($1)', [exam]); checks++;
    const bank = uuid(301);
    await asUser(4, "INSERT INTO question_bank(id,user_id,question) VALUES ($1,$2,'{}')", [bank, uuid(4)]);
    await denied('questao nao pode receber outra escola por PATCH', 4, 'UPDATE question_bank SET school_id=$1 WHERE id=$2', [schoolB, bank]);
    await asUser(4, 'UPDATE question_bank SET school_id=$1 WHERE id=$2', [schoolA, bank]); checks++;
    const token = 'a'.repeat(32);
    await asUser(2, 'INSERT INTO user_invites(email,role,school_id,token) VALUES ($1,$2,$3,$4)', ['test4@example.invalid','teacher',schoolA,token]);
    const invites = await asUser(4, 'SELECT token FROM user_invites');
    assert.equal(invites.rows.length, 0); checks++;
    await denied('convite exige email do destinatario', 6, 'SELECT accept_user_invite($1)', [token]);
    await asUser(4, 'SELECT accept_user_invite($1)', [token]); checks++;
    await denied('convite aceito nao pode ser reutilizado', 4, 'SELECT accept_user_invite($1)', [token]);
    await asUser(2, 'INSERT INTO user_invites(email,role,school_id,token,canceled_at) VALUES ($1,$2,$3,$4,now())', ['test4@example.invalid','teacher',schoolA,'b'.repeat(32)]);
    await denied('convite cancelado rejeitado', 4, 'SELECT accept_user_invite($1)', ['b'.repeat(32)]);
    assert.equal((await db.query("SELECT to_regprocedure('public.admin_reset_user_password(uuid)') AS fn")).rows[0].fn, null); checks++;
    // Reaplicar a migracao nao promove ninguem nem altera o acervo.
    await db.exec(fs.readFileSync(path.join(root, 'migrations/20260908_01_seguranca.sql'), 'utf8'));
    assert.equal((await db.query('SELECT role FROM profiles WHERE id=$1', [uuid(4)])).rows[0].role, 'teacher'); checks++;
    await asUser(3, "UPDATE exams SET print_status='enviada' WHERE id=$1", [exam]);
    // Transferencia permitida pelo master muda apenas o perfil e provas futuras.
    await asUser(1, 'UPDATE profiles SET school_id=$1 WHERE id=$2', [schoolB, uuid(4)]);
    for (const n of [2, 3, 5]) {
      assert.equal((await asUser(n, 'SELECT id FROM exams WHERE id=$1', [exam])).rows.length, 1);
    }
    for (const n of [7, 8, 9]) {
      assert.equal((await asUser(n, 'SELECT id FROM exams WHERE id=$1', [exam])).rows.length, 0);
    }
    assert.equal((await asUser(8, "UPDATE exams SET title='Indevido' WHERE id=$1 RETURNING id", [exam])).rows.length, 0);
    await denied('operador da nova escola nao imprime acervo antigo', 9, 'SELECT mark_exam_printed($1)', [exam]);
    await asUser(5, 'SELECT mark_exam_printed($1)', [exam]);
    assert.equal((await asUser(5, 'SELECT printed_by FROM exams WHERE id=$1', [exam])).rows[0].printed_by, uuid(5)); checks++;
    checks++; console.log('OK SQL transferencia preserva acesso da origem e impede acesso da nova escola');
    // O autor conserva a leitura das suas provas; a escola nova nao herda esse acesso.
    assert.equal((await asUser(4, 'SELECT school_id FROM exams WHERE id=$1', [exam])).rows[0].school_id, schoolA);
    const newExam = uuid(302);
    await asUser(4, 'INSERT INTO exams(id,user_id) VALUES ($1,$2)', [newExam, uuid(4)]);
    assert.equal((await asUser(7, 'SELECT school_id FROM exams WHERE id=$1', [newExam])).rows[0].school_id, schoolB);
    assert.equal((await asUser(2, 'SELECT id FROM exams WHERE id=$1', [newExam])).rows.length, 0); checks++;
    // Desvincular o autor tambem nao remove acesso institucional ao acervo.
    await asUser(1, 'UPDATE profiles SET school_id=NULL WHERE id=$1', [uuid(4)]);
    assert.equal((await asUser(3, 'SELECT id FROM exams WHERE id=$1', [exam])).rows.length, 1); checks++;
    await asUser(1, "UPDATE profiles SET school_grade='6A' WHERE id=$1", [uuid(3)]);
    assert.equal((await asUser(3, 'SELECT id FROM exams WHERE id=$1', [exam])).rows.length, 0);
    await asUser(1, "UPDATE profiles SET school_grade='5A' WHERE id=$1", [uuid(3)]); checks++;
    await asUser(1, 'UPDATE profiles SET school_id=$1 WHERE id=$2', [schoolA, uuid(10)]);
    await db.exec(schoolMigration);
    await db.exec(setup);
    await db.exec(setup); // Reaplicar setup completo tambem preserva a fotografia original.
    assert.equal((await db.query('SELECT school_id FROM exams WHERE id=$1', [personalExam])).rows[0].school_id, null);
    assert.equal((await db.query('SELECT school_id FROM exams WHERE id=$1', [exam])).rows[0].school_id, schoolA);
    assert.equal((await db.query('SELECT school_id FROM exams WHERE id=$1', [newExam])).rows[0].school_id, schoolB);
    assert.equal((await asUser(3, 'SELECT id FROM exams WHERE id=$1', [personalExam])).rows.length, 0);
    checks++; console.log('OK SQL reaplicacao nao vincula provas pessoais nem desloca acervo antigo');
    console.log(`${checks} verificacoes SQL aprovadas em PostgreSQL/PGlite isolado.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
