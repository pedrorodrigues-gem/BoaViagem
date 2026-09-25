const { enviarDocumento } = require('./primavera');

/**
 * Código de cliente estável na Cegid Primavera para um aluno.
 * É gerado de forma determinística a partir do id do aluno (não precisa de
 * ser persistido para se manter estável entre chamadas), para que o mesmo
 * aluno seja sempre reconhecido como a mesma entidade no ERP, mesmo que lhe
 * sejam emitidos vários documentos ao longo do tempo.
 */
function obterEntidadeAluno(tenant, aluno, options = {}) {
  const nifEmpresa = (options.nifFaturar || options.nif_faturar || '').trim();
  if (nifEmpresa) {
    return `C${nifEmpresa.replace(/[^0-9A-Za-z]/g, '').slice(0, 10)}`;
  }
  if (aluno.codigoClientePrimavera) return aluno.codigoClientePrimavera;
  const codigo = `A${String(aluno.id).padStart(9, '0')}`;
  aluno.codigoClientePrimavera = codigo;
  return codigo;
}

/* Converte uma taxa de IVA (em %) no código de 2 dígitos usado pelo gateway
   Primavera (ex: 16 -> "16"). Se a taxa não vier definida numa linha em
   concreto (ex: itens gerados por planos "Mensalidades"/"Personalizado",
   que não correspondem 1:1 a um produto do catálogo), usa a taxa por
   omissão configurada na escola (ou 16%, a taxa normal, como último recurso). */
function codIvaFromTaxa(taxa, taxaOmissao) {
  const n = Number(taxa);
  const valor = Number.isFinite(n) ? n : (Number(taxaOmissao) || 16);
  return String(Math.round(valor)).padStart(2, '0');
}

function codIva(pagamento, escola) {
  const p = escola?.primavera || {};
  const rawTaxa = pagamento?.taxaIva ?? pagamento?.taxa_iva;
  const taxa = (rawTaxa !== undefined && rawTaxa !== null)
    ? rawTaxa
    : (p.taxaIvaDefault ?? 16);
  return codIvaFromTaxa(taxa, p.taxaIvaDefault);
}

function corpoEmail(escola, tipoLabel) {
  return `Caro(a) Formando(a),

Segue em anexo ${tipoLabel} referente aos serviços de formação para condução prestados por ${escola.nome}.

Para qualquer esclarecimento, contacte-nos através de ${escola.email || escola.telefone || 'os nossos contactos habituais'}.

Com os melhores cumprimentos,
${escola.nome}`;
}

/**
 * Distribui o valor de um pagamento pelos itens da conta corrente.
 * Se o valor pago for maior que o valor do item escolhido (ex: pagou 300€ e o item é 100€),
 * insere os outros artigos em dívida até perfazer o valor pago (300€).
 * Se o valor total em dívida for inferior ao valor pago, permite apenas o total em dívida.
 */
function distribuirValorPorItens(itensConta, valorPago, itemEscolhidoId) {
  const valorTotalPago = Number(valorPago) || 0;
  if (valorTotalPago <= 0 || !Array.isArray(itensConta) || !itensConta.length) {
    return { linhas: [], totalDivida: 0, sobra: 0, totalAlocado: 0, excedeuDivida: false };
  }

  // Ordenar itens: colocar o item escolhido em primeiro lugar (se existir),
  // seguido dos restantes itens por ordem/id
  const itensOrdenados = [...itensConta].sort((a, b) => {
    if (itemEscolhidoId) {
      if (a.id === itemEscolhidoId) return -1;
      if (b.id === itemEscolhidoId) return 1;
    }
    return (a.ordem ?? a.id) - (b.ordem ?? b.id);
  });

  // Calcular total em dívida dos itens
  let totalDivida = 0;
  itensOrdenados.forEach(it => {
    const pendente = it.saldo !== undefined ? Number(it.saldo) : Number(it.valor);
    if (pendente > 0) totalDivida += pendente;
  });
  totalDivida = +totalDivida.toFixed(2);

  // Se houver dívida total calculada e o valor pago a exceder, permitir apenas o total em dívida
  const excedeuDivida = totalDivida > 0 && valorTotalPago > totalDivida;
  const valorEfetivo = excedeuDivida ? totalDivida : valorTotalPago;

  let restante = valorEfetivo;
  const linhas = [];

  for (const it of itensOrdenados) {
    if (restante <= 0.0001) break;
    const pendente = it.saldo !== undefined ? Number(it.saldo) : Number(it.valor);
    if (pendente <= 0.0001 && it.id !== itemEscolhidoId) continue;

    const capacidadeItem = pendente > 0 ? pendente : (Number(it.valor) || restante);
    const aplicar = +Math.min(restante, capacidadeItem).toFixed(2);
    if (aplicar <= 0.0001) continue;

    linhas.push({
      itemContaId: it.id,
      artigo: it.codigo || it.artigo || 'FORMACAO',
      descricao: it.descricao || 'Serviços de formação',
      valor: aplicar,
      taxaIva: it.taxaIva != null ? Number(it.taxaIva) : 18,
      quantidade: 1.0
    });

    restante = +(restante - aplicar).toFixed(2);
  }

  const totalAlocado = +linhas.reduce((acc, l) => acc + l.valor, 0).toFixed(2);
  const sobra = +(valorTotalPago - totalAlocado).toFixed(2);

  return {
    linhas,
    totalDivida,
    valorPermitido: valorEfetivo,
    excedeuDivida,
    totalAlocado,
    sobra
  };
}

function linhasFromPagamento(pagamento, escola) {
  const p = escola?.primavera || {};
  const linhasArray = (pagamento && Array.isArray(pagamento.linhas) && pagamento.linhas.length)
    ? pagamento.linhas
    : (pagamento && Array.isArray(pagamento.itensFaturar) && pagamento.itensFaturar.length ? pagamento.itensFaturar : null);

  if (linhasArray) {
    return linhasArray.map(l => {
      const artigo = l.artigo || l.codigo || p.artigoFormacao || 'FORMACAO';
      const descricao = l.descricao || l.itemDescricao || 'Serviços de formação para condução';
      const taxa = l.taxaIva != null ? l.taxaIva : (pagamento.taxaIva != null ? pagamento.taxaIva : (p.taxaIvaDefault ?? 18));
      return {
        Artigo: artigo,
        Quantidade: Number(l.quantidade) || 1.0,
        PrecoUnitario: Number(l.valor ?? l.precoUnitario) || 0,
        Desconto: Number(l.desconto || 0),
        Armazem: p.armazem || 'A1',
        Descricao: descricao,
        DescricaoNovoArtigo: descricao,
        CodIvaNovoArtigo: codIvaFromTaxa(taxa, p.taxaIvaDefault),
        IvaDedutivel: false
      };
    });
  }

  const artigo = (pagamento && (pagamento.artigo || pagamento.codigo)) || p.artigoFormacao || 'FORMACAO';
  const descricao = (pagamento && (pagamento.itemContaDescricao || pagamento.descricao || pagamento.itemDescricao)) || 'Serviços de formação para condução';
  return [{
    Artigo: artigo,
    Quantidade: Number(pagamento?.quantidade) || 1.0,
    PrecoUnitario: Number(pagamento?.valor) || 0,
    Desconto: Number(pagamento?.desconto || 0),
    Armazem: p.armazem || 'A1',
    Descricao: descricao,
    DescricaoNovoArtigo: descricao,
    CodIvaNovoArtigo: codIva(pagamento, escola),
    IvaDedutivel: false
  }];
}

function cabecalhoComum(escola, aluno, pagamento, tipoDocumento, entidade, referenciaExterna, options = {}) {
  const p = escola.primavera;
  const dataDoc = pagamento.data || new Date().toISOString().slice(0, 10);
  const tipoLabel = { FA: 'a fatura', FR: 'a fatura-recibo', NC: 'a nota de crédito' }[tipoDocumento] || 'o documento';
  const serie = options.serie || pagamento.serie || aluno.serie || p.serie;
  const modoPag = options.modoPag || pagamento.modoPagamento || pagamento.modo_pagamento || p.modoPag || 'PGNUM';
  const nomeEfetivo = (options.nomeFaturar || options.nome_faturar || '').trim() || aluno.nome || '';
  const nifEfetivo = (options.nifFaturar || options.nif_faturar || '').trim() || aluno.nif || '999999990';
  const emailDestino = (options.emailFaturar || options.email_faturar || '').trim() || aluno.email || '';
  const isEmpresa = !!(options.nifFaturar || options.nomeFaturar);

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
    NomeNovaEntidade: nomeEfetivo,
    NifNovaEntidade: nifEfetivo,
    Moeda: 'EUR',
    TipoPessoa: isEmpresa ? 'C' : 'S',
    DadosTransmissao: {
      EnviarEmail: !!emailDestino,
      GuardarPDF: true,
      EmailDestino: emailDestino,
      Assunto: `${tipoDocumento} · ${escola.nome} — ${referenciaExterna}`,
      CorpoEmail: corpoEmail(escola, tipoLabel)
    },
    Linhas: (options && Array.isArray(options.linhas) && options.linhas.length)
      ? (options.linhas[0]?.Artigo ? options.linhas : linhasFromPagamento({ ...pagamento, linhas: options.linhas }, escola))
      : linhasFromPagamento(pagamento, escola)
  };
}

/* =========================================================================
 * Fatura-Recibo (FR)
 * ========================================================================= */
async function emitirFaturaRecibo(escola, tenant, aluno, pagamento, options = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno, options);
  const ref = `PAG-${pagamento.id}`;
  const payload = cabecalhoComum(escola, aluno, pagamento, 'FR', entidade, ref, options);
  const resultado = await enviarDocumento(escola.primavera, payload, `FR/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Fatura (FA) avulsa ligada a um pagamento
 * ========================================================================= */
async function emitirFatura(escola, tenant, aluno, pagamento, options = {}) {
  const entidade = obterEntidadeAluno(tenant, aluno, options);
  const ref = `PAG-${pagamento.id}`;
  const payload = cabecalhoComum(escola, aluno, pagamento, 'FA', entidade, ref, options);
  const resultado = await enviarDocumento(escola.primavera, payload, `FA/${ref}`);
  return { resultado, entidade };
}

/* =========================================================================
 * Faturação de Contratos (FA)
 * ========================================================================= */
function linhasFromContrato(contrato, escola) {
  const p = escola?.primavera || {};
  const itens = Array.isArray(contrato.itensCarta) && contrato.itensCarta.length
    ? contrato.itensCarta
    : [{ descricao: `Contrato de formação — categoria ${contrato.categoria || '—'}`, valor: contrato.valorTotal || 0, taxaIva: p.taxaIvaDefault ?? 23 }];

  return itens.map(it => {
    const artigo = it.codigo || it.artigo || p.artigoFormacao || 'FORMACAO';
    const descricao = it.descricao || 'Serviços de formação';
    return {
      Artigo: artigo,
      Quantidade: Number(it.quantidade) || 1.0,
      PrecoUnitario: Number(it.valorUnitario ?? it.valor) || 0,
      Desconto: Number(it.desconto || 0),
      Armazem: p.armazem || 'A1',
      Descricao: descricao,
      DescricaoNovoArtigo: descricao,
      CodIvaNovoArtigo: codIvaFromTaxa(it.taxaIva, p.taxaIvaDefault),
      IvaDedutivel: true
    };
  });
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
  distribuirValorPorItens,
  emitirFaturaRecibo,
  obterEntidadeAluno,
  emitirFatura,
  linhasFromContrato,
  linhasFromPagamento,
  codIva,
  codIvaFromTaxa,
  emitirFaturaContrato,
  emitirNotaCredito,
  emitirRecibo,
  emitirReciboContrato
};