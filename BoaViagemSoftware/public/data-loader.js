(function () {
  if (typeof window.state === 'undefined') {
    console.error('data-loader.js: state não encontrado — carrega app-core.js primeiro.');
    return;
  }

  const COLLECTION_LOADERS = {
    alunos: () => api('GET', '/api/alunos'),
    instrutores: () => api('GET', '/api/instrutores'),
    veiculos: () => api('GET', '/api/veiculos'),
    aulas: () => api('GET', '/api/aulas'),
    turmasTeoricas: () => api('GET', '/api/turmasTeoricas'),
    requisitos: () => api('GET', '/api/requisitos'),
    pagamentos: () => api('GET', '/api/pagamentos'),
    contratos: () => api('GET', '/api/contratos'),
    preInscricoes: () => api('GET', '/api/preinscricoes'),
    examesMarcacoes: () => api('GET', '/api/examesMarcacoes?limit=200'),
    espacos: () => api('GET', '/api/espacos'),
    produtos: () => api('GET', '/api/produtos'),
    escola: () => api('GET', '/api/escola'),
    dashboard: () => api('GET', '/api/dashboard'),
    config: () => api('GET', '/api/config'),
    revalidacoes: () => api('GET', '/api/revalidacoes')
  };

  const VIEW_DEPS = {
    dashboard: ['dashboard'],
    calendario: ['instrutores', 'veiculos', 'espacos', 'aulas', 'turmasTeoricas'],
    aulas: ['aulas', 'turmasTeoricas', 'alunos', 'instrutores', 'veiculos', 'espacos'],
    alunos: ['espacos'],
    instrutores: ['instrutores'],
    veiculos: ['veiculos'],
    pagamentos: ['pagamentos', 'alunos'],
    contratos: ['contratos', 'alunos', 'produtos', 'espacos', 'config'],
    config: ['espacos', 'produtos', 'config'],
    preinscricoes: ['preInscricoes', 'espacos'],
    exames: ['examesMarcacoes', 'alunos', 'instrutores', 'veiculos'],
    estatisticas: ['pagamentos', 'alunos'],
    revalidacoes: ['revalidacoes', 'alunos']
  };

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

  function isViewDataLoaded(view) {
    if (view === 'alunos') return alunosAtivosLoaded;
    const deps = VIEW_DEPS[view] || [];
    return deps.every(d => !!loaded[d]);
  }

  /* ---------- Alunos ativos: carregamento rápido e prioritário ---------- */
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

  /* ---------- Preload em segundo plano com fila sequencial ---------- */
  const preloadQueue = [];
  let isPreloading = false;

  function processNextPreload() {
    if (!preloadQueue.length) {
      isPreloading = false;
      return;
    }
    isPreloading = true;
    const next = preloadQueue.shift();
    if (!loaded[next] && !inFlight[next]) {
      ensureCollection(next)
        .catch(() => {})
        .finally(() => {
          setTimeout(processNextPreload, 300);
        });
    } else {
      processNextPreload();
    }
  }

  function preloadIdle(names) {
    const pendentes = names.filter((n) => !loaded[n] && !inFlight[n] && !preloadQueue.includes(n));
    if (!pendentes.length) return;
    preloadQueue.push(...pendentes);
    if (!isPreloading) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(processNextPreload, { timeout: 3500 });
      } else {
        setTimeout(processNextPreload, 800);
      }
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
    if (view === 'alunos') {
      setLoadingBar(true);
      try {
        await ensureAlunosAtivos();
        await ensureCollections(VIEW_DEPS.alunos);
      } finally {
        setLoadingBar(false);
      }
      preloadIdle(['alunos', 'instrutores', 'veiculos', 'espacos']);
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
  }

  /* Hover Pre-fetch: quando o utilizador passa o rato ou foca num item do menu,
     começa logo a descarregar as dependências dessa vista antes do clique. */
  function setupHoverPrefetch() {
    document.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.nav-item[data-view]');
      if (!btn) return;
      const v = btn.dataset.view;
      if (!v || !VIEW_DEPS[v]) return;
      const emFalta = VIEW_DEPS[v].filter((d) => !loaded[d] && !inFlight[d]);
      if (emFalta.length) {
        emFalta.forEach((n) => ensureCollection(n).catch(() => {}));
      }
    }, { passive: true });
  }

  async function loadEssential() {
    const auth = await api('GET', '/api/auth/me');
    state.escolaAtual = auth.escola;
    state.usuarioAtual = auth.user;

    setupHoverPrefetch();
    ensureAlunosAtivos().catch(() => {});
    ensureCollection('escola');
    ensureCollection('dashboard');
    if (auth.user?.role === 'instrutor') await ensureCollection('instrutores');
    return auth;
  }

  window.ensureCollection = ensureCollection;
  window.ensureCollections = ensureCollections;
  window.refreshCollections = refreshCollections;
  window.ensureViewData = ensureViewData;
  window.ensureAlunosAtivos = ensureAlunosAtivos;
  window.preloadIdle = preloadIdle;
  window.isLoaded = isLoaded;
  window.isViewDataLoaded = isViewDataLoaded;
  window.loadEssential = loadEssential;
})();