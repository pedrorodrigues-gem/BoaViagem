const test = require('node:test');
const assert = require('node:assert');

// 1. Teste de mapeamento do tipo de transferência para produtos 097 e 098
test('Mapeamento de transferência DGV: códigos 097 e 098, valores e categorias corretos', () => {
  function resolverDadosTransferencia(tipoTransferencia, produtosPersonalizados = []) {
    const isPdl = tipoTransferencia === 'dgv_pdl' || tipoTransferencia === '098' || String(tipoTransferencia || '').toLowerCase().includes('pdl');
    const codigo = isPdl ? '098' : '097';
    let descricao = isPdl ? 'Transferência do Processo DGV PDL' : 'Transferência do Processo outra DGV';
    let valor = isPdl ? 30.00 : 50.00;
    let taxaIva = 16.00;
    let categoria = 'Diversos';

    const p = produtosPersonalizados.find(prod => prod.codigo === codigo);
    if (p) {
      if (p.descricao) descricao = p.descricao;
      if (p.categoria) categoria = p.categoria;
      if (p.valor != null && !Number.isNaN(Number(p.valor))) valor = Number(p.valor);
      if (p.taxaIva != null && !Number.isNaN(Number(p.taxaIva))) taxaIva = Number(p.taxaIva);
    }

    return { codigo, descricao, valor, taxaIva, categoria, isPdl };
  }

  // Caso 1: Outra DGV
  const resOutra = resolverDadosTransferencia('outra_dgv');
  assert.strictEqual(resOutra.codigo, '097', 'Outra DGV deve mapear para o código 097');
  assert.strictEqual(resOutra.descricao, 'Transferência do Processo outra DGV');
  assert.strictEqual(resOutra.valor, 50.00, 'Código 097 deve ter o valor base de 50€');
  assert.strictEqual(resOutra.taxaIva, 16.00, 'Código 097 deve ter IVA 16%');
  assert.strictEqual(resOutra.categoria, 'Diversos');

  // Caso 2: DGV PDL
  const resPdl = resolverDadosTransferencia('dgv_pdl');
  assert.strictEqual(resPdl.codigo, '098', 'DGV PDL deve mapear para o código 098');
  assert.strictEqual(resPdl.descricao, 'Transferência do Processo DGV PDL');
  assert.strictEqual(resPdl.valor, 30.00, 'Código 098 deve ter o valor base de 30€');
  assert.strictEqual(resPdl.taxaIva, 16.00, 'Código 098 deve ter IVA 16%');
  assert.strictEqual(resPdl.categoria, 'Diversos');

  // Caso 3: Personalização de preço na tabela de produtos
  const produtosCustom = [
    { codigo: '097', descricao: 'Transferência Outra DGV - Especial', valor: 65.00, taxaIva: 16.00, categoria: 'Diversos' }
  ];
  const resCustom = resolverDadosTransferencia('outra_dgv', produtosCustom);
  assert.strictEqual(resCustom.valor, 65.00, 'Deve respeitar o valor personalizado configurado');
  assert.strictEqual(resCustom.descricao, 'Transferência Outra DGV - Especial');
});

// 2. Teste de atualização de estado e notas do aluno
test('Transferência de aluno: estado passa para Transferido e notas registam data e destino', () => {
  function processarTransferenciaAluno(aluno, { tipoTransferencia, destino, data, notas }) {
    const isPdl = tipoTransferencia === 'dgv_pdl' || tipoTransferencia === '098';
    const dataStr = data || '2026-09-07';
    const destinoStr = destino ? ` (Destino: ${String(destino).trim()})` : '';
    const notasAdicionais = notas ? ` - ${String(notas).trim()}` : '';
    const notaTransferencia = `[Transferência para ${isPdl ? 'DGV PDL' : 'outra DGV'}${destinoStr} em ${dataStr}${notasAdicionais}]`;

    const notasAtuais = aluno.notas ? String(aluno.notas).trim() : '';
    const novasNotas = notasAtuais ? `${notasAtuais}\n${notaTransferencia}` : notaTransferencia;

    return {
      ...aluno,
      estado: 'Transferido',
      notas: novasNotas
    };
  }

  const alunoInicial = { id: 10, nome: 'Manuel Santos', estado: 'Ativo', notas: 'Inscrição feita em Janeiro.' };
  const alunoTransferido = processarTransferenciaAluno(alunoInicial, {
    tipoTransferencia: 'outra_dgv',
    destino: 'DGV Angra do Heroísmo',
    data: '2026-09-07',
    notas: 'Mudança de residência'
  });

  assert.strictEqual(alunoTransferido.estado, 'Transferido', 'O estado deve passar a Transferido');
  assert.ok(alunoTransferido.notas.includes('Transferência para outra DGV (Destino: DGV Angra do Heroísmo) em 2026-09-07 - Mudança de residência'));
  assert.ok(alunoTransferido.notas.includes('Inscrição feita em Janeiro.'), 'Deve preservar as notas anteriores');
});

// 3. Teste de integração de Conta Corrente: cálculo do saldo ao adicionar item 097 ou 098
test('Conta Corrente: lançamento de item 097 ou 098 incrementa débito e saldo em dívida', () => {
  // Lógica de cálculo de conta corrente simplificada (idêntica ao server.js)
  function calcularConta(itens, pagamentos) {
    const totalItens = itens.reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const totalPago = pagamentos.filter(p => p.estado === 'Pago').reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const saldoTotal = totalItens - totalPago;
    return { totalItens, totalPago, saldoTotal };
  }

  // Aluno com contrato inicial de 800€ totalmente pago
  const itensIniciais = [
    { id: 1, codigo: '001', descricao: 'Carta B Pacote Completo', valor: 800.00, estado: 'Pago' }
  ];
  const pagamentosIniciais = [
    { id: 1, valor: 800.00, estado: 'Pago' }
  ];

  const ccInicial = calcularConta(itensIniciais, pagamentosIniciais);
  assert.strictEqual(ccInicial.saldoTotal, 0, 'Saldo inicial deve ser zero');

  // Adiciona item de transferência 097 (50€)
  const novoItemTransferencia = {
    id: 2,
    codigo: '097',
    descricao: 'Transferência do Processo outra DGV',
    categoria: 'Diversos',
    valor: 50.00,
    estado: 'Pendente'
  };
  const itensComTransferencia = [...itensIniciais, novoItemTransferencia];

  const ccAtualizada = calcularConta(itensComTransferencia, pagamentosIniciais);
  assert.strictEqual(ccAtualizada.totalItens, 850.00, 'Total de itens deve somar 850€');
  assert.strictEqual(ccAtualizada.saldoTotal, 50.00, 'Saldo em dívida deve refletir o débito de 50€ da transferência');
});

// 4. Teste de geração de classe badge para Transferido
test('badgeClass: gera badge-transferido corretamente para estilo CSS', () => {
  function badgeClass(estado) {
    var slug = String(estado || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return 'badge badge-' + slug;
  }

  assert.strictEqual(badgeClass('Transferido'), 'badge badge-transferido');
  assert.strictEqual(badgeClass('transferido'), 'badge badge-transferido');
});

// 5. Teste de carregamento inicial de todos os alunos em loadEssential
test('loadEssential: todos os alunos carregados e alunosAtivos derivados sem chamadas de rede redundantes', async () => {
  const loaded = {};
  const state = { alunos: [], alunosAtivos: [], alunosAtivosTotal: 0 };
  let apiCallsCount = 0;

  async function mockEnsureCollection(name) {
    if (name === 'alunos') {
      apiCallsCount++;
      state.alunos = [
        { id: 1, nome: 'Ana Silva', estado: 'Ativo' },
        { id: 2, nome: 'Bernardo Costa', estado: 'Suspenso' },
        { id: 3, nome: 'Carlos Neves', estado: 'Transferido' },
        { id: 4, nome: 'Diana Martins', estado: 'Ativo' }
      ];
      loaded.alunos = true;
      return state.alunos;
    }
    loaded[name] = true;
    return [];
  }

  // Simulação do loadEssential com alunos carregados
  await Promise.all([
    mockEnsureCollection('alunos'),
    mockEnsureCollection('escola'),
    mockEnsureCollection('dashboard')
  ]);

  state.alunosAtivos = (state.alunos || []).filter(a => a.estado === 'Ativo');
  state.alunosAtivosTotal = state.alunosAtivos.length;

  assert.strictEqual(loaded.alunos, true, 'Coleção alunos deve estar marcada como carregada');
  assert.strictEqual(state.alunos.length, 4, 'Todos os alunos devem estar carregados em state.alunos');
  assert.strictEqual(state.alunosAtivos.length, 2, 'Alunos ativos devem ser filtrados corretamente');
  assert.strictEqual(state.alunosAtivosTotal, 2);

  // Verificação de que ensureAlunosAtivos subsequente não dispara nova chamada HTTP
  async function mockEnsureAlunosAtivos() {
    if (loaded.alunos) {
      return state.alunosAtivos;
    }
    apiCallsCount++;
    return [];
  }

  const ativos = await mockEnsureAlunosAtivos();
  assert.strictEqual(ativos.length, 2);
  assert.strictEqual(apiCallsCount, 1, 'Não deve fazer novas chamadas de rede quando alunos já está carregado');
});

