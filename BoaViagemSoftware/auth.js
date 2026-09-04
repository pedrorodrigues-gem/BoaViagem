const bcrypt = require('bcryptjs');
const { query, seedEscola } = require('./db');
const { escolaFull } = require('./helpers');

const COOKIE_NAME = 'chave_secreta_super_segura_boa_viagem';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function snakeToCamel(str) {
  return String(str || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeRows(rows, map = {}) {
  return (rows || []).map(row => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = map[key] || snakeToCamel(key);
      out[normalizedKey] = Buffer.isBuffer(value) ? value.toString('base64') : value;
    }
    return out;
  });
}

/* Aninha nas fichas de aluno os grupos de campos que o resto da
   aplicação espera como objetos (atestadoMedico, examePsicotecnico,
   processoIMT) — na base de dados são colunas simples da tabela alunos. */
function nestAlunoExtras(aluno) {
  aluno.atestadoMedico = {
    dataEmissao: aluno.atestadoDataEmissao ?? null,
    dataValidade: aluno.atestadoDataValidade ?? null,
    apto: aluno.atestadoApto ?? null
  };
  aluno.examePsicotecnico = {
    aplicavel: !!aluno.psicotecnicoAplicavel,
    dataEmissao: aluno.psicotecnicoDataEmissao ?? null,
    dataValidade: aluno.psicotecnicoDataValidade ?? null
  };
  aluno.processoIMT = {
    numero: aluno.imtNumero ?? null,
    dataEmissao: aluno.imtDataEmissao ?? null,
    dataValidade: aluno.imtDataValidade ?? null
  };
  return aluno;
}

async function loadTenantForEscola(escolaId) {
  // By default load full tenant data, but allow skipping heavy preloads
  // via environment variable LOAD_FULL_TENANT=false which is useful for
  // very large databases where SELECT * on big tables during auth times out.
  const FULL = process.env.LOAD_FULL_TENANT !== 'false';

  const tenant = {
    config: { composicaoCarta: {} },
    alunos: [],
    instrutores: [],
    veiculos: [],
    aulas: [],
    turmasTeoricas: [],
    pessoas: [],
    espacos: [],
    requisitos: [],
    produtos: [],
    contratos: [],
    pagamentos: [],
    itensConta: [],
    preInscricoes: [],
    examesMarcacoes: [],
    users: [],
    _seq: {}
  };

  if (FULL) {
    const [alunos, instrutores, veiculos, aulas, turmas, pessoas, espacos, requisitos, produtos, contratos, pagamentos, itensConta, preInscricoes, exames, users] = await Promise.all([
      query('SELECT * FROM alunos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM instrutores WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM veiculos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM aulas WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM turmas_teoricas WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pessoas WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM espacos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM requisitos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM produtos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM contratos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pagamentos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM itens_conta WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pre_inscricoes WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM exames_marcacoes WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM users WHERE escola_id = @escolaId ORDER BY id', { escolaId })
    ]);

    tenant.alunos = normalizeRows(alunos.recordset).map(nestAlunoExtras);
    tenant.instrutores = normalizeRows(instrutores.recordset);
    tenant.veiculos = normalizeRows(veiculos.recordset);
    tenant.aulas = normalizeRows(aulas.recordset);
    tenant.turmasTeoricas = normalizeRows(turmas.recordset);
    tenant.pessoas = normalizeRows(pessoas.recordset);
    tenant.espacos = normalizeRows(espacos.recordset);
    tenant.requisitos = normalizeRows(requisitos.recordset);
    tenant.produtos = normalizeRows(produtos.recordset);
    tenant.contratos = normalizeRows(contratos.recordset);
    tenant.pagamentos = normalizeRows(pagamentos.recordset);
    tenant.itensConta = normalizeRows(itensConta.recordset);
    tenant.preInscricoes = normalizeRows(preInscricoes.recordset);
    tenant.examesMarcacoes = normalizeRows(exames.recordset);
    tenant.users = normalizeRows(users.recordset);

    // ---------- Inscritos/presenças de cada turma teórica ----------
    const turmaIds = tenant.turmasTeoricas.map(t => t.id);
    if (turmaIds.length) {
      const inscritosResult = await query(
        `SELECT turma_id AS turmaId, aluno_id AS alunoId, presente
         FROM turma_inscritos WHERE turma_id IN (${turmaIds.join(',')})`
      );
      const porTurma = new Map();
      inscritosResult.recordset.forEach(r => {
        if (!porTurma.has(r.turmaId)) porTurma.set(r.turmaId, { inscritos: [], presencas: {} });
        const bucket = porTurma.get(r.turmaId);
        bucket.inscritos.push(r.alunoId);
        if (r.presente !== null && r.presente !== undefined) bucket.presencas[r.alunoId] = !!r.presente;
      });
      tenant.turmasTeoricas.forEach(t => {
        const bucket = porTurma.get(t.id) || { inscritos: [], presencas: {} };
        t.inscritos = bucket.inscritos;
        t.presencas = bucket.presencas;
      });
    } else {
      tenant.turmasTeoricas.forEach(t => { t.inscritos = []; t.presencas = {}; });
    }
  } else {
    // Partial load: only small tables and configuration needed for UI
    const [instrutores, pessoas, espacos, requisitos, produtos, users] = await Promise.all([
      query('SELECT * FROM instrutores WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pessoas WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM espacos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM requisitos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM produtos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM users WHERE escola_id = @escolaId ORDER BY id', { escolaId })
    ]);

    tenant.instrutores = normalizeRows(instrutores.recordset);
    tenant.pessoas = normalizeRows(pessoas.recordset);
    tenant.espacos = normalizeRows(espacos.recordset);
    tenant.requisitos = normalizeRows(requisitos.recordset);
    tenant.produtos = normalizeRows(produtos.recordset);
    tenant.users = normalizeRows(users.recordset);
  }

  // ---------- Composição da carta (planos de preço) por categoria ----------
  const planosResult = await query('SELECT * FROM planos_carta WHERE escola_id=@escolaId', { escolaId });
  const linhasResult = await query(
    `SELECT l.* FROM plano_carta_linhas l JOIN planos_carta p ON p.id = l.plano_carta_id WHERE p.escola_id=@escolaId`,
    { escolaId }
  );
  const linhasPorPlano = new Map();
  linhasResult.recordset.forEach(l => {
    if (!linhasPorPlano.has(l.plano_carta_id)) linhasPorPlano.set(l.plano_carta_id, []);
    linhasPorPlano.get(l.plano_carta_id).push({ produtoId: l.produto_id, quantidade: l.quantidade });
  });
  const composicaoCarta = {};
  planosResult.recordset.forEach(p => {
    if (!composicaoCarta[p.categoria]) composicaoCarta[p.categoria] = [];
    composicaoCarta[p.categoria].push({ id: p.id, nome: p.nome, linhas: linhasPorPlano.get(p.id) || [] });
  });
  tenant.config = { composicaoCarta };

  return tenant;
}

function setAuthCookie(res, escolaId, userId) {
  res.cookie(COOKIE_NAME, JSON.stringify({ escolaId, userId }), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/* Middleware: valida o cookie de sessão, carrega escola + utilizador
   da BD e anexa-os ao request. */
async function requireAuth(req, res, next) {
  try {
    const raw = req.signedCookies ? req.signedCookies[COOKIE_NAME] : null;
    if (!raw) return res.status(401).json({ success: false, error: 'Sessão inválida. Autentica-te novamente.' });

    let sessao;
    try { sessao = JSON.parse(raw); } catch { sessao = null; }

    const escolaId = parseInt(sessao?.escolaId, 10);
    const userId = parseInt(sessao?.userId, 10);

    if (!sessao || isNaN(escolaId) || isNaN(userId)) {
      clearAuthCookie(res);
      return res.status(401).json({ success: false, error: 'Sessão inválida. Autentica-te novamente.' });
    }

    try {
      const escolaResult = await query('SELECT * FROM escolas WHERE id = @id', { id: escolaId });
      const escolaRow = escolaResult.recordset[0];
      if (!escolaRow) { clearAuthCookie(res); return res.status(401).json({ success: false, error: 'Escola não encontrada.' }); }

      const userResult = await query(
        `SELECT id, escola_id AS escolaId, nome, username, role, instrutor_id AS instrutorId
         FROM users WHERE id = @id AND escola_id = @escolaId`,
        { id: userId, escolaId: escolaId }
      );
      const userRow = userResult.recordset[0];
      if (!userRow) { clearAuthCookie(res); return res.status(401).json({ success: false, error: 'Utilizador não encontrado.' }); }

      req.escolaId = escolaRow.id;
      req.escola = escolaFull(escolaRow);
      req.user = userRow;
      req.tenant = await loadTenantForEscola(escolaRow.id);
      return next();
    } catch (dbErr) {
      console.error('DB auth failed:', dbErr.message || dbErr);
      return res.status(503).json({ success: false, error: `Base de dados indisponível: ${dbErr.message || dbErr}` });
    }
  } catch (ex) {
    res.status(500).json({ success: false, error: `Erro de autenticação: ${ex.message || ex}` });
  }
}

/* Cria uma escola nova + o utilizador "super" inicial + o catálogo
   por omissão (sp_seed_escola). */
async function registarEscola({ nomeEscola, username, password, email, telefone }) {
  const nome = String(nomeEscola || '').trim();
  const user = String(username || '').trim();
  const pass = String(password || '').trim();
  if (!nome || !user || !pass) return { error: 'Nome da escola, username e password são obrigatórios.' };

  const existente = await query('SELECT id FROM escolas WHERE LOWER(username) = LOWER(@username)', { username: user });
  if (existente.recordset.length) return { error: 'Já existe uma escola com esse username.' };

  const passwordHash = bcrypt.hashSync(pass, 10);

  const insertEscola = await query(
    `INSERT INTO escolas (nome, username, password_hash, email, telefone)
     OUTPUT inserted.*
     VALUES (@nome, @username, @passwordHash, @email, @telefone)`,
    { nome, username: user, passwordHash, email: email || null, telefone: telefone || null }
  );
  const escolaRow = insertEscola.recordset[0];

  await seedEscola(escolaRow.id);

  const insertUser = await query(
    `INSERT INTO users (escola_id, nome, username, password_hash, role)
     OUTPUT inserted.id, inserted.escola_id AS escolaId, inserted.nome, inserted.username, inserted.role, inserted.instrutor_id AS instrutorId
     VALUES (@escolaId, @nomeUser, @username, @passwordHash, 'super')`,
    { escolaId: escolaRow.id, nomeUser: `${nome} Super`, username: user, passwordHash }
  );

  return { escola: escolaRow, user: insertUser.recordset[0] };
}

/* Autentica por username+password, procurando entre TODOS os
   utilizadores de TODAS as escolas. */
async function autenticar({ username, password }) {
  const user = String(username || '').trim();
  const pass = String(password || '').trim();
  if (!user || !pass) return { error: 'Username e password são obrigatórios.' };

  const result = await query(
    `SELECT u.id, u.escola_id AS escolaId, u.nome, u.username, u.password_hash AS passwordHash,
            u.role, u.instrutor_id AS instrutorId, e.*
     FROM users u
     JOIN escolas e ON e.id = u.escola_id
     WHERE LOWER(u.username) = LOWER(@username)`,
    { username: user }
  );
  const row = result.recordset[0];
  if (!row || !bcrypt.compareSync(pass, row.passwordHash)) {
    return { error: 'Credenciais inválidas.' };
  }

  const escolaRow = { ...row };
  const userRow = { id: row.id, escolaId: row.escolaId, nome: row.nome, username: row.username, role: row.role, instrutorId: row.instrutorId };

  return { escola: escolaRow, user: userRow };
}

module.exports = { requireAuth, setAuthCookie, clearAuthCookie, registarEscola, autenticar, loadTenantForEscola };