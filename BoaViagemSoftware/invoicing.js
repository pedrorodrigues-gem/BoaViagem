const { enviarDocumento } = require('./primavera');

/**
 * Código de cliente estável na Cegid Primavera para um aluno.
 * É gerado de forma determinística a partir do id do aluno (não precisa de
 * ser persistido para se manter estável entre chamadas), para que o mesmo
 * aluno seja sempre reconhecido como a mesma entidade no ERP, mesmo que lhe
 * sejam emitidos vários documentos ao longo do tempo.
 */
function obterEntidadeAluno(tenant, aluno) {
  if (aluno.codigoClientePrimavera) return aluno.codigoClientePrimavera;
  const codigo = `A${String(aluno.id).padStart(9, '0')}`;
  aluno.codigoClientePrimavera = codigo;
  return codigo;
}

/* Converte uma taxa de IVA (em %) no código de 2 dígitos usado pelo gateway
   Primavera (ex: 23 -> "23"). Se a taxa não vier definida numa linha em
   concreto (ex: itens gerados por planos "Mensalidades"/"Personalizado",
   que não correspondem 1:1 a um produto do catálogo), usa a taxa por
   omissão configurada na escola (ou 23%, a taxa normal, como último recurso). */
function codIvaFromTaxa(taxa, taxaOmissao) {
  const n = Number(taxa);
  const valor = Number.isFinite(n) ? n : (Number(taxaOmissao) || 23);
  return String(Math.round(valor)).padStart(2, '0');
}

function codIva(pagamento, escola) {
  const taxa = pagamento.taxaIva ?? escola.primavera.taxaIvaDefault ?? 23;
  return codIvaFromTaxa(taxa, escola.primavera.taxaIvaDefault);
}

function corpoEmail(escola, tipoLabel) {
  return `Caro(a) Formando(a),

Segue em anexo ${tipoLabel} referente aos serviços de formação para condução prestados por ${escola.nome}.

Para qualquer esclarecimento, contacte-nos através de ${escola.email || escola.telefone || 'os nossos contactos habituais'}.

Com os melhores cumprimentos,
${escola.nome}`;
}

function linhasFromPagamento(pagamento, escola) {
  const p = escola.primavera;
  return [{
    Artigo: p.artigoFormacao || 'FORMACAO',
    Quantidade: 1.0,
    PrecoUnitario: Number(pagamento.valor) || 0,
    Desconto: Number(pagamento.desconto || 0),
    Armazem: p.armazem || 'A1',
    DescricaoNovoArtigo: pagamento.descricao || 'Serviços de formação para condução',
    CodIvaNovoArtigo: codIva(pagamento, escola),
    IvaDedutivel: true
  }];
}

function cabecalhoComum(escola, aluno, pagamento, tipoDocumento, entidade, referenciaExterna, options = {}) {
  const p = escola.primavera;
  const dataDoc = pagamento.data || new Date().toISOString().slice(0, 10);
  const tipoLabel = { FA: 'a fatura', FR: 'a fatura-recibo', NC: 'a nota de crédito' }[tipoDocumento] || 'o documento';
  const serie = options.serie || pagamento.serie || aluno.serie || p.serie;
  const modoPag = options.modoPag || pagamento.modoPagamento || pagamento.modo_pagamento || p.modoPag || 'PGNUM';
  return {
    EmpresaContexto: p.empresa,
    TipoDocumento: tipoDocumento,
    Serie: serie,
    TipoEntidade: 'C',
    Entidade: entidade,
    DataDocumento: dataDoc,
    ReferenciaExterna: referenciaExterna,
    NumeroDocumentoForcado: 0,
    DescontoTotal: 0.0,
    ModoPag: modoPag,
    NomeNovaEntidade: aluno.nome || '',
    NifNovaEntidade: aluno.nif || '999999990',
    Moeda: 'EUR',
    TipoPessoa: 'S',
    DadosTransmissao: {
      EnviarEmail: !!aluno.email,
      GuardarPDF: true,
      EmailDestino: aluno.email || '',
      Assunto: `${tipoDocumento} · ${escola.nome} — ${referenciaExterna}`,
      CorpoEmail: corpoEmail(escola, tipoLabel)
    },
    Linhas: linhasFromPagamento(pagamento, escola)
  };
}

/* =========================================================================
 * Fatura-Recibo (FR)
 * ========================================================================= */
async function emitirFaturaRecibo(escola, tenant, aluno, pagamento, options = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno);
  const ref = `PAG-${pagamento.id}`;
  const payload = cabecalhoComum(escola, aluno, pagamento, 'FR', entidade, ref, options);
  const resultado = await enviarDocumento(escola.primavera, payload, `FR/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Fatura (FA) avulsa ligada a um pagamento
 * ========================================================================= */
async function emitirFatura(escola, tenant, aluno, pagamento, options = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno);
  const ref = `PAG-${pagamento.id}`;
  const payload = cabecalhoComum(escola, aluno, pagamento, 'FA', entidade, ref, options);
  const resultado = await enviarDocumento(escola.primavera, payload, `FA/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Faturação de Contratos (FA)
 * ========================================================================= */
function linhasFromContrato(contrato, escola) {
  const p = escola.primavera;
  const itens = Array.isArray(contrato.itensCarta) && contrato.itensCarta.length
    ? contrato.itensCarta
    : [{ descricao: `Contrato de formação — categoria ${contrato.categoria || '—'}`, valor: contrato.valorTotal || 0, taxaIva: p.taxaIvaDefault ?? 23 }];

  return itens.map(it => ({
    Artigo: p.artigoFormacao || 'FORMACAO',
    Quantidade: 1.0,
    PrecoUnitario: Number(it.valor) || 0,
    Desconto: 0,
    Armazem: p.armazem || 'A1',
    DescricaoNovoArtigo: it.descricao,
    CodIvaNovoArtigo: codIvaFromTaxa(it.taxaIva, p.taxaIvaDefault),
    IvaDedutivel: true
  }));
}

async function emitirFaturaContrato(escola, tenant, aluno, contrato, options = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno);
  const ref = `CONTRATO-${contrato.id}`;
  const dataDoc = contrato.dataCriacao || new Date().toISOString().slice(0, 10);
  const p = escola.primavera;
  const serie = options.serie || contrato.serie || aluno.serie || p.serie;
  const payload = {
    EmpresaContexto: p.empresa,
    TipoDocumento: 'FA',
    Serie: serie,
    TipoEntidade: 'C',
    Entidade: entidade,
    DataDocumento: dataDoc,
    ReferenciaExterna: ref,
    NumeroDocumentoForcado: 0,
    DescontoTotal: 0.0,
    NomeNovaEntidade: aluno.nome || '',
    NifNovaEntidade: aluno.nif || '999999990',
    Moeda: 'EUR',
    TipoPessoa: 'S',
    DadosTransmissao: {
      EnviarEmail: !!aluno.email,
      GuardarPDF: true,
      EmailDestino: aluno.email || '',
      Assunto: `Fatura · ${escola.nome} — ${ref}`,
      CorpoEmail: corpoEmail(escola, 'a fatura')
    },
    Linhas: linhasFromContrato(contrato, escola)
  };
  const resultado = await enviarDocumento(p, payload, `FA/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Nota de Crédito (NC) — estorno total/parcial
 * ========================================================================= */
async function emitirNotaCredito(escola, tenant, aluno, pagamento, { docOriginalTipo, docOriginalSerie, docOriginalNumero, motivo, serie } = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno);
  const ref = `NC-PAG-${pagamento.id}`;
  const payload = cabecalhoComum(escola, aluno, pagamento, 'NC', entidade, ref, { serie });
  payload.DocOriginalTipo = docOriginalTipo || 'FA';
  payload.DocOriginalSerie = docOriginalSerie || serie || escola.primavera.serie;
  payload.DocOriginalNumero = String(docOriginalNumero || '');
  payload.MotivoEstorno = motivo || '001';
  const resultado = await enviarDocumento(escola.primavera, payload, `NC/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Recibos (RE) — liquidação de faturas
 * ========================================================================= */
async function emitirRecibo(escola, tenant, aluno, pagamento, { docOriginalTipo, docOriginalSerie, docOriginalNumero, numPrestacao, modoPag, contaBancaria, filial, serie } = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno);
  const p = escola.primavera;
  const valor = Number(pagamento.valor) || 0;
  if (valor <= 0) {
    return { resultado: { sucesso: false, erro: 'O valor do pagamento tem de ser superior a zero para emitir recibo.' } };
  }
  const serieDoc = serie || pagamento.serie || aluno.serie || p.serie;
  const modoPagDoc = modoPag || pagamento.modoPagamento || pagamento.modo_pagamento || p.modoPag || 'PGNUM';
  const payload = {
    Tipodoc: 'RE',
    TipoEntidade: 'C',
    Entidade: entidade,
    Serie: serieDoc,
    Moeda: 'EUR',
    ModoPag: modoPagDoc,
    ContaBancaria: contaBancaria || p.contaBancaria,
    Filial: filial || p.filial,
    DataDoc: pagamento.data || new Date().toISOString().slice(0, 10),
    DadosTransmissao: {
      EnviarEmail: !!aluno.email,
      GuardarPDF: true,
      EmailDestino: aluno.email || '',
      Assunto: `Recibo · ${escola.nome} — PAG-${pagamento.id}`,
      CorpoEmail: corpoEmail(escola, 'o recibo')
    },
    LinhasLiquidacao: [{
      ValorRec: valor,
      ModuloOrig: 'V',
      TipoDocOrig: docOriginalTipo || 'FA',
      SerieOrig: docOriginalSerie || serieDoc,
      NumDocOrig: String(docOriginalNumero || ''),
      NumDocOrigInt: Number(docOriginalNumero) || 0,
      NumPrestacao: Number(numPrestacao || 1),
      FilialOrig: filial || p.filial
    }]
  };
  const resultado = await enviarDocumento(escola.primavera, payload, `RE/${entidade}/${docOriginalTipo}/${docOriginalNumero}`);
  return { resultado, entidade };
}

async function emitirReciboContrato(escola, tenant, aluno, contrato, pagamento, options = {}) {
  const fat = contrato && contrato.faturacao;
  if (!fat) {
    return { resultado: { sucesso: false, erro: 'Este contrato ainda não tem fatura emitida — submete primeiro o PDF do contrato assinado.' } };
  }
  const numPrestacao = (Array.isArray(contrato.recibosEmitidos) ? contrato.recibosEmitidos.length : 0) + 1;
  return emitirRecibo(escola, tenant, aluno, pagamento, {
    docOriginalTipo: fat.tipo,
    docOriginalSerie: fat.serie,
    docOriginalNumero: fat.numero,
    numPrestacao,
    serie: options.serie || fat.serie,
    ...options
  });
}

module.exports = {
  emitirFaturaRecibo,
  obterEntidadeAluno,
  emitirFatura,
  linhasFromContrato,
  emitirFaturaContrato,
  emitirNotaCredito,
  emitirRecibo,
  emitirReciboContrato
};