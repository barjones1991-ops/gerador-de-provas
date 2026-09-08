# Gerador de Provas

Aplicacao web estatica para criacao, revisao e impressao de provas escolares com Supabase.

## Modulos

- `login.html`: login, cadastro, troca obrigatoria de senha e redirecionamento por perfil.
- `dashboard.html`: provas do usuario, filtros, nova prova, envio para revisao e PDF.
- `editor.html`: editor de provas com autosave em nuvem, banco de questoes e imagens.
- `print.html`: PDF limpo a partir de prova salva.
- `coordenacao.html`: revisao pedagogica, devolucao, aprovacao, bloqueio e envio para impressao.
- `impressao.html`: fila de impressao e marcacao como impressa.
- `schools.html`: escolas, logos, disciplinas, usuarios e convites.

## Rodar Localmente

```bash
npm run serve
```

Ou diretamente:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Acesse:

```text
http://127.0.0.1:8000/
```

Entrada principal:

```text
http://127.0.0.1:8000/login.html
```

## Testes

Use Node.js 22 ou superior. A instalação abaixo inclui PostgreSQL/PGlite somente para os testes; a aplicação continua estática e sem build.

```bash
npm ci --ignore-scripts
npm test
```

Os testes incluem contratos HTML/JS, regressões de salvamento/login e permissões em PostgreSQL isolado. Nenhum teste altera o Supabase real. Antes de entregar qualquer mudança, valide também o fluxo no navegador.

O acompanhamento da auditoria está em [auditoria/STATUS_CORRECOES.md](auditoria/STATUS_CORRECOES.md).

## Configuracao Supabase

As credenciais publicas ficam em `config.js`:

```javascript
const CONFIG = {
  SUPABASE_URL: 'https://seu-projeto.supabase.co',
  SUPABASE_ANON_KEY: 'sua-anon-key-publica',
  API_URL: 'https://seu-projeto.supabase.co/rest/v1',
  AUTH_URL: 'https://seu-projeto.supabase.co/auth/v1',
};
```

A anon key e publica no frontend. A protecao de dados depende das policies RLS no Supabase.

## Banco de Dados

Use `setup_supabase.sql` como fonte oficial do schema. Ele cria/atualiza:

- `profiles`
- `schools`
- `exams`
- `question_bank`
- `user_invites`
- funcoes auxiliares de permissao e impressao
- policies RLS

Para um ambiente novo, execute todo o arquivo no SQL Editor do Supabase.

Para atualizar um ambiente existente com o primeiro lote da auditoria, faça backup e execute apenas [migrations/20260908_01_seguranca.sql](migrations/20260908_01_seguranca.sql). Aplique antes de publicar o frontend atualizado. A criação inicial do master deve ser feita por UUID conferido em `auth.users`, conforme [o guia da migração](migrations/README.md).

Em Auth, ative a confirmação de e-mail e configure SMTP e URLs de retorno. A migração SQL não muda essas configurações. A recuperação administrativa envia um link individual; nenhuma senha compartilhada é criada.

## Perfis

- `master`: administra todas as escolas e usuarios.
- `school_owner`: administra a propria escola, usuarios e revisoes.
- `coordinator`: revisa provas, gerencia professores da escola e envia para impressao.
- `teacher`: cria e edita as proprias provas.
- `print_operator`: acessa a fila de impressao e PDFs autorizados.

Aliases antigos como `professor`, `coordenadora` e `impressao` sao normalizados pelo sistema.

## Fluxo Operacional

1. Master ou dono cria a escola em `schools.html`.
2. Escola recebe logo, disciplinas e usuarios vinculados.
3. Professor cria prova pelo dashboard.
4. Editor salva automaticamente a prova na nuvem.
5. Professor envia a prova para revisao.
6. Coordenacao revisa e aprova, devolve ou bloqueia.
7. Coordenacao envia prova aprovada para impressao.
8. Operador imprime em `impressao.html` e marca como impressa.

## Imagens

- Aceita PNG, JPG, JPEG, WebP e GIF.
- Arquivos acima de `CONFIG.MAX_FILE_SIZE` sao recusados.
- Logos e imagens de questoes sao comprimidas antes de salvar.
- Renderizacao aceita apenas data URLs seguras de imagem.
- Provas muito pesadas sao bloqueadas antes do autosave.

## Checklist Manual

Professor:

- criar prova nova pelo dashboard;
- selecionar disciplina e turma;
- editar questoes, valores, gabarito e imagens;
- sair e voltar para confirmar autosave;
- abrir PDF limpo.

Coordenacao:

- ver provas enviadas;
- devolver com observacao;
- aprovar;
- enviar para impressao.

Impressao:

- abrir fila;
- abrir PDF;
- marcar como impressa.

Gestao escolar:

- criar/editar escola;
- adicionar logo;
- definir disciplinas;
- vincular usuarios.

## Rotina de Entrega

1. Verificar `git status --short --branch`.
2. Entender o perfil e o fluxo afetado.
3. Implementar com escopo pequeno.
4. Rodar `npm test`.
5. Rodar localmente.
6. Validar no navegador.
7. Publicar somente depois da confirmacao manual.
