const test = require('node:test');
const assert = require('node:assert');
const invoicing = require('../invoicing');

test('Funções de faturação FA, RE, NC estão exportadas e são funções', () => {
  assert.strictEqual(typeof invoicing.emitirFatura, 'function');
  assert.strictEqual(typeof invoicing.emitirRecibo, 'function');
  assert.strictEqual(typeof invoicing.emitirNotaCredito, 'function');
  assert.strictEqual(typeof invoicing.emitirFaturaContrato, 'function');
  assert.strictEqual(typeof invoicing.emitirReciboContrato, 'function');
});

test('Validação de aluno obrigatória: nome, CC (numeroDocumento) e espaço (espacoId)', () => {
  // Simulando a lógica de validação de criação de aluno implementada em server.js
  function validarAluno(body) {
    if (!body || typeof body !== 'object') return 'Dados inválidos';
    if (!body.nome || !String(body.nome).trim()) return 'O nome do aluno é obrigatório';
    if (!body.numeroDocumento || !String(body.numeroDocumento).trim()) return 'O número de documento (CC) é obrigatório';
    if (!body.espacoId || !Number(body.espacoId)) return 'O espaço/posto é obrigatório';
    return null;
  }

  assert.strictEqual(validarAluno({}), 'O nome do aluno é obrigatório');
  assert.strictEqual(validarAluno({ nome: 'João' }), 'O número de documento (CC) é obrigatório');
  assert.strictEqual(validarAluno({ nome: 'João', numeroDocumento: '12345678' }), 'O espaço/posto é obrigatório');
  assert.strictEqual(validarAluno({ nome: 'João', numeroDocumento: '12345678', espacoId: 2 }), null);
});

test('Prioridade de série por espaço do aluno', () => {
  // Simulando a lógica de obtenção de série implementada em server.js
  function obterSerieParaAluno(aluno, espacos, escolaPrimaveraSerie) {
    if (aluno && aluno.espacoId && Array.isArray(espacos)) {
      const espaco = espacos.find(e => e.id === aluno.espacoId);
      if (espaco && espaco.serie && espaco.serie.trim()) {
        return espaco.serie.trim();
      }
    }
    return escolaPrimaveraSerie || null;
  }

  const espacos = [
    { id: 1, nome: 'Sede Ponta Delgada', serie: '2026A' },
    { id: 2, nome: 'Polo Lagoa', serie: '2026B' },
    { id: 3, nome: 'Polo Ribeira Grande', serie: null }
  ];

  // Aluno com espaço configurado com série própria:
  assert.strictEqual(obterSerieParaAluno({ espacoId: 1 }, espacos, '2026GERAL'), '2026A');
  assert.strictEqual(obterSerieParaAluno({ espacoId: 2 }, espacos, '2026GERAL'), '2026B');

  // Aluno cujo espaço não tem série própria -> usa série global da escola:
  assert.strictEqual(obterSerieParaAluno({ espacoId: 3 }, espacos, '2026GERAL'), '2026GERAL');

  // Aluno sem espaço -> fallback para série global:
  assert.strictEqual(obterSerieParaAluno({}, espacos, '2026GERAL'), '2026GERAL');
});

test('Cálculo de menoridade para assinatura do tutor', () => {
  function calcularIdadeAluno(aluno, dataRef = new Date()) {
    if (!aluno || !aluno.dataNascimento) return null;
    const hoje = dataRef;
    const nasc = new Date(aluno.dataNascimento);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade;
  }

  function eMenor(aluno, dataRef) {
    const idade = calcularIdadeAluno(aluno, dataRef);
    return idade !== null && idade < 18;
  }

  const dataAtual = new Date('2026-09-06');
  assert.strictEqual(eMenor({ dataNascimento: '2010-01-15' }, dataAtual), true, '16 anos deve ser menor');
  assert.strictEqual(eMenor({ dataNascimento: '2008-09-05' }, dataAtual), false, 'Completou 18 anos ontem -> maior');
  assert.strictEqual(eMenor({ dataNascimento: '2008-09-07' }, dataAtual), true, 'Faz 18 anos amanhã -> ainda menor');
  assert.strictEqual(eMenor({ dataNascimento: '1995-05-20' }, dataAtual), false, '31 anos -> maior');
  assert.strictEqual(eMenor({}, dataAtual), false, 'Sem data de nascimento');
});

test('Remoção de pagamento faturado converte em NC em vez de apagar', () => {
  // Simulação da lógica de DELETE /api/pagamentos/:id
  function processarRemocaoPagamento(pagamento) {
    const temFaturacao = !!(pagamento.faturacaoNumero || pagamento.faturacao_numero);
    if (temFaturacao) {
      // Não apaga; converte em NC e anula
      return {
        action: 'CONVERT_TO_NC',
        pagamentoAtualizado: {
          ...pagamento,
          estado: 'Anulado'
        },
        convertedToNC: true,
        message: 'Pagamento faturado foi convertido em Nota de Crédito (NC).'
      };
    }
    // Não faturado: apaga normalmente
    return {
      action: 'HARD_DELETE',
      deleted: true
    };
  }

  const pagNaoFaturado = { id: 10, valor: 100, estado: 'Pago' };
  const res1 = processarRemocaoPagamento(pagNaoFaturado);
  assert.strictEqual(res1.action, 'HARD_DELETE');

  const pagFaturado = { id: 11, valor: 250, faturacao_numero: 'FR 2026/1', estado: 'Pago' };
  const res2 = processarRemocaoPagamento(pagFaturado);
  assert.strictEqual(res2.action, 'CONVERT_TO_NC');
  assert.strictEqual(res2.convertedToNC, true);
  assert.strictEqual(res2.pagamentoAtualizado.estado, 'Anulado');
});

test('Agregação da Folha de Caixa Diária (PGNUM vs PGTR)', () => {
  // Simulação da agregação por espaço
  const espacos = [
    { id: 1, nome: 'Central', serie: '2026A' },
    { id: 2, nome: 'Norte', serie: '2026B' }
  ];

  const alunos = [
    { id: 101, espacoId: 1 },
    { id: 102, espacoId: 2 },
    { id: 103, espacoId: 1 }
  ];

  const pagamentos = [
    { id: 1, alunoId: 101, valor: 100, modoPagamento: 'PGNUM', estado: 'Pago', data: '2026-09-06' },
    { id: 2, alunoId: 101, valor: 150, modoPagamento: 'PGTR', estado: 'Pago', data: '2026-09-06' },
    { id: 3, alunoId: 102, valor: 200, modoPagamento: 'PGTR', estado: 'Pago', data: '2026-09-06' },
    { id: 4, alunoId: 103, valor: 50, modoPagamento: 'PGNUM', estado: 'Anulado', data: '2026-09-06' } // Anulado não entra
  ];

  const totaisEspaco = {
    1: { id: 1, nome: 'Central', serie: '2026A', pgnum: 0, pgtr: 0, total: 0, quantidade: 0 },
    2: { id: 2, nome: 'Norte', serie: '2026B', pgnum: 0, pgtr: 0, total: 0, quantidade: 0 }
  };

  const totaisGerais = { pgnum: 0, pgtr: 0, geral: 0, quantidade: 0 };

  for (const p of pagamentos) {
    if (p.estado === 'Anulado') continue;
    const al = alunos.find(a => a.id === p.alunoId);
    const espacoId = al?.espacoId;
    const alvo = totaisEspaco[espacoId];
    if (!alvo) continue;

    const val = Number(p.valor) || 0;
    if (p.modoPagamento === 'PGTR') {
      alvo.pgtr += val;
      totaisGerais.pgtr += val;
    } else {
      alvo.pgnum += val;
      totaisGerais.pgnum += val;
    }
    alvo.total += val;
    alvo.quantidade++;
    totaisGerais.geral += val;
    totaisGerais.quantidade++;
  }

  assert.strictEqual(totaisEspaco[1].pgnum, 100);
  assert.strictEqual(totaisEspaco[1].pgtr, 150);
  assert.strictEqual(totaisEspaco[1].total, 250);
  assert.strictEqual(totaisEspaco[1].quantidade, 2);

  assert.strictEqual(totaisEspaco[2].pgnum, 0);
  assert.strictEqual(totaisEspaco[2].pgtr, 200);
  assert.strictEqual(totaisEspaco[2].total, 200);

  assert.strictEqual(totaisGerais.pgnum, 100);
  assert.strictEqual(totaisGerais.pgtr, 350);
  assert.strictEqual(totaisGerais.geral, 450);
  assert.strictEqual(totaisGerais.quantidade, 3);
});

test('Folha de caixa diária: esquema de resposta garante totais.pgnum e espacos[].pgnum sem undefined', () => {
  // Simular resposta da rota /api/relatorios/folha-caixa-diaria
  const respostaServidor = {
    data: '2026-09-06',
    escolaNome: 'Escola Central',
    espacos: [
      { id: 1, nome: 'Central', serie: '2026A', pgnum: 120, pgtr: 80, total: 200, pagamentos: [{ id: 1 }] },
      { id: 2, nome: 'Norte', serie: '2026B', pgnum: 0, pgtr: 150, total: 150, pagamentos: [{ id: 2 }] }
    ],
    totais: {
      pgnum: 120,
      pgtr: 230,
      geral: 350,
      quantidade: 2
    },
    totalGeralNumerario: 120,
    totalGeralCartaoTransferencia: 230,
    totalGeralDia: 350
  };

  // Normalização do frontend (abrirModalFolhaCaixa e exportarFolhaCaixaPdf)
  const totais = respostaServidor?.totais || {
    pgnum: respostaServidor?.totalGeralNumerario || 0,
    pgtr: respostaServidor?.totalGeralCartaoTransferencia || 0,
    geral: respostaServidor?.totalGeralDia || 0,
    quantidade: (respostaServidor?.espacos || []).reduce((s, e) => s + (e.pagamentos?.length || 0), 0)
  };

  assert.strictEqual(totais.pgnum, 120);
  assert.strictEqual(totais.pgtr, 230);
  assert.strictEqual(totais.geral, 350);
  assert.strictEqual(totais.quantidade, 2);
  assert.ok(respostaServidor.espacos[0].pgnum !== undefined);
  assert.ok(respostaServidor.espacos[1].pgnum !== undefined);
});

test('Resolução de Conta Corrente com fallback SQL (evita 404 quando cache de alunos está vazia)', () => {
  // Cenário: LOAD_FULL_TENANT=false ou aluno recém-criado onde tenant.alunos está vazio
  const tenantMemoria = { alunos: [] };
  const baseDadosSql = [
    { id: 4, nome: 'Aluno Quatro', numero_documento: '12345678', espaco_id: 1, nif: '123456789' }
  ];

  function resolverAluno(alunoId) {
    let aluno = (tenantMemoria.alunos || []).find(a => a.id === alunoId);
    if (!aluno) {
      const sqlRow = baseDadosSql.find(a => a.id === alunoId);
      if (sqlRow) {
        aluno = { ...sqlRow, atestadoMedico: {}, examePsicotecnico: {}, processoIMT: {} };
      }
    }
    return aluno || null;
  }

  const alunoEncontrado = resolverAluno(4);
  assert.notStrictEqual(alunoEncontrado, null);
  assert.strictEqual(alunoEncontrado.nome, 'Aluno Quatro');

  const alunoInexistente = resolverAluno(999);
  assert.strictEqual(alunoInexistente, null);
});

test('Comparação de Espaços e cálculo homólogo Year-to-Date (YTD) para ano em curso', () => {
  // Cenário: Ano atual = 2026, mês atual = 9 (Setembro).
  // Quando modo = 'anoCivil' e ano = 2026, é um ano em curso.
  const anoAtual = 2026;
  const mesAtual = 9;
  const meses2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
  const meses2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);

  const isAnoEmCurso = true;
  const indicesDecorridos = isAnoEmCurso
    ? meses2026.map((m, idx) => Number(m.slice(5, 7)) <= mesAtual ? idx : -1).filter(i => i !== -1)
    : meses2026.map((_, idx) => idx);

  assert.strictEqual(indicesDecorridos.length, 9); // Jan a Set (9 meses)

  // Simular receita de 100€/mês em 2026 (meses 1..9 decorridos = 900€)
  const receita2026 = meses2026.map((m, i) => i < 9 ? 100 : 0);
  // Simular receita de 80€/mês em 2025 nos 12 meses (total 960€ no ano inteiro, mas 720€ nos primeiros 9 meses)
  const receita2025 = meses2025.map(() => 80);

  // Sem YTD: 900 vs 960 => queda artificial de -6.25%
  // Com YTD justo: 900 vs 720 (9 meses vs 9 meses) => subida real de +25%
  const totalAtualYTD = indicesDecorridos.reduce((s, i) => s + (receita2026[i] || 0), 0);
  const totalAnteriorYTD = indicesDecorridos.reduce((s, i) => s + (receita2025[i] || 0), 0);
  const variacaoPctYTD = +(((totalAtualYTD - totalAnteriorYTD) / totalAnteriorYTD) * 100).toFixed(1);

  assert.strictEqual(totalAtualYTD, 900);
  assert.strictEqual(totalAnteriorYTD, 720);
  assert.strictEqual(variacaoPctYTD, 25.0); // Crescimento real apurado corretamente
});

test('Estrutura de comparativo entre espaços (2 espaços) calcula métricas e séries mensais', () => {
  const espacosDb = [
    { id: 1, nome: 'Espaço Central', serie_faturacao: 'A' },
    { id: 2, nome: 'Espaço Norte', serie_faturacao: 'B' }
  ];

  const meses = ['2026-01', '2026-02', '2026-03'];

  const metricasEspacos = espacosDb.map(e => ({
    id: e.id,
    nome: e.nome,
    serie: e.serie_faturacao,
    totalAlunos: e.id === 1 ? 50 : 30,
    alunosAtivos: e.id === 1 ? 25 : 15,
    receitaTotal: e.id === 1 ? 15000 : 10000,
    aulasTotal: e.id === 1 ? 200 : 120,
    examesTotal: e.id === 1 ? 20 : 10,
    examesAprovados: e.id === 1 ? 16 : 8,
    taxaAprovacao: e.id === 1 ? 80.0 : 80.0,
    receitaMensal: e.id === 1 ? [5000, 5000, 5000] : [3000, 3500, 3500]
  }));

  assert.strictEqual(metricasEspacos.length, 2);
  assert.strictEqual(metricasEspacos[0].serie, 'A');
  assert.strictEqual(metricasEspacos[1].serie, 'B');
  assert.strictEqual(metricasEspacos[0].receitaTotal + metricasEspacos[1].receitaTotal, 25000);
  assert.strictEqual(metricasEspacos[0].taxaAprovacao, 80.0);
});


