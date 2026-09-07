/* Core helpers e estado compartilhado do frontend. */
(function () {
  var state = {
    view: 'calendario',
    escolaAtual: null,
    usuarioAtual: null,
    config: null,
    alunos: [],
    instrutores: [],
    veiculos: [],
    aulas: [],
    turmasTeoricas: [],
    requisitos: [],
    pagamentos: [],
    contratos: [],
    escola: {},
    produtos: [],
    dashboard: null,
    search: { alunos: '', instrutores: '', veiculos: '', aulas: '', pagamentos: '', contratos: '' },
    filter: { alunos: 'Ativo', aulas: 'Todos' },
    calendario: { mesRef: new Date().toISOString().slice(0, 7) },
    contaCorrenteAtual: null,
    preInscricoes: [],
    examesMarcacoes: [],
    espacos: [],
    relatorios: { dadosAtuais: null, mapaAtual: [], esperaAtual: [] },
    estatisticas: null,
    revalidacoes: []
  };

  var CATEGORIAS_CONTA = ['Diversos', 'Exames teóricos', 'Exames práticos', 'Lições práticas', 'Lições teóricas'];

  var VIEW_META = {
    dashboard: { title: 'Dashboard', sub: 'Visão geral da atividade da escola' },
    calendario: { title: 'Calendário', sub: 'Agenda de aulas práticas e turmas teóricas' },
    aulas: { title: 'Aulas', sub: 'Agenda de formação teórica e prática' },
    alunos: { title: 'Alunos', sub: 'Candidatos a condutor inscritos na escola' },
    instrutores: { title: 'Instrutores', sub: 'Equipa pedagógica habilitada' },
    veiculos: { title: 'Veículos', sub: 'Frota de instrução e estado de manutenção' },
    pagamentos: { title: 'Pagamentos', sub: 'Faturação e cobranças aos alunos' },
    contratos: { title: 'Contratos', sub: 'Contratos de formação com condições personalizadas por aluno' },
    config: { title: 'Configuração', sub: 'Espaços da escola, preços de cartas e descontos por papel de utilizador' },
    preinscricoes: { title: 'Pré-inscrições', sub: 'Gestão de pré-inscrições e conversão para inscrição' },
    exames: { title: 'Marcação de exames', sub: 'Gestão de exames teóricos e práticos' },
    estatisticas: { title: 'Estatísticas', sub: 'Relatórios e gráficos de desempenho da escola' },
    revalidacoes: { title: 'Revalidações de Cartas', sub: 'Processos de renovação e revalidação de cartas (pagamentos não faturados fiscalmente)' }
  };

  async function api(method, url, body) {
    var res = await fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Sessão expirada');
    }
    var json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Erro no pedido');
    return json.data;
  }

  var _screenLoaderCount = 0;
  function showScreenLoader(msg) {
    _screenLoaderCount++;
    var el = document.getElementById('globalScreenLoader');
    if (el) {
      if (msg) {
        var textEl = document.getElementById('globalScreenLoaderText');
        if (textEl) textEl.textContent = msg;
      }
      el.classList.add('active');
    }
  }

  function hideScreenLoader(force) {
    if (force) _screenLoaderCount = 0;
    else _screenLoaderCount = Math.max(0, _screenLoaderCount - 1);

    if (_screenLoaderCount === 0) {
      var el = document.getElementById('globalScreenLoader');
      if (el) el.classList.remove('active');
    }
  }

  async function withScreenLoader(fnOrPromise, msg) {
    showScreenLoader(msg);
    try {
      if (typeof fnOrPromise === 'function') {
        return await fnOrPromise();
      }
      return await fnOrPromise;
    } finally {
      hideScreenLoader();
    }
  }

  function toast(msg, type) {
    if (type === undefined) type = 'success';
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  document.getElementById('btnLogout').addEventListener('click', async function () {
    try { await api('POST', '/api/auth/logout'); } catch (e) {}
    window.location.href = '/login.html';
  });

  async function fetchCollectionAll(path, options) {
    var limit = Math.max(1, Number((options && options.limit) || 500));
    var maxPages = Number((options && options.maxPages) || 200);
    var offset = 0;
    var rows = [];
    var pageCount = 0;

    while (pageCount < maxPages) {
      var page = await api('GET', path + '?limit=' + limit + '&offset=' + offset);
      if (!Array.isArray(page) || !page.length) break;
      rows = rows.concat(page);
      if (page.length < limit) break;
      offset += page.length;
      pageCount += 1;
    }

    return rows;
  }

  async function loadAll() {
    var auth = await api('GET', '/api/auth/me');
    var config = null;
    if (auth.user && auth.user.role === 'super') {
      try { config = await api('GET', '/api/config'); } catch (err) { config = null; }
    }

    var results = await Promise.all([
      fetchCollectionAll('/api/alunos', { limit: 500, maxPages: 200 }),
      api('GET', '/api/instrutores'),
      api('GET', '/api/veiculos'),
      fetchCollectionAll('/api/aulas', { limit: 500, maxPages: 200 }),
      fetchCollectionAll('/api/turmasTeoricas', { limit: 500, maxPages: 200 }),
      api('GET', '/api/requisitos'),
      fetchCollectionAll('/api/pagamentos', { limit: 500, maxPages: 200 }),
      fetchCollectionAll('/api/contratos', { limit: 500, maxPages: 200 }),
      fetchCollectionAll('/api/preinscricoes', { limit: 500, maxPages: 200 }),
      fetchCollectionAll('/api/examesMarcacoes', { limit: 500, maxPages: 200 }),
      api('GET', '/api/espacos'),
      api('GET', '/api/produtos'),
      api('GET', '/api/escola'),
      api('GET', '/api/dashboard')
    ]);
    var alunos = results[0];
    var instrutores = results[1];
    var veiculos = results[2];
    var aulas = results[3];
    var turmasTeoricas = results[4];
    var requisitos = results[5];
    var pagamentos = results[6];
    var contratos = results[7];
    var preInscricoes = results[8];
    var examesMarcacoes = results[9];
    var espacos = results[10];
    var produtos = results[11];
    var escola = results[12];
    var dashboard = results[13];

    Object.assign(state, {
      escolaAtual: auth.escola,
      usuarioAtual: auth.user,
      config: config,
      alunos: alunos,
      instrutores: instrutores,
      veiculos: veiculos,
      aulas: aulas,
      turmasTeoricas: turmasTeoricas,
      requisitos: requisitos,
      pagamentos: pagamentos,
      contratos: contratos,
      preInscricoes: preInscricoes,
      examesMarcacoes: examesMarcacoes,
      espacos: espacos,
      produtos: produtos,
      escola: escola,
      dashboard: dashboard
    });
    rebuildIndexes();
    if (auth.user && auth.user.role === 'instrutor') {
      state.calendario.instrutorId = auth.user.instrutorId || (instrutores[0] && instrutores[0].id) || null;
    }
  }

  var _alunosMap = new Map();
  var _instrutoresMap = new Map();
  var _veiculosMap = new Map();

  function rebuildIndexes() {
    _alunosMap.clear();
    (state.alunos || []).forEach(function (a) {
      if (a && a.id != null) _alunosMap.set(Number(a.id), a);
    });
    _instrutoresMap.clear();
    (state.instrutores || []).forEach(function (i) {
      if (i && i.id != null) _instrutoresMap.set(Number(i.id), i);
    });
    _veiculosMap.clear();
    (state.veiculos || []).forEach(function (v) {
      if (v && v.id != null) _veiculosMap.set(Number(v.id), v);
    });
  }

  function findAluno(id) {
    if (id == null) return undefined;
    var numId = Number(id);
    if (_alunosMap.has(numId)) return _alunosMap.get(numId);
    return state.alunos.find(function (a) { return a.id === id || a.id === numId; });
  }

  function findInstrutor(id) {
    if (id == null) return undefined;
    var numId = Number(id);
    if (_instrutoresMap.has(numId)) return _instrutoresMap.get(numId);
    return state.instrutores.find(function (i) { return i.id === id || i.id === numId; });
  }

  function findVeiculo(id) {
    if (id == null) return undefined;
    var numId = Number(id);
    if (_veiculosMap.has(numId)) return _veiculosMap.get(numId);
    return state.veiculos.find(function (v) { return v.id === id || v.id === numId; });
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay || 250);
    };
  }

  function getEspacoNomeById(id) { return (state.espacos.find(function (e) { return e.id === id; }) || {}).nome || '—'; }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function badgeClass(estado) {
    var slug = String(estado || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return 'badge badge-' + slug;
  }
  function fmtMoney(v) { return (Number(v) || 0).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); }
  function fmtDate(d) {
    if (!d) return '—';
    var datePart = String(d).slice(0, 10);
    var parts = datePart.split('-');
    if (parts.length !== 3) return '—';
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  function fmtHorasMin(horasDecimal) {
    var totalMin = Math.round((Number(horasDecimal) || 0) * 60);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0 && m > 0) return h + 'h ' + m + 'min';
    if (h > 0) return h + 'h';
    return m + 'min';
  }
  function getAlunoNomePorId(id) {
    var a = findAluno(id);
    return a ? a.nome : '';
  }

  /* ---------- Normalização de tipo/estado (mesma lógica do backend) ----------
     A contagem de aulas teóricas/práticas por aluno (getAlunoContagens) estava
     a comparar `a.tipo === 'Teórica'` / `a.estado === 'Concluída'` de forma
     estrita. Qualquer variação de acentuação, maiúsculas/minúsculas ou grafia
     gravada na BD ("pratica", "Concluido", "concluída" sem acento, etc.)
     fazia com que essas aulas fossem silenciosamente excluídas da contagem
     apresentada nos cartões/listas de alunos — mesmo estando corretamente
     registadas. Esta normalização replica exatamente a lógica já corrigida
     no servidor (isTipo / isEstadoConcluida), para que a contagem mostrada
     no ecrã seja sempre consistente com a dos relatórios do backend. */
  var ESTADOS_CONCLUIDA = ['Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído'];
  var ESTADOS_CANCELADA = ['Cancelada', 'Cancelado', 'Anulada', 'Anulado'];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
  function isTipo(item, tipoAlvo) {
    return normalizeText(item && item.tipo) === normalizeText(tipoAlvo);
  }
  var ESTADOS_CONCLUIDA_NORM = ESTADOS_CONCLUIDA.map(normalizeText);
  function isEstadoConcluida(estado) {
    return ESTADOS_CONCLUIDA_NORM.indexOf(normalizeText(estado)) !== -1;
  }
  var ESTADOS_CANCELADA_NORM = ESTADOS_CANCELADA.map(normalizeText);
  function isEstadoCancelada(estado) {
    return ESTADOS_CANCELADA_NORM.indexOf(normalizeText(estado)) !== -1;
  }

  function getAlunoContagens(aluno) {
    if (!aluno) return { aulasTeoricas: 0, aulasPraticas: 0 };
    // Se o registo já tem os valores calculados na query SQL, usa-os diretamente em O(1)
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

    var alunoId = Number(aluno.id);

    var aulasTeoricasIndividuais = state.aulas.filter(function (a) {
      return a.alunoId === alunoId && isTipo(a, 'Teórica') && !isEstadoCancelada(a.estado);
    }).length;

    var aulasTeoricasTurmas = state.turmasTeoricas.filter(function (t) {
      return (t.inscritos || []).includes(alunoId) && !isEstadoCancelada(t.estado) && (t.presencas || {})[alunoId] === true;
    }).length;

    var aulasTeoricas = aulasTeoricasIndividuais + aulasTeoricasTurmas;

    var aulasPraticas = state.aulas.filter(function (a) {
      return a.alunoId === alunoId && isTipo(a, 'Prática') && !isEstadoCancelada(a.estado);
    }).length;

    return { aulasTeoricas: aulasTeoricas, aulasPraticas: aulasPraticas };
  }

  function getAlunosAtivos() {
    return state.alunos.filter(function (a) { return a.estado === 'Ativo' || !a.estado; });
  }
  function renderAlunoPickerHtml(selectedId, options) {
    options = options || {};
    var label = options.label || 'Aluno';
    var required = options.required !== false;
    var hint = options.hint || 'Podes escolher da lista ou escrever o nome completo.';
    var selectedNome = getAlunoNomePorId(selectedId);
    var alunosDisponiveis = getAlunosAtivos();
    return '<div class="form-field full">' +
      '<label>' + esc(label) + '</label>' +
      '<input name="alunoNome" list="alunosList" ' + (required ? 'required' : '') + ' value="' + esc(selectedNome) + '" placeholder="Escreve o nome completo..." autocomplete="off">' +
      '<input type="hidden" name="alunoId" value="' + (selectedId || '') + '">' +
      '<datalist id="alunosList">' +
      (alunosDisponiveis.length ? alunosDisponiveis.map(function (a) { return '<option value="' + esc(a.nome) + '"></option>'; }).join('') : state.alunos.map(function (a) { return '<option value="' + esc(a.nome) + '"></option>'; }).join('')) +
      '</datalist>' +
      '<div class="muted" style="font-size:12px; margin-top:4px">' + esc(hint) + '</div>' +
      '</div>';
  }
  function bindAlunoPicker(form) {
    var input = form.querySelector('[name="alunoNome"]');
    var hidden = form.querySelector('[name="alunoId"]');
    if (!input || !hidden) return;
    var sync = function () {
      var nome = input.value.trim().toLowerCase();
      var aluno = state.alunos.find(function (a) { return String(a.nome || '').trim().toLowerCase() === nome; });
      hidden.value = aluno ? aluno.id : '';
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
  }
  function diasAte(dataISO) {
    if (!dataISO) return null;
    var hoje = new Date(new Date().toISOString().slice(0, 10));
    return Math.round((new Date(dataISO) - hoje) / 86400000);
  }
  function estadoValidade(dataISO, limiteDias) {
    if (limiteDias === undefined) limiteDias = 30;
    var dias = diasAte(dataISO);
    if (dias === null) return null;
    if (dias < 0) return 'expirado';
    if (dias <= limiteDias) return 'a_expirar';
    return 'valido';
  }
  function selosValidade(dataISO, rotulo) {
    var est = estadoValidade(dataISO);
    if (est === 'expirado') return '<span class="tag tag-danger" title="' + esc(rotulo) + ': expirado">⚠ ' + esc(rotulo) + ' expirado</span>';
    if (est === 'a_expirar') return '<span class="tag tag-warning" title="' + esc(rotulo) + ': a expirar">⚠ ' + esc(rotulo) + ' a expirar</span>';
    return '';
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  function canAccessView(view) {
    var role = state.usuarioAtual && state.usuarioAtual.role;
    if (!role) return false;
    if (role === 'super') return true;
    if (role === 'admin') return view !== 'config';
    if (role === 'instrutor') return ['calendario', 'veiculos', 'instrutores', 'alunos', 'preinscricoes', 'exames'].includes(view);
    if (role === 'aluno') return ['dashboard', 'calendario', 'aulas', 'alunos'].includes(view);
    return false;
  }

  function renderNavItems() {
    var revalAtivo = localStorage.getItem('bv_modulo_revalidacoes_ativo') === 'true';
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      if (btn.id === 'navItemRevalidacoes') {
        btn.style.display = (revalAtivo && canAccessView('revalidacoes')) ? '' : 'none';
        return;
      }
      btn.style.display = canAccessView(btn.dataset.view) ? '' : 'none';
    });
    document.querySelectorAll('.nav-group').forEach(function (group) {
      var temVisivel = Array.from(group.querySelectorAll('.nav-item')).some(function (btn) { return btn.style.display !== 'none'; });
      group.style.display = temVisivel ? '' : 'none';
    });
  }

  async function switchView(view) {
    if (!canAccessView(view)) {
      toast('Não tens permissão para aceder a esta área.', 'error');
      return;
    }
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var targetSec = document.getElementById('view-' + view);
    if (targetSec) targetSec.classList.add('active');
    if (VIEW_META[view]) {
      document.getElementById('viewTitle').textContent = VIEW_META[view].title;
      document.getElementById('viewSubtitle').textContent = VIEW_META[view].sub;
    }

    var precisaBloquear = window.isViewDataLoaded ? !window.isViewDataLoaded(view) : true;
    if (precisaBloquear) {
      showScreenLoader('A carregar ' + (VIEW_META[view]?.title || 'dados') + '…');
    }
    try {
      await ensureViewData(view);
    } finally {
      if (precisaBloquear) hideScreenLoader();
    }
    renderTopbarActions(view);
    render(view);
  }

  function renderTopbarActions(view) {
    var box = document.getElementById('topbarActions');
    box.innerHTML = '';
    var isInstructor = state.usuarioAtual && state.usuarioAtual.role === 'instrutor';
    var map = {
      alunos: { label: '+ Novo Aluno', fn: function () { openAlunoForm(); } },
      instrutores: { label: '+ Novo Instrutor', fn: function () { openInstrutorForm(); } },
      veiculos: { label: '+ Novo Veículo', fn: function () { openVeiculoForm(); } },
      contratos: { label: '+ Novo Contrato', fn: function () { openContratoForm(); } },
      revalidacoes: { label: '+ Nova Revalidação', fn: function () { if (typeof openRevalidacaoForm === 'function') openRevalidacaoForm(); } }
    };
    if (map[view] && (state.usuarioAtual && state.usuarioAtual.role !== 'instrutor' || ['aulas', 'alunos', 'instrutores', 'veiculos', 'contratos', 'exames'].includes(view))) {
      var b = document.createElement('button');
      b.className = 'btn btn-accent';
      b.textContent = map[view].label;
      b.onclick = map[view].fn;
      box.appendChild(b);
    }
    if (view === 'pagamentos' && !isInstructor) {
      var bCaixa = document.createElement('button');
      bCaixa.className = 'btn btn-ghost';
      bCaixa.style.marginRight = '8px';
      bCaixa.innerHTML = '<span class="icon">🖨️</span> Imprimir Folha de Caixa';
      bCaixa.onclick = function () {
        if (typeof abrirModalFolhaCaixa === 'function') abrirModalFolhaCaixa();
      };
      box.appendChild(bCaixa);

      var b2 = document.createElement('button');
      b2.className = 'btn btn-accent';
      b2.textContent = '+ Novo Pagamento';
      b2.onclick = function () { openPagamentoForm(); };
      box.appendChild(b2);
    }
    if (view === 'exames') {
      var b3 = document.createElement('button');
      b3.className = 'btn btn-accent';
      b3.textContent = '+ Nova marcação';
      b3.onclick = function () {
        var form = document.getElementById('examesForm');
        if (form) {
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          form.querySelector('select[name="alunoId"]') && form.querySelector('select[name="alunoId"]').focus();
        }
      };
      box.appendChild(b3);
    }
    if (view === 'aulas') {
      var b4 = document.createElement('button');
      b4.className = 'btn btn-ghost';
      b4.textContent = '+ Aula prática';
      b4.onclick = function () { openAulaForm(); };
      var b5 = document.createElement('button');
      b5.className = 'btn btn-accent';
      b5.textContent = '+ Turma teórica';
      b5.onclick = function () { openTurmaTeoricaForm(); };
      box.appendChild(b4);
      box.appendChild(b5);
    }
  }

  function render(view) {
    view = view || state.view;
    var fns = {
      dashboard: renderDashboard,
      calendario: window.renderCalendario || (typeof renderCalendario !== 'undefined' ? renderCalendario : null),
      aulas: window.renderAulas || (typeof renderAulas !== 'undefined' ? renderAulas : null),
      alunos: window.renderAlunos || (typeof renderAlunos !== 'undefined' ? renderAlunos : null),
      instrutores: window.renderInstrutores || (typeof renderInstrutores !== 'undefined' ? renderInstrutores : null),
      veiculos: window.renderVeiculos || (typeof renderVeiculos !== 'undefined' ? renderVeiculos : null),
      pagamentos: window.renderPagamentos || (typeof renderPagamentos !== 'undefined' ? renderPagamentos : null),
      contratos: window.renderContratos || (typeof renderContratos !== 'undefined' ? renderContratos : null),
      config: window.renderConfig || (typeof renderConfig !== 'undefined' ? renderConfig : null),
      preinscricoes: window.renderPreInscricoes || (typeof renderPreInscricoes !== 'undefined' ? renderPreInscricoes : null),
      exames: window.renderExamesMarcacoes || (typeof renderExamesMarcacoes !== 'undefined' ? renderExamesMarcacoes : null),
      estatisticas: window.renderEstatisticas || (typeof renderEstatisticas !== 'undefined' ? renderEstatisticas : null),
      revalidacoes: window.renderRevalidacoes || (typeof renderRevalidacoes !== 'undefined' ? renderRevalidacoes : null)
    };
    var fn = fns[view];
    if (fn) fn();
  }

  function renderDashboard() {
    var d = state.dashboard;
    var el = document.getElementById('view-dashboard');
    if (!d) { el.innerHTML = ''; return; }

    el.innerHTML = [
      '<div class="stat-grid">',
      '<div class="stat-card">',
      '<div class="stat-top"><div class="stat-icon tone-accent">◍</div></div>',
      '<div class="stat-value">' + d.alunosAtivos + '</div>',
      '<div class="stat-label">Alunos ativos · ' + d.totalAlunos + ' no total</div>',
      '</div>',
      '<div class="stat-card">',
      '<div class="stat-top"><div class="stat-icon tone-info">◷</div></div>',
      '<div class="stat-value">' + d.aulasHoje + '</div>',
      '<div class="stat-label">Aulas agendadas para hoje</div>',
      '</div>',
      '<div class="stat-card">',
      '<div class="stat-top"><div class="stat-icon tone-success">◈</div></div>',
      '<div class="stat-value">' + fmtMoney(d.receitaMes) + '</div>',
      '<div class="stat-label">Receita registada (pagamentos)</div>',
      '</div>',
      '<div class="stat-card">',
      '<div class="stat-top"><div class="stat-icon tone-warn">▤</div></div>',
      '<div class="stat-value">' + d.veiculosDisponiveis + '/' + d.totalVeiculos + '</div>',
      '<div class="stat-label">Veículos disponíveis</div>',
      '</div>',
      '</div>',
      '<div class="panel-grid">',
      '<div class="panel">',
      '<div class="panel-head">',
      '<h3>Alertas prioritários</h3>',
      '</div>',
      (d.alertas && d.alertas.length ? d.alertas.map(function (a) {
        return '<div class="agenda-item"><div class="agenda-info"><div class="name">' + esc(a.tipo) + '</div><div class="sub">' + esc(a.texto) + '</div></div><span class="tag ' + (a.gravidade === 'alta' ? 'tag-danger' : 'tag-warning') + '">' + (a.gravidade === 'alta' ? 'Urgente' : 'Atenção') + '</span></div>';
      }).join('') : emptyState('Sem alertas', 'Não há documentos a expirar nem limites excedidos de momento.')),
      '</div>',
      '<div class="panel">',
      '<div class="panel-head">',
      '<h3>Próximas aulas</h3>',
      '<button class="btn btn-ghost btn-sm" onclick="switchView(\'aulas\')">Ver agenda completa</button>',
      '</div>',
      (d.proximasAulas.length ? d.proximasAulas.map(function (a) {
        return '<div class="agenda-item"><div class="agenda-time">' + a.hora + '</div><div class="agenda-info"><div class="name">' + esc(a.alunoNome) + '</div><div class="sub">' + esc(a.instrutorNome) + ' · ' + (a.veiculoMatricula !== '—' ? esc(a.veiculoMatricula) : 'Sem viatura') + ' · ' + fmtDate(a.data) + '</div></div><span class="' + badgeClass(a.tipo) + '">' + esc(a.tipo) + '</span></div>';
      }).join('') : emptyState('Sem aulas agendadas', 'Cria uma nova aula para preencher a agenda.')),
      '</div>',
      '<div class="panel">',
      '<div class="panel-head"><h3>Estado financeiro</h3></div>',
      '<div class="agenda-item"><div class="agenda-info"><div class="name">Total cobrado</div><div class="sub">Pagamentos com estado "Pago"</div></div><div class="stat-value" style="font-size:18px">' + fmtMoney(d.receitaMes) + '</div></div>',
      '<div class="agenda-item"><div class="agenda-info"><div class="name">Pendente de cobrança</div><div class="sub">Pagamentos por regularizar</div></div><div class="stat-value" style="font-size:18px; color: var(--danger)">' + fmtMoney(d.pagamentosPendentes) + '</div></div>',
      '<div class="agenda-item"><div class="agenda-info"><div class="name">Equipa pedagógica</div><div class="sub">Instrutores ativos</div></div><div class="stat-value" style="font-size:18px">' + d.instrutoresAtivos + '</div></div>',
      '<div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border)"><p class="muted" style="line-height:1.6">Lembrete: mantém a ficha de inscrição e o registo de formação atualizados para consulta e inspeção pelo IMT.</p></div>',
      '</div>',
      '</div>'
    ].join('');
  }

  function emptyState(title, text) {
    return '<div class="empty-state"><h4>' + esc(title) + '</h4><p>' + esc(text) + '</p></div>';
  }

  var _searchDebounceTimers = {};
  function updateSearchAndRerender(inputEl, chave, renderFn) {
    if (_searchDebounceTimers[chave]) clearTimeout(_searchDebounceTimers[chave]);
    var valor = inputEl ? inputEl.value : '';
    state.search[chave] = valor;
    _searchDebounceTimers[chave] = setTimeout(function () {
      var isFocused = inputEl && (document.activeElement === inputEl);
      var start = inputEl ? inputEl.selectionStart : null;
      var end = inputEl ? inputEl.selectionEnd : null;
      var inputId = inputEl ? inputEl.id : null;

      renderFn();

      if (isFocused) {
        var restoredInput = inputId ? document.getElementById(inputId) : null;
        if (!restoredInput && chave) {
          restoredInput = document.querySelector('[oninput*="\'' + chave + '\'"]');
        }
        if (restoredInput) {
          restoredInput.focus();
          if (start !== null && end !== null && typeof restoredInput.setSelectionRange === 'function') {
            try { restoredInput.setSelectionRange(start, end); } catch (e) {}
          }
        }
      }
    }, 300);
  }

  window.showScreenLoader = showScreenLoader;
  window.hideScreenLoader = hideScreenLoader;
  window.withScreenLoader = withScreenLoader;
  window.state = state;
  window.CATEGORIAS_CONTA = CATEGORIAS_CONTA;
  window.VIEW_META = VIEW_META;
  window.api = api;
  window.toast = toast;
  window.fetchCollectionAll = fetchCollectionAll;
  window.loadAll = loadAll;
  window.findAluno = findAluno;
  window.findInstrutor = findInstrutor;
  window.findVeiculo = findVeiculo;
  window.getEspacoNomeById = getEspacoNomeById;
  window.esc = esc;
  window.badgeClass = badgeClass;
  window.fmtMoney = fmtMoney;
  window.fmtDate = fmtDate;
  window.fmtHorasMin = fmtHorasMin;
  window.getAlunoNomePorId = getAlunoNomePorId;
  window.getAlunoContagens = getAlunoContagens;
  window.getAlunosAtivos = getAlunosAtivos;
  window.renderAlunoPickerHtml = renderAlunoPickerHtml;
  window.bindAlunoPicker = bindAlunoPicker;
  window.diasAte = diasAte;
  window.estadoValidade = estadoValidade;
  window.selosValidade = selosValidade;
  window.canAccessView = canAccessView;
  window.renderNavItems = renderNavItems;
  window.switchView = switchView;
  window.renderTopbarActions = renderTopbarActions;
  window.render = render;
  window.renderDashboard = renderDashboard;
  window.emptyState = emptyState;
  window.updateSearchAndRerender = updateSearchAndRerender;
  window.rebuildIndexes = rebuildIndexes;
  window.debounce = debounce;
})();