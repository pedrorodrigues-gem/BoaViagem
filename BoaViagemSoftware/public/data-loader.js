(function () {
    if (typeof window.state === 'undefined') {
        console.error('data-loader.js: state não encontrado — carrega app-core.js primeiro.');
        return;
    }

    const anoAtual = new Date().getFullYear();

    const COLLECTION_LOADERS = {
        alunos: () => api('GET', '/api/alunos?estado=Ativo'),
        instrutores: () => api('GET', '/api/instrutores'),
        veiculos: () => api('GET', '/api/veiculos'),
        aulas: () => api('GET', '/api/aulas?ano=' + anoAtual),
        turmasTeoricas: () => api('GET', '/api/turmasTeoricas?ano=' + anoAtual),
        requisitos: () => api('GET', '/api/requisitos'),
        pagamentos: () => api('GET', '/api/pagamentos?ano=' + anoAtual).then(d => {
            state.pagamentosPorAno = state.pagamentosPorAno || {};
            state.pagamentosPorAno[anoAtual] = d;
            state.filtroAnoPagamentos = anoAtual;
            return d;
        }),
        contratos: () => api('GET', '/api/contratos?ano=' + anoAtual).then(d => {
            state.contratosPorAno = state.contratosPorAno || {};
            state.contratosPorAno[anoAtual] = d;
            state.filtroAnoContratos = anoAtual;
            return d;
        }),
        preInscricoes: () => api('GET', '/api/preinscricoes'),
        examesMarcacoes: () => api('GET', '/api/examesMarcacoes?filtro=Ativos&limit=200'),
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
        alunos: ['alunos', 'espacos'],
        instrutores: ['instrutores'],
        veiculos: ['veiculos'],
        pagamentos: ['pagamentos', 'alunos'],
        contratos: ['contratos', 'alunos', 'produtos', 'espacos', 'config'],
        config: ['espacos', 'produtos', 'config'],
        preinscricoes: ['preInscricoes', 'espacos'],
        exames: ['examesMarcacoes', 'alunos', 'instrutores', 'veiculos'],
        estatisticas: ['alunos'],
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
        const deps = VIEW_DEPS[view] || [];
        return deps.every(d => !!loaded[d]);
    }

    /* ---------- Alunos ativos: carregamento rápido e prioritário ---------- */
    let alunosAtivosLoaded = false;
    let alunosAtivosPromise = null;

    async function ensureAlunosAtivos(opts) {
        opts = opts || {};
        if (alunosAtivosLoaded && !opts.force) return state.alunosAtivos;
        if (loaded.alunos && !opts.force) {
            state.alunosAtivos = (state.alunos || []).filter(a => a.estado === 'Ativo');
            state.alunosAtivosTotal = state.alunosAtivos.length;
            alunosAtivosLoaded = true;
            return state.alunosAtivos;
        }
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
                .catch(() => { })
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
                emFalta.forEach((n) => ensureCollection(n).catch(() => { }));
            }
        }, { passive: true });
    }

    async function loadEssential() {
        const auth = await api('GET', '/api/auth/me');
        state.escolaAtual = auth.escola;
        state.usuarioAtual = auth.user;

        setupHoverPrefetch();

        // Carregar dados essenciais no arranque inicial (alunos ativos, escola, dashboard, espacos)
        const essenciais = [
            ensureCollection('alunos'),
            ensureCollection('escola'),
            ensureCollection('dashboard'),
            ensureCollection('espacos')
        ];
        if (auth.user?.role === 'instrutor') essenciais.push(ensureCollection('instrutores'));

        await Promise.all(essenciais);

        // Derivar lista de alunos ativos e índices imediatamente em memória
        state.alunosAtivos = (state.alunos || []).filter(a => a.estado === 'Ativo');
        state.alunosAtivosTotal = state.alunosAtivos.length;
        alunosAtivosLoaded = true;
        if (window.rebuildIndexes) window.rebuildIndexes();

        return auth;
    }

    /* ---------- Funções de procura sob demanda (Lazy Loading) ---------- */

    // 1. Calendário: Carregar todas as aulas e turmas de um ano específico
    async function ensureCalendarioAno(ano) {
        if (!ano) return;
        state.calendarioAnosCarregados = state.calendarioAnosCarregados || new Set([anoAtual]);
        if (state.calendarioAnosCarregados.has(ano)) return;

        setLoadingBar(true);
        try {
            const [novasAulas, novasTurmas] = await Promise.all([
                api('GET', `/api/aulas?ano=${ano}`),
                api('GET', `/api/turmasTeoricas?ano=${ano}`)
            ]);

            const aulasMap = new Map((state.aulas || []).map(a => [a.id, a]));
            (novasAulas || []).forEach(a => aulasMap.set(a.id, a));
            state.aulas = Array.from(aulasMap.values());

            const turmasMap = new Map((state.turmasTeoricas || []).map(t => [t.id, t]));
            (novasTurmas || []).forEach(t => turmasMap.set(t.id, t));
            state.turmasTeoricas = Array.from(turmasMap.values());

            state.calendarioAnosCarregados.add(ano);
            return { aulas: state.aulas, turmasTeoricas: state.turmasTeoricas };
        } finally {
            setLoadingBar(false);
        }
    }

    // 2. Alunos: Carregar todos os alunos ao clicar em 'Todos'
    let alunosTodosPromise = null;
    async function ensureAlunosTodos() {
        if (state.alunosFiltroCarregado === 'Todos' && (state.alunos?.length > (state.alunosAtivosTotal || 0) || state.alunosAtivosTotal === 0)) {
            return state.alunos;
        }
        if (alunosTodosPromise) return alunosTodosPromise;

        setLoadingBar(true);
        alunosTodosPromise = api('GET', '/api/alunos')
            .then((data) => {
                state.alunos = data;
                state.alunosFiltroCarregado = 'Todos';
                state.alunosAtivos = data.filter(a => a.estado === 'Ativo');
                state.alunosAtivosTotal = state.alunosAtivos.length;
                loaded.alunos = true;
                if (window.rebuildIndexes) window.rebuildIndexes();
                alunosTodosPromise = null;
                return data;
            })
            .catch((err) => {
                alunosTodosPromise = null;
                throw err;
            })
            .finally(() => {
                setLoadingBar(false);
            });

        return alunosTodosPromise;
    }

    // 3. Aulas: Carregar histórico de aulas ao clicar em 'Histórico'
    let aulasHistoricoPromise = null;
    async function ensureAulasHistorico() {
        if (state.aulasHistoricoCarregado) return state.aulas;
        if (aulasHistoricoPromise) return aulasHistoricoPromise;

        setLoadingBar(true);
        aulasHistoricoPromise = api('GET', '/api/aulas?periodo=Historico')
            .then((historico) => {
                const aulasMap = new Map((state.aulas || []).map(a => [a.id, a]));
                (historico || []).forEach(a => aulasMap.set(a.id, a));
                state.aulas = Array.from(aulasMap.values());
                state.aulasHistoricoCarregado = true;
                aulasHistoricoPromise = null;
                return state.aulas;
            })
            .catch((err) => {
                aulasHistoricoPromise = null;
                throw err;
            })
            .finally(() => {
                setLoadingBar(false);
            });

        return aulasHistoricoPromise;
    }

    // 4. Exames: Carregar todos os exames ao clicar em 'Todos'
    let examesTodosPromise = null;
    async function ensureExamesTodos() {
        if (state.examesCarregadosStatus === 'Todos') return state.examesMarcacoes;
        if (examesTodosPromise) return examesTodosPromise;

        setLoadingBar(true);
        examesTodosPromise = api('GET', '/api/examesMarcacoes?limit=1000')
            .then((data) => {
                state.examesMarcacoes = data;
                state.examesCarregadosStatus = 'Todos';
                examesTodosPromise = null;
                return data;
            })
            .catch((err) => {
                examesTodosPromise = null;
                throw err;
            })
            .finally(() => {
                setLoadingBar(false);
            });

        return examesTodosPromise;
    }

    // 5. Pagamentos: Carregar pagamentos do ano selecionado
    async function ensurePagamentosAno(ano) {
        state.pagamentosPorAno = state.pagamentosPorAno || {};
        if (ano === 'Todos') {
            if (state.pagamentosPorAno['Todos']) {
                state.pagamentos = state.pagamentosPorAno['Todos'];
                state.filtroAnoPagamentos = 'Todos';
                return state.pagamentos;
            }
            setLoadingBar(true);
            try {
                const data = await api('GET', '/api/pagamentos');
                state.pagamentosPorAno['Todos'] = data;
                state.pagamentos = data;
                state.filtroAnoPagamentos = 'Todos';
                return data;
            } finally {
                setLoadingBar(false);
            }
        }

        ano = Number(ano);
        if (state.pagamentosPorAno[ano]) {
            state.pagamentos = state.pagamentosPorAno[ano];
            state.filtroAnoPagamentos = ano;
            return state.pagamentos;
        }

        setLoadingBar(true);
        try {
            const data = await api('GET', `/api/pagamentos?ano=${ano}`);
            state.pagamentosPorAno[ano] = data;
            state.pagamentos = data;
            state.filtroAnoPagamentos = ano;
            return data;
        } finally {
            setLoadingBar(false);
        }
    }

    // 6. Contratos: Carregar contratos do ano selecionado
    async function ensureContratosAno(ano) {
        state.contratosPorAno = state.contratosPorAno || {};
        if (ano === 'Todos') {
            if (state.contratosPorAno['Todos']) {
                state.contratos = state.contratosPorAno['Todos'];
                state.filtroAnoContratos = 'Todos';
                return state.contratos;
            }
            setLoadingBar(true);
            try {
                const data = await api('GET', '/api/contratos');
                state.contratosPorAno['Todos'] = data;
                state.contratos = data;
                state.filtroAnoContratos = 'Todos';
                return data;
            } finally {
                setLoadingBar(false);
            }
        }

        ano = Number(ano);
        if (state.contratosPorAno[ano]) {
            state.contratos = state.contratosPorAno[ano];
            state.filtroAnoContratos = ano;
            return state.contratos;
        }

        setLoadingBar(true);
        try {
            const data = await api('GET', `/api/contratos?ano=${ano}`);
            state.contratosPorAno[ano] = data;
            state.contratos = data;
            state.filtroAnoContratos = ano;
            return data;
        } finally {
            setLoadingBar(false);
        }
    }

    window.ensureCollection = ensureCollection;
    window.ensureCollections = ensureCollections;
    window.refreshCollections = refreshCollections;
    window.ensureViewData = ensureViewData;
    window.ensureAlunosAtivos = ensureAlunosAtivos;
    window.ensureAlunosTodos = ensureAlunosTodos;
    window.ensureCalendarioAno = ensureCalendarioAno;
    window.ensureAulasHistorico = ensureAulasHistorico;
    window.ensureExamesTodos = ensureExamesTodos;
    window.ensurePagamentosAno = ensurePagamentosAno;
    window.ensureContratosAno = ensureContratosAno;
    window.preloadIdle = preloadIdle;
    window.isLoaded = isLoaded;
    window.isViewDataLoaded = isViewDataLoaded;
    window.loadEssential = loadEssential;
})();