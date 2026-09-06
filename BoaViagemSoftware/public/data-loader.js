(function () {
  if (typeof window.state === 'undefined') {
    console.error('data-loader.js: state não encontrado — carrega app-core.js primeiro.');
    return;
  }

  const COLLECTION_LOADERS = {
    alunos: () => window.fetchCollectionAll('/api/alunos', { limit: 500, maxPages: 30 }),
    instrutores: () => api('GET', '/api/instrutores'),
    veiculos: () => api('GET', '/api/veiculos'),
    aulas: () => window.fetchCollectionAll('/api/aulas', { limit: 500, maxPages: 30 }),
    turmasTeoricas: () => window.fetchCollectionAll('/api/turmasTeoricas', { limit: 500, maxPages: 30 }),
    requisitos: () => api('GET', '/api/requisitos'),
    pagamentos: () => window.fetchCollectionAll('/api/pagamentos', { limit: 500, maxPages: 30 }),
    contratos: () => window.fetchCollectionAll('/api/contratos', { limit: 500, maxPages: 30 }),
    preInscricoes: () => window.fetchCollectionAll('/api/preinscricoes', { limit: 500, maxPages: 30 }),
    examesMarcacoes: () => window.fetchCollectionAll('/api/examesMarcacoes', { limit: 500, maxPages: 30 }),
    espacos: () => api('GET', '/api/espacos'),
    produtos: () => api('GET', '/api/produtos'),
    escola: () => api('GET', '/api/escola'),
    dashboard: () => api('GET', '/api/dashboard'),
    config: () => api('GET', '/api/config')
  };

  const VIEW_DEPS = {
    dashboard: ['dashboard'],
    calendario: ['instrutores', 'veiculos', 'espacos'], // já não pede aulas/turmasTeoricas/alunos completos
    aulas: ['aulas', 'turmasTeoricas', 'alunos', 'instrutores', 'veiculos', 'espacos'], // esta vista continua a precisar (tabela histórica), mas pode ganhar o mesmo tratamento depois
    alunos: ['espacos'],
    instrutores: ['instrutores'],
    veiculos: ['veiculos'],
    pagamentos: ['pagamentos', 'alunos'],
    contratos: ['contratos', 'alunos', 'produtos', 'espacos', 'config'],
    config: ['espacos', 'produtos', 'config'],
    preinscricoes: ['preInscricoes', 'espacos'],
    exames: ['examesMarcacoes', 'alunos'],
    estatisticas: []
  };

  const PRELOAD_BASE = ['alunos', 'instrutores', 'veiculos', 'espacos', 'produtos'];

  const inFlight = {};
  const loaded = {};

  async function ensureCollection(name, opts) {
    opts = opts || {};
    if (!COLLECTION_LOADERS[name]) return state[name];
    if (loaded[name] && !opts.force) return state[name];
    if (inFlight[name] && !opts.force) return inFlight[name];

    const promise = COLLECTION_LOADERS[name]()
      .then((data) => {
        state[name] = data;
        loaded[name] = true;
        delete inFlight[name];
        if (name === 'alunos' || name === 'instrutores' || name === 'veiculos') {
          if (window.rebuildIndexes) window.rebuildIndexes();
        }
        return data;
      })
      .catch((err) => {
        delete inFlight[name];
        throw err;
      });

    inFlight[name] = promise;
    return promise;
  }

  function ensureCollections(names) {
    return Promise.allSettled(names.map((n) => ensureCollection(n))).then((results) => {
      const falhas = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          falhas.push(names[i]);
          if (state[names[i]] === undefined) state[names[i]] = [];
        }
      });
      if (falhas.length && typeof toast === 'function') {
        toast('Não foi possível carregar: ' + falhas.join(', ') + '.', 'error');
      }
      return results;
    });
  }

  function refreshCollections(names) {
    return Promise.all(names.map((n) => ensureCollection(n, { force: true })));
  }

  function isLoaded(name) {
    return !!loaded[name];
  }

  /* ---------- Alunos ativos: carregamento rápido e isolado ----------
     Não usa fetchCollectionAll (que insiste em trazer TUDO) — pede só
     os alunos com estado=Ativo, já com paginação no servidor. Isto é o
     que a vista "Alunos" mostra por omissão, por isso tem de ser o mais
     rápido possível a aparecer no ecrã. */
  let alunosAtivosLoaded = false;
  let alunosAtivosPromise = null;

  async function ensureAlunosAtivos(opts) {
    opts = opts || {};
    if (alunosAtivosLoaded && !opts.force) return state.alunosAtivos;
    if (alunosAtivosPromise && !opts.force) return alunosAtivosPromise;

    alunosAtivosPromise = api('GET', '/api/alunos/lista?estado=Ativo&limit=200')
      .then((res) => {
        state.alunosAtivos = res.alunos;
        state.alunosAtivosTotal = res.total;
        alunosAtivosLoaded = true;
        alunosAtivosPromise = null;
        // Se a coleção completa 'alunos' ainda não estiver carregada,
        // usa já estes ativos como base provisória — a vista não fica vazia
        // enquanto a coleção completa (todos os estados) chega em segundo plano.
        if (!loaded.alunos) {
          state.alunos = res.alunos;
        }
        if (window.rebuildIndexes) window.rebuildIndexes();
        return res.alunos;
      })
      .catch((err) => {
        alunosAtivosPromise = null;
        throw err;
      });
    return alunosAtivosPromise;
  }

  /* ---------- Preload em segundo plano ---------- */
  let preloadScheduled = false;
  function preloadIdle(names) {
    const pendentes = names.filter((n) => !loaded[n] && !inFlight[n]);
    if (!pendentes.length) return;
    const run = () => {
      preloadScheduled = false;
      pendentes.forEach((n) => ensureCollection(n).catch(() => {}));
    };
    if (preloadScheduled) return;
    preloadScheduled = true;
    if ('requestIdleCallback' in window) {
      requestIdleCallback(run, { timeout: 4000 });
    } else {
      setTimeout(run, 1200);
    }
  }

  function setLoadingBar(active) {
    let el = document.getElementById('viewLoadingBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'viewLoadingBar';
      el.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:var(--accent,#2657c8);z-index:99999;width:0%;opacity:0;transition:width .25s ease,opacity .25s ease';
      document.body.appendChild(el);
    }
    if (active) {
      el.style.opacity = '1';
      el.style.width = '65%';
    } else {
      el.style.width = '100%';
      setTimeout(() => { el.style.opacity = '0'; el.style.width = '0%'; }, 200);
    }
  }

  async function ensureViewData(view) {
    // Caso especial: a vista de alunos carrega primeiro os ativos (rápido),
    // e só depois espera pelo resto das dependências (espaços, etc.).
    if (view === 'alunos') {
      setLoadingBar(true);
      try {
        await ensureAlunosAtivos();
        await ensureCollections(VIEW_DEPS.alunos);
      } finally {
        setLoadingBar(false);
      }
      // A coleção completa de alunos (todos os estados) e o resto da app
      // carregam-se sem bloquear — assim que estiver pronta, quem mudar
      // o filtro para "Todos"/"Concluído"/"Suspenso" já a encontra pronta.
      preloadIdle(['alunos', ...PRELOAD_BASE, ...Object.values(VIEW_DEPS).flat()]);
      return;
    }

    const deps = VIEW_DEPS[view] || [];
    const emFalta = deps.filter((d) => !loaded[d]);
    if (emFalta.length) {
      setLoadingBar(true);
      try {
        await ensureCollections(emFalta);
      } finally {
        setLoadingBar(false);
      }
    }
    const resto = Array.from(new Set([
      ...PRELOAD_BASE,
      ...Object.values(VIEW_DEPS).flat()
    ])).filter((n) => n !== 'dashboard');
    preloadIdle(resto);
  }

  async function loadEssential() {
    const auth = await api('GET', '/api/auth/me');
    state.escolaAtual = auth.escola;
    state.usuarioAtual = auth.user;

    ensureAlunosAtivos().catch(() => {});
    ensureCollection('escola'); // não await — não bloqueia a primeira vista
    ensureCollection('dashboard');
    if (auth.user?.role === 'instrutor') await ensureCollection('instrutores'); // este sim é preciso já
    return auth;
  }

  window.ensureCollection = ensureCollection;
  window.ensureCollections = ensureCollections;
  window.refreshCollections = refreshCollections;
  window.ensureViewData = ensureViewData;
  window.ensureAlunosAtivos = ensureAlunosAtivos;
  window.preloadIdle = preloadIdle;
  window.isLoaded = isLoaded;
  window.loadEssential = loadEssential;
})();