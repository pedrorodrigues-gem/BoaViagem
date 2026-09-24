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
  if (typeof aluno.cartasCategorias === 'string' && aluno.cartasCategorias.trim()) {
    try {
      aluno.cartasCategorias = JSON.parse(aluno.cartasCategorias);
    } catch (_) {
      aluno.cartasCategorias = [];
    }
  } else if (!Array.isArray(aluno.cartasCategorias)) {
    aluno.cartasCategorias = [];
  }
  aluno.tipoDesconto = aluno.tipoDesconto || aluno.tipo_desconto || 'valor';
  return aluno;
}

// Cache em memória para tenant por escola, evitando 15+ queries por cada pedido HTTP.
const tenantCache = new Map();
const inFlightTenantPromises = new Map();
const TENANT_CACHE_TTL_MS = 60 * 1000; // 60 segundos

function invalidateTenantCache(escolaId) {
  if (escolaId != null) {
    tenantCache.delete(Number(escolaId));
    inFlightTenantPromises.delete(Number(escolaId));
  } else {
    tenantCache.clear();
    inFlightTenantPromises.clear();
  }
}

const COLUNAS_LEVES_ALUNOS = 'id, escola_id, pessoa_id, espaco_id, numero_aluno, nome, email, telefone, categoria, estado, data_inscricao, aulas_teoricas, aulas_praticas, notas, data_nascimento, nif, tipo_documento, numero_documento, validade_documento, morada, codigo_postal, localidade, dispensa_modulos, desconto, tipo_desconto, cartas_categorias, atestado_data_emissao, atestado_data_validade, atestado_apto, psicotecnico_aplicavel, psicotecnico_data_emissao, psicotecnico_data_validade, imt_numero, imt_data_emissao, imt_data_validade, plano_carta_id';
const COLUNAS_LEVES_INSTRUTORES = 'id, escola_id, pessoa_id, nome, email, telefone, estado, cargo, nif, titulo_profissional_numero, titulo_profissional_validade';

async function loadTenantForEscola(escolaId) {
  const eId = Number(escolaId);
  const now = Date.now();
  const cached = tenantCache.get(eId);
  if (cached && now < cached.expiresAt) {
    return cached.tenant;
  }
  if (inFlightTenantPromises.has(eId)) {
    return inFlightTenantPromises.get(eId);
  }

  const promise = (async () => {
    try {
      const tenant = await _fetchTenantFromDb(eId);
      tenantCache.set(eId, { tenant, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
      return tenant;
    } finally {
      inFlightTenantPromises.delete(eId);
    }
  })();

  inFlightTenantPromises.set(eId, promise);
  return promise;
}

async function _fetchTenantFromDb(escolaId) {
  const FULL = process.env.LOAD_FULL_TENANT === 'true';

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
      query(`SELECT ${COLUNAS_LEVES_ALUNOS} FROM alunos WHERE escola_id = @escolaId ORDER BY id`, { escolaId }),
      query(`SELECT ${COLUNAS_LEVES_INSTRUTORES} FROM instrutores WHERE escola_id = @escolaId ORDER BY id`, { escolaId }),
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
    // Carregamento rápido e leve: tabelas pequenas essenciais (~150ms)
    const [instrutores, veiculos, pessoas, espacos, requisitos, produtos, users, preInscricoes] = await Promise.all([
      query(`SELECT ${COLUNAS_LEVES_INSTRUTORES} FROM instrutores WHERE escola_id = @escolaId ORDER BY id`, { escolaId }),
      query('SELECT * FROM veiculos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pessoas WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM espacos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM requisitos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM produtos WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM users WHERE escola_id = @escolaId ORDER BY id', { escolaId }),
      query('SELECT * FROM pre_inscricoes WHERE escola_id = @escolaId ORDER BY id DESC', { escolaId })
    ]);

    tenant.instrutores = normalizeRows(instrutores.recordset);
    tenant.veiculos = normalizeRows(veiculos.recordset);
    tenant.pessoas = normalizeRows(pessoas.recordset);
    tenant.espacos = normalizeRows(espacos.recordset);
    tenant.requisitos = normalizeRows(requisitos.recordset);
    tenant.produtos = normalizeRows(produtos.recordset);
    tenant.users = normalizeRows(users.recordset);
    tenant.preInscricoes = normalizeRows(preInscricoes.recordset);
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

/* Resolve a sessão a partir do cookie sem forçar rejeição HTTP 401 */
async function resolveSession(req) {
  const raw = req.signedCookies ? req.signedCookies[COOKIE_NAME] : null;
  if (!raw) return { authenticated: false };

  let sessao;
  try { sessao = JSON.parse(raw); } catch { sessao = null; }

  const escolaId = parseInt(sessao?.escolaId, 10);
  const userId = parseInt(sessao?.userId, 10);

  if (!sessao || isNaN(escolaId) || isNaN(userId)) {
    return { authenticated: false, shouldClearCookie: true };
  }

  try {
    const escolaResult = await query('SELECT * FROM escolas WHERE id = @id', { id: escolaId });
    const escolaRow = escolaResult?.recordset?.[0];
    if (!escolaRow) {
      return { authenticated: false, shouldClearCookie: true, error: 'Escola não encontrada.' };
    }

    const userResult = await query(
      `SELECT id, escola_id AS escolaId, nome, username, role, instrutor_id AS instrutorId
       FROM users WHERE id = @id AND escola_id = @escolaId`,
      { id: userId, escolaId: escolaId }
    );
    const userRow = userResult?.recordset?.[0];
    if (!userRow) {
      return { authenticated: false, shouldClearCookie: true, error: 'Utilizador não encontrado.' };
    }

    return {
      authenticated: true,
      escolaId: escolaRow.id,
      escola: escolaFull(escolaRow),
      user: userRow
    };
  } catch (dbErr) {
    console.error('DB auth check failed:', dbErr.message || dbErr);
    return { authenticated: false, dbError: dbErr };
  }
}

/* Middleware: valida o cookie de sessão, carrega escola + utilizador
   da BD e anexa-os ao request. Rejeita com 401 se inválido. */
async function requireAuth(req, res, next) {
  try {
    const result = await resolveSession(req);
    if (result.dbError) {
      return res.status(503).json({ success: false, error: `Base de dados indisponível: ${result.dbError.message || result.dbError}` });
    }
    if (!result.authenticated) {
      if (result.shouldClearCookie) clearAuthCookie(res);
      return res.status(401).json({ success: false, error: result.error || 'Sessão inválida. Autentica-te novamente.' });
    }
    req.escolaId = result.escolaId;
    req.escola = result.escola;
    req.user = result.user;
    req.tenant = await loadTenantForEscola(result.escolaId);
    return next();
  } catch (ex) {
    res.status(500).json({ success: false, error: `Erro de autenticação: ${ex.message || ex}` });
  }
}

/* Middleware: verifica se existe sessão válida sem forçar 401 se ausente */
async function optionalAuth(req, res, next) {
  try {
    const result = await resolveSession(req);
    if (result.authenticated) {
      req.escolaId = result.escolaId;
      req.escola = result.escola;
      req.user = result.user;
    } else if (result.shouldClearCookie) {
      clearAuthCookie(res);
    }
    return next();
  } catch (ex) {
    return next();
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
    `SELECT
       u.id AS user_id,
       u.escola_id AS user_escola_id,
       u.nome AS user_nome,
       u.username AS user_username,
       u.password_hash AS user_password_hash,
       u.role AS user_role,
       u.instrutor_id AS user_instrutor_id,
       e.id AS escola_id_col,
       e.nome AS escola_nome,
       e.username AS escola_username,
       e.email AS escola_email,
       e.telefone AS escola_telefone,
       e.nipc AS escola_nipc,
       e.morada AS escola_morada,
       e.numero_licenca_imt AS escola_numero_licenca_imt,
       e.nome_diretor AS escola_nome_diretor,
       e.data_criacao AS escola_data_criacao,
       e.primavera_ativo,
       e.primavera_base_url,
       e.primavera_empresa,
       e.primavera_client_id,
       e.primavera_api_key,
       e.primavera_serie,
       e.primavera_modo_pag,
       e.primavera_conta_bancaria,
       e.primavera_filial,
       e.primavera_taxa_iva_default,
       e.primavera_armazem,
       e.primavera_artigo_formacao
     FROM users u
     JOIN escolas e ON e.id = u.escola_id
     WHERE LOWER(u.username) = LOWER(@username)`,
    { username: user }
  );
  const row = result.recordset[0];
  if (!row || !bcrypt.compareSync(pass, row.user_password_hash)) {
    return { error: 'Credenciais inválidas.' };
  }

  const userRow = {
    id: row.user_id,
    escolaId: row.user_escola_id,
    nome: row.user_nome,
    username: row.user_username,
    role: row.user_role,
    instrutorId: row.user_instrutor_id
  };

  const escolaRow = {
    id: row.escola_id_col,
    nome: row.escola_nome,
    username: row.escola_username,
    email: row.escola_email,
    telefone: row.escola_telefone,
    nipc: row.escola_nipc,
    morada: row.escola_morada,
    numero_licenca_imt: row.escola_numero_licenca_imt,
    nome_diretor: row.escola_nome_diretor,
    data_criacao: row.escola_data_criacao,
    primavera_ativo: row.primavera_ativo,
    primavera_base_url: row.primavera_base_url,
    primavera_empresa: row.primavera_empresa,
    primavera_client_id: row.primavera_client_id,
    primavera_api_key: row.primavera_api_key,
    primavera_serie: row.primavera_serie,
    primavera_modo_pag: row.primavera_modo_pag,
    primavera_conta_bancaria: row.primavera_conta_bancaria,
    primavera_filial: row.primavera_filial,
    primavera_taxa_iva_default: row.primavera_taxa_iva_default,
    primavera_armazem: row.primavera_armazem,
    primavera_artigo_formacao: row.primavera_artigo_formacao
  };

  return { escola: escolaRow, user: userRow };
}

module.exports = {
  requireAuth,
  optionalAuth,
  resolveSession,
  setAuthCookie,
  clearAuthCookie,
  registarEscola,
  autenticar,
  loadTenantForEscola,
  invalidateTenantCache
};