const test = require('node:test');
const assert = require('node:assert');

test('Pagamentos de revalidação: assinalados como não faturáveis e blindados contra faturação fiscal', () => {
  // Simulação da lógica de verificação de pagamento não faturável
  function podeEmitirFatura(pagamento) {
    if (!pagamento) return false;
    if (pagamento.naoFaturar || pagamento.nao_faturar) return false;
    const desc = String(pagamento.descricao || '').toLowerCase();
    if (desc.includes('revalidação') || desc.includes('revalidacao')) return false;
    return true;
  }

  const pagRevalComFlag = { id: 101, valor: 50, nao_faturar: 1, descricao: 'Revalidação de Carta B - João Silva' };
  assert.strictEqual(podeEmitirFatura(pagRevalComFlag), false, 'Pagamento com flag nao_faturar não pode ser faturado');

  const pagRevalComTexto = { id: 102, valor: 35, naoFaturar: true, descricao: 'Taxa Revalidação C e D' };
  assert.strictEqual(podeEmitirFatura(pagRevalComTexto), false, 'Pagamento com flag naoFaturar true não pode ser faturado');

  const pagNormal = { id: 103, valor: 250, descricao: 'Aulas práticas categoria B', estado: 'Pago' };
  assert.strictEqual(podeEmitirFatura(pagNormal), true, 'Pagamento de formação normal pode ser faturado');
});

test('Remoção de pagamento de revalidação: eliminado diretamente sem emissão de Nota de Crédito (NC)', () => {
  function processarRemocaoPagamento(atual) {
    if (atual.naoFaturar || atual.nao_faturar) {
      // Revalidações não faturadas são eliminadas diretamente
      return { apagado: true, convertedToNC: false };
    }
    const estaFaturado = !!(atual.faturacaoNumero || (atual.faturacao && atual.faturacao.numero));
    if (estaFaturado) {
      return { apagado: false, convertedToNC: true, message: 'Convertido em NC' };
    }
    return { apagado: true, convertedToNC: false };
  }

  const pagReval = { id: 50, valor: 50, nao_faturar: 1, descricao: 'Revalidação de Carta' };
  const resReval = processarRemocaoPagamento(pagReval);
  assert.strictEqual(resReval.apagado, true);
  assert.strictEqual(resReval.convertedToNC, false);

  const pagFaturado = { id: 51, valor: 300, faturacaoNumero: 'FT 2026/1', descricao: 'Pack' };
  const resFaturado = processarRemocaoPagamento(pagFaturado);
  assert.strictEqual(resFaturado.convertedToNC, true);
});

test('Contador de loader global: reference counting impede fecho prematuro', () => {
  let count = 0;
  let active = false;

  function show() {
    count++;
    active = true;
  }

  function hide(force = false) {
    if (force) count = 0;
    else count = Math.max(0, count - 1);
    if (count === 0) active = false;
  }

  // Dois processos em paralelo
  show(); // Processo 1
  show(); // Processo 2
  assert.strictEqual(active, true);
  assert.strictEqual(count, 2);

  hide(); // Processo 1 termina
  assert.strictEqual(active, true, 'Loader ainda deve estar ativo porque o Processo 2 ainda corre');
  assert.strictEqual(count, 1);

  hide(); // Processo 2 termina
  assert.strictEqual(active, false, 'Loader deve desativar após todos os processos terminarem');
  assert.strictEqual(count, 0);

  // Forçar fecho
  show();
  show();
  hide(true);
  assert.strictEqual(active, false);
  assert.strictEqual(count, 0);
});

test('Cálculo de métricas do módulo de Revalidações', () => {
  const revalidacoes = [
    { id: 1, valor: 50, estadoProcesso: 'Registado' },
    { id: 2, valor: 75, estadoProcesso: 'Submetido no IMT' },
    { id: 3, valor: 50, estadoProcesso: 'Guia Provisória Emitida' },
    { id: 4, valor: 150, estadoProcesso: 'Concluído' }
  ];

  const total = revalidacoes.length;
  const totalValor = revalidacoes.reduce((acc, r) => acc + Number(r.valor), 0);
  const pendentes = revalidacoes.filter(r => r.estadoProcesso !== 'Concluído').length;
  const concluidos = revalidacoes.filter(r => r.estadoProcesso === 'Concluído').length;

  assert.strictEqual(total, 4);
  assert.strictEqual(totalValor, 325);
  assert.strictEqual(pendentes, 3);
  assert.strictEqual(concluidos, 1);
});

test('Fila sequencial de pré-carregamento (preloadIdle) enfileira itens sem duplicações', () => {
  const loaded = { dashboard: true, escola: true };
  const inFlight = {};
  const queue = [];

  function addToQueue(names) {
    const pendentes = names.filter(n => !loaded[n] && !inFlight[n] && !queue.includes(n));
    queue.push(...pendentes);
  }

  addToQueue(['alunos', 'instrutores', 'veiculos']);
  assert.deepStrictEqual(queue, ['alunos', 'instrutores', 'veiculos']);

  // Tentativa de adicionar repetidos e itens já carregados
  addToQueue(['dashboard', 'alunos', 'espacos']);
  assert.deepStrictEqual(queue, ['alunos', 'instrutores', 'veiculos', 'espacos']);
});
