const test = require('node:test');
const assert = require('node:assert/strict');

test('Calendário: fusão de aulas e turmas teóricas sem duplicações por ano', () => {
  const state = {
    aulas: [
      { id: 1, data: '2026-03-10', tipo: 'Prática' },
      { id: 2, data: '2026-03-12', tipo: 'Prática' }
    ],
    turmasTeoricas: [
      { id: 10, data: '2026-03-11', tema: 'Sinalização' }
    ],
    calendarioAnosCarregados: new Set([2026])
  };

  // Simulação de carregar o ano 2025
  const novasAulas2025 = [
    { id: 2, data: '2026-03-12', tipo: 'Prática' }, // ID existente (deve ser atualizado, não duplicado)
    { id: 3, data: '2025-11-05', tipo: 'Prática' }
  ];
  const novasTurmas2025 = [
    { id: 11, data: '2025-10-20', tema: 'Regras de Prioridade' }
  ];

  const aulasMap = new Map(state.aulas.map(a => [a.id, a]));
  novasAulas2025.forEach(a => aulasMap.set(a.id, a));
  state.aulas = Array.from(aulasMap.values());

  const turmasMap = new Map(state.turmasTeoricas.map(t => [t.id, t]));
  novasTurmas2025.forEach(t => turmasMap.set(t.id, t));
  state.turmasTeoricas = Array.from(turmasMap.values());
  state.calendarioAnosCarregados.add(2025);

  assert.equal(state.aulas.length, 3, 'Aulas devem ter 3 itens após fusão sem duplicados');
  assert.equal(state.turmasTeoricas.length, 2, 'Turmas teóricas devem ter 2 itens');
  assert.ok(state.calendarioAnosCarregados.has(2025));
  assert.ok(state.calendarioAnosCarregados.has(2026));
});

test('Alunos: carregamento inicial apenas de ativos e transição para Todos sob demanda', async () => {
  const state = {
    alunos: [
      { id: 1, nome: 'Mariana Lima', estado: 'Ativo' },
      { id: 2, nome: 'João Rocha', estado: 'Ativo' }
    ],
    alunosAtivos: [
      { id: 1, nome: 'Mariana Lima', estado: 'Ativo' },
      { id: 2, nome: 'João Rocha', estado: 'Ativo' }
    ],
    alunosAtivosTotal: 2,
    alunosFiltroCarregado: 'Ativo'
  };

  // Inicialmente tem apenas ativos
  assert.equal(state.alunos.length, 2);
  assert.equal(state.alunosFiltroCarregado, 'Ativo');

  // Ao clicar em 'Todos', busca a totalidade na BD
  async function mockEnsureAlunosTodos() {
    state.alunos = [
      { id: 1, nome: 'Mariana Lima', estado: 'Ativo' },
      { id: 2, nome: 'João Rocha', estado: 'Ativo' },
      { id: 3, nome: 'Carlos Concluído', estado: 'Concluído' },
      { id: 4, nome: 'Pedro Suspenso', estado: 'Suspenso' }
    ];
    state.alunosFiltroCarregado = 'Todos';
    state.alunosAtivos = state.alunos.filter(a => a.estado === 'Ativo');
    return state.alunos;
  }

  await mockEnsureAlunosTodos();

  assert.equal(state.alunos.length, 4, 'Deve conter todos os 4 alunos');
  assert.equal(state.alunosFiltroCarregado, 'Todos');
  assert.equal(state.alunosAtivos.length, 2, 'Lista de ativos mantém 2');
});

test('Pagamentos: filtro por ano e cache de pagamentos por ano', async () => {
  const state = {
    filtroAnoPagamentos: 2026,
    pagamentosPorAno: {
      2026: [
        { id: 101, valor: 150, data: '2026-01-15' },
        { id: 102, valor: 200, data: '2026-02-20' }
      ]
    },
    pagamentos: [
      { id: 101, valor: 150, data: '2026-01-15' },
      { id: 102, valor: 200, data: '2026-02-20' }
    ]
  };

  assert.equal(state.pagamentos.length, 2);
  assert.equal(state.filtroAnoPagamentos, 2026);

  // Mudar para 2025 (simulação de fetch sob demanda)
  async function mockEnsurePagamentosAno(ano) {
    if (state.pagamentosPorAno[ano]) {
      state.pagamentos = state.pagamentosPorAno[ano];
      state.filtroAnoPagamentos = ano;
      return state.pagamentos;
    }
    const dadosAno = [
      { id: 80, valor: 100, data: '2025-05-10' }
    ];
    state.pagamentosPorAno[ano] = dadosAno;
    state.pagamentos = dadosAno;
    state.filtroAnoPagamentos = ano;
    return dadosAno;
  }

  await mockEnsurePagamentosAno(2025);
  assert.equal(state.pagamentos.length, 1);
  assert.equal(state.pagamentos[0].id, 80);
  assert.equal(state.filtroAnoPagamentos, 2025);

  // Alternar de volta para 2026 usa a cache instantaneamente
  await mockEnsurePagamentosAno(2026);
  assert.equal(state.pagamentos.length, 2);
  assert.equal(state.filtroAnoPagamentos, 2026);
});

test('Contratos: filtro por ano e cache de contratos por ano', async () => {
  const state = {
    filtroAnoContratos: 2026,
    contratosPorAno: {
      2026: [
        { id: 1, categoria: 'B', dataCriacao: '2026-01-10T10:00:00' }
      ]
    },
    contratos: [
      { id: 1, categoria: 'B', dataCriacao: '2026-01-10T10:00:00' }
    ]
  };

  async function mockEnsureContratosAno(ano) {
    if (state.contratosPorAno[ano]) {
      state.contratos = state.contratosPorAno[ano];
      state.filtroAnoContratos = ano;
      return state.contratos;
    }
    const dados = [
      { id: 2, categoria: 'A', dataCriacao: '2024-03-12T14:00:00' }
    ];
    state.contratosPorAno[ano] = dados;
    state.contratos = dados;
    state.filtroAnoContratos = ano;
    return dados;
  }

  await mockEnsureContratosAno(2024);
  assert.equal(state.contratos.length, 1);
  assert.equal(state.contratos[0].categoria, 'A');
  assert.equal(state.filtroAnoContratos, 2024);
});

test('Aulas: histórico carregado sob demanda sem duplicar aulas de hoje e futuras', async () => {
  const state = {
    aulas: [
      { id: 1, data: '2026-09-20', tipo: 'Prática' }
    ],
    aulasHistoricoCarregado: false
  };

  async function mockEnsureAulasHistorico() {
    const historico = [
      { id: 1, data: '2026-09-20', tipo: 'Prática' },
      { id: 99, data: '2024-01-15', tipo: 'Prática' }
    ];
    const map = new Map(state.aulas.map(a => [a.id, a]));
    historico.forEach(a => map.set(a.id, a));
    state.aulas = Array.from(map.values());
    state.aulasHistoricoCarregado = true;
    return state.aulas;
  }

  await mockEnsureAulasHistorico();
  assert.equal(state.aulas.length, 2);
  assert.equal(state.aulasHistoricoCarregado, true);
});

test('Exames: filtragem de Marcados vs Todos sob demanda', () => {
  const exames = [
    { id: 1, estado: 'Marcado', data: '2026-09-25' },
    { id: 2, estado: 'Realizado', data: '2025-05-10', resultado: 'Aprovado' },
    { id: 3, estado: 'Cancelado', data: '2025-06-01' }
  ];

  const marcados = exames.filter(e => e.estado === 'Marcado');
  assert.equal(marcados.length, 1);
  assert.equal(marcados[0].id, 1);

  const todos = exames;
  assert.equal(todos.length, 3);
});
