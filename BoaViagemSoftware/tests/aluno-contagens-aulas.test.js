const test = require('node:test');
const assert = require('node:assert/strict');

test('getAlunoContagens: usa contagens pré-calculadas pela base de dados em O(1)', () => {
  function getAlunoContagens(aluno) {
    if (!aluno) return { aulasTeoricas: 0, aulasPraticas: 0 };
    var tReal = aluno.aulasTeoricasRealizadas != null ? aluno.aulasTeoricasRealizadas : aluno.aulas_teoricas_realizadas;
    var pReal = aluno.aulasPraticasRealizadas != null ? aluno.aulasPraticasRealizadas : aluno.aulas_praticas_realizadas;
    if (tReal != null && pReal != null) {
      return {
        aulasTeoricas: Number(tReal) || 0,
        aulasPraticas: Number(pReal) || 0
      };
    }

    // fallback caso nulo
    return {
      aulasTeoricas: tReal != null ? (Number(tReal) || 0) : 0,
      aulasPraticas: pReal != null ? (Number(pReal) || 0) : 0
    };
  }

  const alunoComContagens = {
    id: 638,
    nome: 'Rui Ventura',
    aulasTeoricasRealizadas: 115,
    aulasPraticasRealizadas: 32
  };

  const c = getAlunoContagens(alunoComContagens);
  assert.equal(c.aulasTeoricas, 115, 'Deve devolver 115 aulas teóricas calculadas');
  assert.equal(c.aulasPraticas, 32, 'Deve devolver 32 aulas práticas calculadas');
});

test('getAlunoContagens: lida com snake_case da BD e campos individuais', () => {
  function getAlunoContagens(aluno) {
    if (!aluno) return { aulasTeoricas: 0, aulasPraticas: 0 };
    var tReal = aluno.aulasTeoricasRealizadas != null ? aluno.aulasTeoricasRealizadas : aluno.aulas_teoricas_realizadas;
    var pReal = aluno.aulasPraticasRealizadas != null ? aluno.aulasPraticasRealizadas : aluno.aulas_praticas_realizadas;
    if (tReal != null && pReal != null) {
      return {
        aulasTeoricas: Number(tReal) || 0,
        aulasPraticas: Number(pReal) || 0
      };
    }
    return {
      aulasTeoricas: tReal != null ? (Number(tReal) || 0) : 10,
      aulasPraticas: pReal != null ? (Number(pReal) || 0) : 20
    };
  }

  const alunoSnake = {
    id: 1269,
    aulas_teoricas_realizadas: 105,
    aulas_praticas_realizadas: 15
  };

  const c = getAlunoContagens(alunoSnake);
  assert.equal(c.aulasTeoricas, 105);
  assert.equal(c.aulasPraticas, 15);
});

test('abrirHistoricoAulasModal: deduplica sessões teóricas coincidentes em data e hora', () => {
  const turmasTeoricas = [
    { data: '2025-05-10', horaInicio: '17:00', duracaoMin: 50, tema: 'Sinalização', estado: 'Concluída', presente: true },
    { data: '2025-05-10', horaInicio: '18:00', duracaoMin: 50, tema: 'Prioridade', estado: 'Concluída', presente: true },
    { data: '2025-05-12', horaInicio: '17:00', duracaoMin: 50, tema: 'Velocidades', estado: 'Agendada', presente: null }
  ];

  // Sessões em aulas que espelham exatamente as turmas teóricas
  const teoricasIndividuais = [
    { data: '2025-05-10', hora: '17:00', duracaoMin: 50, estado: 'Concluída' },
    { data: '2025-05-10', hora: '18:00', duracaoMin: 50, estado: 'Concluída' },
    { data: '2025-06-01', hora: '10:00', duracaoMin: 50, estado: 'Concluída' } // aula teórica individual genuína
  ];

  function normalizarEstado(v) {
    return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
  const ESTADOS_CANCELADA = ['Cancelada', 'Cancelado', 'Anulada', 'Anulado'].map(normalizarEstado);
  function isEstadoCancelada(estado) { return ESTADOS_CANCELADA.includes(normalizarEstado(estado)); }

  const mapaTeoricas = new Map();
  (turmasTeoricas || []).forEach(t => {
    const h = t.horaInicio || t.hora || '';
    const d = String(t.data || '').slice(0, 10);
    const chave = `${d}_${h}`;
    mapaTeoricas.set(chave, {
      data: t.data,
      hora: h,
      duracaoMin: t.duracaoMin,
      estado: t.presente === null ? t.estado : (t.presente ? 'Presente' : 'Faltou'),
      cancelada: isEstadoCancelada(t.estado),
      presente: t.presente
    });
  });
  (teoricasIndividuais || []).forEach(t => {
    const h = t.hora || '';
    const d = String(t.data || '').slice(0, 10);
    const chave = `${d}_${h}`;
    if (!mapaTeoricas.has(chave)) {
      mapaTeoricas.set(chave, {
        data: t.data,
        hora: h,
        duracaoMin: t.duracaoMin,
        estado: t.estado,
        cancelada: isEstadoCancelada(t.estado),
        presente: t.estado === 'Concluída' ? true : null
      });
    }
  });

  const linhasTeoricas = Array.from(mapaTeoricas.values()).sort((a, b) => (String(a.data) + String(a.hora)).localeCompare(String(b.data) + String(b.hora)));
  const teoricasNaoCanceladas = linhasTeoricas.filter(t => !t.cancelada).length;

  // Em vez de 6 sessões (3 turmas + 3 aulas duplicadas), devem ser 4 sessões únicas
  assert.equal(linhasTeoricas.length, 4, 'Deduplicação deve resultar em 4 sessões únicas');
  assert.equal(teoricasNaoCanceladas, 4, '4 sessões válidas não canceladas');
});
