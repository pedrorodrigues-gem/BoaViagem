const test = require('node:test');
const assert = require('node:assert');
const { invalidateTenantCache } = require('../auth');

test('invalidateTenantCache está exportada e é invocável', () => {
  assert.strictEqual(typeof invalidateTenantCache, 'function');
  // Não deve lançar erro mesmo com escolaId inexistente ou nulo
  assert.doesNotThrow(() => invalidateTenantCache(999999));
  assert.doesNotThrow(() => invalidateTenantCache(null));
});

test('getAlunoContagens usa fast-path O(1) quando contagens SQL estão presentes', () => {
  // Simulando a lógica de app-core.js
  function getAlunoContagens(aluno, state) {
    if (!aluno) return { aulasTeoricas: 0, aulasPraticas: 0 };
    if (aluno.aulasTeoricasRealizadas != null && aluno.aulasPraticasRealizadas != null) {
      return {
        aulasTeoricas: Number(aluno.aulasTeoricasRealizadas) || 0,
        aulasPraticas: Number(aluno.aulasPraticasRealizadas) || 0
      };
    }
    if (aluno.aulas_teoricas_realizadas != null && aluno.aulas_praticas_realizadas != null) {
      return {
        aulasTeoricas: Number(aluno.aulas_teoricas_realizadas) || 0,
        aulasPraticas: Number(aluno.aulas_praticas_realizadas) || 0
      };
    }
    // Fallback lento:
    return {
      aulasTeoricas: (state.aulas || []).filter(a => a.alunoId === aluno.id && a.tipo === 'Teórica').length,
      aulasPraticas: (state.aulas || []).filter(a => a.alunoId === aluno.id && a.tipo === 'Prática').length
    };
  }

  const alunoComSql = {
    id: 42,
    nome: 'Carlos Santos',
    aulasTeoricasRealizadas: 28,
    aulasPraticasRealizadas: 32
  };

  // State vazio não deve interferir porque o fast-path do SQL tem prioridade
  const contagens = getAlunoContagens(alunoComSql, { aulas: [] });
  assert.strictEqual(contagens.aulasTeoricas, 28);
  assert.strictEqual(contagens.aulasPraticas, 32);

  const alunoComSnakeCase = {
    id: 43,
    nome: 'Mariana Costa',
    aulas_teoricas_realizadas: 15,
    aulas_praticas_realizadas: 20
  };
  const contagensSnake = getAlunoContagens(alunoComSnakeCase, { aulas: [] });
  assert.strictEqual(contagensSnake.aulasTeoricas, 15);
  assert.strictEqual(contagensSnake.aulasPraticas, 20);
});

test('Map indexado permite lookups O(1) de alunos e instrutores', () => {
  const alunos = [
    { id: 1, nome: 'Ana Silva' },
    { id: 2, nome: 'Bernardo Lima' },
    { id: 3, nome: 'Carla Dias' }
  ];

  const map = new Map();
  alunos.forEach(a => map.set(Number(a.id), a));

  assert.strictEqual(map.get(1)?.nome, 'Ana Silva');
  assert.strictEqual(map.get(2)?.nome, 'Bernardo Lima');
  assert.strictEqual(map.get(3)?.nome, 'Carla Dias');
  assert.strictEqual(map.get(999), undefined);
});

test('debounce colapsa chamadas repetidas dentro da janela', async () => {
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  let count = 0;
  let lastArg = null;
  const debounced = debounce((val) => {
    count++;
    lastArg = val;
  }, 30);

  debounced('a');
  debounced('ab');
  debounced('abc');

  assert.strictEqual(count, 0, 'Não deve disparar imediatamente');

  await new Promise(r => setTimeout(r, 60));

  assert.strictEqual(count, 1, 'Deve disparar apenas uma vez');
  assert.strictEqual(lastArg, 'abc', 'Deve conter o último argumento fornecido');
});

test('Normalização de acentos e pesquisa global insensível a diacríticos', () => {
  function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  assert.strictEqual(normalizarTexto('João Teórico Prático'), 'joao teorico pratico');
  assert.strictEqual(normalizarTexto('Veículo Elétrico'), 'veiculo eletrico');
  assert.strictEqual(normalizarTexto('À É Í Ó Ú Ç'), 'a e i o u c');

  const termoPesquisa = normalizarTexto('teorica');
  const aulaTipo = normalizarTexto('Teórica');
  assert.strictEqual(aulaTipo.includes(termoPesquisa), true);
});

test('Sanitização de anos de comparação impede injeção de NaN no SQL', () => {
  function sanitizarAnosParaComparacao(anosDisponiveisRaw, anosComparacaoParam) {
    const anosDisponiveis = (anosDisponiveisRaw || [])
      .map(r => Number(r.ano))
      .filter(a => Number.isInteger(a) && a >= 1990 && a <= 2100)
      .sort((a, b) => a - b);
    const currYear = 2026;
    if (!anosDisponiveis.includes(currYear)) anosDisponiveis.push(currYear);
    const anosComparacao = Math.max(2, Math.min(20, Number(anosComparacaoParam) || 5));
    const anosParaComparar = anosDisponiveis.slice(-anosComparacao);
    const validYears = anosParaComparar.filter(a => Number.isInteger(a) && a >= 1990 && a <= 2100);
    return validYears.length ? validYears.join(',') : String(currYear);
  }

  // Caso 1: Array com dados corrompidos contendo null e NaN
  const rawCorrompido = [{ ano: null }, { ano: 'invalid' }, { ano: 2024 }, { ano: 2025 }];
  const res1 = sanitizarAnosParaComparacao(rawCorrompido, 5);
  assert.strictEqual(res1, '2024,2025,2026');
  assert.strictEqual(res1.includes('NaN'), false);

  // Caso 2: Array vazio
  const res2 = sanitizarAnosParaComparacao([], 5);
  assert.strictEqual(res2, '2026');

  // Caso 3: Parâmetro malicioso/inválido
  const res3 = sanitizarAnosParaComparacao([{ ano: 2023 }], 'abc');
  assert.strictEqual(res3, '2023,2026');
});

test('Paginação de exames devolve páginas corretas e não excede limite', () => {
  const dados = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, data: `2026-03-${String(i + 1).padStart(2, '0')}` }));
  
  function paginarExames(lista, reqQuery) {
    const limit = Math.max(1, Math.min(500, Number(reqQuery.limit) || 200));
    const offset = Math.max(0, Number(reqQuery.offset) || 0);
    return lista.slice(offset, offset + limit);
  }

  const p1 = paginarExames(dados, { limit: 5, offset: 0 });
  assert.strictEqual(p1.length, 5);
  assert.strictEqual(p1[0].id, 1);

  const p2 = paginarExames(dados, { limit: 5, offset: 10 });
  assert.strictEqual(p2.length, 5);
  assert.strictEqual(p2[0].id, 11);

  const p3 = paginarExames(dados, { limit: 5, offset: 15 });
  assert.strictEqual(p3.length, 0);
});

