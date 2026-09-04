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

function escolaPublic(escola = {}) {
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
    primavera: { ...defaultPrimaveraConfig(), ...(escola.primavera || {}) }
  };
}

function escolaFull(escola = {}) {
  return {
    ...escola,
    primavera: { ...defaultPrimaveraConfig(), ...(escola.primavera || {}) }
  };
}

module.exports = { defaultPrimaveraConfig, escolaPublic, escolaFull };
