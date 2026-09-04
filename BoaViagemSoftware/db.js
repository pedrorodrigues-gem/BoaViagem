/* ==========================================================
   Camada de ligação à base de dados — SQL Server via mssql,
   configurada por config.env.
   ========================================================== */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'config.env') });
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
  },
  // requestTimeout in ms for individual queries; can be overridden via env
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS) || 120000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(pool => {
        console.log(`Ligado ao SQL Server (${config.server}/${config.database})`);
        return pool;
      })
      .catch(err => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

/* Atalho para queries parametrizadas.
   params: { nome: valor } ou { nome: { type: sql.Int, value: 5 } } quando
   é preciso forçar o tipo (ex: VARBINARY, DECIMAL). */
async function query(sqlText, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
      // Tipo explícito fornecido pelo chamador (ex: colunas VARBINARY, DECIMAL)
      request.input(key, value.type, value.value);
    } else if (Buffer.isBuffer(value)) {
      // Defesa extra: qualquer Buffer é sempre tipado como VarBinary(MAX),
      // mesmo que o chamador se tenha esquecido de o marcar explicitamente.
      request.input(key, sql.VarBinary(sql.MAX), value);
    } else {
      request.input(key, value);
    }
  }
  return request.query(sqlText);
}

/* Devolve um request associado a uma transação — usar em operações que
   têm de ser atómicas (ex: criar contrato + gerar itens de conta corrente). */
async function beginTransaction() {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  return tx;
}

async function seedEscola(escolaId) {
  const pool = await getPool();
  await pool.request().input('escola_id', sql.Int, escolaId).execute('sp_seed_escola');
}

function defaultPrimaveraConfig() {
  return {
    ativo: false,
    baseUrl: '',
    empresa: 'ESCOLAS',
    clientId: '',
    apiKey: '',
    serie: '1',
    modoPag: 'PGNUM',
    contaBancaria: '01',
    filial: '000',
    taxaIvaDefault: 23,
    armazem: 'A1',
    artigoFormacao: 'FORMACAO'
  };
}

function defaultTenantData() {
  return {
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
    usuarios: [],
    users: [],
    documentos: [],
    _seq: {}
  };
}

function defaultRoot() {
  return { escolas: [], tenants: {}, _escolaSeq: 0 };
}

function load() {
  return defaultRoot();
}

function save() {
  return true;
}

function nextId(tenant, collectionName) {
  const seq = tenant && tenant._seq ? tenant._seq : (tenant._seq = {});
  const current = Number(seq[collectionName] || 0);
  seq[collectionName] = current + 1;
  const arr = tenant && tenant[collectionName] ? tenant[collectionName] : [];
  const maxFromArray = arr.reduce((max, item) => Math.max(max, Number(item && item.id) || 0), 0);
  return Math.max(current + 1, maxFromArray + 1);
}

function getTenant(data, escolaId) {
  if (!data || !data.tenants) return defaultTenantData();
  const tenant = data.tenants[String(escolaId)] || defaultTenantData();
  tenant._seq = tenant._seq || {};
  return tenant;
}

function nestEscolaPrimavera(escola = {}) {
  if (!escola) return escola;
  escola.primavera = {
    ativo: !!escola.primavera_ativo,
    baseUrl: escola.primavera_base_url ?? '',
    empresa: escola.primavera_empresa ?? 'ESCOLAS',
    clientId: escola.primavera_client_id ?? '',
    apiKey: escola.primavera_api_key ?? '',
    serie: escola.primavera_serie ?? '1',
    modoPag: escola.primavera_modo_pag ?? 'PGNUM',
    contaBancaria: escola.primavera_conta_bancaria ?? '01',
    filial: escola.primavera_filial ?? '000',
    taxaIvaDefault: escola.primavera_taxa_iva_default ?? 23,
    armazem: escola.primavera_armazem ?? 'A1',
    artigoFormacao: escola.primavera_artigo_formacao ?? 'FORMACAO'
  };
  return escola;
}

function escolaPublic(escola = {}) {
  nestEscolaPrimavera(escola);
  return {
    id: escola.id,
    nome: escola.nome,
    username: escola.username,
    email: escola.email,
    telefone: escola.telefone,
    nipc: escola.nipc,
    morada: escola.morada,
    numeroLicencaIMT: escola.numero_licenca_imt ?? escola.numeroLicencaIMT,
    nomeDiretor: escola.nome_diretor ?? escola.nomeDiretor,
    dataCriacao: escola.data_criacao ?? escola.dataCriacao,
    primavera: { ...defaultPrimaveraConfig(), ...escola.primavera }
  };
}

function nextPlanoCartaId(tenant) {
  const current = Number((tenant && tenant._seq && tenant._seq.planoCartaId) || 0);
  tenant._seq = tenant._seq || {};
  tenant._seq.planoCartaId = current + 1;
  return tenant._seq.planoCartaId;
}

module.exports = {
  sql,
  getPool,
  query,
  beginTransaction,
  seedEscola,
  defaultPrimaveraConfig,
  defaultTenantData,
  defaultRoot,
  load,
  save,
  nextId,
  getTenant,
  escolaPublic,
  nestEscolaPrimavera,
  nextPlanoCartaId
};