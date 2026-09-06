/* ============================================================
   RotaCerta — Servidor multi-escola (API + estáticos)
   ============================================================
   Índice deste ficheiro (para facilitar futuras alterações):
     1. Bootstrap / middlewares globais
     2. Helpers genéricos (respostas, normalização de texto/estado)
     3. Mapeamento de colunas SQL <-> JS
     4. Factory de rotas CRUD genéricas
     5. Autenticação
     6. Preço da carta / composição por categoria
     7. Aluno: aninhar/achatar subcampos + documentos
     8. Coleções CRUD (alunos, instrutores, espaços, veículos, aulas,
        turmas teóricas, requisitos, pagamentos, itensConta, produtos)
     9. Contratos (cálculo de valores + conta corrente do contrato)
    10. Exames — marcações e estatísticas
    11. Utilizadores e configuração da escola
    12. Pré-inscrições
    13. Dados da escola / integração Primavera / faturação
    14. Assinatura e PDF do contrato
    15. Helpers de tempo/horas + assiduidade
    16. Presenças de turma teórica
    17. Calendário unificado + exportação .ics
    18. Conta corrente por aluno
    19. Relatórios (por aluno, geral, espera teórica->prática, etc.)
    20. Estatísticas agregadas (/api/estatisticas)
    21. Dashboard summary
   ============================================================ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { query, escolaPublic, defaultPrimaveraConfig, nestEscolaPrimavera } = require('./db');
const { requireAuth, setAuthCookie, clearAuthCookie, registarEscola, autenticar, invalidateTenantCache } = require('./auth');
const invoicing = require('./invoicing');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------
   1. Bootstrap / middlewares globais
   ------------------------------------------------------------ */
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'chave_secreta_super_segura_boa_viagem'));
app.use(express.static(path.join(__dirname, 'public')));

const CONTRATOS_PDF_DIR = path.join(__dirname, '..', 'data', 'contratos-pdf');
function contratoPdfPath(escolaId, contratoId) {
  return path.join(CONTRATOS_PDF_DIR, String(escolaId), `contrato-${contratoId}.pdf`);
}

async function ensureSchemaColumns() {
  try {
    await query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('espacos') AND name = 'serie')
        ALTER TABLE espacos ADD serie NVARCHAR(20) NULL;

      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('pagamentos') AND name = 'modo_pagamento')
        ALTER TABLE pagamentos ADD modo_pagamento NVARCHAR(10) NOT NULL DEFAULT 'PGNUM';

      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('contratos') AND name = 'assinatura_tutor_nome_digitado')
        ALTER TABLE contratos ADD assinatura_tutor_nome_digitado NVARCHAR(200) NULL;

      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('contratos') AND name = 'assinatura_tutor_imagem')
        ALTER TABLE contratos ADD assinatura_tutor_imagem VARBINARY(MAX) NULL;
    `);
  } catch (err) {
    console.warn('Aviso ao verificar colunas da BD:', err.message || err);
  }
}
ensureSchemaColumns();

async function obterSerieParaAluno(req, aluno) {
  if (aluno && (aluno.espacoId || aluno.espaco_id)) {
    const espacoId = aluno.espacoId || aluno.espaco_id;
    try {
      const espacoRes = await query('SELECT serie FROM espacos WHERE id=@id AND escola_id=@escolaId', { id: espacoId, escolaId: req.escolaId });
      const serieEspaco = espacoRes.recordset[0]?.serie;
      if (serieEspaco && String(serieEspaco).trim()) return String(serieEspaco).trim();
    } catch (e) { /* fallback */ }
  }
  nestEscolaPrimavera(req.escola);
  return req.escola?.primavera?.serie || null;
}

/* ------------------------------------------------------------
   2. Helpers genéricos
   ------------------------------------------------------------ */
function dstr(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v ?? '');
}
function ok(res, data) { res.json({ success: true, data }); }
function notFound(res, msg) { res.status(404).json({ success: false, error: msg || 'Não encontrado' }); }
function badRequest(res, msg) { res.status(400).json({ success: false, error: msg || 'Pedido inválido' }); }

/* ---------- Normalização de tipo/estado ----------
   USADA EM TODO O FICHEIRO sempre que se compara `tipo` ('Prática' /
   'Teórica') ou `estado` ('Concluída' / 'Cancelada') de uma aula ou
   turma. Comparações estritas (===) partiam-se com qualquer variação
   de acentuação, maiúsculas/minúsculas ou grafia gravada na BD
   ("pratica", "Concluido", "concluída" sem acento, "CANCELADA", etc.),
   fazendo com que aulas corretamente registadas desaparecessem
   silenciosamente das contagens de horas teóricas/práticas, dos
   relatórios e das estatísticas. Esta é a fonte única de verdade para
   essas comparações — qualquer nova rota que conte aulas por tipo ou
   estado deve usar estes helpers em vez de `===`. */
const ESTADOS_CONCLUIDA = ['Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído'];
const ESTADOS_CANCELADA = ['Cancelada', 'Cancelado', 'Anulada', 'Anulado'];

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
function isTipo(item, tipoAlvo) {
  return normalizeText(item && item.tipo) === normalizeText(tipoAlvo);
}
const ESTADOS_CONCLUIDA_NORM = ESTADOS_CONCLUIDA.map(normalizeText);
function isEstadoConcluida(estado) {
  return ESTADOS_CONCLUIDA_NORM.includes(normalizeText(estado));
}
const ESTADOS_CANCELADA_NORM = ESTADOS_CANCELADA.map(normalizeText);
function isEstadoCancelada(estado) {
  return ESTADOS_CANCELADA_NORM.includes(normalizeText(estado));
}

/* ------------------------------------------------------------
   3. Autenticação
   ------------------------------------------------------------ */

app.post('/api/auth/registar', async (req, res) => {
  try {
    const { nomeEscola, username, password, email, telefone } = req.body || {};
    const result = await registarEscola({ nomeEscola, username, password, email, telefone });
    if (result && result.error) return badRequest(res, result.error);
    if (!result || !result.escola || !result.user) {
      return res.status(503).json({ success: false, error: 'Não foi possível criar a escola porque a base de dados não está acessível.' });
    }
    setAuthCookie(res, result.escola.id, result.user.id);
    ok(res, { escola: escolaPublic(result.escola), user: { id: result.user.id, nome: result.user.nome, username: result.user.username, role: result.user.role, instrutorId: result.user.instrutorId || null } });
  } catch (ex) {
    return res.status(503).json({ success: false, error: `Não foi possível contactar a base de dados: ${ex.message || ex}` });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = await autenticar({ username, password });
    if (result && result.error) return res.status(401).json({ success: false, error: result.error });
    if (!result || !result.escola || !result.user) {
      return res.status(503).json({ success: false, error: 'Não foi possível autenticar porque a base de dados não está acessível.' });
    }
    setAuthCookie(res, result.escola.id, result.user.id);
    ok(res, { escola: escolaPublic(result.escola), user: { id: result.user.id, nome: result.user.nome, username: result.user.username, role: result.user.role, instrutorId: result.user.instrutorId || null } });
  } catch (ex) {
    return res.status(503).json({ success: false, error: `Não foi possível contactar a base de dados: ${ex.message || ex}` });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  ok(res, true);
});

/* A partir daqui, todas as rotas /api/* exigem sessão válida
   e operam apenas sobre os dados da escola autenticada.        */
app.use('/api', requireAuth);


app.get('/api/auth/me', requireAuth, (req, res) => {
  ok(res, { escola: escolaPublic(req.escola), user: { id: req.user.id, nome: req.user.nome, username: req.user.username, role: req.user.role, instrutorId: req.user.instrutorId || null } });
});

/* As coleções carregadas para req.tenant no middleware requireAuth (auth.js)
   nem sempre passam pelo mesmo caminho de normalização que fetchCollectionFromSql
   (dbRowToJs/formatDateValue) — por isso campos de data podem chegar como
   objeto Date em vez de string, partindo qualquer `.data.localeCompare(...)`
   espalhado pelo ficheiro. Normaliza-se aqui, uma única vez por pedido,
   assim que o tenant é acedido pela primeira vez. */
const COLECOES_COM_CAMPOS_DATA = {
  examesMarcacoes: ['data'],
  aulas: ['data'],
  turmasTeoricas: ['data'],
  pagamentos: ['data'],
  preInscricoes: ['dataPreInscricao', 'dataInscricao'],
  alunos: ['dataInscricao', 'dataNascimento']
};

function normalizarDatasTenant(tenant) {
  if (tenant.__datasNormalizadas) return tenant;
  for (const [colecao, campos] of Object.entries(COLECOES_COM_CAMPOS_DATA)) {
    const lista = tenant[colecao];
    if (!Array.isArray(lista)) continue;
    lista.forEach(item => {
      campos.forEach(campo => {
        if (item[campo] instanceof Date) item[campo] = formatDateValue(item[campo]);
      });
    });
  }
  tenant.__datasNormalizadas = true;
  return tenant;
}

// Devolve sempre o tenant já carregado (com dados reais da SQL) pelo
// middleware requireAuth — nunca um objeto novo/vazio.
function currentTenant(req) {
  req.tenant = req.tenant || { config: { composicaoCarta: {} } };
  normalizarDatasTenant(req.tenant);
  return { tenant: req.tenant };
}

function camelToSnake(str) {
  return String(str || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
}

/* Converte um valor recebido do cliente (possível base64/data-URL) num
   Buffer para gravar em colunas VARBINARY (ex: fotos). */
function fotoParaBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  try {
    const base64 = String(value).includes(',') ? String(value).split(',').pop() : String(value);
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------
   4. Mapeamento de colunas SQL <-> JS
   ------------------------------------------------------------ */

/* Colunas reais de cada tabela — usado para filtrar do payload
   recebido qualquer campo computado/transitório que não corresponda
   a uma coluna (ex: itensCarta, parcelasPersonalizadas, avisoRecibo),
   evitando erros de SQL "Invalid column name". */
const COLUMNS_BY_TABLE = {
  alunos: ['pessoa_id', 'espaco_id', 'numero_aluno', 'nome', 'email', 'telefone', 'categoria', 'estado', 'data_inscricao', 'aulas_teoricas', 'aulas_praticas', 'notas', 'data_nascimento', 'nif', 'tipo_documento', 'numero_documento', 'validade_documento', 'morada', 'codigo_postal', 'localidade', 'dispensa_modulos', 'desconto', 'foto', 'atestado_data_emissao', 'atestado_data_validade', 'atestado_apto', 'psicotecnico_aplicavel', 'psicotecnico_data_emissao', 'psicotecnico_data_validade', 'imt_numero', 'imt_data_emissao', 'imt_data_validade'],
  instrutores: ['pessoa_id', 'nome', 'email', 'telefone', 'estado', 'cargo', 'nif', 'titulo_profissional_numero', 'titulo_profissional_validade', 'foto'],
  pessoas: ['nome', 'tipo_pessoa', 'origem_collection', 'origem_id', 'email', 'telefone', 'estado'],
  espacos: ['nome', 'observacoes', 'serie'],
  veiculos: ['matricula', 'marca', 'modelo', 'categoria', 'estado', 'inspecao_valida', 'seguro_instrucao_validade', 'data_afetacao_escola'],
  aulas: ['aluno_id', 'instrutor_id', 'veiculo_id', 'espaco_id', 'data', 'hora', 'hora_fim', 'duracao', 'km', 'tipo', 'modulo', 'estado', 'notas'],
  turmas_teoricas: ['espaco_id', 'instrutor_id', 'tema', 'data', 'hora_inicio', 'hora_fim', 'sala', 'estado'],
  requisitos: ['categoria', 'horas_teoricas_min', 'horas_praticas_min', 'km_pratica_min'],
  produtos: ['codigo', 'descricao', 'categoria', 'valor', 'descontavel', 'taxa_iva'],
  contratos: ['aluno_id', 'categoria', 'plano_carta_id', 'plano_pagamento', 'numero_prestacoes', 'estado', 'valor_carta_calculado', 'desconto_aplicado', 'valor_total', 'texto_contrato', 'assinatura_nome_digitado', 'assinatura_data_hora', 'assinatura_tutor_nome_digitado'],
  pagamentos: ['aluno_id', 'valor', 'data', 'descricao', 'taxa_iva', 'estado', 'modo_pagamento'],
  itens_conta: ['aluno_id', 'origem_contrato_id', 'codigo', 'descricao', 'categoria', 'valor', 'taxa_iva', 'estado', 'origem_plano', 'ordem'],  pre_inscricoes: ['nome', 'email', 'categoria', 'desconto', 'estado', 'observacoes', 'data_pre_inscricao', 'data_inscricao', 'aluno_id'],
  exames_marcacoes: ['aluno_id', 'tipo', 'data', 'hora', 'hora_fim', 'duracao', 'local', 'estado', 'observacoes', 'resultado']
};

function jsToDbRow(table, row, extra = {}) {
  const allowed = COLUMNS_BY_TABLE[table];
  const out = { ...extra };
  for (const [key, value] of Object.entries(row || {})) {
    if (key === 'id' || key === 'escolaId') continue;
    const dbKey = camelToSnake(key);
    if (allowed && !allowed.includes(dbKey)) continue;
    if (dbKey === 'foto' || dbKey === 'assinatura_imagem' || dbKey === 'assinatura_tutor_imagem') {
      out[dbKey] = { type: require('mssql').VarBinary(require('mssql').MAX), value: fotoParaBuffer(value) };
    } else {
      out[dbKey] = value;
    }
  }
  return out;
}

function formatDateValue(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  const h = value.getUTCHours(), m = value.getUTCMinutes(), s = value.getUTCSeconds(), ms = value.getUTCMilliseconds();
  if (h === 0 && m === 0 && s === 0 && ms === 0) {
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`; // coluna DATE
  }
  return value.toISOString(); // coluna DATETIME
}

function formatRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = formatDateValue(v);
  return out;
}

function dbRowToJs(row = {}) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const jsKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[jsKey] = Buffer.isBuffer(value) ? value.toString('base64') : formatDateValue(value);
  }
  return out;
}

const TABLE_MAP = {
  alunos: 'alunos',
  instrutores: 'instrutores',
  pessoas: 'pessoas',
  espacos: 'espacos',
  veiculos: 'veiculos',
  aulas: 'aulas',
  turmasTeoricas: 'turmas_teoricas',
  requisitos: 'requisitos',
  produtos: 'produtos',
  contratos: 'contratos',
  pagamentos: 'pagamentos',
  itensConta: 'itens_conta',
  preInscricoes: 'pre_inscricoes',
  examesMarcacoes: 'exames_marcacoes',
  users: 'users'
};

function collectionTableName(name) {
  return TABLE_MAP[name] || camelToSnake(name);
}

const LISTAGEM_SEM_FOTO = {
  alunos: 'pessoa_id, espaco_id, numero_aluno, nome, email, telefone, categoria, estado, data_inscricao, aulas_teoricas, aulas_praticas, notas, data_nascimento, nif, tipo_documento, numero_documento, validade_documento, morada, codigo_postal, localidade, dispensa_modulos, desconto, atestado_data_emissao, atestado_data_validade, atestado_apto, psicotecnico_aplicavel, psicotecnico_data_emissao, psicotecnico_data_validade, imt_numero, imt_data_emissao, imt_data_validade',
  instrutores: 'pessoa_id, nome, email, telefone, estado, cargo, nif, titulo_profissional_numero, titulo_profissional_validade'
};

async function fetchCollectionFromSql(req, name) {
  const table = collectionTableName(name);
  // Support optional pagination to avoid returning extremely large resultsets
  // Clients may pass `?limit=100&offset=0` to page results. If not provided,
  // the behaviour remains the same (return all rows) to preserve backwards
  // compatibility for existing clients until the frontend is adapted.
  const limit = Number(req.query?.limit || 0);
  const colunas = LISTAGEM_SEM_FOTO[name] ? `id, escola_id, ${LISTAGEM_SEM_FOTO[name]}` : '*';
  const offset = Number(req.query?.offset || 0);
  let sqlText = `SELECT ${colunas} FROM ${table} WHERE escola_id = @escolaId ORDER BY id`;
  const params = { escolaId: req.escolaId };
  if (Number.isFinite(limit) && limit > 0) {
    // Use OFFSET/FETCH for SQL Server pagination
    sqlText += ` OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
    params.offset = offset || 0;
    params.limit = limit;
  }
  const result = await query(sqlText, params);
  const rows = (result.recordset || []).map(dbRowToJs);
  req.tenant = req.tenant || { config: { composicaoCarta: {} } };
  req.tenant[name] = rows;
  return rows;
}

async function fetchItemFromSql(req, name, id) {
  const table = collectionTableName(name);
  const result = await query(`SELECT * FROM ${table} WHERE escola_id = @escolaId AND id = @id`, {
    escolaId: req.escolaId,
    id: Number(id)
  });
  const row = result.recordset[0];
  if (!row) return null;
  const item = dbRowToJs(row);
  req.tenant = req.tenant || { config: { composicaoCarta: {} } };
  const list = req.tenant[name] || [];
  const idx = list.findIndex(x => Number(x.id) === Number(id));
  if (idx >= 0) list[idx] = item; else list.push(item);
  req.tenant[name] = list;
  return item;
}

async function insertItemToSql(req, name, payload) {
  const table = collectionTableName(name);
  const record = jsToDbRow(table, payload, { escola_id: req.escolaId });
  const columns = Object.keys(record);
  const values = columns.map(col => '@' + col);
  const result = await query(
    `INSERT INTO ${table} (${columns.join(', ')}) OUTPUT inserted.* VALUES (${values.join(', ')})`,
    record
  );
  invalidateTenantCache(req.escolaId);
  return dbRowToJs(result.recordset[0]);
}

async function updateItemToSql(req, name, id, payload) {
  const table = collectionTableName(name);
  const record = jsToDbRow(table, payload);
  const assignments = Object.keys(record).map(key => `${key} = @${key}`).join(', ');
  if (!assignments) {
    const existing = await query(`SELECT * FROM ${table} WHERE id=@id AND escola_id=@escolaId`, { id: Number(id), escolaId: req.escolaId });
    return existing.recordset[0] ? dbRowToJs(existing.recordset[0]) : null;
  }
  const params = { ...record, id: Number(id), escolaId: req.escolaId };
  const result = await query(
    `UPDATE ${table} SET ${assignments} OUTPUT inserted.* WHERE id = @id AND escola_id = @escolaId`,
    params
  );
  invalidateTenantCache(req.escolaId);
  return result.recordset[0] ? dbRowToJs(result.recordset[0]) : null;
}

async function deleteItemFromSql(req, name, id) {
  const table = collectionTableName(name);
  const result = await query(
    `SELECT * FROM ${table} WHERE escola_id = @escolaId AND id = @id`,
    { escolaId: req.escolaId, id: Number(id) }
  );
  const item = result.recordset[0] ? dbRowToJs(result.recordset[0]) : null;
  await query(`DELETE FROM ${table} WHERE escola_id = @escolaId AND id = @id`, {
    escolaId: req.escolaId,
    id: Number(id)
  });
  invalidateTenantCache(req.escolaId);
  return item;
}

/* ------------------------------------------------------------
   5. Factory de rotas CRUD genéricas
   ------------------------------------------------------------
   `onCreate`/`onUpdate`/`onDelete` podem ser síncronas ou `async`.
   `onAfterCreate(saved, tenant, req, item)` corre DEPOIS do INSERT
   (só aí se conhece o id gerado pela BD) — útil para criar registos
   dependentes (ex: pessoa associada, itens de conta corrente).
   `transformOut(row, tenant, req)` deixa moldar a resposta enviada
   ao cliente (ex: aninhar subcampos, juntar dados de outra tabela). */
function collectionRoutes(name, { validate, onCreate, onUpdate, onDelete, onAfterCreate, onAfterUpdate, onAfterDelete, transformOut } = {}) {
  const router = express.Router();
  const applyOut = async (row, tenant, req) => (row && transformOut ? (await transformOut(row, tenant, req)) || row : row);

  router.get('/', async (req, res) => {
    try {
      const rows = await fetchCollectionFromSql(req, name);
      const { tenant } = currentTenant(req);
      const out = transformOut ? await Promise.all(rows.map(r => applyOut(r, tenant, req))) : rows;
      ok(res, out);
    } catch (ex) {
      res.status(503).json({ success: false, error: `Falha ao ler ${name}: ${ex.message || ex}` });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const item = await fetchItemFromSql(req, name, req.params.id);
      if (!item) return notFound(res);
      const { tenant } = currentTenant(req);
      ok(res, await applyOut(item, tenant, req));
    } catch (ex) {
      res.status(503).json({ success: false, error: `Falha ao ler ${name}: ${ex.message || ex}` });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { tenant } = currentTenant(req);
      const payload = { ...(req.body || {}) };
      delete payload.id;
      if (validate) {
        const err = validate(payload, tenant, req);
        if (err) return badRequest(res, err);
      }
      const item = { ...payload };
      if (onCreate) {
        try {
          await onCreate(item, tenant, req);
        } catch (ex) {
          item._avisoPosCriacao = `O registo foi criado, mas ocorreu um aviso: ${ex.message || ex}`;
        }
      }
      let saved = await insertItemToSql(req, name, item);
      if (onAfterCreate) {
        try {
          saved = (await onAfterCreate(saved, tenant, req, item)) || saved;
        } catch (ex) {
          saved._avisoPosCriacao = `O registo foi criado, mas ocorreu um aviso: ${ex.message || ex}`;
        }
      }
      const list = tenant[name] || [];
      list.push(saved);
      tenant[name] = list;
      ok(res, await applyOut(saved, tenant, req));
    } catch (ex) {
      res.status(503).json({ success: false, error: `Falha ao criar ${name}: ${ex.message || ex}` });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { tenant } = currentTenant(req);
      const idx = (tenant[name] || []).findIndex(x => x.id === Number(req.params.id));
      let anterior = idx >= 0 ? tenant[name][idx] : null;
      if (!anterior) {
        anterior = await fetchItemFromSql(req, name, req.params.id);
        if (!anterior) return notFound(res);
      }
      if (validate) {
        const err = validate(req.body || {}, tenant, req);
        if (err) return badRequest(res, err);
      }
      const atualizado = { ...anterior, ...req.body, id: Number(req.params.id) };
      if (onUpdate) {
        try {
          await onUpdate(atualizado, anterior, tenant, req);
        } catch (ex) {
          atualizado._avisoPosAtualizacao = `O registo foi atualizado, mas ocorreu um aviso: ${ex.message || ex}`;
        }
      }
      const saved = await updateItemToSql(req, name, req.params.id, atualizado);
      if (!saved) return notFound(res);
      let finalSaved = saved;
      if (onAfterUpdate) {
        try { finalSaved = (await onAfterUpdate(saved, tenant, req, atualizado)) || saved; }
        catch (ex) { finalSaved._avisoPosAtualizacao = `O registo foi atualizado, mas ocorreu um aviso: ${ex.message || ex}`; }
      }
      const list = tenant[name] || [];
      const pos = list.findIndex(x => Number(x.id) === Number(req.params.id));
      if (pos >= 0) list[pos] = finalSaved; else list.push(finalSaved);
      tenant[name] = list;
      ok(res, await applyOut(finalSaved, tenant, req));
    } catch (ex) {
      res.status(503).json({ success: false, error: `Falha ao atualizar ${name}: ${ex.message || ex}` });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const { tenant } = currentTenant(req);
      const atual = (tenant[name] || []).find(x => x.id === Number(req.params.id)) || await fetchItemFromSql(req, name, req.params.id);
      if (onDelete && atual) {
        const resultOrErr = await onDelete(atual, tenant, req, res);
        if (res.headersSent) return;
        if (typeof resultOrErr === 'string') return badRequest(res, resultOrErr);
        if (resultOrErr && resultOrErr.convertedToNC) {
          return ok(res, resultOrErr);
        }
      }
      const removed = await deleteItemFromSql(req, name, req.params.id);
      if (!removed) return notFound(res);
      tenant[name] = (tenant[name] || []).filter(x => Number(x.id) !== Number(req.params.id));
      if (onAfterDelete) {
        try { await onAfterDelete(removed, tenant, req); } catch (ex) { /* não bloqueia a remoção */ }
      }
      ok(res, removed);
    } catch (ex) {
      res.status(503).json({ success: false, error: `Falha ao remover ${name}: ${ex.message || ex}` });
    }
  });

  return router;
}

/* ------------------------------------------------------------
   6. Preço da carta / composição por categoria
   ------------------------------------------------------------
   Fonte única de verdade usada tanto na ficha do aluno
   (pré-visualização) como na criação do contrato (geração real
   da conta corrente). */
function obterPlanoCarta(tenant, categoria, planoCartaId) {
  const planos = (tenant.config?.composicaoCarta?.[String(categoria || '').trim()]) || [];
  if (!planos.length) return null;
  if (planoCartaId) {
    const encontrado = planos.find(p => p.id === Number(planoCartaId));
    if (encontrado) return encontrado;
  }
  return planos[0];
}

function itensCartaPorCategoria(tenant, categoria, desconto, planoCartaId) {
  const plano = obterPlanoCarta(tenant, categoria, planoCartaId);
  const composicao = plano ? plano.linhas : [];
  const d = Math.max(0, Math.min(100, Number(desconto) || 0));
  return composicao.map(linha => {
    const produto = (tenant.produtos || []).find(p => p.id === Number(linha.produtoId));
    if (!produto) return null;
    const quantidade = Math.max(1, Number(linha.quantidade) || 1);
    const valorBase = +((Number(produto.valor) || 0) * quantidade).toFixed(2);
    const descontavel = !!produto.descontavel;
    const valor = descontavel ? +(valorBase * (1 - d / 100)).toFixed(2) : valorBase;
    return {
      produtoId: produto.id,
      codigo: produto.codigo || null, // NOVO
      descricao: quantidade > 1 ? `${produto.descricao} (x${quantidade})` : produto.descricao,
      categoria: produto.categoria || 'Diversos',
      quantidade, valorBase, descontavel,
      taxaIva: Number(produto.taxaIva ?? 23),
      valor
    };
  }).filter(Boolean);
}

/* ------------------------------------------------------------
   7. Aluno: aninhar/achatar subcampos + documentos
   ------------------------------------------------------------
   Na BD, atestado médico / exame psicotécnico / processo IMT são
   colunas simples da tabela alunos. O resto da aplicação (relatórios,
   dashboard) trabalha com objetos aninhados — nestAlunoExtras() já
   é aplicado a quem vem carregado via requireAuth (ver auth.js); aqui
   replicamos o mesmo para respostas construídas à mão nesta rota. */
function nestAlunoExtras(aluno) {
  if (!aluno) return aluno;
  aluno.atestadoMedico = { dataEmissao: aluno.atestadoDataEmissao ?? null, dataValidade: aluno.atestadoDataValidade ?? null, apto: aluno.atestadoApto ?? null };
  aluno.examePsicotecnico = { aplicavel: !!aluno.psicotecnicoAplicavel, dataEmissao: aluno.psicotecnicoDataEmissao ?? null, dataValidade: aluno.psicotecnicoDataValidade ?? null };
  aluno.processoIMT = { numero: aluno.imtNumero ?? null, dataEmissao: aluno.imtDataEmissao ?? null, dataValidade: aluno.imtDataValidade ?? null };

  if (Buffer.isBuffer(aluno.foto)) {
    aluno.foto = aluno.foto.length ? `data:image/jpeg;base64,${aluno.foto.toString('base64')}` : null;
  } else if (aluno.foto && typeof aluno.foto === 'object' && aluno.foto.type === 'Buffer' && Array.isArray(aluno.foto.data)) {
    // caso já tenha passado por um round-trip JSON antes de chegar aqui
    const buf = Buffer.from(aluno.foto.data);
    aluno.foto = buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
  }

  return aluno;
}

function flattenAlunoExtras(item) {
  // --- TRATAMENTO DO CAMPO BINÁRIO (FOTO) ---
  if (item.foto !== undefined) {
    if (Buffer.isBuffer(item.foto)) {
      // já está no formato certo, não faz nada
    } else if (typeof item.foto === 'string') {
      const v = item.foto.trim();
      if (v === '') {
        item.foto = null; // remoção explícita da foto
      } else if (v.startsWith('data:image')) {
        const base64Data = v.split(',')[1] || '';
        item.foto = base64Data ? Buffer.from(base64Data, 'base64') : null;
      } else {
        // não é uma data URI válida (ex: lixo de um round-trip) — não arriscar
        // gravar binário inválido: simplesmente não atualizar esta coluna.
        delete item.foto;
      }
    } else {
      // qualquer outro tipo inesperado — mesma lógica de segurança
      delete item.foto;
    }
  }

  // --- RESTO DAS TUAS REGRAS EXISTENTES ---
  if (item.atestadoMedico && typeof item.atestadoMedico === 'object') {
    item.atestadoDataEmissao = item.atestadoMedico.dataEmissao ?? item.atestadoDataEmissao;
    item.atestadoDataValidade = item.atestadoMedico.dataValidade ?? item.atestadoDataValidade;
    item.atestadoApto = item.atestadoMedico.apto ?? item.atestadoApto;
    delete item.atestadoMedico;
  }
  if (item.examePsicotecnico && typeof item.examePsicotecnico === 'object') {
    item.psicotecnicoAplicavel = !!item.examePsicotecnico.aplicavel;
    item.psicotecnicoDataEmissao = item.examePsicotecnico.dataEmissao ?? item.psicotecnicoDataEmissao;
    item.psicotecnicoDataValidade = item.examePsicotecnico.dataValidade ?? item.psicotecnicoDataValidade;
    delete item.examePsicotecnico;
  }
  if (item.processoIMT && typeof item.processoIMT === 'object') {
    item.imtNumero = item.processoIMT.numero ?? item.imtNumero;
    item.imtDataEmissao = item.processoIMT.dataEmissao ?? item.imtDataEmissao;
    item.imtDataValidade = item.processoIMT.dataValidade ?? item.imtDataValidade;
    delete item.processoIMT;
  }
  return item;
}

async function criarPessoaSql(req, { nome, tipoPessoa, origemCollection, origemId, email, telefone, estado }) {
  const result = await query(
    `INSERT INTO pessoas (escola_id, nome, tipo_pessoa, origem_collection, origem_id, email, telefone, estado)
     OUTPUT inserted.id
     VALUES (@escolaId, @nome, @tipoPessoa, @origemCollection, @origemId, @email, @telefone, @estado)`,
    { escolaId: req.escolaId, nome: nome || '', tipoPessoa, origemCollection, origemId: origemId || null, email: email || null, telefone: telefone || null, estado: estado || 'Ativo' }
  );
  return result.recordset[0].id;
}

async function criarUserAlunoSql(req, aluno) {
  const usernameBase = (aluno.email && String(aluno.email).trim()) || `aluno${aluno.id}`;
  let username = usernameBase.toLowerCase();
  let sufixo = 1;
  while (true) {
    const dup = await query('SELECT id FROM users WHERE escola_id=@escolaId AND LOWER(username)=LOWER(@username)', { escolaId: req.escolaId, username });
    if (!dup.recordset.length) break;
    sufixo++;
    username = `${usernameBase.toLowerCase()}${sufixo}`;
  }
  const passwordHash = bcrypt.hashSync('123456', 10);
  await query(
    `INSERT INTO users (escola_id, nome, username, password_hash, role, instrutor_id, aluno_id)
     VALUES (@escolaId, @nome, @username, @passwordHash, 'aluno', NULL, @alunoId)`,
    { escolaId: req.escolaId, nome: aluno.nome || '', username, passwordHash, alunoId: aluno.id }
  );
  return username;
}

/* NOVO — mantém o username do utilizador de acesso alinhado com o email
   do aluno. Sempre que o email existe (na criação) ou é alterado (numa
   atualização), recalcula o username a partir dele. Se o aluno ainda não
   tiver utilizador de acesso (ex: criado antes desta funcionalidade
   existir, ou a criação automática falhou nessa altura), cria-o agora. */
async function sincronizarUsernameAlunoSql(req, aluno) {
  if (!aluno.email) return; // sem email não há nada a sincronizar

  const userResult = await query(
    'SELECT id, username FROM users WHERE escola_id=@escolaId AND aluno_id=@alunoId',
    { escolaId: req.escolaId, alunoId: aluno.id }
  );
  const user = userResult.recordset[0];

  if (!user) {
    await criarUserAlunoSql(req, aluno);
    return;
  }

  const novoUsernameBase = String(aluno.email).trim().toLowerCase();
  if (!novoUsernameBase || user.username.toLowerCase() === novoUsernameBase) return;

  let username = novoUsernameBase;
  let sufixo = 1;
  while (true) {
    const dup = await query(
      'SELECT id FROM users WHERE escola_id=@escolaId AND LOWER(username)=LOWER(@username) AND id<>@id',
      { escolaId: req.escolaId, username, id: user.id }
    );
    if (!dup.recordset.length) break;
    sufixo++;
    username = `${novoUsernameBase}${sufixo}`;
  }

  await query('UPDATE users SET username=@username WHERE id=@id', { username, id: user.id });
}

/* Endpoint de pesquisa global rápida via SQL */
app.get('/api/pesquisa-global', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return ok(res, []);
    const termo = `%${q}%`;
    const params = { escolaId: req.escolaId, termo };

    const [alunosRes, instrutoresRes, veiculosRes, contratosRes, turmasRes] = await Promise.all([
      query(`
        SELECT TOP 8 id, nome, numero_aluno AS numeroAluno, categoria, estado
        FROM alunos
        WHERE escola_id = @escolaId AND (nome LIKE @termo OR email LIKE @termo OR nif LIKE @termo OR CAST(numero_aluno AS NVARCHAR) LIKE @termo)
        ORDER BY nome
      `, params),
      query(`
        SELECT TOP 5 id, nome, cargo, estado
        FROM instrutores
        WHERE escola_id = @escolaId AND (nome LIKE @termo OR email LIKE @termo OR nif LIKE @termo)
        ORDER BY nome
      `, params),
      query(`
        SELECT TOP 5 id, matricula, marca, modelo, categoria, estado
        FROM veiculos
        WHERE escola_id = @escolaId AND (matricula LIKE @termo OR marca LIKE @termo OR modelo LIKE @termo)
        ORDER BY matricula
      `, params),
      query(`
        SELECT TOP 5 c.id, c.categoria, c.estado, a.nome AS alunoNome
        FROM contratos c
        JOIN alunos a ON a.id = c.aluno_id
        WHERE c.escola_id = @escolaId AND (a.nome LIKE @termo OR c.categoria LIKE @termo)
        ORDER BY c.id DESC
      `, params),
      query(`
        SELECT TOP 5 id, tema, data, hora_inicio AS horaInicio
        FROM turmas_teoricas
        WHERE escola_id = @escolaId AND (tema LIKE @termo)
        ORDER BY data DESC
      `, params)
    ]);

    const results = [];
    (alunosRes.recordset || []).forEach(a => results.push({
      id: a.id,
      tipo: 'Aluno',
      label: a.nome,
      sub: `Nº ${a.numeroAluno ?? a.id} · ${a.categoria || '—'} · ${a.estado || ''}`,
      view: 'alunos'
    }));
    (instrutoresRes.recordset || []).forEach(i => results.push({
      id: i.id,
      tipo: 'Instrutor',
      label: i.nome,
      sub: i.cargo || 'Instrutor',
      view: 'instrutores'
    }));
    (veiculosRes.recordset || []).forEach(v => results.push({
      id: v.id,
      tipo: 'Veículo',
      label: v.matricula,
      sub: `${v.marca || ''} ${v.modelo || ''}`.trim() || '—',
      view: 'veiculos'
    }));
    (contratosRes.recordset || []).forEach(c => results.push({
      id: c.id,
      tipo: 'Contrato',
      label: `Contrato · ${c.alunoNome || 'Aluno'}`,
      sub: `${c.categoria || '—'} · ${c.estado || ''}`,
      view: 'contratos'
    }));
    (turmasRes.recordset || []).forEach(t => results.push({
      id: t.id,
      tipo: 'Turma teórica',
      label: t.tema,
      sub: `${t.data ? String(t.data).slice(0, 10) : ''} · ${t.horaInicio || ''}`,
      view: 'calendario'
    }));

    ok(res, results.slice(0, 20));
  } catch (ex) {
    res.status(500).json({ success: false, error: `Falha na pesquisa global: ${ex.message || ex}` });
  }
});

/* Endpoint otimizado: filtra por estado e pesquisa (nome/email/NIF/nº aluno)
   diretamente no SQL Server, e devolve só as colunas leves (sem foto) com
   contagens agregadas de aulas teóricas e práticas realizadas.
   TEM DE ESTAR REGISTADO ANTES do app.use('/api/alunos', collectionRoutes(...))
   porque esse router define GET /api/alunos/:id, que caso contrário
   intercetaria "/api/alunos/lista" tratando "lista" como um id. */
app.get('/api/alunos/lista', async (req, res) => {
  try {
    const estado = String(req.query.estado || '').trim();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const condicoes = ['a.escola_id = @escolaId'];
    const params = { escolaId: req.escolaId, limit, offset };

    if (estado && estado !== 'Todos') {
      condicoes.push('a.estado = @estado');
      params.estado = estado;
    }
    if (q) {
      condicoes.push('(a.nome LIKE @q OR a.email LIKE @q OR a.nif LIKE @q OR CAST(a.numero_aluno AS NVARCHAR) LIKE @q)');
      params.q = `%${q}%`;
    }

    const where = condicoes.join(' AND ');
    const countResult = await query(`SELECT COUNT(*) AS total FROM alunos a WHERE ${where}`, params);
    const total = countResult.recordset[0]?.total || 0;

    const colunasComContagens = `
      a.id, a.escola_id, a.pessoa_id, a.espaco_id, a.numero_aluno, a.nome, a.email, a.telefone, a.categoria,
      a.estado, a.data_inscricao, a.aulas_teoricas, a.aulas_praticas, a.notas, a.data_nascimento, a.nif,
      a.tipo_documento, a.numero_documento, a.validade_documento, a.morada, a.codigo_postal, a.localidade,
      a.dispensa_modulos, a.desconto, a.atestado_data_emissao, a.atestado_data_validade, a.atestado_apto,
      a.psicotecnico_aplicavel, a.psicotecnico_data_emissao, a.psicotecnico_data_validade, a.imt_numero,
      a.imt_data_emissao, a.imt_data_validade,
      (SELECT COUNT(*) FROM aulas au WHERE au.aluno_id = a.id AND au.tipo = 'Prática' AND au.estado NOT IN ('Cancelada','Cancelado','Anulada','Anulado')) AS aulas_praticas_realizadas,
      ((SELECT COUNT(*) FROM aulas au WHERE au.aluno_id = a.id AND au.tipo = 'Teórica' AND au.estado NOT IN ('Cancelada','Cancelado','Anulada','Anulado')) +
       (SELECT COUNT(*) FROM turma_inscritos ti JOIN turmas_teoricas tt ON tt.id = ti.turma_id WHERE ti.aluno_id = a.id AND ti.presente = 1 AND tt.estado NOT IN ('Cancelada','Cancelado','Anulada','Anulado'))) AS aulas_teoricas_realizadas
    `;

    const result = await query(
      `SELECT ${colunasComContagens} FROM alunos a WHERE ${where}
       ORDER BY a.nome
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    );
    const alunos = result.recordset.map(dbRowToJs).map(nestAlunoExtras);
    ok(res, { alunos, total, limit, offset });
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao pesquisar alunos: ${ex.message || ex}` });
  }
});

app.use('/api/alunos', collectionRoutes('alunos', {
  validate: (p) => {
    if (!p.nome || !String(p.nome).trim()) return 'O nome do aluno é obrigatório.';
    const doc = p.numeroDocumento || p.numero_documento;
    if (!doc || !String(doc).trim()) return 'O número do documento de identificação (CC / Passaporte) é obrigatório.';
    const espaco = p.espacoId || p.espaco_id;
    if (!espaco) return 'O espaço físico da escola é obrigatório.';
    return null;
  },
  onCreate: (item, tenant) => { /* ...igual... */ },
  onAfterCreate: async (saved, tenant, req) => {
    const pessoaId = await criarPessoaSql(req, { nome: saved.nome, tipoPessoa: 'aluno', origemCollection: 'alunos', origemId: saved.id, email: saved.email, telefone: saved.telefone, estado: saved.estado });
    const updated = await updateItemToSql(req, 'alunos', saved.id, { ...saved, numeroAluno: saved.id, pessoaId });
    const alunoFinal = updated || saved;
    try {
      await criarUserAlunoSql(req, alunoFinal);
    } catch (ex) {
      alunoFinal._avisoPosCriacao = `O aluno foi criado, mas não foi possível criar automaticamente o utilizador de acesso: ${ex.message || ex}`;
    }
    return alunoFinal;
  },
  onUpdate: (item) => { flattenAlunoExtras(item); },
  onAfterUpdate: async (saved, tenant, req) => {
    try {
      await sincronizarUsernameAlunoSql(req, saved);
    } catch (ex) {
      saved._avisoPosAtualizacao = `O aluno foi atualizado, mas não foi possível sincronizar o username do utilizador de acesso: ${ex.message || ex}`;
    }
    return saved;
  },
  transformOut: (row) => nestAlunoExtras(row)
}));

app.get('/api/alunos/:id/foto', async (req, res) => {
  const result = await query('SELECT foto FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: Number(req.params.id), escolaId: req.escolaId });
  const foto = result.recordset[0]?.foto;
  if (!foto) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(foto);
});

app.post('/api/alunos/:id/documentos', async (req, res) => {
  try {
    const alunoId = Number(req.params.id);
    const alunoCheck = await query('SELECT id FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: alunoId, escolaId: req.escolaId });
    if (!alunoCheck.recordset[0]) return res.status(404).json({ error: 'Aluno não encontrado.' });

    const { nome, filename, mimeType, dataBase64 } = req.body || {};
    if (!nome || !dataBase64) return res.status(400).json({ error: 'Nome e ficheiro são obrigatórios.' });

    const base64Data = String(dataBase64).includes(',') ? String(dataBase64).split(',').pop() : dataBase64;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 15_000_000) return res.status(400).json({ error: 'O ficheiro não pode exceder 15MB.' });

    await query(
      `INSERT INTO aluno_documentos (aluno_id, nome, filename, mime_type, conteudo, tamanho_bytes)
       VALUES (@alunoId, @nome, @filename, @mimeType, @conteudo, @tamanho)`,
      { alunoId, nome: String(nome).trim(), filename: filename || nome, mimeType: mimeType || 'application/octet-stream', conteudo: buffer, tamanho: buffer.length }
    );

    const documentos = await query(
      `SELECT id, nome, filename, mime_type AS mimeType, tamanho_bytes AS size, uploaded_at AS uploadedAt
       FROM aluno_documentos WHERE aluno_id=@alunoId ORDER BY id`,
      { alunoId }
    );
    ok(res, { documentos: documentos.recordset });
  } catch (ex) {
    res.status(503).json({ error: `Falha ao guardar documento: ${ex.message || ex}` });
  }
});

app.get('/api/alunos/:id/documentos/:docId', async (req, res) => {
  try {
    const result = await query(
      `SELECT d.* FROM aluno_documentos d JOIN alunos a ON a.id = d.aluno_id
       WHERE d.id=@docId AND d.aluno_id=@alunoId AND a.escola_id=@escolaId`,
      { docId: Number(req.params.docId), alunoId: Number(req.params.id), escolaId: req.escolaId }
    );
    const doc = result.recordset[0];
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.filename || 'documento').replace(/"/g, '')}"`);
    res.send(doc.conteudo);
  } catch (ex) {
    res.status(503).json({ error: `Falha ao obter documento: ${ex.message || ex}` });
  }
});

app.delete('/api/alunos/:id/documentos/:docId', async (req, res) => {
  try {
    const alunoId = Number(req.params.id);
    const check = await query('SELECT id FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: alunoId, escolaId: req.escolaId });
    if (!check.recordset[0]) return res.status(404).json({ error: 'Aluno não encontrado.' });
    await query('DELETE FROM aluno_documentos WHERE id=@docId AND aluno_id=@alunoId', { docId: Number(req.params.docId), alunoId });
    const documentos = await query(
      `SELECT id, nome, filename, mime_type AS mimeType, tamanho_bytes AS size, uploaded_at AS uploadedAt
       FROM aluno_documentos WHERE aluno_id=@alunoId ORDER BY id`,
      { alunoId }
    );
    ok(res, { documentos: documentos.recordset });
  } catch (ex) {
    res.status(503).json({ error: `Falha ao remover documento: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   8. Coleções CRUD
   ------------------------------------------------------------ */

app.use('/api/instrutores', collectionRoutes('instrutores', {
  validate: (p) => {
    if (!p.nome) return 'O nome do instrutor é obrigatório';
    if (p.foto && String(p.foto).length > 2_500_000) return 'A foto do instrutor é demasiado grande. Escolhe uma imagem mais pequena (máx. ~1.5MB).';
    return null;
  },
  onAfterCreate: async (saved, tenant, req) => {
    const pessoaId = await criarPessoaSql(req, { nome: saved.nome, tipoPessoa: 'instrutor', origemCollection: 'instrutores', origemId: saved.id, email: saved.email, telefone: saved.telefone, estado: saved.estado });
    const updated = await updateItemToSql(req, 'instrutores', saved.id, { ...saved, pessoaId });
    return updated || saved;
  }
}));
app.use('/api/pessoas', collectionRoutes('pessoas', {
  validate: (p) => (!p.nome ? 'O nome é obrigatório' : null)
}));
app.use('/api/espacos', collectionRoutes('espacos', {
  validate: (p, tenant, req) => {
    const nome = String(p.nome || '').trim();
    if (!nome) return 'O nome do espaço é obrigatório';
    const duplicado = (tenant.espacos || []).some(e =>
      e.nome.toLowerCase() === nome.toLowerCase() && e.id !== Number(req.params?.id)
    );
    if (duplicado) return 'Já existe um espaço com esse nome nesta escola.';
    p.nome = nome;
    return null;
  },
  onDelete: (item, tenant) => {
    if ((tenant.espacos || []).length <= 1) return 'Tem de existir pelo menos um espaço na escola.';
    const emUso =
      (tenant.alunos || []).some(a => a.espacoId === item.id) ||
      (tenant.aulas || []).some(a => a.espacoId === item.id) ||
      (tenant.turmasTeoricas || []).some(t => t.espacoId === item.id);
    if (emUso) return 'Este espaço tem alunos, aulas ou turmas atribuídos. Reatribui-os a outro espaço antes de o remover.';
    return null;
  }
}));
app.use('/api/veiculos', collectionRoutes('veiculos', {
  validate: (p) => (!p.matricula ? 'A matrícula é obrigatória' : null)
}));

const LIMITE_DIARIO_PRATICA_MIN = 240; // 4 horas — confirmar valor em vigor junto do IMT

app.get('/api/aulas/verificar-limite-diario', (req, res) => {
  const { tenant } = currentTenant(req);
  const alunoId = Number(req.query.alunoId);
  const dataAula = req.query.data;
  const duracaoNova = Number(req.query.duracao || 0);
  const excluirId = req.query.excluirId ? Number(req.query.excluirId) : null;
  if (!alunoId || !dataAula) return badRequest(res, 'alunoId e data são obrigatórios');

  const minutosExistentes = tenant.aulas
    .filter(a => a.alunoId === alunoId && a.data === dataAula && isTipo(a, 'Prática') && !isEstadoCancelada(a.estado) && a.id !== excluirId)
    .reduce((s, a) => s + (a.duracao || 50), 0);

  const minutosTotais = minutosExistentes + duracaoNova;
  ok(res, {
    minutosTotais,
    limiteMinutos: LIMITE_DIARIO_PRATICA_MIN,
    excedeLimite: minutosTotais > LIMITE_DIARIO_PRATICA_MIN
  });
});
app.use('/api/aulas', collectionRoutes('aulas', {
  validate: (p, tenant) => {
    if (!p.alunoId || !p.data || !p.hora) return 'Aluno, data e hora são obrigatórios';
    const espacoId = Number(p.espacoId || 0);
    if (!espacoId) return 'O espaço físico da aula é obrigatório';
    if (!Array.isArray(tenant.espacos) || !tenant.espacos.some(e => e.id === espacoId)) return 'Espaço físico inválido';
    return null;
  },
  onCreate: (item, tenant) => {
    item.espacoId = Number(item.espacoId || tenant.espacos[0]?.id || null);
  }
}));
app.use('/api/turmasTeoricas', collectionRoutes('turmasTeoricas', {
  validate: (p, tenant) => {
    if (!p.tema || !p.data || !p.horaInicio || !p.horaFim) return 'Tema, data e horário são obrigatórios';
    const espacoId = Number(p.espacoId || 0);
    if (!espacoId) return 'O espaço físico da turma teórica é obrigatório';
    if (!Array.isArray(tenant.espacos) || !tenant.espacos.some(e => e.id === espacoId)) return 'Espaço físico inválido';
    return null;
  },
  onCreate: (item, tenant) => {
    item.espacoId = Number(item.espacoId || tenant.espacos[0]?.id || null);
  },
  transformOut: async (row) => {
    const presencasResult = await query(
      'SELECT aluno_id AS alunoId, presente FROM turma_inscritos WHERE turma_id=@id',
      { id: row.id }
    );
    const inscritos = presencasResult.recordset.map(r => Number(r.alunoId));
    row.inscritos = [...new Set(inscritos)];
    row.presencas = Object.fromEntries(
      presencasResult.recordset
        .filter(r => r.presente !== null)
        .map(r => [Number(r.alunoId), !!r.presente])
    );
    return row;
  }
}));
app.use('/api/requisitos', collectionRoutes('requisitos', {
  validate: (p) => (!p.categoria ? 'A categoria é obrigatória' : null)
}));
app.use('/api/pagamentos', collectionRoutes('pagamentos', {
  validate: (p) => (!p.alunoId || !p.valor ? 'Aluno e valor são obrigatórios' : null),
  onCreate: async (item, tenant, req) => {
    if (!item.modoPagamento && !item.modo_pagamento) item.modoPagamento = 'PGNUM';
    await tentarEmitirReciboAutomatico(item, tenant, req);
  },
  onAfterCreate: async (saved, tenant, req) => { await atualizarEstadosContaCorrente(req, saved.alunoId); return saved; },
  onUpdate: async (atualizado, anterior, tenant, req) => {
    if (!atualizado.modoPagamento && !atualizado.modo_pagamento) atualizado.modoPagamento = anterior?.modoPagamento || 'PGNUM';
    if (atualizado.estado === 'Pago' && anterior.estado !== 'Pago') await tentarEmitirReciboAutomatico(atualizado, tenant, req);
  },
  onAfterUpdate: async (saved, tenant, req) => { await atualizarEstadosContaCorrente(req, saved.alunoId); return saved; },
  onDelete: async (atual, tenant, req) => {
    // Verificar se o pagamento já possui emissão fiscal associada
    const docResult = await query(
      `SELECT TOP 1 * FROM documentos_fiscais WHERE pagamento_id=@id AND tipo IN ('FA', 'FR', 'RE') ORDER BY data_emissao DESC`,
      { id: atual.id }
    );
    const docRow = docResult.recordset[0];
    const estaFaturado = !!(atual.faturacaoNumero || (atual.faturacao && atual.faturacao.numero) || docRow);

    if (estaFaturado) {
      // O pagamento já foi faturado -> CONVERTER EM NOTA DE CRÉDITO (NC)
      const alunoResult = await query('SELECT * FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: atual.alunoId, escolaId: req.escolaId });
      const alunoRow = alunoResult.recordset[0];
      const aluno = alunoRow ? nestAlunoExtras(dbRowToJs(alunoRow)) : null;

      const docTipo = docRow ? docRow.tipo : (atual.faturacaoTipo || atual.faturacao?.tipo || 'FA');
      const docSerie = docRow ? docRow.serie : (atual.faturacaoSerie || atual.faturacao?.serie || req.escola.primavera?.serie);
      const docNumero = docRow ? docRow.numero : (atual.faturacaoNumero || atual.faturacao?.numero || '');

      nestEscolaPrimavera(req.escola);
      let ncResultado = { sucesso: true, doc_tipo: 'NC', doc_serie: docSerie, doc_numero: `NC-${atual.id}` };

      if (req.escola.primavera && req.escola.primavera.ativo && aluno && aluno.nif) {
        try {
          const serieDoc = await obterSerieParaAluno(req, aluno);
          const out = await invoicing.emitirNotaCredito(req.escola, tenant, aluno, atual, {
            docOriginalTipo: docTipo,
            docOriginalSerie: docSerie,
            docOriginalNumero: docNumero,
            motivo: '001',
            serie: serieDoc
          });
          if (out && out.resultado) {
            ncResultado = out.resultado;
          }
        } catch (ex) {
          console.warn('Aviso ao emitir NC na Primavera:', ex.message || ex);
        }
      }

      await query(
        `INSERT INTO documentos_fiscais (escola_id, aluno_id, pagamento_id, tipo, serie, numero, valor, doc_original_tipo, doc_original_serie, doc_original_numero)
         VALUES (@escolaId, @alunoId, @pagamentoId, 'NC', @serie, @numero, @valor, @docOrigTipo, @docOrigSerie, @docOrigNumero)`,
        {
          escolaId: req.escolaId,
          alunoId: atual.alunoId,
          pagamentoId: atual.id,
          serie: ncResultado.doc_serie || docSerie || null,
          numero: ncResultado.doc_numero || null,
          valor: atual.valor,
          docOrigTipo: docTipo,
          docOrigSerie: docSerie,
          docOrigNumero: String(docNumero)
        }
      );

      await query(
        `UPDATE pagamentos
         SET estado='Anulado',
             faturacao_tipo='NC',
             faturacao_serie=@ncSerie,
             faturacao_numero=@ncNumero,
             faturacao_data_emissao=SYSUTCDATETIME()
         WHERE id=@id AND escola_id=@escolaId`,
        {
          id: atual.id,
          escolaId: req.escolaId,
          ncSerie: ncResultado.doc_serie || docSerie || null,
          ncNumero: ncResultado.doc_numero || null
        }
      );

      await historicoFaturacaoInsert(atual.id, {
        tipo: 'NC',
        sucesso: !!ncResultado.sucesso,
        doc_numero: ncResultado.doc_numero,
        doc_serie: ncResultado.doc_serie,
        erro: ncResultado.erro
      });

      await atualizarEstadosContaCorrente(req, atual.alunoId);

      const list = tenant.pagamentos || [];
      const pos = list.findIndex(p => p.id === atual.id);
      if (pos >= 0) {
        list[pos].estado = 'Anulado';
        list[pos].faturacaoTipo = 'NC';
        list[pos].faturacaoSerie = ncResultado.doc_serie || docSerie;
        list[pos].faturacaoNumero = ncResultado.doc_numero;
        list[pos].faturacao = {
          tipo: 'NC',
          serie: ncResultado.doc_serie || docSerie,
          numero: ncResultado.doc_numero,
          dataEmissao: new Date().toISOString()
        };
      }

      return {
        convertedToNC: true,
        message: `O pagamento já estava faturado e foi convertido em Nota de Crédito (NC ${ncResultado.doc_serie || ''}/${ncResultado.doc_numero || ''}) com sucesso.`,
        pagamentoId: atual.id
      };
    }

    return null;
  },
  onAfterDelete: async (removed, tenant, req) => { await atualizarEstadosContaCorrente(req, removed.alunoId); },
  transformOut: async (row, tenant, req) => {
    if (row.faturacaoNumero || row.faturacaoTipo) {
      row.faturacao = {
        tipo: row.faturacaoTipo,
        serie: row.faturacaoSerie,
        numero: row.faturacaoNumero,
        entidade: row.faturacaoEntidade,
        dataEmissao: row.faturacaoDataEmissao
      };
    } else {
      const docResult = await query(`SELECT TOP 1 * FROM documentos_fiscais WHERE pagamento_id=@id ORDER BY data_emissao DESC`, { id: row.id });
      if (docResult.recordset[0]) {
        row.faturacao = dbRowToJs(docResult.recordset[0]);
      } else {
        row.faturacao = null;
      }
    }
    const histResult = await query(`SELECT * FROM pagamento_historico_faturacao WHERE pagamento_id=@id ORDER BY data_hora DESC`, { id: row.id });
    row.historicoFaturacao = histResult.recordset.map(dbRowToJs);
    if (!row.modoPagamento) {
      row.modoPagamento = row.modo_pagamento || 'PGNUM';
    }
    return row;
  }
}));
app.use('/api/itensConta', collectionRoutes('itensConta', {
  validate: (p) => {
    if (!p.alunoId || !p.descricao || p.valor === undefined || p.valor === null || p.valor === '') return 'Aluno, descrição e valor são obrigatórios';
    if (p.taxaIva !== undefined && p.taxaIva !== null && p.taxaIva !== '') {
      const iva = Number(p.taxaIva);
      if (Number.isNaN(iva) || iva < 0 || iva > 100) return 'A taxa de IVA deve ser um valor entre 0 e 100.';
      p.taxaIva = iva;
    } else {
      p.taxaIva = null;
    }
    return null;
  },
  onAfterCreate: async (saved, tenant, req) => { await atualizarEstadosContaCorrente(req, saved.alunoId); return saved; },
  onAfterUpdate: async (saved, tenant, req) => { await atualizarEstadosContaCorrente(req, saved.alunoId); return saved; },
  onDelete: (item) => item.estado === 'Pago' ? 'Este item já está pago — para o anular usa uma nota de crédito em vez de o remover.' : null,
  onAfterDelete: async (removed, tenant, req) => { await atualizarEstadosContaCorrente(req, removed.alunoId); }
}));
app.use('/api/produtos', collectionRoutes('produtos', {
  validate: (p) => {
    if (!p.descricao || p.valor === undefined || p.valor === null || p.valor === '') return 'Descrição e valor são obrigatórios';
    p.descontavel = (p.descontavel === true || p.descontavel === 'true');
    if (p.taxaIva === undefined || p.taxaIva === null || p.taxaIva === '') {
      p.taxaIva = 23;
    } else {
      const iva = Number(p.taxaIva);
      if (Number.isNaN(iva) || iva < 0 || iva > 100) return 'A taxa de IVA deve ser um valor entre 0 e 100.';
      p.taxaIva = iva;
    }
    return null;
  }
}));

/* ------------------------------------------------------------
   9. Contratos
   ------------------------------------------------------------ */

/* Gera/regenera os itens de conta corrente ligados a um contrato
   (origem_contrato_id). */
async function sincronizarItensContaContrato(req, contratoId, sync) {
  const { itensCarta, usaParcelasPersonalizadas, parcelasPersonalizadas, planoPagamento, numeroPrestacoes, categoria } = sync;
  const contratoResult = await query('SELECT aluno_id, valor_total FROM contratos WHERE id=@id', { id: contratoId });
  const row = contratoResult.recordset[0];
  const alunoId = row?.aluno_id;
  const valorTotalContrato = Number(row?.valor_total) || 0;
  await query('DELETE FROM itens_conta WHERE origem_contrato_id=@id', { id: contratoId });

  let novosItens;
  if (usaParcelasPersonalizadas && Array.isArray(parcelasPersonalizadas) && parcelasPersonalizadas.length > 0) {
    novosItens = parcelasPersonalizadas.map((p, i) => ({
      descricao: p.descricao ? `Contrato ${categoria} — ${p.descricao}` : `Contrato ${categoria} — Parcela ${i + 1}`,
      codigo: null,
      categoria: 'Diversos', valor: +(Number(p.valor) || 0).toFixed(2), taxaIva: null, ordem: i + 1, origemPlano: planoPagamento
    }));
  } else if (planoPagamento === 'Mensalidades') {
    const valorCalculado = (Array.isArray(itensCarta) && itensCarta.length)
      ? +itensCarta.reduce((s, i) => s + (Number(i.valor) || 0), 0).toFixed(2)
      : valorTotalContrato;
    const n = Math.max(1, Number(numeroPrestacoes) || 1);
    const parcela = +(valorCalculado / n).toFixed(2);
    let acumulado = 0;
    novosItens = Array.from({ length: n }, (_, i) => {
      const valor = i < n - 1 ? parcela : +((valorCalculado - acumulado)).toFixed(2);
      acumulado = +(acumulado + valor).toFixed(2);
      return { descricao: `Contrato ${categoria} — Mensalidade ${i + 1}/${n}`, codigo: null, categoria: 'Diversos', valor, taxaIva: null, ordem: i + 1, origemPlano: planoPagamento };
    });
  } else if (Array.isArray(itensCarta) && itensCarta.length > 0) {
    novosItens = itensCarta.map((it, i) => ({
      descricao: `Contrato ${categoria} — ${it.descricao}`,
      codigo: it.codigo || null,
      categoria: it.categoria || 'Diversos', valor: Number(it.valor) || 0, taxaIva: it.taxaIva ?? null, ordem: i + 1, origemPlano: planoPagamento || 'Pagamento único'
    }));
  } else {
    // Fallback: se não houver itens específicos configurados, cria o item global de formação do contrato
    novosItens = [{
      descricao: `Contrato ${categoria} — Formação de Condução`,
      codigo: null,
      categoria: 'Diversos',
      valor: valorTotalContrato > 0 ? valorTotalContrato : 0,
      taxaIva: null,
      ordem: 1,
      origemPlano: planoPagamento || 'Pagamento único'
    }];
  }

  for (const it of novosItens) {
    await query(
      `INSERT INTO itens_conta (escola_id, aluno_id, origem_contrato_id, codigo, descricao, categoria, valor, taxa_iva, estado, origem_plano, ordem)
      VALUES (@escolaId, @alunoId, @contratoId, @codigo, @descricao, @categoria, @valor, @taxaIva, 'Pendente', @origemPlano, @ordem)`,
      { escolaId: req.escolaId, alunoId, contratoId, codigo: it.codigo || null, descricao: it.descricao, categoria: it.categoria, valor: it.valor, taxaIva: it.taxaIva, origemPlano: it.origemPlano, ordem: it.ordem }
    );
  }
}

async function gravarParcelasPersonalizadas(contratoId, parcelas) {
  await query('DELETE FROM contrato_parcelas_personalizadas WHERE contrato_id=@id', { id: contratoId });
  for (let i = 0; i < (parcelas || []).length; i++) {
    const p = parcelas[i];
    await query(
      'INSERT INTO contrato_parcelas_personalizadas (contrato_id, descricao, valor, ordem) VALUES (@contratoId, @descricao, @valor, @ordem)',
      { contratoId, descricao: p.descricao || null, valor: +(Number(p.valor) || 0).toFixed(2), ordem: i + 1 }
    );
  }
}

function calcularValoresContrato(item, tenant) {
  const aluno = tenant.alunos.find(a => a.id === Number(item.alunoId));
  const desconto = Number(aluno?.desconto || 0);
  const categoria = item.categoria || aluno?.categoria || '—';
  const itensCarta = itensCartaPorCategoria(tenant, categoria, desconto, item.planoCartaId);
  const valorCalculado = +itensCarta.reduce((s, i) => s + (Number(i.valor) || 0), 0).toFixed(2);
  const usaParcelasPersonalizadas = item.planoPagamento === 'Personalizado' && Array.isArray(item.parcelasPersonalizadas) && item.parcelasPersonalizadas.length > 0;

  item.valorCartaCalculado = valorCalculado;
  item.descontoAplicado = desconto;
  item.valorTotal = usaParcelasPersonalizadas
    ? +item.parcelasPersonalizadas.reduce((s, p) => s + (Number(p.valor) || 0), 0).toFixed(2)
    : valorCalculado;

  return { itensCarta, usaParcelasPersonalizadas, parcelasPersonalizadas: item.parcelasPersonalizadas || [], planoPagamento: item.planoPagamento, numeroPrestacoes: item.numeroPrestacoes, categoria };
}

app.use('/api/contratos', collectionRoutes('contratos', {
  validate: (p, tenant) => {
    if (!p.alunoId) return 'O aluno é obrigatório';
    const aluno = tenant.alunos.find(a => a.id === Number(p.alunoId));
    if (!aluno) return 'Aluno inválido';
    const categoria = String(p.categoria || aluno.categoria || '').trim();
    if (!categoria) return 'A categoria do contrato é obrigatória (define a categoria pretendida na ficha do aluno ou escolhe uma no contrato)';
    p.categoria = categoria;
    const temParcelasPersonalizadas = p.planoPagamento === 'Personalizado' && Array.isArray(p.parcelasPersonalizadas) && p.parcelasPersonalizadas.length > 0;
    if (!temParcelasPersonalizadas) {
      const planos = tenant.config?.composicaoCarta?.[categoria] || [];
      if (!planos.length) {
        return `Não existe nenhum plano de preço definido para a categoria ${categoria}. Define-o em Configurações > Composição da carta, ou usa o plano de pagamento "Personalizado".`;
      }
      if (p.planoCartaId) {
        if (!planos.some(pl => pl.id === Number(p.planoCartaId))) return 'O plano de preço da carta selecionado não existe para esta categoria.';
        p.planoCartaId = Number(p.planoCartaId);
      } else {
        p.planoCartaId = planos[0].id;
      }
    } else {
      p.planoCartaId = null;
    }
    return null;
  },
  onCreate: (item, tenant) => {
    item._pendingSync = calcularValoresContrato(item, tenant);
  },
  onAfterCreate: async (saved, tenant, req, item) => {
    const sync = item._pendingSync;
    if (sync) {
      await sincronizarItensContaContrato(req, saved.id, sync);
      if (sync.usaParcelasPersonalizadas) await gravarParcelasPersonalizadas(saved.id, sync.parcelasPersonalizadas);
    }
    return saved;
  },
  onUpdate: async (item, anterior, tenant, req) => {
    if (anterior.estado === 'Assinado') return;
    const sync = calcularValoresContrato(item, tenant);
    await sincronizarItensContaContrato(req, item.id, sync);
    await gravarParcelasPersonalizadas(item.id, sync.usaParcelasPersonalizadas ? sync.parcelasPersonalizadas : []);
  },
  transformOut: async (row, tenant, req) => {
    const parcelasResult = await query('SELECT descricao, valor FROM contrato_parcelas_personalizadas WHERE contrato_id=@id ORDER BY ordem', { id: row.id });
    row.parcelasPersonalizadas = parcelasResult.recordset;
    row.assinatura = row.assinaturaNomeDigitado ? {
      nomeDigitado: row.assinaturaNomeDigitado,
      dataHora: row.assinaturaDataHora,
      imagemBase64: row.assinaturaImagem ? `data:image/png;base64,${row.assinaturaImagem}` : null
    } : null;
    delete row.assinaturaImagem;
    row.assinaturaTutor = row.assinaturaTutorNomeDigitado ? {
      nomeDigitado: row.assinaturaTutorNomeDigitado,
      imagemBase64: row.assinaturaTutorImagem ? `data:image/png;base64,${row.assinaturaTutorImagem}` : null
    } : null;
    delete row.assinaturaTutorImagem;
    row.pdfAssinado = row.pdfAssinadoFilename ? { filename: row.pdfAssinadoFilename, uploadedAt: row.pdfAssinadoUploadedAt, size: row.pdfAssinadoTamanhoBytes } : null;
    const aluno = (tenant.alunos || []).find(a => a.id === row.alunoId);
    row.itensCarta = itensCartaPorCategoria(tenant, row.categoria, Number(aluno?.desconto ?? row.descontoAplicado ?? 0), row.planoCartaId);
    const faturaResult = await query(`SELECT TOP 1 * FROM documentos_fiscais WHERE contrato_id=@id AND tipo IN ('FA','FR') ORDER BY data_emissao DESC`, { id: row.id });
    row.faturacao = faturaResult.recordset[0] ? dbRowToJs(faturaResult.recordset[0]) : null;
    const recibosResult = await query(`SELECT * FROM documentos_fiscais WHERE contrato_id=@id AND tipo='RE' ORDER BY data_emissao`, { id: row.id });
    row.recibosEmitidos = recibosResult.recordset.map(dbRowToJs);
    return row;
  }
}));

/* ------------------------------------------------------------
   10. Exames — marcações e estatísticas
   ------------------------------------------------------------ */

app.get('/api/examesMarcacoes', async (req, res) => {
  try {
    const e = req.escolaId;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const result = await query(`
      SELECT m.id, m.escola_id AS escolaId, m.aluno_id AS alunoId, m.tipo, m.data, m.hora,
             m.hora_fim AS horaFim, m.duracao, m.local, m.estado, m.observacoes, m.resultado,
             a.nome AS alunoNome
      FROM exames_marcacoes m
      LEFT JOIN alunos a ON a.id = m.aluno_id
      WHERE m.escola_id = @e
      ORDER BY m.data DESC, m.id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { e, offset, limit });

    ok(res, result.recordset || []);
  } catch (err) {
    const { tenant } = currentTenant(req);
    const limit = Math.max(1, Number(req.query.limit) || 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const itens = (tenant.examesMarcacoes || []).slice()
      .sort((a, b) => dstr(b.data).localeCompare(dstr(a.data)) || b.id - a.id);
    ok(res, itens.slice(offset, offset + limit));
  }
});

app.post('/api/examesMarcacoes', async (req, res) => {
  try {
    const { tenant } = currentTenant(req);
    const payload = { ...(req.body || {}) };
    const alunoId = Number(payload.alunoId);
    const tipo = String(payload.tipo || '').trim();
    const dataExame = String(payload.data || '').trim();
    if (!alunoId || !tipo || !dataExame) return badRequest(res, 'Aluno, tipo e data são obrigatórios.');
    if (!['Teórico', 'Prático'].includes(tipo)) return badRequest(res, 'Tipo inválido. Usa Teórico ou Prático.');
    if (tipo === 'Prático') {
      const saldo = saldoContaCorrenteAluno(tenant, alunoId);
      if (saldo > 0.0001) return badRequest(res, 'Não é possível marcar um exame prático enquanto a conta corrente do aluno tiver saldo pendente.');
    }
    const resultado = ['Aprovado', 'Reprovado'].includes(payload.resultado) ? payload.resultado : null;
    const result = await query(
      `INSERT INTO exames_marcacoes (escola_id, aluno_id, tipo, data, hora, hora_fim, duracao, local, estado, observacoes, resultado)
       OUTPUT inserted.id, inserted.aluno_id AS alunoId, inserted.tipo, inserted.data, inserted.hora, inserted.hora_fim AS horaFim,
              inserted.duracao, inserted.local, inserted.estado, inserted.observacoes, inserted.resultado
       VALUES (@escolaId, @alunoId, @tipo, @data, @hora, @horaFim, @duracao, @local, @estado, @observacoes, @resultado)`,
      {
        escolaId: req.escolaId, alunoId, tipo, data: dataExame, hora: payload.hora || '',
        duracao: payload.duracao ? Number(payload.duracao) : null,
        horaFim: payload.horaFim || '', local: payload.local || '',
        estado: payload.estado || 'Marcado', observacoes: payload.observacoes || '', resultado
      }
    );
    ok(res, result.recordset[0]);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao criar marcação: ${ex.message || ex}` });
  }
});

app.get('/api/examesMarcacoes/estatisticas', async (req, res) => {
  try {
    const params = { escolaId: req.escolaId };
    const [statsRes, countRes] = await Promise.all([
      query(`
        SELECT
          m.tipo,
          FORMAT(m.data, 'yyyy-MM') AS mes,
          FORMAT(m.data, 'yyyy') AS ano,
          ISNULL(CAST(a.espaco_id AS NVARCHAR), 'sem-espaco') AS espacoChave,
          ISNULL(e.nome, 'Sem espaço definido') AS espacoNome,
          m.resultado,
          COUNT(*) AS total
        FROM exames_marcacoes m
        LEFT JOIN alunos a ON a.id = m.aluno_id
        LEFT JOIN espacos e ON e.id = a.espaco_id
        WHERE m.escola_id = @escolaId AND m.resultado IN ('Aprovado', 'Reprovado') AND m.data IS NOT NULL
        GROUP BY m.tipo, FORMAT(m.data, 'yyyy-MM'), FORMAT(m.data, 'yyyy'), a.espaco_id, e.nome, m.resultado
      `, params),
      query(`
        SELECT COUNT(*) AS total FROM exames_marcacoes WHERE escola_id = @escolaId
      `, params)
    ]);

    const rows = statsRes.recordset || [];
    const totalMarcacoes = countRes.recordset[0]?.total || 0;

    function agruparRows(subRows, chaveProp, rotuloProp) {
      const mapa = new Map();
      subRows.forEach(r => {
        const chave = r[chaveProp];
        if (!chave) return;
        const rotulo = rotuloProp ? r[rotuloProp] : chave;
        if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo, aprovados: 0, reprovados: 0 });
        const entry = mapa.get(chave);
        if (r.resultado === 'Aprovado') entry.aprovados += r.total;
        else if (r.resultado === 'Reprovado') entry.reprovados += r.total;
      });
      return [...mapa.values()]
        .map(e => ({
          ...e,
          total: e.aprovados + e.reprovados,
          taxaAprovacao: (e.aprovados + e.reprovados) ? +((e.aprovados / (e.aprovados + e.reprovados)) * 100).toFixed(1) : 0
        }))
        .sort((a, b) => String(a.chave).localeCompare(String(b.chave)));
    }

    function construirBloco(subRows) {
      return {
        porMes: agruparRows(subRows, 'mes'),
        porAno: agruparRows(subRows, 'ano'),
        porEspaco: agruparRows(subRows, 'espacoChave', 'espacoNome'),
        total: subRows.reduce((s, r) => s + r.total, 0)
      };
    }

    ok(res, {
      geral: construirBloco(rows),
      teorico: construirBloco(rows.filter(r => r.tipo === 'Teórico')),
      pratico: construirBloco(rows.filter(r => r.tipo === 'Prático')),
      totalMarcacoes
    });
  } catch (ex) {
    res.status(500).json({ success: false, error: `Falha ao obter estatísticas de exames: ${ex.message || ex}` });
  }
});

app.put('/api/examesMarcacoes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM exames_marcacoes WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    const atual = existing.recordset[0];
    if (!atual) return notFound(res);
    const body = { ...req.body };
    if (body.resultado !== undefined && !['Aprovado', 'Reprovado', null, ''].includes(body.resultado)) {
      return badRequest(res, 'Resultado inválido. Usa Aprovado, Reprovado ou vazio.');
    }
    if (body.resultado === '') body.resultado = null;
    const merged = {
      alunoId: body.alunoId !== undefined ? Number(body.alunoId) : atual.aluno_id,
      tipo: body.tipo !== undefined ? body.tipo : atual.tipo,
      data: body.data !== undefined ? body.data : atual.data,
      hora: body.hora !== undefined ? body.hora : atual.hora,
      horaFim: body.horaFim !== undefined ? body.horaFim : atual.hora_fim,
      duracao: body.duracao !== undefined ? (body.duracao ? Number(body.duracao) : null) : atual.duracao,
      local: body.local !== undefined ? body.local : atual.local,
      estado: body.estado !== undefined ? body.estado : atual.estado,
      observacoes: body.observacoes !== undefined ? body.observacoes : atual.observacoes,
      resultado: body.resultado !== undefined ? body.resultado : atual.resultado
    };
    const result = await query(
      `UPDATE exames_marcacoes SET aluno_id=@alunoId, tipo=@tipo, data=@data, hora=@hora, hora_fim=@horaFim, duracao=@duracao, local=@local, estado=@estado, observacoes=@observacoes, resultado=@resultado
       OUTPUT inserted.id, inserted.aluno_id AS alunoId, inserted.tipo, inserted.data, inserted.hora, inserted.hora_fim AS horaFim,
              inserted.duracao, inserted.local, inserted.estado, inserted.observacoes, inserted.resultado
       WHERE id=@id AND escola_id=@escolaId`,
      { ...merged, id, escolaId: req.escolaId }
    );
    ok(res, formatRow(result.recordset[0]));
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar marcação: ${ex.message || ex}` });
  }
});

app.delete('/api/examesMarcacoes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query('SELECT * FROM exames_marcacoes WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    const row = result.recordset[0];
    if (!row) return notFound(res);
    await query('DELETE FROM exames_marcacoes WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    ok(res, formatRow(result.recordset[0]));
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao remover marcação: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   11. Utilizadores e configuração da escola
   ------------------------------------------------------------ */

app.post('/api/usuarios', async (req, res) => {
  try {
    const role = String((req.body || {}).role || '').trim();
    if (!['super', 'admin', 'instrutor', 'aluno'].includes(role)) return badRequest(res, 'Role inválida. Usa super, admin, instrutor ou aluno.');
    if (!['super', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Não tens permissão para criar utilizadores.' });
    const nome = String((req.body || {}).nome || '').trim();
    const username = String((req.body || {}).username || '').trim();
    const password = String((req.body || {}).password || '').trim();
    if (!nome || !username || !password) return badRequest(res, 'Nome, username e palavra-passe são obrigatórios.');
    const dup = await query('SELECT id FROM users WHERE escola_id=@escolaId AND LOWER(username)=LOWER(@username)', { escolaId: req.escolaId, username });
    if (dup.recordset.length) return badRequest(res, 'Já existe um utilizador com esse username.');
    const passwordHash = bcrypt.hashSync(password, 10);
    const instrutorId = (req.body || {}).instrutorId ? Number((req.body || {}).instrutorId) : null;
    const result = await query(
      `INSERT INTO users (escola_id, nome, username, password_hash, role, instrutor_id)
       OUTPUT inserted.id, inserted.nome, inserted.username, inserted.role
       VALUES (@escolaId, @nome, @username, @passwordHash, @role, @instrutorId)`,
      { escolaId: req.escolaId, nome, username, passwordHash, role, instrutorId }
    );
    ok(res, result.recordset[0]);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao criar utilizador: ${ex.message || ex}` });
  }
});

app.get('/api/usuarios', (req, res) => {
  if (!['super', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Não tens permissão para aceder aos utilizadores.' });
  const { tenant } = currentTenant(req);
  ok(res, (tenant.users || []).map(u => ({ id: u.id, nome: u.nome, username: u.username, role: u.role })));
});

app.put('/api/usuarios/:id', async (req, res) => {
  try {
    if (!['super', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, error: 'Não tens permissão para editar utilizadores.' });
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM users WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    if (!existing.recordset[0]) return notFound(res);
    const updates = { ...req.body };
    if (updates.role === 'super' && req.user.role !== 'super') {
      return res.status(403).json({ success: false, error: 'Apenas o super pode atribuir o role super.' });
    }
    if (updates.username) {
      updates.username = String(updates.username).trim();
      const dup = await query('SELECT id FROM users WHERE escola_id=@escolaId AND LOWER(username)=LOWER(@username) AND id<>@id', { escolaId: req.escolaId, username: updates.username, id });
      if (dup.recordset.length) return badRequest(res, 'Já existe um utilizador com esse username.');
    }
    const sets = [];
    const params = { id, escolaId: req.escolaId };
    if (updates.nome !== undefined) { sets.push('nome=@nome'); params.nome = updates.nome; }
    if (updates.username !== undefined) { sets.push('username=@username'); params.username = updates.username; }
    if (updates.role !== undefined) { sets.push('role=@role'); params.role = updates.role; }
    if (updates.instrutorId !== undefined) { sets.push('instrutor_id=@instrutorId'); params.instrutorId = updates.instrutorId ? Number(updates.instrutorId) : null; }
    if (updates.password) { sets.push('password_hash=@passwordHash'); params.passwordHash = bcrypt.hashSync(String(updates.password), 10); }
    if (sets.length) {
      await query(`UPDATE users SET ${sets.join(', ')} WHERE id=@id AND escola_id=@escolaId`, params);
    }
    const result = await query('SELECT id, nome, username, role FROM users WHERE id=@id', { id });
    ok(res, result.recordset[0]);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar utilizador: ${ex.message || ex}` });
  }
});

app.get('/api/config', (req, res) => {
  if (req.user.role !== 'super') return res.status(403).json({ success: false, error: 'Não tens permissão para ver a configuração.' });
  const { tenant } = currentTenant(req);
  ok(res, tenant.config || {});
});

app.put('/api/config', async (req, res) => {
  if (req.user.role !== 'super') return res.status(403).json({ success: false, error: 'Não tens permissão para editar a configuração.' });
  try {
    const body = req.body || {};
    const composicaoCartaRecebida = body.composicaoCarta && typeof body.composicaoCarta === 'object' ? body.composicaoCarta : {};
    for (const categoria of Object.keys(composicaoCartaRecebida)) {
      const planosRecebidos = Array.isArray(composicaoCartaRecebida[categoria]) ? composicaoCartaRecebida[categoria] : [];
      for (const plano of planosRecebidos) {
        const nome = String(plano.nome || 'Standard').trim() || 'Standard';
        const linhas = (Array.isArray(plano.linhas) ? plano.linhas : [])
          .filter(l => l && l.produtoId !== undefined && l.produtoId !== null && l.produtoId !== '')
          .map(l => ({ produtoId: Number(l.produtoId), quantidade: Math.max(1, Number(l.quantidade) || 1) }));

        let planoId = plano.id ? Number(plano.id) : null;
        if (planoId) {
          const chk = await query('SELECT id FROM planos_carta WHERE id=@id AND escola_id=@escolaId', { id: planoId, escolaId: req.escolaId });
          if (!chk.recordset[0]) planoId = null;
        }
        if (planoId) {
          await query('UPDATE planos_carta SET categoria=@categoria, nome=@nome WHERE id=@id AND escola_id=@escolaId', { categoria, nome, id: planoId, escolaId: req.escolaId });
          await query('DELETE FROM plano_carta_linhas WHERE plano_carta_id=@id', { id: planoId });
        } else {
          const ins = await query(
            'INSERT INTO planos_carta (escola_id, categoria, nome) OUTPUT inserted.id VALUES (@escolaId, @categoria, @nome)',
            { escolaId: req.escolaId, categoria, nome }
          );
          planoId = ins.recordset[0].id;
        }
        for (const linha of linhas) {
          await query(
            'INSERT INTO plano_carta_linhas (plano_carta_id, produto_id, quantidade) VALUES (@planoId, @produtoId, @quantidade)',
            { planoId, produtoId: linha.produtoId, quantidade: linha.quantidade }
          );
        }
      }
    }

    const planosResult = await query('SELECT * FROM planos_carta WHERE escola_id=@escolaId', { escolaId: req.escolaId });
    const linhasResult = await query(
      `SELECT l.* FROM plano_carta_linhas l JOIN planos_carta p ON p.id = l.plano_carta_id WHERE p.escola_id=@escolaId`,
      { escolaId: req.escolaId }
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
    req.tenant.config = { composicaoCarta };
    ok(res, req.tenant.config);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar configuração: ${ex.message || ex}` });
  }
});

// ---------- Pré-visualização do valor da carta por categoria + desconto ----------
app.get('/api/precoCarta/:categoria', (req, res) => {
  const { tenant } = currentTenant(req);
  const categoria = String(req.params.categoria || '').trim();
  const desconto = Number(req.query.desconto || 0);
  const planoCartaId = req.query.planoCartaId ? Number(req.query.planoCartaId) : null;
  const itens = itensCartaPorCategoria(tenant, categoria, desconto, planoCartaId);
  const total = +itens.reduce((s, i) => s + (Number(i.valor) || 0), 0).toFixed(2);
  const plano = obterPlanoCarta(tenant, categoria, planoCartaId);
  ok(res, { categoria, desconto, planoCartaId: plano?.id || null, planoNome: plano?.nome || null, itens, total });
});

app.get('/api/planosCarta/:categoria', (req, res) => {
  const { tenant } = currentTenant(req);
  const categoria = String(req.params.categoria || '').trim();
  const planos = (tenant.config?.composicaoCarta?.[categoria] || []).map(p => ({ id: p.id, nome: p.nome }));
  ok(res, planos);
});

/* ------------------------------------------------------------
   12. Pré-inscrições
   ------------------------------------------------------------ */

app.get('/api/preinscricoes', (req, res) => {
  const { tenant } = currentTenant(req);
  ok(res, tenant.preInscricoes || []);
});

app.post('/api/preinscricoes', async (req, res) => {
  try {
    const payload = req.body || {};
    const nome = String(payload.nome || '').trim();
    const email = String(payload.email || '').trim();
    const categoria = String(payload.categoria || '').trim();
    if (!nome || !email || !categoria) return badRequest(res, 'Nome, email e categoria são obrigatórios.');
    let desconto = Number(payload.desconto || 0);
    if (Number.isNaN(desconto) || desconto < 0 || desconto > 100) desconto = 0;
    const result = await query(
      `INSERT INTO pre_inscricoes (escola_id, nome, email, categoria, desconto, estado, observacoes, data_pre_inscricao, data_inscricao)
       OUTPUT inserted.id, inserted.nome, inserted.email, inserted.categoria, inserted.desconto, inserted.estado,
              inserted.observacoes, inserted.data_pre_inscricao AS dataPreInscricao, inserted.data_inscricao AS dataInscricao, inserted.aluno_id AS alunoId
       VALUES (@escolaId, @nome, @email, @categoria, @desconto, @estado, @observacoes, @dataPreInscricao, @dataInscricao)`,
      {
        escolaId: req.escolaId, nome, email, categoria, desconto,
        estado: payload.estado || 'Pendente',
        observacoes: payload.observacoes || '',
        dataPreInscricao: payload.dataPreInscricao || new Date().toISOString().slice(0, 10),
        dataInscricao: payload.dataInscricao || null
      }
    );
    ok(res, formatRow(result.recordset[0]));
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao criar pré-inscrição: ${ex.message || ex}` });
  }
});

app.post('/api/preinscricoes/:id/converter', async (req, res) => {
  try {
    const preResult = await query('SELECT * FROM pre_inscricoes WHERE id=@id AND escola_id=@escolaId', { id: Number(req.params.id), escolaId: req.escolaId });
    const pre = preResult.recordset[0];
    if (!pre) return notFound(res, 'Pré-inscrição não encontrada');
    if (pre.aluno_id) return badRequest(res, 'Esta pré-inscrição já foi convertida num aluno.');

    const espacoId = Number((req.body || {}).espacoId || 0);
    const espacoChk = await query('SELECT id FROM espacos WHERE id=@id AND escola_id=@escolaId', { id: espacoId, escolaId: req.escolaId });
    if (!espacoId || !espacoChk.recordset[0]) return badRequest(res, 'Escolhe um espaço físico válido para criar o aluno.');

    let desconto = Number((req.body || {}).desconto ?? pre.desconto ?? 0);
    if (Number.isNaN(desconto) || desconto < 0 || desconto > 100) desconto = 0;

    const dataInscricao = new Date().toISOString().slice(0, 10);

    const pessoaId = await criarPessoaSql(req, { nome: pre.nome, tipoPessoa: 'aluno', origemCollection: 'alunos', email: pre.email, estado: 'Ativo' });

    const alunoResult = await query(
      `INSERT INTO alunos (escola_id, pessoa_id, espaco_id, nome, email, categoria, desconto, estado, data_inscricao)
       OUTPUT inserted.*
       VALUES (@escolaId, @pessoaId, @espacoId, @nome, @email, @categoria, @desconto, 'Ativo', @dataInscricao)`,
      { escolaId: req.escolaId, pessoaId, espacoId, nome: pre.nome, email: pre.email, categoria: pre.categoria, desconto, dataInscricao }
    );
    const alunoRow = alunoResult.recordset[0];

    await query('UPDATE alunos SET numero_aluno=@id WHERE id=@id', { id: alunoRow.id });
    await query('UPDATE pessoas SET origem_id=@alunoId WHERE id=@pessoaId', { alunoId: alunoRow.id, pessoaId });
    try {
      await criarUserAlunoSql(req, { id: alunoRow.id, nome: alunoRow.nome, email: alunoRow.email });
    } catch (ex) {
      console.error('Falha ao criar utilizador automático para aluno convertido de pré-inscrição:', ex.message || ex);
    }
    await query(
      `UPDATE pre_inscricoes SET estado='Inscrita', data_inscricao=@dataInscricao, aluno_id=@alunoId WHERE id=@id`,
      { dataInscricao, alunoId: alunoRow.id, id: pre.id }
    );

    const aluno = nestAlunoExtras(dbRowToJs({ ...alunoRow, numero_aluno: alunoRow.id }));
    ok(res, {
      aluno,
      preInscricao: { ...dbRowToJs(pre), estado: 'Inscrita', dataInscricao, alunoId: alunoRow.id }
    });
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao converter pré-inscrição: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   13. Dados da escola / integração Primavera / faturação
   ------------------------------------------------------------ */

app.get('/api/escola', (req, res) => {
  ok(res, escolaPublic(req.escola));
});
app.put('/api/escola', async (req, res) => {
  try {
    const body = req.body || {};
    const colMap = { nome: 'nome', email: 'email', telefone: 'telefone', nipc: 'nipc', morada: 'morada', nomeDiretor: 'nome_diretor' };
    const sets = [];
    const params = { id: req.escolaId };
    for (const [campo, coluna] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        sets.push(`${coluna} = @${campo}`);
        params[campo] = body[campo];
      }
    }
    const numeroLicencaIMT = body.numeroLicencaIMT ?? body.numeroLicencaImt;
    if (numeroLicencaIMT !== undefined) {
      sets.push('numero_licenca_imt = @numeroLicencaIMT');
      params.numeroLicencaIMT = numeroLicencaIMT;
    }
    if (sets.length) {
      await query(`UPDATE escolas SET ${sets.join(', ')} WHERE id=@id`, params);
    }
    const result = await query('SELECT * FROM escolas WHERE id=@id', { id: req.escolaId });
    ok(res, escolaPublic(result.recordset[0]));
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar escola: ${ex.message || ex}` });
  }
});

app.get('/api/escola/primavera', (req, res) => {
  ok(res, escolaPublic(req.escola).primavera);
});
app.put('/api/escola/primavera', async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (body.apiKey === '••••••••') delete body.apiKey;

    const currentResult = await query('SELECT * FROM escolas WHERE id=@id', { id: req.escolaId });
    const currentRow = currentResult.recordset[0];
    if (!currentRow) return notFound(res, 'Escola não encontrada.');

    const current = {
      ativo: !!currentRow.primavera_ativo, baseUrl: currentRow.primavera_base_url || '', empresa: currentRow.primavera_empresa || 'ESCOLAS',
      clientId: currentRow.primavera_client_id || '', apiKey: currentRow.primavera_api_key || '', serie: currentRow.primavera_serie || '1',
      modoPag: currentRow.primavera_modo_pag || 'PGNUM', contaBancaria: currentRow.primavera_conta_bancaria || '01', filial: currentRow.primavera_filial || '000',
      taxaIvaDefault: currentRow.primavera_taxa_iva_default ?? 23, armazem: currentRow.primavera_armazem || 'A1', artigoFormacao: currentRow.primavera_artigo_formacao || 'FORMACAO'
    };
    const merged = { ...defaultPrimaveraConfig(), ...current, ...body };

    await query(
      `UPDATE escolas SET
        primavera_ativo=@ativo, primavera_base_url=@baseUrl, primavera_empresa=@empresa,
        primavera_client_id=@clientId, primavera_api_key=@apiKey, primavera_serie=@serie,
        primavera_modo_pag=@modoPag, primavera_conta_bancaria=@contaBancaria, primavera_filial=@filial,
        primavera_taxa_iva_default=@taxaIvaDefault, primavera_armazem=@armazem, primavera_artigo_formacao=@artigoFormacao
       WHERE id=@id`,
      {
        id: req.escolaId, ativo: !!merged.ativo, baseUrl: merged.baseUrl || '', empresa: merged.empresa || 'ESCOLAS',
        clientId: merged.clientId || '', apiKey: merged.apiKey || '', serie: merged.serie || '1',
        modoPag: merged.modoPag || 'PGNUM', contaBancaria: merged.contaBancaria || '01', filial: merged.filial || '000',
        taxaIvaDefault: merged.taxaIvaDefault ?? 23, armazem: merged.armazem || 'A1', artigoFormacao: merged.artigoFormacao || 'FORMACAO'
      }
    );

    const updatedResult = await query('SELECT * FROM escolas WHERE id=@id', { id: req.escolaId });
    ok(res, escolaPublic(updatedResult.recordset[0]).primavera);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar configuração Primavera: ${ex.message || ex}` });
  }
});

async function historicoFaturacaoInsert(pagamentoId, entrada) {
  await query(
    `INSERT INTO pagamento_historico_faturacao (pagamento_id, tipo, sucesso, doc_numero, doc_serie, erro)
     VALUES (@pagamentoId, @tipo, @sucesso, @docNumero, @docSerie, @erro)`,
    { pagamentoId, tipo: entrada.tipo, sucesso: !!entrada.sucesso, docNumero: entrada.doc_numero || null, docSerie: entrada.doc_serie || null, erro: entrada.erro || null }
  );
}

/* Tenta emitir automaticamente um recibo (RE) sempre que um pagamento fica
   com estado "Pago": procura o contrato assinado mais recente deste aluno
   que já tenha fatura emitida (documentos_fiscais) e liquida-a
   parcialmente pelo valor deste pagamento. */
async function tentarEmitirReciboAutomatico(item, tenant, req) {
  if (item.estado !== 'Pago') return;
  if (item.id) {
    const jaTemRecibo = await query(`SELECT id FROM documentos_fiscais WHERE pagamento_id=@id AND tipo='RE'`, { id: item.id });
    if (jaTemRecibo.recordset.length) return;
  }
  const aluno = (tenant.alunos || []).find(a => a.id === Number(item.alunoId));
  if (!aluno) return;
  if (!req.escola.primavera || !req.escola.primavera.ativo) return;
  if (!aluno.nif) return;

  const contratoResult = await query(
    `SELECT TOP 1 c.* FROM contratos c
     WHERE c.aluno_id=@alunoId AND c.estado='Assinado'
       AND EXISTS (SELECT 1 FROM documentos_fiscais d WHERE d.contrato_id = c.id AND d.tipo IN ('FA','FR'))
     ORDER BY c.data_criacao DESC, c.id DESC`,
    { alunoId: aluno.id }
  );
  const contratoRow = contratoResult.recordset[0];
  if (!contratoRow) return;

  const faturaResult = await query(
    `SELECT TOP 1 * FROM documentos_fiscais WHERE contrato_id=@contratoId AND tipo IN ('FA','FR') ORDER BY data_emissao DESC`,
    { contratoId: contratoRow.id }
  );
  const faturaRow = faturaResult.recordset[0];
  const contrato = dbRowToJs(contratoRow);
  contrato.faturacao = faturaRow ? { tipo: faturaRow.tipo, serie: faturaRow.serie, numero: faturaRow.numero } : null;

  try {
    const serieDoc = await obterSerieParaAluno(req, aluno);
    const out = await invoicing.emitirReciboContrato(req.escola, tenant, aluno, contrato, item, { serie: serieDoc });
    if (out.resultado.sucesso) {
      await query(
        `INSERT INTO documentos_fiscais (escola_id, aluno_id, contrato_id, pagamento_id, tipo, serie, numero, valor, doc_original_tipo, doc_original_serie, doc_original_numero)
         VALUES (@escolaId, @alunoId, @contratoId, @pagamentoId, 'RE', @serie, @numero, @valor, @docTipo, @docSerie, @docNumero)`,
        {
          escolaId: req.escolaId, alunoId: aluno.id, contratoId: contrato.id, pagamentoId: item.id || null,
          serie: out.resultado.doc_serie || serieDoc || null, numero: out.resultado.doc_numero || null, valor: Number(item.valor) || 0,
          docTipo: contrato.faturacao?.tipo || null, docSerie: contrato.faturacao?.serie || null, docNumero: contrato.faturacao?.numero || null
        }
      );
    }
  } catch (ex) {
    // Não bloqueia a criação/atualização do pagamento por causa de uma falha acessória
    console.error('Falha ao emitir recibo automático:', ex.message || ex);
  }
}

async function handleEmissao(req, res, tipo) {
  try {
    const pagamentoResult = await query('SELECT * FROM pagamentos WHERE id=@id AND escola_id=@escolaId', { id: Number(req.params.id), escolaId: req.escolaId });
    const pagamentoRow = pagamentoResult.recordset[0];
    if (!pagamentoRow) return notFound(res, 'Pagamento não encontrado');
    const alunoResult = await query('SELECT * FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: pagamentoRow.aluno_id, escolaId: req.escolaId });
    const alunoRow = alunoResult.recordset[0];
    if (!alunoRow) return badRequest(res, 'Este pagamento não está associado a um aluno válido');

    nestEscolaPrimavera(req.escola); // <-- aninha primavera_* → req.escola.primavera
    if (!req.escola.primavera || !req.escola.primavera.ativo) {
      return badRequest(res, 'A integração com a Cegid Primavera não está ativa para esta escola. Configura-a em Pagamentos > Faturação.');
    }
    if (!alunoRow.nif) return badRequest(res, 'O aluno não tem NIF preenchido — obrigatório para emitir documentos fiscais.');

    const aluno = nestAlunoExtras(dbRowToJs(alunoRow));
    const pagamento = dbRowToJs(pagamentoRow);
    const { tenant } = currentTenant(req);

    const serieDoc = await obterSerieParaAluno(req, aluno);
    const options = { serie: serieDoc, ...(req.body || {}) };
    let out;
    try {
      if (tipo === 'FA') out = await invoicing.emitirFatura(req.escola, tenant, aluno, pagamento, options);
      else if (tipo === 'FR') out = await invoicing.emitirFaturaRecibo(req.escola, tenant, aluno, pagamento, options);
      else if (tipo === 'NC') out = await invoicing.emitirNotaCredito(req.escola, tenant, aluno, pagamento, options);
      else if (tipo === 'RE') out = await invoicing.emitirRecibo(req.escola, tenant, aluno, pagamento, options);
    } catch (ex) {
      return res.status(502).json({ success: false, error: `Erro inesperado a comunicar com a Cegid Primavera: ${ex.message || ex}` });
    }

    const { resultado, entidade } = out;
    if (!resultado.sucesso) {
      await historicoFaturacaoInsert(pagamentoRow.id, { tipo, sucesso: false, erro: resultado.erro });
      return res.status(502).json({ success: false, error: resultado.erro });
    }

    const sets = [
      'faturacao_tipo=@tipo', 'faturacao_serie=@serie', 'faturacao_numero=@numero',
      'faturacao_entidade=@entidade', 'faturacao_data_emissao=SYSUTCDATETIME()'
    ];
    if (tipo === 'FA' || tipo === 'FR') sets.push(`estado='Pago'`);
    await query(
      `UPDATE pagamentos SET ${sets.join(', ')} WHERE id=@id AND escola_id=@escolaId`,
      { tipo: resultado.doc_tipo || tipo, serie: resultado.doc_serie || null, numero: resultado.doc_numero || null, entidade: entidade || null, id: pagamentoRow.id, escolaId: req.escolaId }
    );
    await query(
      `INSERT INTO documentos_fiscais (escola_id, aluno_id, pagamento_id, tipo, serie, numero, valor)
       VALUES (@escolaId, @alunoId, @pagamentoId, @tipo, @serie, @numero, @valor)`,
      { escolaId: req.escolaId, alunoId: alunoRow.id, pagamentoId: pagamentoRow.id, tipo: resultado.doc_tipo || tipo, serie: resultado.doc_serie || null, numero: resultado.doc_numero || null, valor: pagamentoRow.valor }
    );
    await historicoFaturacaoInsert(pagamentoRow.id, { tipo, sucesso: true, doc_numero: resultado.doc_numero, doc_serie: resultado.doc_serie });

    const pagamentoAtualizado = await query('SELECT * FROM pagamentos WHERE id=@id', { id: pagamentoRow.id });
    ok(res, { pagamento: dbRowToJs(pagamentoAtualizado.recordset[0]), resultado });
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao emitir documento: ${ex.message || ex}` });
  }
}

app.post('/api/pagamentos/:id/fatura', (req, res) => handleEmissao(req, res, 'FA'));
app.post('/api/pagamentos/:id/fatura-recibo', (req, res) => handleEmissao(req, res, 'FR'));
app.post('/api/pagamentos/:id/nota-credito', (req, res) => handleEmissao(req, res, 'NC'));
app.post('/api/pagamentos/:id/recibo', (req, res) => handleEmissao(req, res, 'RE'));

/* ------------------------------------------------------------
   14. Assinatura e PDF do contrato
   ------------------------------------------------------------ */

app.put('/api/contratos/:id/assinar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nomeDigitado, textoContrato, assinaturaImagem, nomeTutorDigitado, nomeDigitadoTutor, assinaturaTutorImagem, pdfBase64, filename } = req.body || {};
    if (!nomeDigitado) return badRequest(res, 'É necessário indicar o nome completo para confirmar a aceitação do contrato');
    if (!assinaturaImagem) return badRequest(res, 'É necessário desenhar a assinatura no ecrã antes de confirmar.');

    const existing = await query('SELECT * FROM contratos WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    const contratoRow = existing.recordset[0];
    if (!contratoRow) return notFound(res);

    const finalNomeTutor = nomeTutorDigitado || nomeDigitadoTutor || null;

    const base64Data = String(assinaturaImagem).includes(',') ? String(assinaturaImagem).split(',').pop() : assinaturaImagem;
    const imagemBuffer = Buffer.from(base64Data, 'base64');

    let tutorBuffer = null;
    if (assinaturaTutorImagem) {
      const tutorBase64 = String(assinaturaTutorImagem).includes(',') ? String(assinaturaTutorImagem).split(',').pop() : assinaturaTutorImagem;
      tutorBuffer = Buffer.from(tutorBase64, 'base64');
    }

    // Preparar/obter o buffer do PDF assinado
    let pdfBuffer = null;
    const nomeFicheiroPdf = filename || `contrato-${id}-assinado.pdf`;

    if (pdfBase64) {
      try {
        const rawPdf = String(pdfBase64).includes(',') ? String(pdfBase64).split(',').pop() : pdfBase64;
        pdfBuffer = Buffer.from(rawPdf, 'base64');
      } catch (errPdf) {
        console.error('Erro ao descodificar pdfBase64:', errPdf.message);
      }
    }

    // Se não foi fornecido um PDF do cliente, gerar automaticamente o PDF com pdf-lib no backend
    if (!pdfBuffer || pdfBuffer.length === 0) {
      try {
        const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595.28, 841.89]);
        const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const escolaNome = req.escola?.nome || 'Escola de Condução';
        page.drawText(escolaNome, { x: 50, y: 800, size: 16, font: fontBold, color: rgb(0.09, 0.14, 0.23) });
        page.drawText(`CONTRATO DE FORMAÇÃO DE CONDUTORES N.º ${id}`, { x: 50, y: 780, size: 12, font: fontBold, color: rgb(0.3, 0.35, 0.45) });

        page.drawText(`Categoria: ${contratoRow.categoria || '—'}  |  Valor Total: ${contratoRow.valor_total || 0} €`, { x: 50, y: 755, size: 10, font: fontReg, color: rgb(0.15, 0.15, 0.15) });
        page.drawText(`Data de Aceitação: ${new Date().toLocaleString('pt-PT')}`, { x: 50, y: 740, size: 10, font: fontReg, color: rgb(0.15, 0.15, 0.15) });

        // Desenhar resumo do contrato
        page.drawText('Termos do Contrato:', { x: 50, y: 705, size: 11, font: fontBold, color: rgb(0.09, 0.14, 0.23) });
        const resumoLinhas = [
          '1. O presente contrato regula a prestação de serviços de ensino da condução.',
          '2. O segundo outorgante aceitou os termos e condições gerais de formação.',
          '3. O contrato entra em vigor na data da sua aceitação eletrónica.'
        ];
        let posY = 685;
        resumoLinhas.forEach(l => {
          page.drawText(l, { x: 50, y: posY, size: 9.5, font: fontReg, color: rgb(0.25, 0.25, 0.25) });
          posY -= 18;
        });

        // Assinatura do formando
        page.drawText('Assinatura do Formando:', { x: 50, y: 320, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.2) });
        try {
          const sigImg = await pdfDoc.embedPng(imagemBuffer);
          page.drawImage(sigImg, { x: 50, y: 240, width: 140, height: 60 });
        } catch (_) {}
        page.drawText(`Aceite por: ${nomeDigitado}`, { x: 50, y: 220, size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3) });

        // Assinatura do tutor se aplicável
        if (tutorBuffer && finalNomeTutor) {
          page.drawText('Assinatura do Encarregado / Tutor:', { x: 320, y: 320, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.2) });
          try {
            const tutorImg = await pdfDoc.embedPng(tutorBuffer);
            page.drawImage(tutorImg, { x: 320, y: 240, width: 140, height: 60 });
          } catch (_) {}
          page.drawText(`Tutor: ${finalNomeTutor}`, { x: 320, y: 220, size: 9, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
        }

        const pdfBytes = await pdfDoc.save();
        pdfBuffer = Buffer.from(pdfBytes);
      } catch (genErr) {
        console.error('Erro ao sintetizar PDF com pdf-lib:', genErr.message);
      }
    }

    // Gravar o ficheiro PDF no sistema de ficheiros
    if (pdfBuffer) {
      const dir = path.join(CONTRATOS_PDF_DIR, String(req.escolaId));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(contratoPdfPath(req.escolaId, id), pdfBuffer);
    }

    const result = await query(
      `UPDATE contratos SET
              estado='Assinado',
              texto_contrato=@textoContrato,
              assinatura_nome_digitado=@nomeDigitado,
              assinatura_data_hora=SYSUTCDATETIME(),
              assinatura_imagem=@assinaturaImagem,
              assinatura_tutor_nome_digitado=@nomeTutorDigitado,
              assinatura_tutor_imagem=@assinaturaTutorImagem,
              pdf_assinado_filename=@pdfFilename,
              pdf_assinado_uploaded_at=SYSUTCDATETIME(),
              pdf_assinado_tamanho_bytes=@pdfTamanho
       OUTPUT inserted.*
       WHERE id=@id AND escola_id=@escolaId`,
      {
        id, escolaId: req.escolaId, textoContrato: textoContrato || contratoRow.texto_contrato, nomeDigitado,
        assinaturaImagem: { type: sql.VarBinary(sql.MAX), value: imagemBuffer },
        nomeTutorDigitado: finalNomeTutor,
        assinaturaTutorImagem: { type: sql.VarBinary(sql.MAX), value: tutorBuffer },
        pdfFilename: nomeFicheiroPdf,
        pdfTamanho: pdfBuffer ? pdfBuffer.length : 0
      }
    );
    const contrato = dbRowToJs(result.recordset[0]);
    contrato.assinatura = {
      nomeDigitado: contrato.assinaturaNomeDigitado,
      dataHora: contrato.assinaturaDataHora,
      imagemBase64: contrato.assinaturaImagem ? `data:image/png;base64,${contrato.assinaturaImagem}` : null
    };
    delete contrato.assinaturaImagem;
    contrato.assinaturaTutor = contrato.assinaturaTutorNomeDigitado ? {
      nomeDigitado: contrato.assinaturaTutorNomeDigitado,
      imagemBase64: contrato.assinaturaTutorImagem ? `data:image/png;base64,${contrato.assinaturaTutorImagem}` : null
    } : null;
    delete contrato.assinaturaTutorImagem;
    contrato.pdfAssinado = {
      filename: contrato.pdfAssinadoFilename,
      uploadedAt: contrato.pdfAssinadoUploadedAt,
      size: contrato.pdfAssinadoTamanhoBytes
    };

    // Sincronizar automaticamente os itens à CC do aluno de acordo com o contrato assinado
    const { tenant } = currentTenant(req);
    const sync = calcularValoresContrato(contrato, tenant);
    await sincronizarItensContaContrato(req, id, sync);
    if (sync.usaParcelasPersonalizadas) {
      const parcelasResult = await query('SELECT descricao, valor FROM contrato_parcelas_personalizadas WHERE contrato_id=@id ORDER BY ordem', { id });
      await gravarParcelasPersonalizadas(id, parcelasResult.recordset);
    }
    await atualizarEstadosContaCorrente(req, contrato.alunoId);

    // Se Primavera estiver ativa e aluno tiver NIF, emitir fatura de contrato automaticamente
    nestEscolaPrimavera(req.escola);
    if (req.escola.primavera && req.escola.primavera.ativo) {
      const alunoResult = await query('SELECT * FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: contrato.alunoId, escolaId: req.escolaId });
      const alunoRow = alunoResult.recordset[0];
      if (alunoRow && alunoRow.nif) {
        const jaTemFatura = await query(`SELECT id FROM documentos_fiscais WHERE contrato_id=@id AND tipo IN ('FA','FR')`, { id });
        if (!jaTemFatura.recordset.length) {
          try {
            const aluno = nestAlunoExtras(dbRowToJs(alunoRow));
            contrato.itensCarta = itensCartaPorCategoria(tenant, contrato.categoria, Number(aluno.desconto || 0), contrato.planoCartaId);
            const serieDoc = await obterSerieParaAluno(req, aluno);
            const out = await invoicing.emitirFaturaContrato(req.escola, tenant, aluno, contrato, { serie: serieDoc });
            if (out && out.resultado && out.resultado.sucesso) {
              await query(
                `INSERT INTO documentos_fiscais (escola_id, aluno_id, contrato_id, tipo, serie, numero, valor)
                 VALUES (@escolaId, @alunoId, @contratoId, 'FA', @serie, @numero, @valor)`,
                {
                  escolaId: req.escolaId,
                  alunoId: aluno.id,
                  contratoId: id,
                  serie: out.resultado.doc_serie || serieDoc,
                  numero: out.resultado.doc_numero || null,
                  valor: contrato.valorTotal || contrato.valorCartaCalculado || 0
                }
              );
            }
          } catch (ex) {
            console.error('Aviso ao emitir fatura automática de contrato:', ex.message || ex);
          }
        }
      }
    }

    ok(res, contrato);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao assinar contrato: ${ex.message || ex}` });
  }
});

app.post('/api/contratos/:id/pdf-assinado', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM contratos WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    const contratoRow = existing.recordset[0];
    if (!contratoRow) return notFound(res, 'Contrato não encontrado');

    const { pdfBase64, filename } = req.body || {};
    if (!pdfBase64) return badRequest(res, 'É necessário enviar o ficheiro PDF do contrato assinado.');

    let buffer;
    try {
      const base64Data = String(pdfBase64).includes(',') ? String(pdfBase64).split(',').pop() : pdfBase64;
      buffer = Buffer.from(base64Data, 'base64');
    } catch (ex) {
      return badRequest(res, 'Ficheiro PDF inválido.');
    }
    if (!buffer || buffer.length === 0) return badRequest(res, 'Ficheiro PDF vazio ou inválido.');
    if (buffer.length > 15 * 1024 * 1024) return badRequest(res, 'O ficheiro não pode exceder 15MB.');

    const dir = path.join(CONTRATOS_PDF_DIR, String(req.escolaId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(contratoPdfPath(req.escolaId, id), buffer);

    const nomeFicheiro = filename || `contrato-${id}.pdf`;
    const result = await query(
      `UPDATE contratos SET estado='Assinado', pdf_assinado_filename=@filename, pdf_assinado_uploaded_at=SYSUTCDATETIME(), pdf_assinado_tamanho_bytes=@tamanho
       OUTPUT inserted.*
       WHERE id=@id AND escola_id=@escolaId`,
      { id, escolaId: req.escolaId, filename: nomeFicheiro, tamanho: buffer.length }
    );
    const contrato = dbRowToJs(result.recordset[0]);
    contrato.pdfAssinado = { filename: contrato.pdfAssinadoFilename, uploadedAt: contrato.pdfAssinadoUploadedAt, size: contrato.pdfAssinadoTamanhoBytes };

    // Sincronizar automaticamente os itens à CC do aluno após a submissão
    const { tenant } = currentTenant(req);
    const sync = calcularValoresContrato(contrato, tenant);
    await sincronizarItensContaContrato(req, id, sync);
    if (sync.usaParcelasPersonalizadas) {
      const parcelasResult = await query('SELECT descricao, valor FROM contrato_parcelas_personalizadas WHERE contrato_id=@id ORDER BY ordem', { id });
      await gravarParcelasPersonalizadas(id, parcelasResult.recordset);
    }
    await atualizarEstadosContaCorrente(req, contrato.alunoId);

    // Se Primavera estiver ativa e aluno tiver NIF, emitir fatura de contrato automaticamente
    nestEscolaPrimavera(req.escola);
    if (req.escola.primavera && req.escola.primavera.ativo) {
      const alunoResult = await query('SELECT * FROM alunos WHERE id=@id AND escola_id=@escolaId', { id: contrato.alunoId, escolaId: req.escolaId });
      const alunoRow = alunoResult.recordset[0];
      if (alunoRow && alunoRow.nif) {
        const jaTemFatura = await query(`SELECT id FROM documentos_fiscais WHERE contrato_id=@id AND tipo IN ('FA','FR')`, { id });
        if (!jaTemFatura.recordset.length) {
          try {
            const aluno = nestAlunoExtras(dbRowToJs(alunoRow));
            contrato.itensCarta = itensCartaPorCategoria(tenant, contrato.categoria, Number(aluno.desconto || 0), contrato.planoCartaId);
            const serieDoc = await obterSerieParaAluno(req, aluno);
            const out = await invoicing.emitirFaturaContrato(req.escola, tenant, aluno, contrato, { serie: serieDoc });
            if (out && out.resultado && out.resultado.sucesso) {
              await query(
                `INSERT INTO documentos_fiscais (escola_id, aluno_id, contrato_id, tipo, serie, numero, valor)
                 VALUES (@escolaId, @alunoId, @contratoId, 'FA', @serie, @numero, @valor)`,
                {
                  escolaId: req.escolaId,
                  alunoId: aluno.id,
                  contratoId: id,
                  serie: out.resultado.doc_serie || serieDoc,
                  numero: out.resultado.doc_numero || null,
                  valor: contrato.valorTotal || contrato.valorCartaCalculado || 0
                }
              );
            }
          } catch (ex) {
            console.error('Aviso ao emitir fatura automática de contrato:', ex.message || ex);
          }
        }
      }
    }

    ok(res, { contrato });
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao guardar PDF do contrato: ${ex.message || ex}` });
  }
});

app.get('/api/contratos/:id/pdf-assinado', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query('SELECT pdf_assinado_filename AS filename FROM contratos WHERE id=@id AND escola_id=@escolaId', { id, escolaId: req.escolaId });
    const row = result.recordset[0];
    if (!row || !row.filename) return notFound(res, 'Este contrato ainda não tem um PDF submetido.');
    const ficheiro = contratoPdfPath(req.escolaId, id);
    if (!fs.existsSync(ficheiro)) return notFound(res, 'Ficheiro não encontrado no servidor.');
    res.setHeader('Content-Type', 'application/pdf');
    const nomeSeguro = String(row.filename || 'contrato.pdf').replace(/"/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${nomeSeguro}"`);
    fs.createReadStream(ficheiro).pipe(res);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao obter PDF: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   15. Helpers de tempo/horas + assiduidade
   ------------------------------------------------------------ */

function minutosEntre(horaInicio, horaFim) {
  const [h1, m1] = String(horaInicio || '0:0').split(':').map(Number);
  const [h2, m2] = String(horaFim || '0:0').split(':').map(Number);
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1));
}

function diasAte(dataISO) {
  if (!dataISO) return null;
  const hoje = new Date(new Date().toISOString().slice(0, 10));
  const alvo = new Date(dataISO);
  return Math.round((alvo - hoje) / 86400000);
}
function diasEntre(dataInicioISO, dataFimISO) {
  if (!dataInicioISO || !dataFimISO) return null;
  const d1 = new Date(`${dataInicioISO}T00:00:00`);
  const d2 = new Date(`${dataFimISO}T00:00:00`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.round((d2 - d1) / 86400000);
}
function ultimosNMeses(n) {
  const hoje = new Date();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

function formatarDataPt(dataISO) {
  if (!dataISO) return '—';
  const str = String(dataISO).slice(0, 10);
  const [ano, mes, dia] = str.split('-');
  if (!ano || !mes || !dia) return str;
  return `${dia}/${mes}/${ano}`;
}

// CORRIGIDO: usa isTipo (aceita "Prática"/"pratica"/"PRÁTICA" ...) e
// isEstadoCancelada em vez de `!== 'Cancelada'` estrito.
function calcularEsperaTeoricaPratica(tenant) {
  const resultados = [];
  tenant.alunos.forEach(aluno => {
    const examesTeoricosAprovados = (tenant.examesMarcacoes || [])
      .filter(m => m.alunoId === aluno.id && m.tipo === 'Teórico' && m.resultado === 'Aprovado' && m.data)
      .sort((a, b) => a.data.localeCompare(b.data));
    if (!examesTeoricosAprovados.length) return;
    const dataExameAprovado = examesTeoricosAprovados[0].data;

    const praticas = tenant.aulas
      .filter(a => a.alunoId === aluno.id && isTipo(a, 'Prática') && !isEstadoCancelada(a.estado) && a.data)
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    if (!praticas.length) return;
    const primeiraAula = praticas[0];

    const diasEspera = diasEntre(dataExameAprovado, primeiraAula.data);
    if (diasEspera === null) return;

    const espaco = tenant.espacos.find(e => e.id === aluno.espacoId);
    resultados.push({
      alunoId: aluno.id,
      nome: aluno.nome,
      espacoId: aluno.espacoId ?? null,
      espacoNome: espaco ? espaco.nome : '—',
      dataExameAprovado,
      dataAula1: primeiraAula.data,
      diasEspera
    });
  });
  return resultados.sort((a, b) => b.diasEspera - a.diasEspera);
}
function estadoValidade(dataISO, limiteAvisoDias = 30) {
  const dias = diasAte(dataISO);
  if (dias === null) return null;
  if (dias < 0) return 'expirado';
  if (dias <= limiteAvisoDias) return 'a_expirar';
  return 'valido';
}

/* ------------------------------------------------------------
   16. Presenças de turma teórica
   ------------------------------------------------------------ */

app.put('/api/turmasTeoricas/:id/presencas', async (req, res) => {
  try {
    const turmaId = Number(req.params.id);
    const turmaResult = await query('SELECT * FROM turmas_teoricas WHERE id=@id AND escola_id=@escolaId', { id: turmaId, escolaId: req.escolaId });
    if (!turmaResult.recordset[0]) return notFound(res);

    const presencas = req.body?.presencas || {};
    const idsAlunos = Object.keys(presencas).map(Number).filter(Number.isFinite);
    const marcadoPor = req.user.id; // quem está a marcar a presença (staff autenticado)

    for (const alunoId of idsAlunos) {
      const jaExiste = await query('SELECT 1 AS existe FROM turma_inscritos WHERE turma_id=@turmaId AND aluno_id=@alunoId', {
        turmaId,
        alunoId
      });

      if (jaExiste.recordset[0]) {
        await query(
          `UPDATE turma_inscritos
           SET presente=@presente, data_marcacao=SYSUTCDATETIME(), marcado_por=@marcadoPor
           WHERE turma_id=@turmaId AND aluno_id=@alunoId`,
          {
            presente: !!presencas[alunoId],
            turmaId,
            alunoId,
            marcadoPor
          }
        );
      } else {
        await query(
          `INSERT INTO turma_inscritos (turma_id, aluno_id, presente, data_marcacao, marcado_por)
           VALUES (@turmaId, @alunoId, @presente, SYSUTCDATETIME(), @marcadoPor)`,
          {
            turmaId,
            alunoId,
            presente: !!presencas[alunoId],
            marcadoPor
          }
        );
      }
    }

    if (req.body?.estado) {
      await query('UPDATE turmas_teoricas SET estado=@estado WHERE id=@id AND escola_id=@escolaId', { estado: req.body.estado, id: turmaId, escolaId: req.escolaId });
    }

    // Devolve também data_marcacao/marcado_por para o front conseguir mostrar quem/quando marcou
    const presencasAtualizadas = await query(
      'SELECT aluno_id AS alunoId, presente, data_marcacao AS dataMarcacao, marcado_por AS marcadoPor FROM turma_inscritos WHERE turma_id=@id',
      { id: turmaId }
    );
    const turmaAtualizada = await query('SELECT * FROM turmas_teoricas WHERE id=@id', { id: turmaId });
    const turma = dbRowToJs(turmaAtualizada.recordset[0]);
    const inscritos = presencasAtualizadas.recordset.map(r => Number(r.alunoId));
    turma.inscritos = [...new Set(inscritos)];
    turma.presencas = Object.fromEntries(presencasAtualizadas.recordset.filter(r => r.presente !== null).map(r => [Number(r.alunoId), !!r.presente]));
    ok(res, turma);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao atualizar presenças: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   17. Calendário unificado + exportação .ics
   ------------------------------------------------------------ */

app.get('/api/calendario', async (req, res) => {
  try {
    const { inicio, fim, instrutorId } = req.query;
    if (!inicio || !fim) return badRequest(res, 'inicio e fim são obrigatórios (YYYY-MM-DD).');

    const filtroInstrutor = instrutorId ? 'AND instrutor_id = @instrutorId' : '';
    const params = { escolaId: req.escolaId, inicio, fim, instrutorId: instrutorId ? Number(instrutorId) : null };

    const [aulasR, turmasR] = await Promise.all([
      query(`SELECT * FROM aulas WHERE escola_id=@escolaId AND data BETWEEN @inicio AND @fim ${filtroInstrutor} ORDER BY data, hora`, params),
      query(`SELECT t.*,
               (SELECT COUNT(*) FROM turma_inscritos ti WHERE ti.turma_id = t.id) AS numInscritos,
               (SELECT COUNT(*) FROM turma_inscritos ti WHERE ti.turma_id = t.id AND ti.presente = 1) AS numPresentes
             FROM turmas_teoricas t
             WHERE t.escola_id=@escolaId AND t.data BETWEEN @inicio AND @fim ${filtroInstrutor}
             ORDER BY t.data, t.hora_inicio`, params)
    ]);

    // ids de alunos/instrutores/veículos/espaços envolvidos, para resolver nomes
    // sem precisar da coleção inteira
    const aulasRows = aulasR.recordset.map(dbRowToJs);
    const turmasRows = turmasR.recordset.map(dbRowToJs);

    const idsAlunos = [...new Set(aulasRows.map(a => a.alunoId).filter(Boolean))];
    const idsInstrutores = [...new Set([...aulasRows, ...turmasRows].map(a => a.instrutorId).filter(Boolean))];
    const idsVeiculos = [...new Set(aulasRows.map(a => a.veiculoId).filter(Boolean))];
    const idsEspacos = [...new Set([...aulasRows, ...turmasRows].map(a => a.espacoId).filter(Boolean))];

    async function mapaPorIds(tabela, ids, colunas) {
      if (!ids.length) return new Map();
      const r = await query(
        `SELECT id, ${colunas} FROM ${tabela} WHERE escola_id=@escolaId AND id IN (${ids.map((_, i) => '@id' + i).join(',')})`,
        ids.reduce((acc, id, i) => ({ ...acc, ['id' + i]: id }), { escolaId: req.escolaId })
      );
      return new Map(r.recordset.map(row => [row.id, row]));
    }

    const [mapaAlunos, mapaInstrutores, mapaVeiculos, mapaEspacos] = await Promise.all([
      mapaPorIds('alunos', idsAlunos, 'nome'),
      mapaPorIds('instrutores', idsInstrutores, 'nome'),
      mapaPorIds('veiculos', idsVeiculos, 'matricula'),
      mapaPorIds('espacos', idsEspacos, 'nome')
    ]);

    const eventosAulas = aulasRows.map(a => ({
      id: a.id, origem: 'aula', tipo: a.tipo || 'Prática', data: a.data, horaInicio: a.hora, horaFim: null,
      duracao: a.duracao || 50, estado: a.estado, alunoId: a.alunoId,
      alunoNome: mapaAlunos.get(a.alunoId)?.nome || '—',
      instrutorId: a.instrutorId, instrutorNome: mapaInstrutores.get(a.instrutorId)?.nome || '—',
      veiculoMatricula: mapaVeiculos.get(a.veiculoId)?.matricula || null,
      espacoId: a.espacoId || null, espacoNome: mapaEspacos.get(a.espacoId)?.nome || '—',
      titulo: a.notas || (isTipo(a, 'Teórica') ? 'Aula teórica individual' : 'Aula prática')
    }));

    const eventosTurmas = turmasRows.map(t => ({
      id: t.id, origem: 'turmaTeorica', tipo: 'Teórica', data: t.data, horaInicio: t.horaInicio, horaFim: t.horaFim,
      duracao: minutosEntre(t.horaInicio, t.horaFim), estado: t.estado,
      instrutorId: t.instrutorId, instrutorNome: mapaInstrutores.get(t.instrutorId)?.nome || '—',
      espacoId: t.espacoId || null, espacoNome: mapaEspacos.get(t.espacoId)?.nome || t.sala || '—',
      numInscritos: t.numInscritos || 0, numPresentes: t.numPresentes || 0, titulo: t.tema
    }));

    const eventos = [...eventosAulas, ...eventosTurmas].sort((a, b) =>
      (a.data + (a.horaInicio || '')).localeCompare(b.data + (b.horaInicio || ''))
    );
    ok(res, eventos);
  } catch (ex) {
    res.status(503).json({ success: false, error: `Falha ao carregar calendário: ${ex.message || ex}` });
  }
});

function pad2(n) { return String(n).padStart(2, '0'); }

function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsFoldLine(line) {
  if (line.length <= 74) return line;
  let out = line.slice(0, 74);
  let rest = line.slice(74);
  while (rest.length > 0) {
    out += `\r\n ${rest.slice(0, 73)}`;
    rest = rest.slice(73);
  }
  return out;
}

function icsDateTimeLocal(data, hora) {
  const [y, m, d] = String(data || '').split('-');
  if (!y || !m || !d) return null;
  const [hh, mm] = String(hora || '00:00').split(':');
  return `${y}${m}${d}T${pad2(hh || '0')}${pad2(mm || '0')}00`;
}

function icsDateTimeAddMinutos(data, hora, minutos) {
  const [y, m, d] = String(data || '').split('-').map(Number);
  const [hh, mm] = String(hora || '00:00').split(':').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  dt.setMinutes(dt.getMinutes() + (minutos || 50));
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
}

function icsStampUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

app.get('/api/calendario/export.ics', (req, res) => {
  const { tenant } = currentTenant(req);
  const mesRef = String(req.query.mes || '').trim();
  const instrutorId = req.query.instrutorId ? Number(req.query.instrutorId) : null;
  const dominio = String(req.escola?.username || 'escola').replace(/[^a-z0-9]/gi, '') + '.autoescola';
  const stamp = icsStampUTC();

  const eventos = [];

  (tenant.aulas || [])
    .filter(a => a.data && (!mesRef || a.data.startsWith(mesRef)) && (!instrutorId || Number(a.instrutorId) === instrutorId))
    .forEach(a => {
      const dtStart = icsDateTimeLocal(a.data, a.hora);
      if (!dtStart) return;
      const dtEnd = a.horaFim ? icsDateTimeLocal(a.data, a.horaFim) : icsDateTimeAddMinutos(a.data, a.hora, a.duracao || 50);
      const aluno = (tenant.alunos || []).find(x => x.id === a.alunoId);
      const instrutor = (tenant.instrutores || []).find(x => x.id === a.instrutorId);
      const veiculo = (tenant.veiculos || []).find(x => x.id === a.veiculoId);
      const espaco = (tenant.espacos || []).find(x => x.id === a.espacoId);
      const descricaoLinhas = [
        `Tipo: ${a.tipo || 'Aula'}`,
        a.modulo ? `Módulo: ${a.modulo}` : null,
        instrutor ? `Instrutor: ${instrutor.nome}` : null,
        veiculo ? `Veículo: ${veiculo.matricula}` : null,
        `Estado: ${a.estado || 'Agendada'}`,
        a.notas ? `Notas: ${a.notas}` : null
      ].filter(Boolean).join('\n');
      eventos.push({
        uid: `aula-${a.id}@${dominio}`,
        dtStart, dtEnd,
        summary: `Aula ${a.tipo || ''} — ${aluno ? aluno.nome : 'Aluno removido'}`.trim(),
        description: descricaoLinhas,
        location: espaco ? espaco.nome : '',
        status: isEstadoCancelada(a.estado) ? 'CANCELLED' : 'CONFIRMED'
      });
    });

  (tenant.turmasTeoricas || [])
    .filter(t => t.data && (!mesRef || t.data.startsWith(mesRef)) && (!instrutorId || Number(t.instrutorId) === instrutorId))
    .forEach(t => {
      const dtStart = icsDateTimeLocal(t.data, t.horaInicio);
      if (!dtStart) return;
      const dtEnd = t.horaFim ? icsDateTimeLocal(t.data, t.horaFim) : icsDateTimeAddMinutos(t.data, t.horaInicio, 50);
      const instrutor = (tenant.instrutores || []).find(x => x.id === t.instrutorId);
      const espaco = (tenant.espacos || []).find(x => x.id === t.espacoId);
      const descricaoLinhas = [
        instrutor ? `Instrutor: ${instrutor.nome}` : null,
        `Inscritos: ${(t.inscritos || []).length}`,
        `Estado: ${t.estado || 'Agendada'}`
      ].filter(Boolean).join('\n');
      eventos.push({
        uid: `turma-${t.id}@${dominio}`,
        dtStart, dtEnd,
        summary: `Turma teórica: ${t.tema || 'Sem tema'}`,
        description: descricaoLinhas,
        location: espaco ? espaco.nome : (t.sala || ''),
        status: isEstadoCancelada(t.estado) ? 'CANCELLED' : 'CONFIRMED'
      });
    });

  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//' + icsEscape(req.escola?.nome || 'Escola') + '//Calendario//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(req.escola?.nome || 'Calendário da escola')}`
  ];
  eventos.forEach(ev => {
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${ev.uid}`);
    linhas.push(`DTSTAMP:${stamp}`);
    linhas.push(`DTSTART:${ev.dtStart}`);
    if (ev.dtEnd) linhas.push(`DTEND:${ev.dtEnd}`);
    linhas.push(icsFoldLine(`SUMMARY:${icsEscape(ev.summary)}`));
    if (ev.description) linhas.push(icsFoldLine(`DESCRIPTION:${icsEscape(ev.description)}`));
    if (ev.location) linhas.push(icsFoldLine(`LOCATION:${icsEscape(ev.location)}`));
    linhas.push(`STATUS:${ev.status}`);
    linhas.push('END:VEVENT');
  });
  linhas.push('END:VCALENDAR');

  const corpo = linhas.join('\r\n');
  const nomeFicheiro = `calendario-${(req.escola?.username || 'escola')}${mesRef ? '-' + mesRef : ''}.ics`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeFicheiro}"`);
  res.send(corpo);
});

/* ------------------------------------------------------------
   18. Conta corrente por aluno
   ------------------------------------------------------------ */

function dataOrdenavel(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v || '');
}

function calcularContaCorrente(itens, pagamentos) {
  const estadoItens = [...itens]
    .sort((a, b) => (a.ordem ?? a.id) - (b.ordem ?? b.id))
    .map(it => ({ ...it, valorPago: 0 }));

  const pagamentosOrdenados = [...pagamentos]
    .filter(p => p.estado === 'Pago')
    .sort((a, b) => dataOrdenavel(a.data).localeCompare(dataOrdenavel(b.data)) || a.id - b.id);
    
  const alocacoesPorPagamento = {};

  pagamentosOrdenados.forEach(pag => {
    let restante = Number(pag.valor) || 0;
    const alocacoes = [];
    for (const item of estadoItens) {
      if (restante <= 0.0001) break;
      const valorItem = Number(item.valor) || 0;
      const saldoItem = +(valorItem - item.valorPago).toFixed(2);
      if (saldoItem <= 0.0001) continue;
      const aplicar = Math.min(restante, saldoItem);
      item.valorPago = +(item.valorPago + aplicar).toFixed(2);
      restante = +(restante - aplicar).toFixed(2);
      alocacoes.push({ itemId: item.id, descricao: item.descricao, valor: +aplicar.toFixed(2) });
    }
    alocacoesPorPagamento[pag.id] = { alocacoes, sobra: +restante.toFixed(2) };
  });

  const itensComEstado = estadoItens.map(item => {
    const valor = Number(item.valor) || 0;
    const valorPago = +item.valorPago.toFixed(2);
    const saldo = +(valor - valorPago).toFixed(2);
    let estado = 'Pendente';
    if (saldo <= 0.0001) estado = 'Pago';
    else if (valorPago > 0) estado = 'Parcial';
    return { ...item, valorPago, saldo, estado };
  });

  const valorTotal = +itensComEstado.reduce((s, i) => s + (Number(i.valor) || 0), 0).toFixed(2);
  const totalPago = +itensComEstado.reduce((s, i) => s + i.valorPago, 0).toFixed(2);
  const saldoTotal = +(valorTotal - totalPago).toFixed(2);

  const pagamentosComAlocacao = pagamentos.map(p => ({
    ...p,
    alocacoes: alocacoesPorPagamento[p.id]?.alocacoes || [],
    sobra: alocacoesPorPagamento[p.id]?.sobra ?? (p.estado === 'Pago' ? Number(p.valor) || 0 : 0)
  }));

  return { itens: itensComEstado, pagamentos: pagamentosComAlocacao, valorTotal, totalPago, saldoTotal };
}

function saldoContaCorrenteAluno(tenant, alunoId) {
  const itens = (tenant.itensConta || []).filter(i => i.alunoId === alunoId);
  const pagamentos = (tenant.pagamentos || []).filter(p => p.alunoId === alunoId);
  const resultado = calcularContaCorrente(itens, pagamentos);
  return resultado.saldoTotal;
}

async function atualizarEstadosContaCorrente(req, alunoId) {
  if (!alunoId) return;
  const itensResult = await query('SELECT * FROM itens_conta WHERE aluno_id=@alunoId AND escola_id=@escolaId', { alunoId, escolaId: req.escolaId });
  const pagamentosResult = await query('SELECT * FROM pagamentos WHERE aluno_id=@alunoId AND escola_id=@escolaId', { alunoId, escolaId: req.escolaId });
  const itens = itensResult.recordset.map(dbRowToJs);
  const pagamentos = pagamentosResult.recordset.map(dbRowToJs);
  const { itens: itensComEstado } = calcularContaCorrente(itens, pagamentos);
  for (const item of itensComEstado) {
    await query('UPDATE itens_conta SET estado=@estado WHERE id=@id AND escola_id=@escolaId', {
      estado: item.estado, id: item.id, escolaId: req.escolaId
    });
  }
  if (req.tenant && Array.isArray(req.tenant.itensConta)) {
    req.tenant.itensConta = req.tenant.itensConta.map(it => {
      const atualizado = itensComEstado.find(x => x.id === it.id);
      return atualizado ? { ...it, estado: atualizado.estado } : it;
    });
  }
}

app.get('/api/contaCorrente/:alunoId', async (req, res) => {
  try {
    const alunoId = Number(req.params.alunoId);
    if (!alunoId) return badRequest(res, 'ID do aluno inválido');

    let aluno = null;
    const { tenant } = currentTenant(req);
    if (tenant.alunos && tenant.alunos.length) {
      aluno = tenant.alunos.find(a => a.id === alunoId);
    }
    if (!aluno) {
      const alunoRes = await query('SELECT * FROM alunos WHERE id = @alunoId AND escola_id = @escolaId', { alunoId, escolaId: req.escolaId });
      if (alunoRes.recordset[0]) {
        aluno = nestAlunoExtras(dbRowToJs(alunoRes.recordset[0]));
      }
    }
    if (!aluno) return notFound(res, 'Aluno não encontrado');

    const [itensRes, pagamentosRes, contratosRes] = await Promise.all([
      query('SELECT * FROM itens_conta WHERE aluno_id = @alunoId AND escola_id = @escolaId ORDER BY ordem, id', { alunoId, escolaId: req.escolaId }),
      query('SELECT * FROM pagamentos WHERE aluno_id = @alunoId AND escola_id = @escolaId ORDER BY data, id', { alunoId, escolaId: req.escolaId }),
      query('SELECT * FROM contratos WHERE aluno_id = @alunoId AND escola_id = @escolaId ORDER BY id DESC', { alunoId, escolaId: req.escolaId })
    ]);

    const itens = (itensRes.recordset || []).map(dbRowToJs);
    const pagamentos = (pagamentosRes.recordset || []).map(p => {
      const jsP = dbRowToJs(p);
      if (jsP.faturacaoNumero) {
        jsP.faturacao = {
          tipo: jsP.faturacaoTipo,
          serie: jsP.faturacaoSerie,
          numero: jsP.faturacaoNumero
        };
      }
      return jsP;
    });

    const contratos = (contratosRes.recordset || []).map(c => {
      const jsC = dbRowToJs(c);
      jsC.assinatura = jsC.assinaturaNomeDigitado ? {
        nomeDigitado: jsC.assinaturaNomeDigitado,
        dataHora: jsC.assinaturaDataHora,
        imagemBase64: jsC.assinaturaImagem ? `data:image/png;base64,${jsC.assinaturaImagem}` : null
      } : null;
      jsC.assinaturaTutor = jsC.assinaturaTutorNomeDigitado ? {
        nomeDigitado: jsC.assinaturaTutorNomeDigitado,
        imagemBase64: jsC.assinaturaTutorImagem ? `data:image/png;base64,${jsC.assinaturaTutorImagem}` : null
      } : null;
      if (jsC.pdfAssinadoFilename) {
        jsC.pdfAssinado = {
          filename: jsC.pdfAssinadoFilename,
          uploadedAt: jsC.pdfAssinadoUploadedAt,
          size: jsC.pdfAssinadoTamanhoBytes
        };
      }
      return jsC;
    });

    const resultado = calcularContaCorrente(itens, pagamentos);
    ok(res, { aluno, contratos, ...resultado });
  } catch (ex) {
    console.error('Erro ao obter conta corrente:', ex);
    res.status(500).json({ success: false, error: `Falha ao obter conta corrente: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   19. Relatórios
   ------------------------------------------------------------
   Todas as contagens de aulas por tipo/estado nesta secção usam os
   helpers isTipo / isEstadoConcluida definidos na secção 2. */

app.get('/api/relatorios/aluno/:id', async (req, res) => {
  const { tenant } = currentTenant(req);
  const alunoId = Number(req.params.id);
  let aluno = (tenant.alunos || []).find(a => a.id === alunoId);
  if (!aluno) {
    const alunoRes = await query('SELECT * FROM alunos WHERE id = @alunoId AND escola_id = @escolaId', { alunoId, escolaId: req.escolaId });
    if (alunoRes.recordset[0]) {
      aluno = nestAlunoExtras(dbRowToJs(alunoRes.recordset[0]));
    }
  }
  if (!aluno) return notFound(res);

  const praticas = tenant.aulas
    .filter(a => a.alunoId === alunoId && isTipo(a, 'Prática'))
    .map(a => ({
      data: a.data, hora: a.hora, horaFim: a.horaFim || null, duracaoMin: a.duracao || 50, estado: a.estado,
      km: a.km ?? null, modulo: a.modulo || '',
      instrutorNome: (tenant.instrutores.find(i => i.id === a.instrutorId) || {}).nome || '—',
      veiculoMatricula: (tenant.veiculos.find(v => v.id === a.veiculoId) || {}).matricula || '—',
      notas: a.notas || ''
    }))
    .sort((x, y) => (x.data + x.hora).localeCompare(y.data + y.hora));

  const teoricasIndividuais = tenant.aulas
    .filter(a => a.alunoId === alunoId && isTipo(a, 'Teórica'))
    .map(a => ({
      data: a.data, hora: a.hora, duracaoMin: a.duracao || 50, estado: a.estado,
      instrutorNome: (tenant.instrutores.find(i => i.id === a.instrutorId) || {}).nome || '—',
      notas: a.notas || ''
    }));

  const turmas = tenant.turmasTeoricas
    .filter(t => (t.inscritos || []).includes(alunoId))
    .map(t => ({
      data: t.data, horaInicio: t.horaInicio, horaFim: t.horaFim,
      duracaoMin: minutosEntre(t.horaInicio, t.horaFim),
      tema: t.tema, estado: t.estado,
      instrutorNome: (tenant.instrutores.find(i => i.id === t.instrutorId) || {}).nome || '—',
      sala: t.sala || '—',
      presente: isEstadoConcluida(t.estado) ? !!(t.presencas || {})[alunoId] : null
    }))
    .sort((x, y) => (x.data + x.horaInicio).localeCompare(y.data + y.horaInicio));

  const minutosPraticaFeitos = praticas.filter(p => isEstadoConcluida(p.estado)).reduce((s, p) => s + p.duracaoMin, 0);
  const minutosTeoricaIndividualFeitos = teoricasIndividuais.filter(p => isEstadoConcluida(p.estado)).reduce((s, p) => s + p.duracaoMin, 0);
  const minutosTeoricaTurmaFeitos = turmas.filter(t => t.presente === true).reduce((s, t) => s + t.duracaoMin, 0);
  const kmTotalPercorridos = praticas.filter(p => isEstadoConcluida(p.estado)).reduce((s, p) => s + (Number(p.km) || 0), 0);

  const requisito = tenant.requisitos.find(r => r.categoria === aluno.categoria) || {};

  const alertasDocumentais = [];
  const estadoAtestado = estadoValidade(aluno.atestadoMedico?.dataValidade);
  if (estadoAtestado === 'expirado') alertasDocumentais.push('Atestado médico expirado.');
  else if (estadoAtestado === 'a_expirar') alertasDocumentais.push('Atestado médico a expirar em breve.');
  if (aluno.examePsicotecnico?.aplicavel) {
    const estadoPsico = estadoValidade(aluno.examePsicotecnico?.dataValidade);
    if (estadoPsico === 'expirado') alertasDocumentais.push('Exame psicotécnico expirado.');
    else if (estadoPsico === 'a_expirar') alertasDocumentais.push('Exame psicotécnico a expirar em breve.');
  }
  const estadoProcesso = estadoValidade(aluno.processoIMT?.dataValidade);
  if (estadoProcesso === 'expirado') alertasDocumentais.push('Licença de aprendizagem / processo IMT expirado.');
  else if (estadoProcesso === 'a_expirar') alertasDocumentais.push('Licença de aprendizagem a expirar em breve.');

  ok(res, {
    aluno,
    requisito,
    alertasDocumentais,
    resumo: {
      horasPraticasRealizadas: +(minutosPraticaFeitos / 60).toFixed(2),
      horasTeoricasRealizadas: +((minutosTeoricaIndividualFeitos + minutosTeoricaTurmaFeitos) / 60).toFixed(2),
      totalSessoesPraticas: praticas.filter(p => isEstadoConcluida(p.estado)).length,
      totalSessoesTeoricas: teoricasIndividuais.filter(p => isEstadoConcluida(p.estado)).length + turmas.filter(t => t.presente === true).length,
      faltasTeoricas: turmas.filter(t => t.presente === false).length,
      kmTotalPercorridos,
      kmMin: requisito.kmPraticaMin ?? null
    },
    praticas,
    teoricasIndividuais,
    turmasTeoricas: turmas
  });
});

app.get('/api/relatorios/geral', async (req, res) => {
  try {
    const e = req.escolaId;
    const result = await query(`
      WITH AulasPraticas AS (
        SELECT aluno_id,
               SUM(ISNULL(duracao, 50)) AS minutosPratica,
               SUM(ISNULL(km, 0)) AS kmTotal
        FROM aulas
        WHERE escola_id = @e
          AND (LOWER(tipo) LIKE '%prat%')
          AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
        GROUP BY aluno_id
      ),
      AulasTeoricasIndividuais AS (
        SELECT aluno_id,
               SUM(ISNULL(duracao, 50)) AS minutosTeoricaInd
        FROM aulas
        WHERE escola_id = @e
          AND (LOWER(tipo) LIKE '%teor%')
          AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
        GROUP BY aluno_id
      ),
      TurmasPresencas AS (
        SELECT ti.aluno_id,
               SUM(CASE WHEN ti.presente = 1 THEN DATEDIFF(minute, TRY_CONVERT(time, t.hora_inicio), TRY_CONVERT(time, t.hora_fim)) ELSE 0 END) AS minutosTeoricaTurma,
               SUM(CASE WHEN ti.presente = 0 AND t.estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído') THEN 1 ELSE 0 END) AS faltasTeoricas
        FROM turma_inscritos ti
        JOIN turmas_teoricas t ON t.id = ti.turma_id
        WHERE t.escola_id = @e
        GROUP BY ti.aluno_id
      )
      SELECT TOP (300)
        a.id AS alunoId,
        a.nome,
        a.categoria,
        a.estado,
        ROUND(ISNULL(ap.minutosPratica, 0) / 60.0, 2) AS horasPraticasRealizadas,
        ROUND((ISNULL(ati.minutosTeoricaInd, 0) + ISNULL(tp.minutosTeoricaTurma, 0)) / 60.0, 2) AS horasTeoricasRealizadas,
        r.horas_praticas_min AS horasPraticasMin,
        r.horas_teoricas_min AS horasTeoricasMin,
        ISNULL(ap.kmTotal, 0) AS kmTotalPercorridos,
        r.km_pratica_min AS kmMin,
        ISNULL(tp.faltasTeoricas, 0) AS faltasTeoricas
      FROM alunos a
      LEFT JOIN AulasPraticas ap ON ap.aluno_id = a.id
      LEFT JOIN AulasTeoricasIndividuais ati ON ati.aluno_id = a.id
      LEFT JOIN TurmasPresencas tp ON tp.aluno_id = a.id
      LEFT JOIN requisitos r ON r.escola_id = @e AND r.categoria = a.categoria
      WHERE a.escola_id = @e AND (a.estado = 'Ativo' OR a.estado IS NULL)
      ORDER BY a.nome
    `, { e });

    ok(res, result.recordset || []);
  } catch (err) {
    const { tenant } = currentTenant(req);
    const linhas = (tenant.alunos || []).slice(0, 100).map(aluno => {
      const minutosPratica = (tenant.aulas || [])
        .filter(a => a.alunoId === aluno.id && isTipo(a, 'Prática') && isEstadoConcluida(a.estado))
        .reduce((s, a) => s + (a.duracao || 50), 0);
      const minutosTeoricaIndividual = (tenant.aulas || [])
        .filter(a => a.alunoId === aluno.id && isTipo(a, 'Teórica') && isEstadoConcluida(a.estado))
        .reduce((s, a) => s + (a.duracao || 50), 0);
      const minutosTeoricaTurma = (tenant.turmasTeoricas || [])
        .filter(t => (t.inscritos || []).includes(aluno.id) && !!(t.presencas || {})[aluno.id])
        .reduce((s, t) => s + minutosEntre(t.horaInicio, t.horaFim), 0);
      const faltasTeoricas = (tenant.turmasTeoricas || [])
        .filter(t => (t.inscritos || []).includes(aluno.id) && isEstadoConcluida(t.estado) && (t.presencas || {})[aluno.id] === false)
        .length;
      const kmTotalPercorridos = (tenant.aulas || [])
        .filter(a => a.alunoId === aluno.id && isTipo(a, 'Prática') && isEstadoConcluida(a.estado))
        .reduce((s, a) => s + (Number(a.km) || 0), 0);
      const requisito = (tenant.requisitos || []).find(r => r.categoria === aluno.categoria) || {};
      return {
        alunoId: aluno.id,
        nome: aluno.nome,
        categoria: aluno.categoria,
        estado: aluno.estado,
        horasPraticasRealizadas: +(minutosPratica / 60).toFixed(2),
        horasTeoricasRealizadas: +((minutosTeoricaIndividual + minutosTeoricaTurma) / 60).toFixed(2),
        horasPraticasMin: requisito.horasPraticasMin ?? null,
        horasTeoricasMin: requisito.horasTeoricasMin ?? null,
        kmTotalPercorridos,
        kmMin: requisito.kmPraticaMin ?? null,
        faltasTeoricas
      };
    });
    ok(res, linhas);
  }
});

app.get('/api/relatorios/espera-teorica-pratica', async (req, res) => {
  try {
    const result = await query(`
      WITH TeoricoAprovado AS (
        SELECT aluno_id, MIN(data) AS dataExameAprovado
        FROM exames_marcacoes
        WHERE escola_id = @e AND tipo = 'Teórico' AND resultado = 'Aprovado'
        GROUP BY aluno_id
      ),
      PrimeiraPratica AS (
        SELECT aluno_id, MIN(data) AS dataAula1
        FROM aulas
        WHERE escola_id = @e AND LOWER(tipo) LIKE '%prat%'
          AND estado NOT IN ('Cancelada','Cancelado','Anulada','Anulado')
        GROUP BY aluno_id
      )
      SELECT
        a.id AS alunoId,
        a.nome,
        a.espaco_id AS espacoId,
        ISNULL(e.nome, '—') AS espacoNome,
        t.dataExameAprovado,
        p.dataAula1,
        DATEDIFF(day, t.dataExameAprovado, p.dataAula1) AS diasEspera
      FROM TeoricoAprovado t
      JOIN PrimeiraPratica p ON p.aluno_id = t.aluno_id
      JOIN alunos a ON a.id = t.aluno_id
      LEFT JOIN espacos e ON e.id = a.espaco_id
      WHERE a.escola_id = @e AND p.dataAula1 >= t.dataExameAprovado
      ORDER BY diasEspera DESC
    `, { e: req.escolaId });

    const linhas = (result.recordset || []).map(r => ({
      alunoId: r.alunoId,
      nome: r.nome,
      espacoId: r.espacoId,
      espacoNome: r.espacoNome,
      dataExameAprovado: r.dataExameAprovado ? (r.dataExameAprovado instanceof Date ? r.dataExameAprovado.toISOString().slice(0, 10) : String(r.dataExameAprovado).slice(0, 10)) : '',
      dataAula1: r.dataAula1 ? (r.dataAula1 instanceof Date ? r.dataAula1.toISOString().slice(0, 10) : String(r.dataAula1).slice(0, 10)) : '',
      diasEspera: r.diasEspera
    }));
    ok(res, linhas);
  } catch (ex) {
    res.status(500).json({ success: false, error: `Falha ao carregar relatório de espera: ${ex.message || ex}` });
  }
});

app.get('/api/relatorios/inscricoes-espaco', async (req, res) => {
  try {
    const [espacosRes, alunosRes] = await Promise.all([
      query(`SELECT id, nome FROM espacos WHERE escola_id = @e ORDER BY id`, { e: req.escolaId }),
      query(`
        SELECT espaco_id AS espacoId, FORMAT(data_inscricao, 'yyyy-MM') AS mes, FORMAT(data_inscricao, 'yyyy') AS ano, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e AND data_inscricao IS NOT NULL
        GROUP BY espaco_id, FORMAT(data_inscricao, 'yyyy-MM'), FORMAT(data_inscricao, 'yyyy')
      `, { e: req.escolaId })
    ]);

    const espacos = espacosRes.recordset || [];
    const agrupados = alunosRes.recordset || [];

    const porEspaco = espacos.map(espaco => {
      const doEspaco = agrupados.filter(r => r.espacoId === espaco.id);
      const totalAlunos = doEspaco.reduce((s, r) => s + r.total, 0);
      const mesesMap = new Map();
      const anosMap = new Map();
      doEspaco.forEach(r => {
        mesesMap.set(r.mes, (mesesMap.get(r.mes) || 0) + r.total);
        anosMap.set(r.ano, (anosMap.get(r.ano) || 0) + r.total);
      });
      return {
        espacoId: espaco.id,
        espacoNome: espaco.nome,
        totalAlunos,
        porMes: [...mesesMap.entries()].map(([mes, total]) => ({ mes, total })).sort((a, b) => a.mes.localeCompare(b.mes)),
        porAno: [...anosMap.entries()].map(([ano, total]) => ({ ano, total })).sort((a, b) => a.ano.localeCompare(b.ano))
      };
    });

    ok(res, { porEspaco });
  } catch (ex) {
    res.status(500).json({ success: false, error: `Falha ao carregar inscrições por espaço: ${ex.message || ex}` });
  }
});

app.get('/api/relatorios/fluxo-caixa', async (req, res) => {
  try {
    const [espacosRes, pagamentosRes] = await Promise.all([
      query(`SELECT id, nome FROM espacos WHERE escola_id = @e ORDER BY id`, { e: req.escolaId }),
      query(`
        SELECT
          ISNULL(a.espaco_id, 0) AS espacoId,
          FORMAT(p.data, 'yyyy-MM') AS mes,
          FORMAT(p.data, 'yyyy') AS ano,
          ISNULL(SUM(p.valor), 0) AS total
        FROM pagamentos p
        LEFT JOIN alunos a ON a.id = p.aluno_id
        WHERE p.escola_id = @e AND p.estado = 'Pago' AND p.data IS NOT NULL
        GROUP BY a.espaco_id, FORMAT(p.data, 'yyyy-MM'), FORMAT(p.data, 'yyyy')
      `, { e: req.escolaId })
    ]);

    const espacos = espacosRes.recordset || [];
    const rows = pagamentosRes.recordset || [];

    const mesesGlobais = new Map();
    const anosGlobais = new Map();
    let totalGlobal = 0;

    rows.forEach(r => {
      totalGlobal = +(totalGlobal + Number(r.total)).toFixed(2);
      mesesGlobais.set(r.mes, +((mesesGlobais.get(r.mes) || 0) + Number(r.total)).toFixed(2));
      anosGlobais.set(r.ano, +((anosGlobais.get(r.ano) || 0) + Number(r.total)).toFixed(2));
    });

    const global = {
      porMes: [...mesesGlobais.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => a.chave.localeCompare(b.chave)),
      porAno: [...anosGlobais.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => a.chave.localeCompare(b.chave)),
      total: totalGlobal
    };

    const porEspaco = espacos.map(espaco => {
      const rowsEspaco = rows.filter(r => r.espacoId === espaco.id);
      const mesesEspaco = new Map();
      const anosEspaco = new Map();
      let totalEspaco = 0;
      rowsEspaco.forEach(r => {
        totalEspaco = +(totalEspaco + Number(r.total)).toFixed(2);
        mesesEspaco.set(r.mes, +((mesesEspaco.get(r.mes) || 0) + Number(r.total)).toFixed(2));
        anosEspaco.set(r.ano, +((anosEspaco.get(r.ano) || 0) + Number(r.total)).toFixed(2));
      });
      return {
        espacoId: espaco.id,
        espacoNome: espaco.nome,
        porMes: [...mesesEspaco.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => a.chave.localeCompare(b.chave)),
        porAno: [...anosEspaco.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => a.chave.localeCompare(b.chave)),
        total: totalEspaco
      };
    });

    ok(res, { global, porEspaco });
  } catch (err) {
    console.error('Erro ao gerar relatório de fluxo de caixa:', err);
    res.status(500).json({ success: false, error: 'Erro ao gerar relatório de fluxo de caixa.' });
  }
});

app.get('/api/relatorios/folha-caixa-diaria', async (req, res) => {
  try {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    const result = await query(`
      SELECT
        p.id, p.aluno_id, p.valor, p.data, p.descricao, p.estado,
        COALESCE(p.modo_pagamento, 'PGNUM') AS modo_pagamento,
        p.faturacao_tipo, p.faturacao_serie, p.faturacao_numero,
        a.nome AS aluno_nome, a.numero_aluno, a.espaco_id,
        COALESCE(e.nome, 'Sem espaço atribuído') AS espaco_nome
      FROM pagamentos p
      INNER JOIN alunos a ON a.id = p.aluno_id
      LEFT JOIN espacos e ON e.id = a.espaco_id
      WHERE p.escola_id = @e
        AND p.data = @data
        AND p.estado = 'Pago'
      ORDER BY espaco_nome, a.nome
    `, { e: req.escolaId, data });

    const rows = result.recordset || [];
    const espacosMap = new Map();

    const todosEspacosRes = await query('SELECT id, nome, serie FROM espacos WHERE escola_id = @e ORDER BY nome', { e: req.escolaId });
    for (const esp of (todosEspacosRes.recordset || [])) {
      espacosMap.set(esp.nome, {
        id: esp.id,
        nome: esp.nome,
        serie: esp.serie || null,
        espacoId: esp.id,
        espacoNome: esp.nome,
        pgnum: 0,
        pgtr: 0,
        total: 0,
        totalNumerario: 0,
        totalCartaoTransferencia: 0,
        totalGeral: 0,
        pagamentos: []
      });
    }

    for (const r of rows) {
      const espacoNome = r.espaco_nome;
      if (!espacosMap.has(espacoNome)) {
        espacosMap.set(espacoNome, {
          id: r.espaco_id || null,
          nome: espacoNome,
          serie: null,
          espacoId: r.espaco_id || null,
          espacoNome,
          pgnum: 0,
          pgtr: 0,
          total: 0,
          totalNumerario: 0,
          totalCartaoTransferencia: 0,
          totalGeral: 0,
          pagamentos: []
        });
      }
      const item = espacosMap.get(espacoNome);
      const val = Number(r.valor) || 0;
      const modo = String(r.modo_pagamento || 'PGNUM').toUpperCase();
      if (modo === 'PGTR') {
        item.pgtr = +(item.pgtr + val).toFixed(2);
        item.totalCartaoTransferencia = +(item.totalCartaoTransferencia + val).toFixed(2);
      } else {
        item.pgnum = +(item.pgnum + val).toFixed(2);
        item.totalNumerario = +(item.totalNumerario + val).toFixed(2);
      }
      item.total = +(item.total + val).toFixed(2);
      item.totalGeral = +(item.totalGeral + val).toFixed(2);
      item.pagamentos.push({
        id: r.id,
        alunoId: r.aluno_id,
        alunoNome: r.aluno_nome,
        numeroAluno: r.numero_aluno,
        descricao: r.descricao,
        valor: val,
        modoPagamento: modo,
        faturacao: r.faturacao_numero ? { tipo: r.faturacao_tipo, serie: r.faturacao_serie, numero: r.faturacao_numero } : null
      });
    }

    const espacos = Array.from(espacosMap.values());
    const totalGeralNumerario = +espacos.reduce((s, e) => s + e.pgnum, 0).toFixed(2);
    const totalGeralCartaoTransferencia = +espacos.reduce((s, e) => s + e.pgtr, 0).toFixed(2);
    const totalGeralDia = +(totalGeralNumerario + totalGeralCartaoTransferencia).toFixed(2);
    const totalQuantidade = espacos.reduce((s, e) => s + e.pagamentos.length, 0);

    const totais = {
      pgnum: totalGeralNumerario,
      pgtr: totalGeralCartaoTransferencia,
      geral: totalGeralDia,
      quantidade: totalQuantidade
    };

    ok(res, {
      data,
      escolaNome: req.escola?.nome || 'Escola de Condução',
      espacos,
      totais,
      totalGeralNumerario,
      totalGeralCartaoTransferencia,
      totalGeralDia
    });
  } catch (ex) {
    console.error('Erro ao gerar folha de caixa diária:', ex);
    res.status(500).json({ success: false, error: `Falha ao gerar folha de caixa diária: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   20. Estatísticas agregadas (/api/estatisticas) — Calculadas via SQL
   ------------------------------------------------------------ */

function mesesDoAnoCivil(ano) {
  if (!ano) return [];
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
}

function mesAnoAnterior(chaveMes) {
  const [ano, mes] = chaveMes.split('-');
  return `${Number(ano) - 1}-${mes}`;
}

function medianaDe(numeros) {
  if (!numeros || !numeros.length) return null;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0
    ? ordenados[meio]
    : +(((ordenados[meio - 1] + ordenados[meio]) / 2).toFixed(1));
}

app.get('/api/estatisticas', async (req, res) => {
  try {
    const e = req.escolaId;
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtualNum = hoje.getMonth() + 1;
    const mesAtual = mesAtualNum;
    const mesAtualStr = `${anoAtual}-${String(mesAtualNum).padStart(2, '0')}`;

    const anoQuery = req.query.ano ? Number(req.query.ano) : null;
    const modo = anoQuery ? 'anoCivil' : 'rolante12';
    const isAnoEmCurso = (modo === 'anoCivil' && anoQuery === anoAtual);
    const meses = modo === 'anoCivil' ? mesesDoAnoCivil(anoQuery) : ultimosNMeses(12);

    const inicioMes = meses[0] + '-01';
    const fimMes = `${meses[meses.length - 1]}-31`;

    const mesesAnoAnterior = meses.map(mesAnoAnterior);
    const inicioHomologo = mesesAnoAnterior[0] + '-01';
    const fimHomologo = `${mesesAnoAnterior[mesesAnoAnterior.length - 1]}-31`;

    const tresMesesAtrasStr = meses[Math.max(0, meses.length - 3)] + '-01';

    const safeQ = async (sqlText, params, label = '') => {
      try {
        return await query(sqlText, params);
      } catch (err) {
        console.error(`[Estatísticas SQL erro: ${label}]`, err.message);
        return { recordset: [] };
      }
    };

    // Executar queries SQL paralelas no SQL Server com tolerância a falhas
    const [
      receitaMensalRes,
      receitaHomologaRes,
      inscricoesMensaisRes,
      inscricoesHomologaRes,
      aulasIndividuaisRes,
      aulasHomologasRes,
      turmasTeoricasRes,
      turmasHomologasRes,
      examesMensaisRes,
      examesHomologosRes,
      receitaPendenteRes,
      taxasExamesRes,
      alunosEstadoRes,
      alunosCategoriaRes,
      cargaInstrutorRes,
      usoVeiculosRes,
      receitaCategoriaRes,
      agingRes,
      funilRes,
      tentativasRes,
      desempenhoInstrutoresRes,
      esperaRes,
      anosDisponiveisRes,
      alunosTotaisRes,
      tempoMedioPraticaRes,
      todosEspacosRes,
      espacoAlunosRes,
      espacoReceitaMensalRes,
      espacoReceitaTotaisRes,
      espacoAulasRes,
      espacoExamesRes
    ] = await Promise.all([
      // 1. Receita mensal atual
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes, ISNULL(SUM(valor), 0) AS total
        FROM pagamentos
        WHERE escola_id = @e AND estado = 'Pago' AND data >= @inicioMes AND data <= @fimMes
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM')
      `, { e, inicioMes, fimMes }, 'receitaMensal'),

      // 2. Receita período homólogo
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes, ISNULL(SUM(valor), 0) AS total
        FROM pagamentos
        WHERE escola_id = @e AND estado = 'Pago' AND data >= @inicioHomologo AND data <= @fimHomologo
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM')
      `, { e, inicioHomologo, fimHomologo }, 'receitaHomologa'),

      // 3. Inscrições mensais atuais
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data_inscricao), 'yyyy-MM') AS mes, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e AND data_inscricao >= @inicioMes AND data_inscricao <= @fimMes
        GROUP BY FORMAT(TRY_CONVERT(date, data_inscricao), 'yyyy-MM')
      `, { e, inicioMes, fimMes }, 'inscricoesMensais'),

      // 4. Inscrições período homólogo
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data_inscricao), 'yyyy-MM') AS mes, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e AND data_inscricao >= @inicioHomologo AND data_inscricao <= @fimHomologo
        GROUP BY FORMAT(TRY_CONVERT(date, data_inscricao), 'yyyy-MM')
      `, { e, inicioHomologo, fimHomologo }, 'inscricoesHomologa'),

      // 5. Aulas individuais atuais (Prática / Teórica)
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes,
               CASE WHEN LOWER(tipo) LIKE '%prat%' THEN 'Prática' ELSE 'Teórica' END AS tipo,
               COUNT(*) AS total
        FROM aulas
        WHERE escola_id = @e
          AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
          AND data >= @inicioMes AND data <= @fimMes
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM'), CASE WHEN LOWER(tipo) LIKE '%prat%' THEN 'Prática' ELSE 'Teórica' END
      `, { e, inicioMes, fimMes }, 'aulasIndividuais'),

      // 6. Aulas individuais período homólogo
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes,
               CASE WHEN LOWER(tipo) LIKE '%prat%' THEN 'Prática' ELSE 'Teórica' END AS tipo,
               COUNT(*) AS total
        FROM aulas
        WHERE escola_id = @e
          AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
          AND data >= @inicioHomologo AND data <= @fimHomologo
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM'), CASE WHEN LOWER(tipo) LIKE '%prat%' THEN 'Prática' ELSE 'Teórica' END
      `, { e, inicioHomologo, fimHomologo }, 'aulasHomologas'),

      // 7. Turmas teóricas atuais
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, t.data), 'yyyy-MM') AS mes, COUNT(ti.aluno_id) AS total
        FROM turmas_teoricas t
        JOIN turma_inscritos ti ON ti.turma_id = t.id AND ti.presente = 1
        WHERE t.escola_id = @e
          AND t.estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
          AND t.data >= @inicioMes AND t.data <= @fimMes
        GROUP BY FORMAT(TRY_CONVERT(date, t.data), 'yyyy-MM')
      `, { e, inicioMes, fimMes }, 'turmasTeoricas'),

      // 8. Turmas teóricas período homólogo
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, t.data), 'yyyy-MM') AS mes, COUNT(ti.aluno_id) AS total
        FROM turmas_teoricas t
        JOIN turma_inscritos ti ON ti.turma_id = t.id AND ti.presente = 1
        WHERE t.escola_id = @e
          AND t.estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
          AND t.data >= @inicioHomologo AND t.data <= @fimHomologo
        GROUP BY FORMAT(TRY_CONVERT(date, t.data), 'yyyy-MM')
      `, { e, inicioHomologo, fimHomologo }, 'turmasHomologas'),

      // 9. Exames mensais atuais
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes, resultado, COUNT(*) AS total
        FROM exames_marcacoes
        WHERE escola_id = @e AND resultado IN ('Aprovado', 'Reprovado')
          AND data >= @inicioMes AND data <= @fimMes
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM'), resultado
      `, { e, inicioMes, fimMes }, 'examesMensais'),

      // 10. Exames período homólogo
      safeQ(`
        SELECT FORMAT(TRY_CONVERT(date, data), 'yyyy-MM') AS mes, resultado, COUNT(*) AS total
        FROM exames_marcacoes
        WHERE escola_id = @e AND resultado IN ('Aprovado', 'Reprovado')
          AND data >= @inicioHomologo AND data <= @fimHomologo
        GROUP BY FORMAT(TRY_CONVERT(date, data), 'yyyy-MM'), resultado
      `, { e, inicioHomologo, fimHomologo }, 'examesHomologos'),

      // 11. Receita pendente total
      safeQ(`
        SELECT ISNULL(SUM(valor), 0) AS total
        FROM pagamentos
        WHERE escola_id = @e AND estado = 'Pendente'
      `, { e }, 'receitaPendente'),

      // 12. Taxas gerais de exame
      safeQ(`
        SELECT tipo, resultado, COUNT(*) AS total
        FROM exames_marcacoes
        WHERE escola_id = @e AND resultado IN ('Aprovado', 'Reprovado')
        GROUP BY tipo, resultado
      `, { e }, 'taxasExames'),

      // 13. Alunos por estado
      safeQ(`
        SELECT ISNULL(estado, 'Ativo') AS estado, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e
        GROUP BY estado
      `, { e }, 'alunosEstado'),

      // 14. Alunos por categoria
      safeQ(`
        SELECT ISNULL(categoria, 'Sem categoria') AS categoria, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e
        GROUP BY categoria
        ORDER BY total DESC
      `, { e }, 'alunosCategoria'),

      // 15. Carga por instrutor (3 meses)
      safeQ(`
        SELECT i.id AS instrutorId, i.nome, COUNT(a.id) AS total
        FROM instrutores i
        JOIN (
          SELECT id, instrutor_id FROM aulas WHERE escola_id = @e AND data >= @tresMesesAtrasStr
          UNION ALL
          SELECT id, instrutor_id FROM turmas_teoricas WHERE escola_id = @e AND data >= @tresMesesAtrasStr
        ) a ON a.instrutor_id = i.id
        WHERE i.escola_id = @e
        GROUP BY i.id, i.nome
        ORDER BY total DESC
      `, { e, tresMesesAtrasStr }, 'cargaInstrutor'),

      // 16. Utilização de veículos (3 meses)
      safeQ(`
        SELECT v.id AS veiculoId, v.matricula, COUNT(a.id) AS total
        FROM veiculos v
        JOIN aulas a ON a.veiculo_id = v.id
        WHERE v.escola_id = @e
          AND (LOWER(a.tipo) LIKE '%prat%')
          AND a.data >= @tresMesesAtrasStr
        GROUP BY v.id, v.matricula
        ORDER BY total DESC
      `, { e, tresMesesAtrasStr }, 'usoVeiculos'),

      // 17. Receita por categoria
      safeQ(`
        SELECT ISNULL(a.categoria, 'Sem categoria') AS categoria, ISNULL(SUM(p.valor), 0) AS total
        FROM pagamentos p
        LEFT JOIN alunos a ON a.id = p.aluno_id
        WHERE p.escola_id = @e AND p.estado = 'Pago'
        GROUP BY a.categoria
        ORDER BY total DESC
      `, { e }, 'receitaCategoria'),

      // 18. Aging de pagamentos pendentes
      safeQ(`
        SELECT
          ISNULL(SUM(CASE WHEN DATEDIFF(day, TRY_CONVERT(date, data), GETDATE()) <= 30 THEN valor ELSE 0 END), 0) AS f0_30,
          ISNULL(SUM(CASE WHEN DATEDIFF(day, TRY_CONVERT(date, data), GETDATE()) BETWEEN 31 AND 60 THEN valor ELSE 0 END), 0) AS f31_60,
          ISNULL(SUM(CASE WHEN DATEDIFF(day, TRY_CONVERT(date, data), GETDATE()) BETWEEN 61 AND 90 THEN valor ELSE 0 END), 0) AS f61_90,
          ISNULL(SUM(CASE WHEN DATEDIFF(day, TRY_CONVERT(date, data), GETDATE()) > 90 THEN valor ELSE 0 END), 0) AS f90_plus
        FROM pagamentos
        WHERE escola_id = @e AND estado = 'Pendente' AND data IS NOT NULL
      `, { e }, 'aging'),

      // 19. Funil de conversão
      safeQ(`
        SELECT
          (SELECT COUNT(*) FROM alunos WHERE escola_id = @e) AS totalInscritos,
          (SELECT COUNT(DISTINCT aluno_id) FROM exames_marcacoes WHERE escola_id = @e AND tipo = 'Teórico' AND resultado = 'Aprovado') AS aprovadosTeorico,
          (SELECT COUNT(DISTINCT aluno_id) FROM exames_marcacoes WHERE escola_id = @e AND tipo = 'Prático' AND resultado = 'Aprovado') AS aprovadosPratico,
          (SELECT COUNT(*) FROM alunos WHERE escola_id = @e AND estado = 'Concluído') AS concluidos
      `, { e }, 'funil'),

      // 20. Exames para cálculo de tentativas médias
      safeQ(`
        SELECT aluno_id, tipo, data, resultado
        FROM exames_marcacoes
        WHERE escola_id = @e AND aluno_id IS NOT NULL AND resultado IN ('Aprovado', 'Reprovado')
        ORDER BY aluno_id, tipo, data
      `, { e }, 'tentativas'),

      // 21. Desempenho de instrutores
      safeQ(`
        WITH AlunoInstrutorPrincipal AS (
          SELECT aluno_id, instrutor_id,
            ROW_NUMBER() OVER (PARTITION BY aluno_id ORDER BY COUNT(*) DESC) as rn
          FROM aulas
          WHERE escola_id = @e AND LOWER(tipo) LIKE '%prat%' AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído') AND instrutor_id IS NOT NULL
          GROUP BY aluno_id, instrutor_id
        )
        SELECT
          i.id AS instrutorId,
          i.nome,
          COUNT(m.id) AS totalExames,
          SUM(CASE WHEN m.resultado = 'Aprovado' THEN 1 ELSE 0 END) AS aprovados
        FROM exames_marcacoes m
        JOIN AlunoInstrutorPrincipal aip ON aip.aluno_id = m.aluno_id AND aip.rn = 1
        JOIN instrutores i ON i.id = aip.instrutor_id
        WHERE m.escola_id = @e AND m.tipo = 'Prático' AND m.resultado IN ('Aprovado', 'Reprovado')
        GROUP BY i.id, i.nome
        HAVING COUNT(m.id) >= 3
        ORDER BY (CAST(SUM(CASE WHEN m.resultado = 'Aprovado' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(m.id), 0)) DESC
      `, { e }, 'desempenhoInstrutores'),

      // 22. Tempo de espera teórico -> prático por aluno
      safeQ(`
        WITH TeoricoAprovado AS (
          SELECT aluno_id, MIN(TRY_CONVERT(date, data)) AS dataExameAprovado
          FROM exames_marcacoes
          WHERE escola_id = @e AND tipo = 'Teórico' AND resultado = 'Aprovado'
            AND TRY_CONVERT(date, data) IS NOT NULL
          GROUP BY aluno_id
        ),
        PrimeiraPratica AS (
          SELECT aluno_id, MIN(TRY_CONVERT(date, data)) AS dataAula1
          FROM aulas
          WHERE escola_id = @e AND LOWER(tipo) LIKE '%prat%'
            AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
            AND TRY_CONVERT(date, data) IS NOT NULL
          GROUP BY aluno_id
        )
        SELECT
          t.aluno_id AS alunoId,
          t.dataExameAprovado,
          p.dataAula1,
          FORMAT(p.dataAula1, 'yyyy-MM') AS mesAula1,
          DATEDIFF(day, t.dataExameAprovado, p.dataAula1) AS diasEspera
        FROM TeoricoAprovado t
        JOIN PrimeiraPratica p ON p.aluno_id = t.aluno_id
        WHERE p.dataAula1 >= t.dataExameAprovado
      `, { e }, 'espera'),

      // 23. Anos disponíveis
      safeQ(`
        SELECT DISTINCT ano FROM (
          SELECT YEAR(TRY_CONVERT(date, data)) AS ano FROM pagamentos WHERE escola_id = @e AND data IS NOT NULL
          UNION
          SELECT YEAR(TRY_CONVERT(date, data_inscricao)) AS ano FROM alunos WHERE escola_id = @e AND data_inscricao IS NOT NULL
          UNION
          SELECT YEAR(TRY_CONVERT(date, data)) AS ano FROM aulas WHERE escola_id = @e AND data IS NOT NULL
          UNION
          SELECT YEAR(TRY_CONVERT(date, data)) AS ano FROM exames_marcacoes WHERE escola_id = @e AND data IS NOT NULL
        ) t WHERE ano >= 1990 AND ano <= 2100 ORDER BY ano
      `, { e }, 'anosDisponiveis'),

      // 24. Alunos totais por estado
      safeQ(`
        SELECT
          (SELECT COUNT(*) FROM alunos WHERE escola_id = @e AND (estado = 'Ativo' OR estado IS NULL)) AS totalAlunosAtivos,
          (SELECT COUNT(*) FROM alunos WHERE escola_id = @e AND estado = 'Concluído') AS alunosConcluidos,
          (SELECT COUNT(*) FROM alunos WHERE escola_id = @e AND estado = 'Suspenso') AS alunosSuspensos
      `, { e }, 'alunosTotais'),

      // 25. Tempo médio até aprovação prática
      safeQ(`
        SELECT AVG(CAST(dias AS FLOAT)) AS mediaDias
        FROM (
          SELECT DATEDIFF(day, TRY_CONVERT(date, a.data_inscricao), MIN(TRY_CONVERT(date, m.data))) AS dias
          FROM exames_marcacoes m
          JOIN alunos a ON a.id = m.aluno_id
          WHERE m.escola_id = @e AND m.tipo = 'Prático' AND m.resultado = 'Aprovado'
            AND TRY_CONVERT(date, a.data_inscricao) IS NOT NULL
            AND TRY_CONVERT(date, m.data) IS NOT NULL
            AND TRY_CONVERT(date, m.data) >= TRY_CONVERT(date, a.data_inscricao)
          GROUP BY a.id, a.data_inscricao
        ) sub
      `, { e }, 'tempoMedioPratica'),

      // 26. Espaços da escola
      safeQ('SELECT id, nome, serie FROM espacos WHERE escola_id = @e ORDER BY nome', { e }, 'todosEspacos'),

      // 27. Alunos e inscrições por espaço
      safeQ(`
        SELECT
          e.id AS espaco_id, e.nome AS espaco_nome, e.serie,
          COUNT(DISTINCT a.id) AS total_alunos,
          SUM(CASE WHEN a.estado = 'Ativo' OR a.estado IS NULL THEN 1 ELSE 0 END) AS alunos_ativos,
          SUM(CASE WHEN a.estado = 'Concluído' THEN 1 ELSE 0 END) AS alunos_concluidos,
          SUM(CASE WHEN a.data_inscricao >= @inicioMes AND a.data_inscricao <= @fimMes THEN 1 ELSE 0 END) AS inscricoes_periodo,
          SUM(CASE WHEN a.data_inscricao >= @inicioHomologo AND a.data_inscricao <= @fimHomologo THEN 1 ELSE 0 END) AS inscricoes_homologo
        FROM espacos e
        LEFT JOIN alunos a ON a.espaco_id = e.id AND a.escola_id = @e
        WHERE e.escola_id = @e
        GROUP BY e.id, e.nome, e.serie
      `, { e, inicioMes, fimMes, inicioHomologo, fimHomologo }, 'espacoAlunos'),

      // 28. Receita mensal por espaço
      safeQ(`
        SELECT a.espaco_id, FORMAT(TRY_CONVERT(date, p.data), 'yyyy-MM') AS mes, ISNULL(SUM(p.valor), 0) AS total
        FROM pagamentos p
        JOIN alunos a ON a.id = p.aluno_id AND a.escola_id = @e
        WHERE p.escola_id = @e AND p.estado = 'Pago' AND p.data >= @inicioMes AND p.data <= @fimMes AND a.espaco_id IS NOT NULL
        GROUP BY a.espaco_id, FORMAT(TRY_CONVERT(date, p.data), 'yyyy-MM')
      `, { e, inicioMes, fimMes }, 'espacoReceitaMensal'),

      // 29. Receita total e pendente por espaço
      safeQ(`
        SELECT a.espaco_id,
          SUM(CASE WHEN p.estado = 'Pago' AND p.data >= @inicioMes AND p.data <= @fimMes THEN p.valor ELSE 0 END) AS receita_periodo,
          SUM(CASE WHEN p.estado = 'Pago' AND p.data >= @inicioHomologo AND p.data <= @fimHomologo THEN p.valor ELSE 0 END) AS receita_homologa,
          SUM(CASE WHEN p.estado = 'Pendente' THEN p.valor ELSE 0 END) AS receita_pendente
        FROM pagamentos p
        JOIN alunos a ON a.id = p.aluno_id AND a.escola_id = @e
        WHERE p.escola_id = @e AND a.espaco_id IS NOT NULL
        GROUP BY a.espaco_id
      `, { e, inicioMes, fimMes, inicioHomologo, fimHomologo }, 'espacoReceitaTotais'),

      // 30. Aulas por espaço
      safeQ(`
        SELECT espaco_id,
          SUM(CASE WHEN LOWER(tipo) LIKE '%prat%' THEN 1 ELSE 0 END) AS aulas_praticas,
          SUM(CASE WHEN LOWER(tipo) NOT LIKE '%prat%' THEN 1 ELSE 0 END) AS aulas_teoricas,
          COUNT(*) AS total_aulas
        FROM aulas
        WHERE escola_id = @e AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído')
          AND data >= @inicioMes AND data <= @fimMes AND espaco_id IS NOT NULL
        GROUP BY espaco_id
      `, { e, inicioMes, fimMes }, 'espacoAulas'),

      // 31. Exames por espaço
      safeQ(`
        SELECT a.espaco_id,
          COUNT(*) AS total_exames,
          SUM(CASE WHEN m.resultado = 'Aprovado' THEN 1 ELSE 0 END) AS aprovados,
          SUM(CASE WHEN m.resultado = 'Reprovado' THEN 1 ELSE 0 END) AS reprovados,
          SUM(CASE WHEN m.tipo = 'Teórico' THEN 1 ELSE 0 END) AS exames_teoricos,
          SUM(CASE WHEN m.tipo = 'Teórico' AND m.resultado = 'Aprovado' THEN 1 ELSE 0 END) AS aprovados_teoricos,
          SUM(CASE WHEN m.tipo = 'Prático' THEN 1 ELSE 0 END) AS exames_praticos,
          SUM(CASE WHEN m.tipo = 'Prático' AND m.resultado = 'Aprovado' THEN 1 ELSE 0 END) AS aprovados_praticos
        FROM exames_marcacoes m
        JOIN alunos a ON a.id = m.aluno_id AND a.escola_id = @e
        WHERE m.escola_id = @e AND m.resultado IN ('Aprovado', 'Reprovado')
          AND m.data >= @inicioMes AND m.data <= @fimMes AND a.espaco_id IS NOT NULL
        GROUP BY a.espaco_id
      `, { e, inicioMes, fimMes }, 'espacoExames')
    ]);

    // Mapeamentos para garantir que todos os meses do período estão representados
    const recMap = new Map((receitaMensalRes.recordset || []).map(r => [r.mes, +Number(r.total).toFixed(2)]));
    const receitaMensal = meses.map(m => ({ mes: m, total: recMap.get(m) || 0 }));

    const recHomologaMap = new Map((receitaHomologaRes.recordset || []).map(r => [r.mes, +Number(r.total).toFixed(2)]));
    const receitaAnterior = mesesAnoAnterior.map(m => ({ mes: m, total: recHomologaMap.get(m) || 0 }));

    const inscMap = new Map((inscricoesMensaisRes.recordset || []).map(r => [r.mes, Number(r.total)]));
    const inscricoesMensais = meses.map(m => ({ mes: m, total: inscMap.get(m) || 0 }));

    const inscHomologaMap = new Map((inscricoesHomologaRes.recordset || []).map(r => [r.mes, Number(r.total)]));
    const inscricoesAnterior = mesesAnoAnterior.map(m => ({ mes: m, total: inscHomologaMap.get(m) || 0 }));

    const aulasPratMap = new Map();
    const aulasTeorMap = new Map();
    (aulasIndividuaisRes.recordset || []).forEach(r => {
      if (r.tipo === 'Prática') aulasPratMap.set(r.mes, (aulasPratMap.get(r.mes) || 0) + Number(r.total));
      else aulasTeorMap.set(r.mes, (aulasTeorMap.get(r.mes) || 0) + Number(r.total));
    });
    (turmasTeoricasRes.recordset || []).forEach(r => {
      aulasTeorMap.set(r.mes, (aulasTeorMap.get(r.mes) || 0) + Number(r.total));
    });
    const aulasMensais = meses.map(m => ({
      mes: m,
      praticas: aulasPratMap.get(m) || 0,
      teoricas: aulasTeorMap.get(m) || 0
    }));

    const aulasPratHomologaMap = new Map();
    const aulasTeorHomologaMap = new Map();
    (aulasHomologasRes.recordset || []).forEach(r => {
      if (r.tipo === 'Prática') aulasPratHomologaMap.set(r.mes, (aulasPratHomologaMap.get(r.mes) || 0) + Number(r.total));
      else aulasTeorHomologaMap.set(r.mes, (aulasTeorHomologaMap.get(r.mes) || 0) + Number(r.total));
    });
    (turmasHomologasRes.recordset || []).forEach(r => {
      aulasTeorHomologaMap.set(r.mes, (aulasTeorHomologaMap.get(r.mes) || 0) + Number(r.total));
    });
    const aulasAnterior = mesesAnoAnterior.map(m => ({
      mes: m,
      praticas: aulasPratHomologaMap.get(m) || 0,
      teoricas: aulasTeorHomologaMap.get(m) || 0
    }));

    const examesAprovMap = new Map();
    const examesReprovMap = new Map();
    (examesMensaisRes.recordset || []).forEach(r => {
      if (r.resultado === 'Aprovado') examesAprovMap.set(r.mes, Number(r.total));
      else if (r.resultado === 'Reprovado') examesReprovMap.set(r.mes, Number(r.total));
    });
    const examesMensais = meses.map(m => ({
      mes: m,
      aprovados: examesAprovMap.get(m) || 0,
      reprovados: examesReprovMap.get(m) || 0
    }));

    const exHomAprovMap = new Map();
    const exHomReprovMap = new Map();
    (examesHomologosRes.recordset || []).forEach(r => {
      if (r.resultado === 'Aprovado') exHomAprovMap.set(r.mes, Number(r.total));
      else if (r.resultado === 'Reprovado') exHomReprovMap.set(r.mes, Number(r.total));
    });
    const examesAnterior = mesesAnoAnterior.map(m => ({
      mes: m,
      aprovados: exHomAprovMap.get(m) || 0,
      reprovados: exHomReprovMap.get(m) || 0
    }));

    // Taxas de aprovação gerais
    let totalAprovGeral = 0, totalExamesGeral = 0;
    let totalAprovTeorico = 0, totalExamesTeorico = 0;
    let totalAprovPratico = 0, totalExamesPratico = 0;
    (taxasExamesRes.recordset || []).forEach(r => {
      const tot = Number(r.total);
      const isAprov = r.resultado === 'Aprovado';
      totalExamesGeral += tot;
      if (isAprov) totalAprovGeral += tot;

      if (r.tipo === 'Teórico') {
        totalExamesTeorico += tot;
        if (isAprov) totalAprovTeorico += tot;
      } else if (r.tipo === 'Prático') {
        totalExamesPratico += tot;
        if (isAprov) totalAprovPratico += tot;
      }
    });
    const taxaAprovacaoGeral = totalExamesGeral ? +((totalAprovGeral / totalExamesGeral) * 100).toFixed(1) : null;
    const taxaAprovacaoTeorico = totalExamesTeorico ? +((totalAprovTeorico / totalExamesTeorico) * 100).toFixed(1) : null;
    const taxaAprovacaoPratico = totalExamesPratico ? +((totalAprovPratico / totalExamesPratico) * 100).toFixed(1) : null;

    // Totais do período homólogo
    const somaTotal = arr => +arr.reduce((s, m) => s + m.total, 0).toFixed(2);
    const somaAulas = arr => arr.reduce((s, m) => s + m.praticas + m.teoricas, 0);
    const somaAprovados = arr => arr.reduce((s, m) => s + m.aprovados, 0);
    const somaExamesTotal = arr => arr.reduce((s, m) => s + m.aprovados + m.reprovados, 0);
    const variacaoPct = (atual, anterior) => (anterior ? +(((atual - anterior) / anterior) * 100).toFixed(1) : null);

    // Quando o ano está a decorrer, a comparação homóloga justa (YTD) considera apenas os meses decorridos até à data atual
    const indicesDecorridos = isAnoEmCurso
      ? meses.map((m, idx) => m <= mesAtualStr ? idx : -1).filter(idx => idx !== -1)
      : meses.map((_, idx) => idx);

    const receitaMesesDecorridos = indicesDecorridos.map(i => receitaMensal[i]);
    const receitaHomologaDecorridos = indicesDecorridos.map(i => receitaAnterior[i]);

    const inscricoesMesesDecorridos = indicesDecorridos.map(i => inscricoesMensais[i]);
    const inscricoesHomologaDecorridos = indicesDecorridos.map(i => inscricoesAnterior[i]);

    const aulasMesesDecorridos = indicesDecorridos.map(i => aulasMensais[i]);
    const aulasHomologaDecorridos = indicesDecorridos.map(i => aulasAnterior[i]);

    const examesMesesDecorridos = indicesDecorridos.map(i => examesMensais[i]);
    const examesHomologaDecorridos = indicesDecorridos.map(i => examesAnterior[i]);

    const totalReceitaAtual = somaTotal(receitaMesesDecorridos);
    const totalReceitaAnterior = somaTotal(receitaHomologaDecorridos);
    const totalReceitaAnteriorAnoCompleto = somaTotal(receitaAnterior);

    const totalInscricoesAtual = somaTotal(inscricoesMesesDecorridos);
    const totalInscricoesAnterior = somaTotal(inscricoesHomologaDecorridos);
    const totalInscricoesAnteriorAnoCompleto = somaTotal(inscricoesAnterior);

    const totalAulasAtual = somaAulas(aulasMesesDecorridos);
    const totalAulasAnterior = somaAulas(aulasHomologaDecorridos);
    const totalAulasAnteriorAnoCompleto = somaAulas(aulasAnterior);

    const aprovadosAtual = somaAprovados(examesMesesDecorridos);
    const aprovadosAnterior = somaAprovados(examesHomologaDecorridos);
    const totalExamesAtual = somaExamesTotal(examesMesesDecorridos);
    const totalExamesAnterior = somaExamesTotal(examesHomologaDecorridos);
    const taxaAprovAtual = totalExamesAtual ? +((aprovadosAtual / totalExamesAtual) * 100).toFixed(1) : null;
    const taxaAprovAnterior = totalExamesAnterior ? +((aprovadosAnterior / totalExamesAnterior) * 100).toFixed(1) : null;

    const comparacaoHomologa = {
      isAnoEmCurso,
      mesAtual: mesAtualStr,
      mesesDecorridos: indicesDecorridos.length,
      porMes: meses.map((m, i) => ({
        mes: m,
        mesAnoAnterior: mesesAnoAnterior[i],
        decorrido: !isAnoEmCurso || m <= mesAtualStr,
        receitaAtual: receitaMensal[i].total,
        receitaAnterior: receitaAnterior[i].total,
        inscricoesAtual: inscricoesMensais[i].total,
        inscricoesAnterior: inscricoesAnterior[i].total,
        aulasAtual: aulasMensais[i].praticas + aulasMensais[i].teoricas,
        aulasAnterior: aulasAnterior[i].praticas + aulasAnterior[i].teoricas
      })),
      totais: {
        isAnoEmCurso,
        mesAtual: mesAtualStr,
        mesesDecorridos: indicesDecorridos.length,
        receita: {
          atual: totalReceitaAtual,
          anterior: totalReceitaAnterior,
          anteriorAnoCompleto: totalReceitaAnteriorAnoCompleto,
          variacaoPct: variacaoPct(totalReceitaAtual, totalReceitaAnterior)
        },
        inscricoes: {
          atual: totalInscricoesAtual,
          anterior: totalInscricoesAnterior,
          anteriorAnoCompleto: totalInscricoesAnteriorAnoCompleto,
          variacaoPct: variacaoPct(totalInscricoesAtual, totalInscricoesAnterior)
        },
        aulasConcluidas: {
          atual: totalAulasAtual,
          anterior: totalAulasAnterior,
          anteriorAnoCompleto: totalAulasAnteriorAnoCompleto,
          variacaoPct: variacaoPct(totalAulasAtual, totalAulasAnterior)
        },
        taxaAprovacao: {
          atual: taxaAprovAtual,
          anterior: taxaAprovAnterior,
          variacaoPP: (taxaAprovAtual != null && taxaAprovAnterior != null) ? +(taxaAprovAtual - taxaAprovAnterior).toFixed(1) : null
        }
      }
    };

    // Montagem da comparação detalhada entre espaços
    const todosEspacos = todosEspacosRes.recordset || [];
    const espAlunosMap = new Map((espacoAlunosRes.recordset || []).map(r => [r.espaco_id, r]));
    const espRecTotaisMap = new Map((espacoReceitaTotaisRes.recordset || []).map(r => [r.espaco_id, r]));
    const espAulasMap = new Map((espacoAulasRes.recordset || []).map(r => [r.espaco_id, r]));
    const espExamesMap = new Map((espacoExamesRes.recordset || []).map(r => [r.espaco_id, r]));

    const espRecMensalMap = new Map();
    (espacoReceitaMensalRes.recordset || []).forEach(r => {
      const k = `${r.espaco_id}|${r.mes}`;
      espRecMensalMap.set(k, +Number(r.total).toFixed(2));
    });

    const espacosFinais = todosEspacos.map(esp => {
      const al = espAlunosMap.get(esp.id) || {};
      const rec = espRecTotaisMap.get(esp.id) || {};
      const aul = espAulasMap.get(esp.id) || {};
      const exm = espExamesMap.get(esp.id) || {};

      const totalAlunos = Number(al.total_alunos || 0);
      const alunosAtivos = Number(al.alunos_ativos || 0);
      const alunosConcluidos = Number(al.alunos_concluidos || 0);
      const inscricoesPeriodo = Number(al.inscricoes_periodo || 0);
      const inscricoesHomologo = Number(al.inscricoes_homologo || 0);

      const receitaPeriodo = +Number(rec.receita_periodo || 0).toFixed(2);
      const receitaHomologa = +Number(rec.receita_homologa || 0).toFixed(2);
      const receitaPendente = +Number(rec.receita_pendente || 0).toFixed(2);
      const receitaMediaPorAluno = alunosAtivos ? +(receitaPeriodo / alunosAtivos).toFixed(2) : null;

      const aulasPraticas = Number(aul.aulas_praticas || 0);
      const aulasTeoricas = Number(aul.aulas_teoricas || 0);
      const totalAulas = Number(aul.total_aulas || 0);

      const totalExames = Number(exm.total_exames || 0);
      const aprovados = Number(exm.aprovados || 0);
      const reprovados = Number(exm.reprovados || 0);
      const taxaAprovacaoGeral = totalExames ? +((aprovados / totalExames) * 100).toFixed(1) : null;
      const examesTeoricos = Number(exm.exames_teoricos || 0);
      const aprovadosTeoricos = Number(exm.aprovados_teoricos || 0);
      const taxaAprovacaoTeorico = examesTeoricos ? +((aprovadosTeoricos / examesTeoricos) * 100).toFixed(1) : null;
      const examesPraticos = Number(exm.exames_praticos || 0);
      const aprovadosPraticos = Number(exm.aprovados_praticos || 0);
      const taxaAprovacaoPratico = examesPraticos ? +((aprovadosPraticos / examesPraticos) * 100).toFixed(1) : null;

      const receitaMensalEspaco = meses.map(m => espRecMensalMap.get(`${esp.id}|${m}`) || 0);

      return {
        id: esp.id,
        nome: esp.nome,
        serie: esp.serie || 'Padrão',
        totalAlunos,
        alunosAtivos,
        alunosConcluidos,
        inscricoesPeriodo,
        inscricoesHomologo,
        variacaoInscricoesPct: variacaoPct(inscricoesPeriodo, inscricoesHomologo),
        receitaPeriodo,
        receitaHomologa,
        variacaoReceitaPct: variacaoPct(receitaPeriodo, receitaHomologa),
        receitaPendente,
        receitaMediaPorAluno,
        aulasPraticas,
        aulasTeoricas,
        totalAulas,
        totalExames,
        aprovados,
        reprovados,
        taxaAprovacaoGeral,
        taxaAprovacaoTeorico,
        taxaAprovacaoPratico,
        receitaMensal: receitaMensalEspaco
      };
    });

    const nomesMesesPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const nomeMesAtual = nomesMesesPt[mesAtualNum - 1] || '';
    const comparacaoEspacos = {
      ativo: espacosFinais.length >= 2,
      periodoRotulo: isAnoEmCurso ? `Ano em Curso (Jan a ${nomeMesAtual} ${anoQuery || anoAtual})` : (modo === 'anoCivil' ? `Ano ${anoQuery}` : 'Últimos 12 Meses'),
      isAnoEmCurso,
      mesAtualStr,
      mesesLabels: meses,
      espacos: espacosFinais
    };

    // Anos disponíveis e comparativo anual
    const anosDisponiveis = (anosDisponiveisRes.recordset || [])
      .map(r => Number(r.ano))
      .filter(a => Number.isInteger(a) && a >= 1990 && a <= 2100)
      .sort((a, b) => a - b);
    const currYear = new Date().getFullYear();
    if (!anosDisponiveis.includes(currYear)) anosDisponiveis.push(currYear);
    const anosComparacao = Math.max(2, Math.min(20, Number(req.query.anosComparacao) || 5));
    const anosParaComparar = anosDisponiveis.slice(-anosComparacao);
    const validYears = anosParaComparar.filter(a => Number.isInteger(a) && a >= 1990 && a <= 2100);
    const anosListStr = validYears.length ? validYears.join(',') : String(currYear);

    const [recAnualRes, inscAnualRes, aulasAnualRes, examesAnualRes] = await Promise.all([
      safeQ(`
        SELECT YEAR(TRY_CONVERT(date, data)) AS ano, ISNULL(SUM(valor), 0) AS total
        FROM pagamentos
        WHERE escola_id = @e AND estado = 'Pago' AND YEAR(TRY_CONVERT(date, data)) IN (${anosListStr})
        GROUP BY YEAR(TRY_CONVERT(date, data))
      `, { e }, 'recAnual'),
      safeQ(`
        SELECT YEAR(TRY_CONVERT(date, data_inscricao)) AS ano, COUNT(*) AS total
        FROM alunos
        WHERE escola_id = @e AND YEAR(TRY_CONVERT(date, data_inscricao)) IN (${anosListStr})
        GROUP BY YEAR(TRY_CONVERT(date, data_inscricao))
      `, { e }, 'inscAnual'),
      safeQ(`
        SELECT YEAR(TRY_CONVERT(date, data)) AS ano, COUNT(*) AS total
        FROM (
          SELECT data FROM aulas WHERE escola_id = @e AND estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído') AND YEAR(TRY_CONVERT(date, data)) IN (${anosListStr})
          UNION ALL
          SELECT t.data FROM turmas_teoricas t
          JOIN turma_inscritos ti ON ti.turma_id = t.id AND ti.presente = 1
          WHERE t.escola_id = @e AND t.estado IN ('Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído') AND YEAR(TRY_CONVERT(date, t.data)) IN (${anosListStr})
        ) sub
        GROUP BY YEAR(TRY_CONVERT(date, data))
      `, { e }, 'aulasAnual'),
      safeQ(`
        SELECT YEAR(TRY_CONVERT(date, data)) AS ano,
               SUM(CASE WHEN resultado = 'Aprovado' THEN 1 ELSE 0 END) AS aprovados,
               SUM(CASE WHEN resultado = 'Reprovado' THEN 1 ELSE 0 END) AS reprovados
        FROM exames_marcacoes
        WHERE escola_id = @e AND resultado IN ('Aprovado', 'Reprovado') AND YEAR(TRY_CONVERT(date, data)) IN (${anosListStr})
        GROUP BY YEAR(TRY_CONVERT(date, data))
      `, { e }, 'examesAnual')
    ]);

    const recAnualMap = new Map((recAnualRes.recordset || []).map(r => [Number(r.ano), +Number(r.total).toFixed(2)]));
    const inscAnualMap = new Map((inscAnualRes.recordset || []).map(r => [Number(r.ano), Number(r.total)]));
    const aulasAnualMap = new Map((aulasAnualRes.recordset || []).map(r => [Number(r.ano), Number(r.total)]));
    const examesAnualMap = new Map((examesAnualRes.recordset || []).map(r => [Number(r.ano), { aprovados: Number(r.aprovados), reprovados: Number(r.reprovados) }]));

    const baseComparativo = anosParaComparar.map(ano => {
      const receita = recAnualMap.get(ano) || 0;
      const inscricoes = inscAnualMap.get(ano) || 0;
      const aulasConcluidas = aulasAnualMap.get(ano) || 0;
      const ex = examesAnualMap.get(ano) || { aprovados: 0, reprovados: 0 };
      const totEx = ex.aprovados + ex.reprovados;
      const taxaAprovacao = totEx ? +((ex.aprovados / totEx) * 100).toFixed(1) : null;
      return { ano, receita, inscricoes, aulasConcluidas, examesAprovados: ex.aprovados, examesReprovados: ex.reprovados, taxaAprovacao };
    });

    const comparativoAnual = baseComparativo.map((item, i) => {
      const anterior = baseComparativo[i - 1];
      return {
        ...item,
        variacaoReceitaPct: anterior && anterior.receita ? +(((item.receita - anterior.receita) / anterior.receita) * 100).toFixed(1) : null,
        variacaoInscricoesPct: anterior && anterior.inscricoes ? +(((item.inscricoes - anterior.inscricoes) / anterior.inscricoes) * 100).toFixed(1) : null
      };
    });

    // Funil de conversão
    const fRow = funilRes.recordset[0] || {};
    const totalInscritos = Number(fRow.totalInscritos || 0);
    const etapas = [
      { etapa: 'Inscritos', total: totalInscritos },
      { etapa: 'Aprovados no teórico', total: Number(fRow.aprovadosTeorico || 0) },
      { etapa: 'Aprovados no prático', total: Number(fRow.aprovadosPratico || 0) },
      { etapa: 'Curso concluído', total: Number(fRow.concluidos || 0) }
    ];
    const funilConversao = etapas.map((et, i) => ({
      ...et,
      taxaConversaoDesdeInicio: totalInscritos ? +((et.total / totalInscritos) * 100).toFixed(1) : null,
      taxaConversaoEtapaAnterior: i > 0 && etapas[i - 1].total ? +((et.total / etapas[i - 1].total) * 100).toFixed(1) : null
    }));

    // Aging de pagamentos
    const agRow = agingRes.recordset[0] || {};
    const agingPagamentosPendentes = [
      { label: '0-30 dias', total: +Number(agRow.f0_30 || 0).toFixed(2) },
      { label: '31-60 dias', total: +Number(agRow.f31_60 || 0).toFixed(2) },
      { label: '61-90 dias', total: +Number(agRow.f61_90 || 0).toFixed(2) },
      { label: '90+ dias', total: +Number(agRow.f90_plus || 0).toFixed(2) }
    ];

    // Desempenho de instrutores
    const desempenhoInstrutores = (desempenhoInstrutoresRes.recordset || []).map(r => ({
      instrutorId: r.instrutorId,
      nome: r.nome,
      totalExames: Number(r.totalExames),
      aprovados: Number(r.aprovados),
      taxaAprovacao: Number(r.totalExames) ? +((Number(r.aprovados) / Number(r.totalExames)) * 100).toFixed(1) : null
    }));

    // Tempo de espera mensal
    const porMesEspera = new Map();
    (esperaRes.recordset || []).forEach(r => {
      if (!porMesEspera.has(r.mesAula1)) porMesEspera.set(r.mesAula1, []);
      porMesEspera.get(r.mesAula1).push(Number(r.diasEspera));
    });
    const tempoEsperaMensal = meses.map(m => {
      const valores = porMesEspera.get(m) || [];
      return { mes: m, medianaDias: medianaDe(valores), amostras: valores.length };
    });

    // Tentativas médias de exame
    const tentativas = { 'Teórico': [], 'Prático': [] };
    const porAlunoTipo = new Map();
    (tentativasRes.recordset || []).forEach(m => {
      const chave = `${m.aluno_id}|${m.tipo}`;
      if (!porAlunoTipo.has(chave)) porAlunoTipo.set(chave, []);
      porAlunoTipo.get(chave).push(m);
    });
    porAlunoTipo.forEach((lista, chave) => {
      const tipo = chave.split('|')[1];
      const idx = lista.findIndex(x => x.resultado === 'Aprovado');
      if (idx !== -1 && tentativas[tipo]) {
        tentativas[tipo].push(idx + 1);
      }
    });
    const mediaOuNull = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
    const tentativasMediasExame = {
      teorico: mediaOuNull(tentativas['Teórico']),
      pratico: mediaOuNull(tentativas['Prático'])
    };

    // KPIs principais e adicionais
    const totRow = alunosTotaisRes.recordset[0] || {};
    const totalAlunosAtivos = Number(totRow.totalAlunosAtivos || 0);
    const alunosConcluidos = Number(totRow.alunosConcluidos || 0);
    const alunosSuspensos = Number(totRow.alunosSuspensos || 0);
    const totalProcessosTerminados = alunosConcluidos + alunosSuspensos;

    const receitaUltimos12Meses = +receitaMensal.reduce((s, m) => s + m.total, 0).toFixed(2);
    const receitaMesAtual = receitaMensal[receitaMensal.length - 1]?.total || 0;
    const receitaPendenteTotal = +Number(receitaPendenteRes.recordset[0]?.total || 0).toFixed(2);

    const kpis = {
      totalAlunosAtivos,
      receitaUltimos12Meses,
      receitaMesAtual,
      receitaPendenteTotal,
      taxaAprovacaoGeral,
      taxaAprovacaoTeorico,
      taxaAprovacaoPratico,
      comparacaoHomologa,
      funilConversao,
      tentativasMediasExame,
      receitaPorCategoria: (receitaCategoriaRes.recordset || []).map(r => ({ categoria: r.categoria, total: +Number(r.total).toFixed(2) })),
      desempenhoInstrutores,
      agingPagamentosPendentes,
      aulasConcluidasUltimos12Meses: aulasMensais.reduce((s, m) => s + m.praticas + m.teoricas, 0),
      tempoEsperaMensal,
      inscricoesUltimos12Meses: inscricoesMensais.reduce((s, m) => s + m.total, 0)
    };

    const mediaDiasPratica = tempoMedioPraticaRes.recordset[0]?.mediaDias;
    const kpisAdicionais = {
      taxaConclusaoCurso: totalProcessosTerminados ? +((alunosConcluidos / totalProcessosTerminados) * 100).toFixed(1) : null,
      taxaDesistencia: totalProcessosTerminados ? +((alunosSuspensos / totalProcessosTerminados) * 100).toFixed(1) : null,
      receitaMediaPorAlunoAtivo: totalAlunosAtivos ? +(receitaUltimos12Meses / totalAlunosAtivos).toFixed(2) : null,
      tempoMedioDiasAteAprovacaoPratica: mediaDiasPratica != null ? Math.round(Number(mediaDiasPratica)) : null
    };

    ok(res, {
      modo,
      anoSelecionado: modo === 'anoCivil' ? anoQuery : null,
      anosDisponiveis,
      isAnoEmCurso,
      mesAtual: mesAtualStr,
      mesAtualStr: mesAtualStr,
      mesesDecorridos: indicesDecorridos.length,
      comparacaoEspacos,
      kpis,
      kpisAdicionais,
      comparacaoHomologa,
      funilConversao,
      tentativasMediasExame,
      desempenhoInstrutores,
      agingPagamentosPendentes,
      receitaPorCategoria: kpis.receitaPorCategoria,
      receitaMensal,
      inscricoesMensais,
      aulasMensais,
      examesMensais,
      alunosPorEstado: (alunosEstadoRes.recordset || []).map(r => ({ estado: r.estado, total: Number(r.total) })),
      alunosPorCategoria: (alunosCategoriaRes.recordset || []).map(r => ({ categoria: r.categoria, total: Number(r.total) })),
      cargaPorInstrutor: (cargaInstrutorRes.recordset || []).slice(0, 10).map(r => ({ instrutorId: r.instrutorId, nome: r.nome, total: Number(r.total) })),
      utilizacaoVeiculos: (usoVeiculosRes.recordset || []).slice(0, 10).map(r => ({ veiculoId: r.veiculoId, matricula: r.matricula, total: Number(r.total) })),
      comparativoAnual
    });
  } catch (ex) {
    console.error('[ERRO /api/estatisticas]:', ex);
    res.status(500).json({ success: false, error: `Falha ao carregar estatísticas: ${ex.message || ex}` });
  }
});

/* ------------------------------------------------------------
   21. Dashboard summary
   ------------------------------------------------------------ */

app.get('/api/dashboard', async (req, res) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const { tenant } = currentTenant(req);
    const [resumo] = (await query(`
      SELECT
        (SELECT COUNT(*) FROM alunos WHERE escola_id=@e) AS totalAlunos,
        (SELECT COUNT(*) FROM alunos WHERE escola_id=@e AND estado='Ativo') AS alunosAtivos,
        (SELECT COUNT(*) FROM aulas WHERE escola_id=@e AND data=@hoje) +
        (SELECT COUNT(*) FROM turmas_teoricas WHERE escola_id=@e AND data=@hoje) AS aulasHoje,
        (SELECT COUNT(*) FROM instrutores WHERE escola_id=@e AND estado='Ativo') AS instrutoresAtivos,
        (SELECT COUNT(*) FROM veiculos WHERE escola_id=@e AND estado='Disponível') AS veiculosDisponiveis,
        (SELECT COUNT(*) FROM veiculos WHERE escola_id=@e) AS totalVeiculos,
        (SELECT COUNT(*) FROM instrutores WHERE escola_id=@e) AS totalInstrutores,
        (SELECT ISNULL(SUM(valor),0) FROM pagamentos WHERE escola_id=@e AND estado='Pago') AS receitaMes,
        (SELECT ISNULL(SUM(valor),0) FROM pagamentos WHERE escola_id=@e AND estado='Pendente') AS pagamentosPendentes
    `, { e: req.escolaId, hoje })).recordset;

    const {
      totalAlunos, alunosAtivos, aulasHoje, instrutoresAtivos,
      veiculosDisponiveis, totalVeiculos, totalInstrutores,
      receitaMes, pagamentosPendentes
    } = resumo || {};

    const proximasRes = await query(`
      SELECT TOP 6
        au.id, au.data, au.hora, au.hora_fim AS horaFim, au.tipo, au.modulo, au.estado, au.notas,
        au.aluno_id AS alunoId, au.instrutor_id AS instrutorId, au.veiculo_id AS veiculoId,
        a.nome AS alunoNome,
        i.nome AS instrutorNome,
        v.matricula AS veiculoMatricula
      FROM aulas au
      LEFT JOIN alunos a ON a.id = au.aluno_id
      LEFT JOIN instrutores i ON i.id = au.instrutor_id
      LEFT JOIN veiculos v ON v.id = au.veiculo_id
      WHERE au.escola_id = @e AND au.estado = 'Agendada' AND au.data >= @hoje
      ORDER BY au.data, au.hora
    `, { e: req.escolaId, hoje });

    const proximasAulas = (proximasRes.recordset || []).map(r => ({
      ...dbRowToJs(r),
      alunoNome: r.alunoNome || '—',
      instrutorNome: r.instrutorNome || '—',
      veiculoMatricula: r.veiculoMatricula || '—'
    }));

  const alertas = [];

  // Alunos com documentos expirados ou a expirar (diretamente do SQL para suportar 500k alunos sem loop em memória)
  try {
    const alunosAlertasRes = await query(`
      SELECT TOP (30) id, nome, atestado_data_validade, psicotecnico_aplicavel, psicotecnico_data_validade, imt_data_validade
      FROM alunos
      WHERE escola_id = @e AND (estado = 'Ativo' OR estado IS NULL)
        AND (
          (atestado_data_validade IS NOT NULL AND atestado_data_validade <= DATEADD(day, 30, GETDATE())) OR
          (psicotecnico_aplicavel = 1 AND psicotecnico_data_validade IS NOT NULL AND psicotecnico_data_validade <= DATEADD(day, 30, GETDATE())) OR
          (imt_data_validade IS NOT NULL AND imt_data_validade <= DATEADD(day, 30, GETDATE()))
        )
    `, { e: req.escolaId });

    (alunosAlertasRes.recordset || []).forEach(a => {
      const estAtestado = estadoValidade(dstr(a.atestado_data_validade).slice(0, 10));
      if (estAtestado === 'expirado') alertas.push({ tipo: 'Atestado médico', gravidade: 'alta', texto: `Atestado médico de ${a.nome} está expirado.` });
      else if (estAtestado === 'a_expirar') alertas.push({ tipo: 'Atestado médico', gravidade: 'media', texto: `Atestado médico de ${a.nome} expira em breve.` });

      if (a.psicotecnico_aplicavel) {
        const estP = estadoValidade(dstr(a.psicotecnico_data_validade).slice(0, 10));
        if (estP === 'expirado') alertas.push({ tipo: 'Exame psicotécnico', gravidade: 'alta', texto: `Exame psicotécnico de ${a.nome} está expirado.` });
        else if (estP === 'a_expirar') alertas.push({ tipo: 'Exame psicotécnico', gravidade: 'media', texto: `Exame psicotécnico de ${a.nome} expira em breve.` });
      }

      const estIMT = estadoValidade(dstr(a.imt_data_validade).slice(0, 10));
      if (estIMT === 'expirado') alertas.push({ tipo: 'Processo IMT', gravidade: 'alta', texto: `Licença de aprendizagem de ${a.nome} está expirada.` });
      else if (estIMT === 'a_expirar') alertas.push({ tipo: 'Processo IMT', gravidade: 'media', texto: `Licença de aprendizagem de ${a.nome} expira em breve.` });
    });
  } catch (err) {
    (tenant.alunos || []).slice(0, 50).forEach(a => {
      const est = estadoValidade(a.atestadoMedico?.dataValidade);
      if (est === 'expirado') alertas.push({ tipo: 'Atestado médico', gravidade: 'alta', texto: `Atestado médico de ${a.nome} está expirado.` });
      else if (est === 'a_expirar') alertas.push({ tipo: 'Atestado médico', gravidade: 'media', texto: `Atestado médico de ${a.nome} expira em breve.` });
    });
  }

  tenant.instrutores.forEach(i => {
    const est = estadoValidade(i.tituloProfissionalValidade);
    if (est === 'expirado') alertas.push({ tipo: 'Título profissional', gravidade: 'alta', texto: `Título profissional de ${i.nome} está expirado.` });
    else if (est === 'a_expirar') alertas.push({ tipo: 'Título profissional', gravidade: 'media', texto: `Título profissional de ${i.nome} expira em breve.` });
    else if (!i.tituloProfissionalValidade) alertas.push({ tipo: 'Título profissional', gravidade: 'media', texto: `Falta a data de validade do título profissional de ${i.nome}.` });
  });

  tenant.veiculos.forEach(v => {
    const estIpo = estadoValidade(v.inspecaoValida);
    if (estIpo === 'expirado') alertas.push({ tipo: 'IPO', gravidade: 'alta', texto: `Inspeção periódica do veículo ${v.matricula} está expirada.` });
    else if (estIpo === 'a_expirar') alertas.push({ tipo: 'IPO', gravidade: 'media', texto: `Inspeção periódica do veículo ${v.matricula} expira em breve.` });

    const estSeg = estadoValidade(v.seguroInstrucaoValidade);
    if (estSeg === 'expirado') alertas.push({ tipo: 'Seguro de instrução', gravidade: 'alta', texto: `Seguro de instrução do veículo ${v.matricula} está expirado.` });
    else if (estSeg === 'a_expirar') alertas.push({ tipo: 'Seguro de instrução', gravidade: 'media', texto: `Seguro de instrução do veículo ${v.matricula} expira em breve.` });
  });

  try {
    const pagamentosAtrasoRes = await query(`
      SELECT TOP (20) p.id, p.data, a.nome AS alunoNome
      FROM pagamentos p
      LEFT JOIN alunos a ON a.id = p.aluno_id
      WHERE p.escola_id = @e AND p.estado = 'Pendente' AND p.data <= DATEADD(day, -7, GETDATE())
      ORDER BY p.data ASC
    `, { e: req.escolaId });

    (pagamentosAtrasoRes.recordset || []).forEach(p => {
      alertas.push({
        tipo: 'Pagamento em atraso',
        gravidade: 'alta',
        texto: `${p.alunoNome || 'Aluno'} tem um pagamento pendente desde ${p.data ? formatarDataPt(dstr(p.data).slice(0, 10)) : 'data não definida'}.`
      });
    });
  } catch (err) {
    tenant.pagamentos.forEach(p => {
      if (p.estado !== 'Pendente') return;
      const dias = diasPassados(p.data);
      if (dias === null || dias >= 7) {
        const aluno = tenant.alunos.find(a => a.id === Number(p.alunoId));
        alertas.push({
          tipo: 'Pagamento em atraso',
          gravidade: 'alta',
          texto: `${aluno?.nome || 'Aluno'} tem um pagamento pendente desde ${p.data ? formatarDataPt(p.data) : 'data não definida'}.`
        });
      }
    });
  }

  tenant.preInscricoes.forEach(p => {
    if (p.estado !== 'Pendente') return;
    const dias = diasPassados(p.dataPreInscricao);
    if (dias !== null && dias >= 7) {
      alertas.push({
        tipo: 'Pré-inscrição antiga',
        gravidade: 'media',
        texto: `${p.nome || 'Pré-inscrição'} está pendente há mais de 7 dias.`
      });
    }
  });

  calcularEsperaTeoricaPratica(tenant).filter(r => r.diasEspera > 60).forEach(r => {
    alertas.push({
      tipo: 'Espera exame teórico → prática',
      gravidade: 'alta',
      texto: `${r.nome} (${r.espacoNome}) tem ${r.diasEspera} dias entre a aprovação no exame teórico (${formatarDataPt(r.dataExameAprovado)}) e a 1.ª aula prática.`
    });
  });

  // CORRIGIDO: isTipo / isEstadoCancelada em vez de comparação estrita.
  const totaisPorAlunoDia = {};
  tenant.aulas.filter(a => isTipo(a, 'Prática') && !isEstadoCancelada(a.estado)).forEach(a => {
    const chave = `${a.alunoId}|${a.data}`;
    totaisPorAlunoDia[chave] = (totaisPorAlunoDia[chave] || 0) + (a.duracao || 50);
  });
  Object.entries(totaisPorAlunoDia).forEach(([chave, minutos]) => {
    if (minutos > LIMITE_DIARIO_PRATICA_MIN) {
      const [alunoId, dataAula] = chave.split('|');
      const aluno = tenant.alunos.find(al => al.id === Number(alunoId));
      alertas.push({
        tipo: 'Limite diário excedido',
        gravidade: 'alta',
        texto: `${aluno?.nome || 'Aluno'} tem ${(minutos / 60).toFixed(1)}h de prática marcadas em ${dataAula} (limite de referência: 4h/dia).`
      });
    }
  });

    ok(res, {
      totalAlunos: Number(totalAlunos || 0),
      alunosAtivos: Number(alunosAtivos || 0),
      aulasHoje: Number(aulasHoje || 0),
      instrutoresAtivos: Number(instrutoresAtivos || 0),
      veiculosDisponiveis: Number(veiculosDisponiveis || 0),
      totalVeiculos: Number(totalVeiculos || 0),
      totalInstrutores: Number(totalInstrutores || 0),
      receitaMes: Number(receitaMes || 0),
      pagamentosPendentes: Number(pagamentosPendentes || 0),
      proximasAulas,
      alertas
    });
  } catch (ex) {
    console.error('Erro ao carregar dashboard:', ex);
    res.status(500).json({ success: false, error: 'Falha ao carregar dashboard' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`RotaCerta (multi-escola) a correr em http://localhost:${PORT}`);
});