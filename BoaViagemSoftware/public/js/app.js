/* O estado e os helpers principais foram movidos para app-core.js. */

/* ====================================================================================
   1) PESQUISA GLOBAL — caixa de pesquisa que indexa alunos, instrutores, veículos,
      contratos, pagamentos, pré-inscrições, turmas e páginas fixas, e navega para lá.
   ==================================================================================== */

function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mesmoDia(dataCampo, dataISO) {
  return String(dataCampo || '').slice(0, 10) === dataISO;
}

/* Constrói o índice de tudo o que é pesquisável. Cada item tem uma `acao()` que faz a
   navegação — para alunos/instrutores/veículos abre logo a ficha, para os restantes
   muda apenas de vista (podes especializar mais tarde se quiseres, ex: abrir modal
   específico do pagamento). */
function construirIndiceGlobal() {
  const idx = [];

  (state.alunos || []).forEach(a => idx.push({
    tipo: 'Aluno', label: a.nome, sub: `Nº ${a.numeroAluno ?? a.id} · ${a.categoria || '—'} · ${a.estado || ''}`,
    acao: () => { switchView('alunos'); setTimeout(() => openAlunoForm(a.id), 60); }
  }));

  (state.instrutores || []).forEach(i => idx.push({
    tipo: 'Instrutor', label: i.nome, sub: i.cargo || 'Instrutor',
    acao: () => { switchView('instrutores'); setTimeout(() => openInstrutorForm(i.id), 60); }
  }));

  (state.veiculos || []).forEach(v => idx.push({
    tipo: 'Veículo', label: v.matricula, sub: `${v.marca || ''} ${v.modelo || ''}`.trim() || '—',
    acao: () => { switchView('veiculos'); setTimeout(() => openVeiculoForm(v.id), 60); }
  }));

  (state.contratos || []).forEach(c => {
    const al = findAluno(c.alunoId);
    idx.push({
      tipo: 'Contrato', label: `Contrato · ${al?.nome || 'Aluno removido'}`, sub: `${c.categoria || '—'} · ${c.estado || ''}`,
      acao: () => switchView('contratos')
    });
  });

  (state.pagamentos || []).forEach(p => {
    const al = findAluno(p.alunoId);
    idx.push({
      tipo: 'Pagamento', label: `${p.descricao || 'Pagamento'} · ${al?.nome || 'Aluno removido'}`, sub: fmtMoney(p.valor),
      acao: () => switchView('pagamentos')
    });
  });

  (state.preInscricoes || []).forEach(p => idx.push({
    tipo: 'Pré-inscrição', label: p.nome, sub: `${p.email || ''} · ${p.categoria || ''}`,
    acao: () => switchView('preinscricoes')
  }));

  (state.turmasTeoricas || []).forEach(t => idx.push({
    tipo: 'Turma teórica', label: t.tema, sub: `${fmtDate(t.data)} · ${t.horaInicio || ''}`,
    acao: () => { switchView('calendario'); setTimeout(() => abrirTurmaTeoricaDetalhe(t.id), 60); }
  }));

  const paginas = [
    { label: 'Dashboard', view: 'dashboard' }, { label: 'Calendário', view: 'calendario' },
    { label: 'Alunos', view: 'alunos' }, { label: 'Instrutores', view: 'instrutores' },
    { label: 'Veículos', view: 'veiculos' }, { label: 'Aulas', view: 'aulas' },
    { label: 'Exames', view: 'exames' }, { label: 'Pré-inscrições', view: 'preinscricoes' },
    { label: 'Pagamentos', view: 'pagamentos' }, { label: 'Contratos', view: 'contratos' },
    { label: 'Estatísticas', view: 'estatisticas' }, { label: 'Configurações', view: 'config' }
  ];
  paginas.forEach(p => idx.push({ tipo: 'Página', label: p.label, sub: 'Ir para a secção', acao: () => switchView(p.view) }));

  return idx;
}

function pesquisarGlobal(query) {
  const q = normalizarTexto(query).trim();
  if (!q) return [];
  return construirIndiceGlobal()
    .map(item => {
      const label = normalizarTexto(item.label);
      const sub = normalizarTexto(item.sub);
      let score = 0;
      if (label === q) score = 4;
      else if (label.startsWith(q)) score = 3;
      else if (label.includes(q)) score = 2;
      else if (sub.includes(q)) score = 1;
      return { item, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(r => r.item);
}

/* Injeta a caixa de pesquisa num contentor existente (ex: <div id="global-search-container">
   no cabeçalho/topbar). Chama isto UMA VEZ no init(), depois de renderNavItems(). */
function renderGlobalSearchBox(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div style="position:relative; width:100%; max-width:360px">
      <input id="globalSearchInput" placeholder="Pesquisar em todo o site... (nome, matrícula, tema...)"
        style="width:100%; padding:8px 12px; border-radius:8px; border:1px solid var(--border); font-size:13.5px"
        autocomplete="off">
      <div id="globalSearchResults"
        style="position:absolute; top:calc(100% + 4px); left:0; right:0; background:var(--bg,#fff);
        border:1px solid var(--border); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.14);
        max-height:360px; overflow-y:auto; display:none; z-index:1000"></div>
    </div>
  `;

  const input = document.getElementById('globalSearchInput');
  const results = document.getElementById('globalSearchResults');
  let timer = null;
  let itensAtuais = [];

  function esconder() { results.style.display = 'none'; results.innerHTML = ''; }

  async function mostrarResultados() {
    const queryStr = input.value.trim();
    if (!queryStr) { esconder(); return; }

    try {
      const res = await api('GET', `/api/pesquisa-global?q=${encodeURIComponent(queryStr)}`);
      if (input.value.trim() !== queryStr) return;
      if (res && Array.isArray(res.resultados) && res.resultados.length > 0) {
        itensAtuais = res.resultados.map(r => ({
          tipo: r.tipo,
          label: r.label,
          sub: r.sub,
          acao: () => {
            if (r.tipo === 'Aluno') { switchView('alunos'); setTimeout(() => openAlunoForm(r.id), 60); }
            else if (r.tipo === 'Instrutor') { switchView('instrutores'); setTimeout(() => openInstrutorForm(r.id), 60); }
            else if (r.tipo === 'Veículo') { switchView('veiculos'); setTimeout(() => openVeiculoForm(r.id), 60); }
            else if (r.tipo === 'Contrato') { switchView('contratos'); }
            else if (r.tipo === 'Turma teórica') { switchView('calendario'); setTimeout(() => abrirTurmaTeoricaDetalhe(r.id), 60); }
            else { switchView('dashboard'); }
          }
        }));
      } else {
        itensAtuais = pesquisarGlobal(queryStr);
      }
    } catch (e) {
      itensAtuais = pesquisarGlobal(queryStr);
    }

    if (!itensAtuais.length) { esconder(); return; }
    results.innerHTML = itensAtuais.map((it, i) => `
      <div class="global-search-item" data-idx="${i}" style="padding:9px 12px; cursor:pointer; border-bottom:1px solid var(--border); font-size:13.5px">
        <span style="font-size:10.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700">${esc(it.tipo)}</span>
        <div style="font-weight:600">${esc(it.label)}</div>
        ${it.sub ? `<div class="muted" style="font-size:12px">${esc(it.sub)}</div>` : ''}
      </div>
    `).join('');
    results.style.display = 'block';
    results.querySelectorAll('.global-search-item').forEach((div, i) => {
      div.addEventListener('mousedown', (e) => {
        e.preventDefault(); // evita perder o foco antes do click disparar
        itensAtuais[i].acao();
        esconder();
        input.value = '';
      });
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(mostrarResultados, 250);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) mostrarResultados(); });

  document.addEventListener('click', (e) => { if (!el.contains(e.target)) esconder(); });

  // Atalho "/" para focar a pesquisa a partir de qualquer sítio (exceto dentro de campos de texto)
  document.addEventListener('keydown', (e) => {
    const alvoEIntput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (e.key === '/' && !alvoEIntput) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') { esconder(); input.blur(); }
  });
}

/* ==================== CALENDÁRIO ==================== */
function eventosDoMes(mesRef) {
  const instrFilter = state.calendario?.instrutorId ? Number(state.calendario.instrutorId) : null;
  const aulasEv = state.aulas
    .filter(a => (a.data || '').startsWith(mesRef) && (!instrFilter || Number(a.instrutorId) === instrFilter))
    .map(a => ({
      origem: 'aula', id: a.id, tipo: a.tipo || 'Prática', data: a.data, hora: a.hora,
      estado: a.estado, titulo: (findAluno(a.alunoId) || {}).nome || 'Aluno removido',
      sub: (findInstrutor(a.instrutorId) || {}).nome || 'Sem instrutor'
    }));
  const turmasEv = state.turmasTeoricas
    .filter(t => (t.data || '').startsWith(mesRef) && (!instrFilter || Number(t.instrutorId) === instrFilter))
    .map(t => ({
      origem: 'turmaTeorica', id: t.id, tipo: 'Teórica', data: t.data, hora: t.horaInicio,
      estado: t.estado, titulo: t.tema,
      sub: `${(t.inscritos || []).length} inscritos · ${(findInstrutor(t.instrutorId) || {}).nome || 'Sem instrutor'}`
    }));
  const preInscricoesEv = state.preInscricoes.filter(p => {
    const dataBase = p.dataInscricao || p.dataPreInscricao || '';
    return dataBase.startsWith(mesRef);
  }).map(p => ({
    origem: 'preInscricao', id: p.id, tipo: 'Pré-inscrição', data: p.dataInscricao || p.dataPreInscricao || '', hora: '',
    estado: p.estado, titulo: p.nome, sub: `${p.categoria} · ${p.email}`
  }));
  return [...aulasEv, ...turmasEv, ...preInscricoesEv].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

/* Nº sequencial da lição do aluno: posição desta aula na cronologia de
   TODAS as aulas desse aluno (excluindo canceladas), por data+hora. */
function numeroSequenciaAula(aula) {
  const doAluno = state.aulas
    .filter(a => a.alunoId === aula.alunoId && normalizarTexto(a.estado) !== normalizarTexto('Cancelada'))
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const pos = doAluno.findIndex(a => a.id === aula.id);
  return pos === -1 ? '—' : pos + 1;
}

/* Eventos de um único dia (aulas + turmas teóricas), do mais cedo para
   o mais tarde — usados na vista diária e na respetiva exportação PDF. */
function eventosDoDia(dataISO) {
  const instrFilter = state.calendario?.instrutorId ? Number(state.calendario.instrutorId) : null;

  const aulasEv = state.aulas
    .filter(a => mesmoDia(a.data, dataISO) && (!instrFilter || Number(a.instrutorId) === instrFilter))
    .map(a => ({
      origem: 'aula', id: a.id, tipo: a.tipo || 'Prática', hora: a.hora, estado: a.estado,
      alunoNome: (findAluno(a.alunoId) || {}).nome || 'Aluno removido',
      instrutorNome: (findInstrutor(a.instrutorId) || {}).nome || 'Sem instrutor',
      veiculoMatricula: (findVeiculo(a.veiculoId) || {}).matricula || '—',
      numeroLicao: numeroSequenciaAula(a)
    }));

  const turmasEv = state.turmasTeoricas
    .filter(t => mesmoDia(t.data, dataISO) && (!instrFilter || Number(t.instrutorId) === instrFilter))
    .map(t => ({
      origem: 'turmaTeorica', id: t.id, tipo: 'Teórica', hora: t.horaInicio, estado: t.estado,
      alunoNome: `${t.tema} (${(t.inscritos || []).length} inscritos)`,
      instrutorNome: (findInstrutor(t.instrutorId) || {}).nome || 'Sem instrutor',
      veiculoMatricula: '—', numeroLicao: '—'
    }));

  return [...aulasEv, ...turmasEv].sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
}

// substitui eventosDoMes / eventosDoDia em app-render.js
state.calendarioCache = state.calendarioCache || {}; // chave: "2026-09|instrutorId"

async function carregarEventosPeriodo(inicio, fim) {
  const instrFilter = state.calendario?.instrutorId || '';
  const chave = `${inicio}_${fim}|${instrFilter}`;
  if (state.calendarioCache[chave]) return state.calendarioCache[chave];
  const params = new URLSearchParams({ inicio, fim });
  if (instrFilter) params.set('instrutorId', instrFilter);
  const eventos = await api('GET', `/api/calendario?${params.toString()}`);
  state.calendarioCache[chave] = eventos;
  return eventos;
}

function limitesDoMes(mesRef) {
  const [ano, mes] = mesRef.split('-').map(Number);
  const inicio = `${mesRef}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${mesRef}-${String(ultimoDia).padStart(2, '0')}`;
  return { inicio, fim };
}

function exportarFolhaAssinaturasTurma(turmaId) {
  const t = state.turmasTeoricas.find(x => x.id === turmaId);
  if (!t) return;
  const alunosBase = (t.inscritos || []).length
    ? (t.inscritos || []).map(id => findAluno(id)).filter(Boolean)
    : getAlunosAtivos();

  const linhas = alunosBase.map(a => `
    <tr>
      <td style="width:34px; text-align:center; font-size:16px">☐</td>
      <td>${esc(a.nome)}</td>
      <td style="width:70px">${a.numeroAluno ?? a.id}</td>
      <td style="min-width:220px; height:34px"></td>
    </tr>
  `).join('');

  const html = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Folha de Presenças e Assinaturas</h1>
        <p class="muted">${esc(t.tema)} · ${fmtDate(t.data)} · ${esc(t.horaInicio || '')}–${esc(t.horaFim || '')} · ${esc(state.escola?.nome || '')}</p>
      </div>
      <table class="print-info"><tbody>
        <tr><td><strong>Instrutor</strong></td><td>${esc((findInstrutor(t.instrutorId) || {}).nome || 'Sem instrutor')}</td></tr>
        <tr><td><strong>Sala / Espaço</strong></td><td>${esc(t.sala || getEspacoNomeById(t.espacoId) || '—')}</td></tr>
      </tbody></table>
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Presente</th><th>Aluno</th><th>Nº</th><th>Assinatura</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="4" class="muted">Sem alunos disponíveis para esta turma.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:16px">Depois de recolhidas as assinaturas, esta folha deve ser entregue aos serviços administrativos,
      que a convertem digitalmente em "Marcar presenças" na turma correspondente — isso atualiza automaticamente as horas teóricas de cada aluno.</p>
    </div>
  `;
  exportarHtmlParaPdf(html, `folha-assinaturas-${(t.tema || 'turma').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.pdf`);
}

async function renderCalendario() {
  const el = document.getElementById('view-calendario');
  state.calendario.modo = state.calendario.modo || 'mes';
  state.calendario.diaRef = state.calendario.diaRef || new Date().toISOString().slice(0, 10);

  const seletorInstrutorHtml = state.usuarioAtual?.role === 'instrutor' ? `
    <select onchange="(function(v){ state.calendario.instrutorId = Number(v); renderCalendario(); })(this.value)" style="font-size:13px; padding:4px 8px; border-radius:6px; border:1px solid var(--border)">
      ${state.instrutores.map(i => `<option value="${i.id}" ${state.calendario.instrutorId == i.id ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}
    </select>
  ` : `
    <select onchange="(function(v){ state.calendario.instrutorId = v === 'all' ? null : Number(v); renderCalendario(); })(this.value)" style="font-size:13px; padding:4px 8px; border-radius:6px; border:1px solid var(--border)">
      <option value="all">Todos</option>
      ${state.instrutores.map(i => `<option value="${i.id}" ${state.calendario.instrutorId == i.id ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}
    </select>
  `;

  const toggleModoHtml = `
    <div class="filter-row" style="gap:4px">
      <button class="chip ${state.calendario.modo === 'mes' ? 'active' : ''}" onclick="state.calendario.modo='mes'; renderCalendario();">Vista mensal</button>
      <button class="chip ${state.calendario.modo === 'dia' ? 'active' : ''}" onclick="state.calendario.modo='dia'; renderCalendario();">Vista diária</button>
    </div>
  `;

  let navHtml = '', exportBtnsHtml = '', corpoHtml = '';

  if (state.calendario.modo === 'dia') {
    const dataISO = state.calendario.diaRef;
    const tituloDia = new Date(`${dataISO}T00:00:00`).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    navHtml = `
      <div class="cal-nav">
        <button class="icon-btn" onclick="mudarDiaCalendario(-1)">‹</button>
        <h3 class="cal-titulo">${tituloDia.charAt(0).toUpperCase() + tituloDia.slice(1)}</h3>
        <button class="icon-btn" onclick="mudarDiaCalendario(1)">›</button>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="state.calendario.diaRef = new Date().toISOString().slice(0,10); renderCalendario();">Hoje</button>
    `;
    exportBtnsHtml = `<button class="btn btn-ghost btn-sm" onclick="exportarCalendarioDiaPDF()">Exportar PDF do dia</button>`;
    corpoHtml = renderCalendarioDiaTabela(dataISO);
  } else {
    const [anoStr, mesStr] = state.calendario.mesRef.split('-');
    const ano = Number(anoStr), mes = Number(mesStr);
    const primeiroDia = new Date(ano, mes - 1, 1);
    const nomeMes = primeiroDia.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const offsetSemana = (primeiroDia.getDay() + 6) % 7;

    const eventos = eventosDoMes(state.calendario.mesRef);
    const porDia = {};
    eventos.forEach(e => { const dia = Number(e.data.slice(8, 10)); (porDia[dia] = porDia[dia] || []).push(e); });
    const hojeISO = new Date().toISOString().slice(0, 10);

    let celulas = '';
    for (let i = 0; i < offsetSemana; i++) celulas += `<div class="cal-cell cal-cell-empty"></div>`;
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dataISO = `${anoStr}-${mesStr}-${String(dia).padStart(2, '0')}`;
      const evsDia = (porDia[dia] || []);
      const isHoje = dataISO === hojeISO;
      celulas += `
        <div class="cal-cell ${isHoje ? 'cal-cell-today' : ''}" style="cursor:pointer" onclick="state.calendario.modo='dia'; state.calendario.diaRef='${dataISO}'; renderCalendario();">
          <div class="cal-daynum">${dia}</div>
          <div class="cal-events">
            ${evsDia.slice(0, 3).map(e => {
        const className = e.origem === 'preInscricao' ? 'cal-event-preinscricao' : (e.tipo === 'Teórica' ? 'cal-event-teorica' : 'cal-event-pratica');
        return `<div class="cal-event ${className}" title="${esc(e.titulo)}"><span class="cal-event-time">${esc(e.hora || '')}</span> ${esc(e.titulo)}</div>`;
      }).join('')}
            ${evsDia.length > 3 ? `<div class="cal-event-more">+${evsDia.length - 3} mais</div>` : ''}
          </div>
        </div>`;
    }

    navHtml = `
      <div class="cal-nav">
        <button class="icon-btn" onclick="mudarMesCalendario(-1)">‹</button>
        <h3 class="cal-titulo">${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}</h3>
        <button class="icon-btn" onclick="mudarMesCalendario(1)">›</button>
      </div>
    `;
    exportBtnsHtml = `
      <button class="btn btn-ghost btn-sm" onclick="exportarCalendarioPDF()">Exportar PDF</button>
      <button class="btn btn-ghost btn-sm" onclick="exportarCalendarioGoogle()">Exportar p/ Google Calendar</button>
    `;
    corpoHtml = `
      <div class="cal-grid cal-grid-head">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<div class="cal-head-cell">${d}</div>`).join('')}</div>
      <div class="cal-grid">${celulas}</div>
    `;
  }

  el.innerHTML = `
    <div class="cal-toolbar">
      ${navHtml}
      <div class="filter-row">
        ${toggleModoHtml}
        <div style="display:flex; align-items:center; gap:10px">
          <label style="font-size:13px; margin-right:6px">Ver calendário de</label>
          ${seletorInstrutorHtml}
        </div>
        <span class="cal-legend"><span class="dot dot-pratica"></span> Prática</span>
        <span class="cal-legend"><span class="dot dot-teorica"></span> Teórica</span>
        ${state.calendario.modo === 'mes' ? '<span class="cal-legend"><span class="dot dot-preinscricao"></span> Pré-inscrição</span>' : ''}
        <div style="margin-left:auto; display:flex; gap:8px">${exportBtnsHtml}</div>
      </div>
    </div>
    ${corpoHtml}
  `;

  const preForm = document.getElementById('preInscricaoForm');
  if (preForm) {
    preForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(preForm);
      const payload = {
        nome: fd.get('nome'), email: fd.get('email'), categoria: fd.get('categoria'),
        estado: fd.get('estado') || 'Pendente', observacoes: fd.get('observacoes'),
        dataPreInscricao: fd.get('dataPreInscricao') || new Date().toISOString().slice(0, 10),
        dataInscricao: fd.get('dataInscricao') || null
      };
      try {
        await api('POST', '/api/preinscricoes', payload);
        await refreshCollections(['preInscricoes']);
        renderCalendario();
        toast('Pré-inscrição guardada.');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

function renderCalendarioDiaTabela(dataISO) {
  const eventos = eventosDoDia(dataISO);
  if (!eventos.length) {
    return `<div class="panel" style="margin-top:12px">${emptyState('Sem aulas ou turmas agendadas', 'Não há eventos marcados para este dia.')}</div>`;
  }
  return `
    <div class="table-wrap" style="margin-top:12px">
      <table>
        <thead>
          <tr>
            <th>Hora início</th><th>Nº lição</th><th>Aluno / Turma</th>
            <th>Instrutor</th><th>Viatura</th><th>Estado</th>
            <th style="min-width:180px">Assinatura do instruendo</th>
          </tr>
        </thead>
        <tbody>
          ${eventos.map(e => `
            <tr style="cursor:pointer" onclick="${e.origem === 'turmaTeorica' ? `abrirTurmaTeoricaDetalhe(${e.id})` : `openAulaForm(${e.id})`}">
              <td class="cell-primary">${esc(e.hora || '—')}</td>
              <td>${e.numeroLicao !== '—' ? `Lição ${e.numeroLicao}` : '—'}</td>
              <td>${esc(e.alunoNome)}</td>
              <td>${esc(e.instrutorNome)}</td>
              <td>${esc(e.veiculoMatricula)}</td>
              <td><span class="${badgeClass(e.estado)}">${esc(e.estado || '—')}</span></td>
              <td></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function mudarDiaCalendario(delta) {
  const d = new Date(`${state.calendario.diaRef}T00:00:00`);
  d.setDate(d.getDate() + delta);
  state.calendario.diaRef = d.toISOString().slice(0, 10);
  renderCalendario();
}

function calcularHoraFimStr(hora, duracaoMin) {
  if (!hora) return '';
  const [h, m] = String(hora).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const total = h * 60 + m + (Number(duracaoMin) || 0);
  const totalMod = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(totalMod / 60);
  const mm = totalMod % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function exportarCalendarioDiaPDF() {
  const dataISO = state.calendario.diaRef;
  const eventos = eventosDoDia(dataISO);
  const tituloDia = new Date(`${dataISO}T00:00:00`).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const linhas = eventos.length ? eventos.map(e => `
    <tr>
      <td>${esc(e.hora || '—')}</td>
      <td>${e.numeroLicao !== '—' ? esc(String(e.numeroLicao)) : '—'}</td>
      <td>${esc(e.alunoNome)}</td>
      <td>${esc(e.instrutorNome)}</td>
      <td>${esc(e.veiculoMatricula)}</td>
      <td style="min-width:160px"></td>
    </tr>
  `).join('') : `<tr><td colspan="6" style="text-align:center; color:var(--muted)">Sem eventos neste dia.</td></tr>`;

  document.getElementById('printArea').innerHTML = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Folha de Aulas — ${esc(tituloDia.charAt(0).toUpperCase() + tituloDia.slice(1))}</h1>
        <div class="print-info-grid">
          <div><strong>Escola</strong>${esc(state.escola?.nome || '—')}</div>
          <div><strong>Gerado em</strong>${new Date().toLocaleString('pt-PT')}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Hora</th><th>Nº lição</th><th>Aluno</th><th>Instrutor</th><th>Viatura</th><th>Assinatura</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>
  `;
  window.print();
}

function mudarMesCalendario(delta) {
  const [ano, mes] = state.calendario.mesRef.split('-').map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  state.calendario.mesRef = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderCalendario();
}

/* ---------- Exportar calendário: PDF (impressão) e Google Calendar (.ics) ---------- */
function exportarCalendarioPDF() {
  const mesRef = state.calendario.mesRef;
  const [anoStr, mesStr] = mesRef.split('-');
  const nomeMes = new Date(Number(anoStr), Number(mesStr) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const eventos = eventosDoMes(mesRef);

  const linhas = eventos.length ? eventos.map(e => `
    <tr>
      <td>${fmtDate(e.data)}</td>
      <td>${esc(e.hora || '—')}</td>
      <td>${esc(e.tipo || '—')}</td>
      <td>${esc(e.titulo || '—')}</td>
      <td>${esc(e.sub || '—')}</td>
      <td>${esc(e.estado || '—')}</td>
    </tr>
  `).join('') : `<tr><td colspan="6" style="text-align:center; color:var(--muted)">Sem eventos neste mês.</td></tr>`;

  document.getElementById('printArea').innerHTML = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Calendário — ${esc(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1))}</h1>
        <div class="print-info-grid">
          <div><strong>Escola</strong>${esc(state.escolaAtual?.nome || '—')}</div>
          <div><strong>Gerado em</strong>${new Date().toLocaleString('pt-PT')}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Hora</th><th>Tipo</th><th>Descrição</th><th>Detalhe</th><th>Estado</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>
  `;
  window.print();
}

function exportarCalendarioGoogle() {
  const params = new URLSearchParams({ mes: state.calendario.mesRef });
  if (state.calendario.instrutorId) params.set('instrutorId', state.calendario.instrutorId);
  window.open(`/api/calendario/export.ics?${params.toString()}`, '_blank');
  toast('Ficheiro .ics descarregado. Em calendar.google.com, abre Definições > Importar e exportar para o importares.');
}

function renderExamesMarcacoes() {
  const el = document.getElementById('view-exames');
  state.exames = state.exames || {};
  const tab = state.exames.tab || 'marcacoes';
  el.innerHTML = `
    <div class="filter-row" style="margin-bottom:16px">
      <button class="chip ${tab === 'marcacoes' ? 'active' : ''}" onclick="state.exames.tab='marcacoes'; renderExamesMarcacoes();">Marcações</button>
      <button class="chip ${tab === 'estatisticas' ? 'active' : ''}" onclick="state.exames.tab='estatisticas'; renderExamesMarcacoes();">Estatísticas</button>
    </div>
    <div id="examesTabBody"></div>
  `;
  if (tab === 'estatisticas') renderExamesEstatisticas();
  else renderExamesMarcacoesTab();
}

function renderExamesMarcacoesTab() {
  const body = document.getElementById('examesTabBody');
  body.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Marcações de exames</h3></div>
      <form id="examesForm" class="form-grid">
        ${renderAlunoPickerHtml(null, { label: 'Aluno', required: true, hint: 'Podes escolher da lista ou escrever o nome' })}
        <div class="form-field"><label>Tipo</label><select name="tipo"><option>Teórico</option><option>Prático</option></select></div>
        <div class="form-field"><label>Data</label><input name="data" type="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-field"><label>Hora</label><input name="hora" type="time"></div>
        <div class="form-field"><label>Duração (min)</label><input name="duracao" id="exameDuracaoInput" type="number" min="10" value="60"></div>
        <div class="form-field"><label>Hora fim (calculada)</label><input type="time" id="exameHoraFimCalc" readonly style="background:var(--bg-subtle,#f3f4f6); font-weight:600" tabindex="-1"></div>
        <div class="form-field"><label>Local / Sala</label><input name="local" placeholder="Ex: Sala 2"></div>
        <div class="form-field"><label>Estado</label><select name="estado"><option>Marcado</option><option>Realizado</option><option>Cancelado</option></select></div>
        <div class="form-field">
          <label>Resultado</label>
          <select name="resultado">
            <option value="">— Ainda sem resultado —</option>
            <option value="Aprovado">Aprovado</option>
            <option value="Reprovado">Reprovado</option>
          </select>
        </div>
        <div class="form-field full"><label>Observações</label><textarea name="observacoes" placeholder="Informações úteis para a marcação..."></textarea></div>
        <div class="form-actions full"><button type="submit" class="btn btn-accent">Guardar marcação</button></div>
      </form>
      <p class="muted" style="margin-top:10px">Os exames práticos só podem ser marcados quando a conta corrente do aluno estiver liquidada. O resultado alimenta automaticamente a aba de Estatísticas.</p>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Registos</h3></div>
      <div class="table-wrap">
        ${state.examesMarcacoes.length ? `<table>
          <thead><tr><th>Aluno</th><th>Tipo</th><th>Data</th><th>Hora</th><th>Hora fim</th><th>Local</th><th>Estado</th><th>Resultado</th><th>Observações</th><th></th></tr></thead>
          <tbody>
            ${state.examesMarcacoes.map(m => `
              <tr>
                <td>${esc(m.alunoNome || getAlunoNomePorId(m.alunoId) || '—')}</td>
                <td>${esc(m.tipo || '—')}</td>
                <td>${fmtDate(m.data)}</td>
                <td>${esc(m.hora || '—')}</td>
                <td>${esc(m.horaFim || '—')}</td>
                <td>${esc(m.local || '—')}</td>
                <td><span class="${badgeClass(m.estado)}">${esc(m.estado || 'Marcado')}</span></td>
                <td>
                  <select onchange="atualizarResultadoExame(${m.id}, this.value)">
                    <option value="" ${!m.resultado ? 'selected' : ''}>—</option>
                    <option value="Aprovado" ${m.resultado === 'Aprovado' ? 'selected' : ''}>Aprovado</option>
                    <option value="Reprovado" ${m.resultado === 'Reprovado' ? 'selected' : ''}>Reprovado</option>
                  </select>
                </td>
                <td>${esc(m.observacoes || '—')}</td>
                <td><button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('examesMarcacoes', ${m.id}, 'esta marcação')">Remover</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : emptyState('Sem marcações', 'Ainda não há marcas de exames registadas.')}
      </div>
    </div>
  `;

  const form = document.getElementById('examesForm');
  if (form) bindAlunoPicker(form);
  function atualizarHoraFimExame() {
    const hora = form.querySelector('[name="hora"]')?.value;
    const duracao = form.querySelector('[name="duracao"]')?.value;
    const campo = document.getElementById('exameHoraFimCalc');
    if (campo) campo.value = calcularHoraFimStr(hora, duracao);
  }
  ['hora', 'duracao'].forEach(name => {
    const campoEl = form.querySelector(`[name="${name}"]`);
    campoEl?.addEventListener('input', atualizarHoraFimExame);
    campoEl?.addEventListener('change', atualizarHoraFimExame);
  });
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        alunoId: Number(fd.get('alunoId')), tipo: fd.get('tipo') || 'Teórico',
        data: fd.get('data') || '', hora: fd.get('hora') || '',
        duracao: fd.get('duracao') ? Number(fd.get('duracao')) : null,
        horaFim: calcularHoraFimStr(fd.get('hora'), fd.get('duracao')),
        local: fd.get('local') || '',
        estado: fd.get('estado') || 'Marcado', resultado: fd.get('resultado') || null,
        observacoes: fd.get('observacoes') || ''
      };
      try {
        if (payload.tipo === 'Prático') {
          const conta = await api('GET', `/api/contaCorrente/${payload.alunoId}`);
          if (Number(conta.saldoTotal || 0) > 0.0001) throw new Error('Não é possível marcar um exame prático enquanto a conta corrente do aluno tiver saldo pendente.');
        }
        await api('POST', '/api/examesMarcacoes', payload);
        await refreshCollections(['examesMarcacoes']);
        renderExamesMarcacoesTab();
        toast('Marcação de exame guardada.');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

async function atualizarResultadoExame(id, resultado) {
  try {
    await api('PUT', `/api/examesMarcacoes/${id}`, { resultado: resultado || null });
    await refreshCollections(['examesMarcacoes']);
    renderExamesMarcacoesTab();
    toast('Resultado atualizado.');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderExamesEstatisticas() {
  const body = document.getElementById('examesTabBody');
  body.innerHTML = `<div class="muted" style="padding:12px">A carregar estatísticas...</div>`;
  try {
    const stats = await api('GET', '/api/examesMarcacoes/estatisticas');
    state.exames.statsCache = stats;
    state.exames.subTab = state.exames.subTab || 'teorico';
    renderExamesEstatisticasHTML();
  } catch (err) {
    body.innerHTML = emptyState('Erro ao carregar estatísticas', err.message);
  }
}

function barraTaxa(taxa) {
  return `
    <div class="progress-track" style="width:120px; display:inline-block; vertical-align:middle; margin-right:8px">
      <div class="progress-fill" style="width:${Math.min(100, Math.max(0, taxa))}%"></div>
    </div><span>${taxa}%</span>
  `;
}

function fmtMesLabel(chaveMes) {
  const [ano, mes] = chaveMes.split('-');
  const rotulo = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}

function renderExamesEstatisticasHTML() {
  const body = document.getElementById('examesTabBody');
  const stats = state.exames.statsCache;
  if (!stats) return;
  const subTab = state.exames.subTab || 'teorico';
  const bloco = stats[subTab] || stats.teorico;
  const anoAtual = new Date().getFullYear();
  const porMesAnoAtual = bloco.porMes.filter(m => m.chave.startsWith(String(anoAtual)));
  const nomeTipo = subTab === 'teorico' ? 'exame teórico' : subTab === 'pratico' ? 'exame prático' : 'exames (teórico + prático)';

  body.innerHTML = `
    <div class="filter-row" style="margin-bottom:14px">
      <button class="chip ${subTab === 'teorico' ? 'active' : ''}" onclick="state.exames.subTab='teorico'; renderExamesEstatisticasHTML();">Exame Teórico</button>
      <button class="chip ${subTab === 'pratico' ? 'active' : ''}" onclick="state.exames.subTab='pratico'; renderExamesEstatisticasHTML();">Exame Prático</button>
      <button class="chip ${subTab === 'geral' ? 'active' : ''}" onclick="state.exames.subTab='geral'; renderExamesEstatisticasHTML();">Ambos (geral)</button>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Aprovações / reprovações por mês — ${anoAtual} (${nomeTipo})</h3></div>
      <div class="table-wrap">
        ${porMesAnoAtual.length ? `<table>
          <thead><tr><th>Mês</th><th>Aprovados</th><th>Reprovados</th><th>Total</th><th>Taxa de aprovação</th></tr></thead>
          <tbody>${porMesAnoAtual.map(m => `<tr><td class="cell-primary">${fmtMesLabel(m.chave)}</td><td>${m.aprovados}</td><td>${m.reprovados}</td><td>${m.total}</td><td>${barraTaxa(m.taxaAprovacao)}</td></tr>`).join('')}</tbody>
        </table>` : emptyState('Sem dados este ano', `Ainda não há registos de ${nomeTipo} com resultado atribuído em ${anoAtual}.`)}
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Aprovações / reprovações por ano (${nomeTipo})</h3></div>
      <div class="table-wrap">
        ${bloco.porAno.length ? `<table>
          <thead><tr><th>Ano</th><th>Aprovados</th><th>Reprovados</th><th>Total</th><th>Taxa de aprovação</th></tr></thead>
          <tbody>${bloco.porAno.map(a => `<tr><td class="cell-primary">${esc(a.chave)}</td><td>${a.aprovados}</td><td>${a.reprovados}</td><td>${a.total}</td><td>${barraTaxa(a.taxaAprovacao)}</td></tr>`).join('')}</tbody>
        </table>` : emptyState('Sem dados', `Ainda não há registos de ${nomeTipo} com resultado atribuído.`)}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Comparação entre espaços da escola (${nomeTipo})</h3></div>
      <div class="table-wrap">
        ${bloco.porEspaco.length ? `<table>
          <thead><tr><th>Espaço</th><th>Aprovados</th><th>Reprovados</th><th>Total</th><th>Taxa de aprovação</th></tr></thead>
          <tbody>${bloco.porEspaco.slice().sort((a, b) => b.taxaAprovacao - a.taxaAprovacao).map(e => `<tr><td class="cell-primary">${esc(e.rotulo)}</td><td>${e.aprovados}</td><td>${e.reprovados}</td><td>${e.total}</td><td>${barraTaxa(e.taxaAprovacao)}</td></tr>`).join('')}</tbody>
        </table>` : emptyState('Sem dados', `Ainda não há registos de ${nomeTipo} com resultado atribuído.`)}
      </div>
    </div>
  `;
}

function renderPreInscricoes() {
  const el = document.getElementById('view-preinscricoes');
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Pré-inscrições</h3></div>
      <form id="preInscricaoFormMain" class="form-grid" style="margin-bottom:16px">
        <div class="form-field"><label>Nome</label><input name="nome" required></div>
        <div class="form-field"><label>Email</label><input name="email" type="email" required></div>
        <div class="form-field"><label>Categoria</label><input name="categoria" required placeholder="Ex: B"></div>
        <div class="form-field"><label>Desconto acordado (%)</label><input name="desconto" type="number" min="0" max="100" step="1" value="0"></div>
        <div class="form-field"><label>Estado</label><select name="estado"><option>Pendente</option><option>Aprovada</option><option>Inscrita</option><option>Cancelada</option></select></div>
        <div class="form-field"><label>Data pré-inscrição</label><input name="dataPreInscricao" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-field"><label>Data de inscrição</label><input name="dataInscricao" type="date"></div>
        <div class="form-field full"><label>Observações</label><textarea name="observacoes" placeholder="Informações adicionais..."></textarea></div>
        <div class="form-actions full">
          <button type="submit" class="btn btn-accent">Guardar pré-inscrição</button>
        </div>
      </form>
      <p class="muted" style="margin-bottom:10px">A categoria e o desconto acordados aqui transitam automaticamente para o aluno ao converter a pré-inscrição.</p>
      <div class="table-wrap">
        ${state.preInscricoes.length ? `<table>
          <thead><tr><th>Nome</th><th>Email</th><th>Categoria</th><th>Desconto</th><th>Estado</th><th>Pré-inscrição</th><th>Inscrição</th><th>Observações</th><th></th></tr></thead>
          <tbody>
            ${state.preInscricoes.map(p => `
              <tr>
                <td>${esc(p.nome)}</td>
                <td>${esc(p.email)}</td>
                <td>${esc(p.categoria)}</td>
                <td>${p.desconto ? `${p.desconto}%` : '—'}</td>
                <td><span class="${badgeClass(p.estado)}">${esc(p.estado || 'Pendente')}</span></td>
                <td>${fmtDate(p.dataPreInscricao)}</td>
                <td>${p.dataInscricao ? fmtDate(p.dataInscricao) : '—'}</td>
                <td>${esc(p.observacoes || '—')}</td>
                <td>${p.alunoId ? '<span class="muted" style="font-size:12px">Já convertida</span>' : `<button class="btn btn-accent btn-sm" onclick="openConverterPreInscricaoForm(${p.id})">Converter em aluno</button>`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : emptyState('Sem pré-inscrições', 'Adiciona a primeira pré-inscrição.')}
      </div>
    </div>
  `;

  const preForm = document.getElementById('preInscricaoFormMain');
  if (preForm) {
    preForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(preForm);
      const payload = {
        nome: fd.get('nome'),
        email: fd.get('email'),
        categoria: fd.get('categoria'),
        desconto: Number(fd.get('desconto') || 0),
        estado: fd.get('estado') || 'Pendente',
        observacoes: fd.get('observacoes'),
        dataPreInscricao: fd.get('dataPreInscricao') || new Date().toISOString().slice(0, 10),
        dataInscricao: fd.get('dataInscricao') || null
      };
      try {
        await api('POST', '/api/preinscricoes', payload);
        await refreshCollections(['preInscricoes']);
        renderPreInscricoes();
        toast('Pré-inscrição guardada.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

function openConverterPreInscricaoForm(id) {
  const pre = state.preInscricoes.find(p => p.id === id);
  if (!pre) return;
  openModal('Converter pré-inscrição em aluno', `
    <form id="converterPreForm">
      <p class="muted" style="margin-bottom:12px">A categoria (<strong>${esc(pre.categoria)}</strong>) e o desconto acordado transitam diretamente desta pré-inscrição para o novo aluno.</p>
      <div class="form-grid">
        <div class="form-field full"><label>Nome</label><input value="${esc(pre.nome)}" disabled></div>
        <div class="form-field"><label>Categoria</label><input value="${esc(pre.categoria)}" disabled></div>
        <div class="form-field"><label>Desconto (%)</label><input name="desconto" type="number" min="0" max="100" step="1" value="${pre.desconto ?? 0}"></div>
        <div class="form-field">
          <label>Espaço físico</label>
          <select name="espacoId" required>
            ${state.espacos.map(e => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">Criar aluno</button>
      </div>
    </form>
  `);
  const form = document.getElementById('converterPreForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = { espacoId: Number(fd.get('espacoId') || 0), desconto: Number(fd.get('desconto') || 0) };
    try {
      await api('POST', `/api/preinscricoes/${id}/converter`, payload);
      await refreshCollections(['preInscricoes']);
      closeModal();
      renderPreInscricoes();
      toast('Pré-inscrição convertida em aluno com sucesso.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function abrirTurmaTeoricaDetalhe(id) {
  const t = state.turmasTeoricas.find(x => x.id === id);
  if (!t) return;
  if (t.estado === 'Agendada') abrirPresencasForm(id);
  else openTurmaTeoricaForm(id);
}

function openTurmaTeoricaForm(id) {
  const item = id ? state.turmasTeoricas.find(t => t.id === id) : null;
  openModal(item ? 'Editar Turma Teórica' : 'Nova Turma Teórica', `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field full"><label>Tema / Assunto da aula</label><input name="tema" required value="${esc(item?.tema || '')}" placeholder="Ex: Sinalização vertical"></div>
        <div class="form-field"><label>Data</label><input name="data" type="date" required value="${item?.data || ''}"></div>
        <div class="form-field">
          <label>Espaço</label>
          <select name="espacoId" required>
            ${state.espacos.map(e => `<option value="${e.id}" ${item?.espacoId === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Hora início</label><input name="horaInicio" type="time" required value="${item?.horaInicio || ''}"></div>
        <div class="form-field"><label>Hora fim</label><input name="horaFim" type="time" required value="${item?.horaFim || ''}"></div>
        <div class="form-field full">
          <label>Estado</label>
          <select name="estado">${['Agendada', 'Concluída', 'Cancelada'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
      </div>
      <p class="muted" style="margin-top:10px">Os alunos podem ser marcados depois, na validação das presenças, sem necessidade de os inscrever previamente.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar turma'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('entityForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      tema: fd.get('tema'), data: fd.get('data'), espacoId: Number(fd.get('espacoId') || 0),
      horaInicio: fd.get('horaInicio'), horaFim: fd.get('horaFim'),
      instrutorId: null,
      estado: fd.get('estado') || 'Agendada',
      inscritos: item?.inscritos || [],
      presencas: item?.presencas || {}
    };
    try {
      if (item) await api('PUT', `/api/turmasTeoricas/${item.id}`, payload);
      else await api('POST', '/api/turmasTeoricas', payload);
      await refreshCollections(['turmasTeoricas']);
      closeModal();
      render();
      toast(item ? 'Turma teórica atualizada.' : 'Turma teórica criada.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function abrirPresencasForm(turmaId) {
  const t = state.turmasTeoricas.find(x => x.id === turmaId);
  if (!t) return;
  const alunosBase = (t.inscritos || []).length
    ? (t.inscritos || []).map(id => findAluno(id)).filter(Boolean)
    : getAlunosAtivos();
  const inscritos = alunosBase.filter(a => a.estado === 'Ativo' || !a.estado);

  openModal(`Presenças · ${t.tema}`, `
    <p class="muted" style="margin-bottom:14px">${fmtDate(t.data)} · ${esc(t.horaInicio)}–${esc(t.horaFim)} · Marca os alunos que estiveram presentes. Esta validação atualiza automaticamente as horas teóricas de cada aluno.</p>
    <div class="form-field" style="margin-bottom:10px">
      <label>Pesquisar aluno por nome ou nº</label>
      <input type="text" id="presencasFiltroInput" placeholder="Escreve o nome ou o número do aluno..." autocomplete="off">
    </div>
    <form id="presencasForm">
      <div id="presencasListaAlunos" style="display:flex; flex-direction:column; gap:2px">
        ${inscritos.length ? inscritos.map(a => `
          <label class="presenca-row" data-nome="${esc(normalizarTexto(a.nome))}" data-num="${esc(String(a.numeroAluno ?? a.id))}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 4px; border-bottom:1px solid var(--border); font-size:14px; font-weight:500; text-transform:none; color:var(--ink)">
            <span>${esc(a.nome)} <span class="muted" style="font-size:12px">· Nº ${a.numeroAluno ?? a.id}</span></span>
            <span style="display:flex; gap:14px">
              <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:600; text-transform:none">
                <input type="radio" name="p_${a.id}" value="1" ${t.presencas?.[a.id] === true ? 'checked' : ''}> Presente
              </label>
              <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:600; text-transform:none; color:var(--danger)">
                <input type="radio" name="p_${a.id}" value="0" ${t.presencas?.[a.id] === false ? 'checked' : ''}> Faltou
              </label>
            </span>
          </label>
        `).join('') : emptyState('Sem alunos ativos', 'Não há alunos ativos para validar presença neste momento.')}
      </div>
      <div id="presencasSemResultados" class="muted" style="padding:10px 4px; display:none">Nenhum aluno encontrado com esse nome ou número.</div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        ${inscritos.length ? `<button type="submit" class="btn btn-accent">Validar presenças e concluir aula</button>` : ''}
      </div>
    </form>
  `);

  const filtroInput = document.getElementById('presencasFiltroInput');
  const linhas = Array.from(document.querySelectorAll('.presenca-row'));
  const semResultados = document.getElementById('presencasSemResultados');
  function aplicarFiltro() {
    const termo = normalizarTexto(filtroInput.value.trim());
    let visiveis = 0;
    linhas.forEach(row => {
      const corresponde = !termo || row.dataset.nome.includes(termo) || row.dataset.num.includes(termo);
      row.style.display = corresponde ? '' : 'none';
      if (corresponde) visiveis++;
    });
    if (semResultados) semResultados.style.display = (linhas.length && !visiveis) ? '' : 'none';
  }
  if (filtroInput) filtroInput.addEventListener('input', aplicarFiltro);

  const form = document.getElementById('presencasForm');
  if (!form.querySelector('button[type="submit"]')) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const presencas = {};
    inscritos.forEach(a => { presencas[a.id] = fd.get('p_' + a.id) === '1'; });
    try {
      await api('PUT', `/api/turmasTeoricas/${turmaId}/presencas`, { presencas, estado: 'Concluída' });
      await refreshCollections(['turmasTeoricas']);
      closeModal();
      render();
      toast('Presenças validadas com sucesso.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderDocumentosAlunoHTML(aluno) {
  const docs = aluno.documentos || [];
  return `
    <div class="table-wrap" style="box-shadow:none; margin-bottom:12px">
      <table>
        <thead><tr><th>Nome</th><th>Ficheiro</th><th>Tamanho</th><th>Carregado em</th><th></th></tr></thead>
        <tbody>
          ${docs.length ? docs.map(d => `
            <tr>
              <td class="cell-primary">${esc(d.nome)}</td>
              <td>${esc(d.filename)}</td>
              <td>${(d.size / 1024).toFixed(0)} KB</td>
              <td>${new Date(d.uploadedAt).toLocaleString('pt-PT')}</td>
              <td>
                <div class="row-actions">
                  <a class="btn btn-ghost btn-sm" href="/api/alunos/${aluno.id}/documentos/${d.id}" target="_blank" rel="noopener">Descarregar</a>
                  <button class="btn btn-danger-ghost btn-sm" onclick="removerDocumentoAluno(${aluno.id}, ${d.id})">Remover</button>
                </div>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="5" class="muted">Sem documentos carregados.</td></tr>`}
        </tbody>
      </table>
    </div>
    <form id="uploadDocumentoForm" style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap">
      <div class="form-field" style="margin-bottom:0; min-width:180px">
        <label>Nome do documento</label>
        <input name="nomeDocumento" required placeholder="Ex: CC, Contrato assinado...">
      </div>
      <div class="form-field" style="margin-bottom:0">
        <label>Ficheiro</label>
        <input type="file" name="ficheiro" required>
      </div>
      <button type="submit" class="btn btn-accent btn-sm">Carregar documento</button>
    </form>
    <p class="muted" style="margin-top:8px; font-size:12px">Máximo 15MB por ficheiro. Sugestões de nome: CC, Cartão de Cidadão, Comprovativo de morada, Contrato assinado, Atestado médico, Foto tipo passe...</p>
  `;
}

function bindUploadDocumentoAluno(alunoId, rerenderFn) {
  const form = document.getElementById('uploadDocumentoForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const nome = fd.get('nomeDocumento');
    const file = form.querySelector('[name="ficheiro"]').files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('O ficheiro não pode exceder 15MB.', 'error'); return; }
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
        reader.readAsDataURL(file);
      });
      await api('POST', `/api/alunos/${alunoId}/documentos`, { nome, filename: file.name, mimeType: file.type, dataBase64 });
      await refreshCollections(['alunos']);
      toast('Documento carregado.');
      rerenderFn();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function removerDocumentoAluno(alunoId, docId) {
  if (!confirm('Tens a certeza que queres remover este documento?')) return;
  try {
    await api('DELETE', `/api/alunos/${alunoId}/documentos/${docId}`);
    await refreshCollections(['alunos']);
    toast('Documento removido.');
    abrirDocumentosAlunoModal(alunoId);
  } catch (err) { toast(err.message, 'error'); }
}

function abrirDocumentosAlunoModal(alunoId) {
  const aluno = findAluno(alunoId);
  if (!aluno) return;
  openModal(`Documentos · ${aluno.nome}`, `
    ${renderDocumentosAlunoHTML(aluno)}
    <div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button></div>
  `);
  bindUploadDocumentoAluno(alunoId, () => abrirDocumentosAlunoModal(alunoId));
}

/* ==================== ALUNOS ==================== */
let alunosSearchTimer = null;

function renderAlunos() {
  const el = document.getElementById('view-alunos');
  const q = state.search.alunos.trim();
  const filtro = state.filter.alunos;
  const estados = ['Ativo', 'Todos', 'Concluído', 'Suspenso'];

  // Base de dados a mostrar: se o filtro é "Ativo" e a coleção completa
  // ainda não chegou, usa a lista rápida (state.alunosAtivos) — assim o
  // ecrã nunca fica vazio à espera da coleção inteira.
  const baseAtivos = (typeof isLoaded === 'function' && isLoaded('alunos'))
    ? state.alunos.filter(a => a.estado === 'Ativo')
    : (state.alunosAtivos || []);

  let list;
  if (filtro === 'Ativo') {
    list = baseAtivos;
  } else if (typeof isLoaded === 'function' && isLoaded('alunos')) {
    list = filtro === 'Todos' ? state.alunos : state.alunos.filter(a => a.estado === filtro);
  } else {
    // Ainda não temos a coleção completa: mostra o que já existe (ativos)
    // e dispara o carregamento completo em segundo plano.
    list = baseAtivos;
    if (typeof ensureCollection === 'function') ensureCollection('alunos');
  }

  const qLower = q.toLowerCase();
  if (qLower) {
    list = list.filter(a =>
      a.nome.toLowerCase().includes(qLower) ||
      (a.email || '').toLowerCase().includes(qLower) ||
      (a.nif || '').includes(qLower) ||
      String(a.numeroAluno ?? a.id).includes(qLower)
    );
  }

  const avisoCarregamento = (!isLoaded('alunos') && filtro !== 'Ativo')
    ? `<div class="inline-alert inline-alert-info" style="margin-bottom:12px">A carregar todos os alunos em segundo plano — os resultados podem estar incompletos por instantes.</div>`
    : '';

  const tableHtml = list.length ? `<table>
    <thead><tr><th>Nº</th><th>Aluno</th><th>Categoria</th><th>Progresso</th><th>Estado</th><th>Documentos</th><th></th></tr></thead>
    <tbody>
      ${list.map(a => {
    const tags = [
      selosValidade(a.atestadoMedico?.dataValidade, 'Atestado médico'),
      a.examePsicotecnico?.aplicavel ? selosValidade(a.examePsicotecnico?.dataValidade, 'Exame psicotécnico') : '',
      selosValidade(a.processoIMT?.dataValidade, 'Processo IMT'), (a.cartasCategorias || []).map(c => selosValidade(c.dataValidade, `Carta ${c.categoria}`))
    ].filter(Boolean).join(' ');
    return `
        <tr>
          <td class="cell-primary">#${a.numeroAluno ?? a.id}</td>
          <td>
            <div style="display:flex; align-items:center; gap:10px">
              ${avatarHtml(a.nome, a.foto, 36)}
              <div>
                <div class="cell-primary">${esc(a.nome)}</div>
                <div class="cell-sub">${esc(a.email || '')} ${a.telefone ? '· ' + esc(a.telefone) : ''} ${a.nif ? '· NIF ' + esc(a.nif) : ''}</div>
              </div>
            </div>
          </td>
          <td>${esc(a.categoria || '—')}</td>
          <td style="min-width:140px">
            <div class="cell-sub" style="margin-bottom:4px">${getAlunoContagens(a).aulasTeoricas} teóricas · ${getAlunoContagens(a).aulasPraticas} práticas</div>
            <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, ((getAlunoContagens(a).aulasPraticas || 0) / 28) * 100)}%"></div></div>
          </td>
          <td><span class="${badgeClass(a.estado)}">${esc(a.estado || '—')}</span></td>
          <td>${tags || '<span class="muted" style="font-size:12px">Em dia</span>'}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-ghost btn-sm" onclick="abrirContaCorrente(${a.id})">Conta Corrente</button>
              <button class="btn btn-ghost btn-sm" onclick="abrirHistoricoAulasModal(${a.id})">Histórico Aulas</button>
              <button class="btn btn-ghost btn-sm" onclick="abrirFichaIndividualModal(${a.id})">Ficha Individual</button>
              <button class="btn btn-ghost btn-sm" onclick="openAutoFillPdfModal(${a.id})">Preencher PDF</button>
              <button class="btn btn-ghost btn-sm" onclick="openAlunoForm(${a.id})">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="abrirDocumentosAlunoModal(${a.id})">Documentos</button>
              <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('alunos', ${a.id}, '${escJs(a.nome)}')">Remover</button>
            </div>
          </td>
        </tr>
      `;
  }).join('')}
    </tbody>
  </table>` : emptyState('Nenhum aluno encontrado', 'Ajusta a pesquisa ou adiciona um novo aluno.');

  const tableWrap = document.getElementById('alunosTableWrap');
  const searchInput = document.getElementById('alunosSearchInput');

  if (tableWrap && searchInput) {
    tableWrap.innerHTML = tableHtml;
    const chips = el.querySelectorAll('.filter-row .chip');
    chips.forEach(c => {
      c.classList.toggle('active', c.textContent.trim() === filtro);
    });
    if (document.activeElement !== searchInput && searchInput.value !== (state.search.alunos || '')) {
      searchInput.value = state.search.alunos || '';
    }
    return;
  }

  el.innerHTML = `
    ${avisoCarregamento}
    <div class="toolbar">
      <input id="alunosSearchInput" class="search-input" placeholder="Pesquisar aluno por nome, email, NIF ou nº..."
        value="${esc(state.search.alunos)}" oninput="updateSearchAndRerender(this, 'alunos', renderAlunos)">
      <div class="filter-row">
        ${estados.map(e => `<button class="chip ${filtro === e ? 'active' : ''}" onclick="mudarFiltroAlunos('${e}')">${e}</button>`).join('')}
      </div>
    </div>
    <div id="alunosTableWrap" class="table-wrap">
      ${tableHtml}
    </div>
  `;
}

/* Trocar de separador: se o filtro pedido precisar da coleção completa
   e ela ainda não estiver carregada, mostra o painel já (com o que houver)
   e vai buscar o resto sem bloquear o clique. */
function mudarFiltroAlunos(estado) {
  state.filter.alunos = estado;
  renderAlunos();
  if (estado !== 'Ativo' && typeof isLoaded === 'function' && !isLoaded('alunos')) {
    ensureCollection('alunos').then(() => renderAlunos());
  }
}

function escJs(s) { return String(s).replace(/'/g, "\\'"); }

/* ==================== TOOLTIP CUSTOMIZADO (substitui os <title> nativos) ====================
   Porquê: o <title> do SVG usa o tooltip nativo do browser — tem delay grande, área de
   hover minúscula nos pontos/linhas finas, sem estilo, e pode ficar cortado pelo overflow
   dos .panel. Esta versão usa um div flutuante posicionado pelo rato, com listeners
   delegados no document (funciona mesmo depois de innerHTML re-renderizar os gráficos). */

function initChartTooltip() {
  if (document.getElementById('chart-tooltip')) return; // já inicializado

  const tip = document.createElement('div');
  tip.id = 'chart-tooltip';
  tip.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 9999;
    background: var(--ink, #1a1a1a);
    color: #fff;
    font-size: 12.5px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.2);
    white-space: pre-line;
    opacity: 0;
    left: 0; top: 0;
    transform: translate(-50%, calc(-100% - 12px));
    transition: opacity 0.08s ease;
    max-width: 240px;
  `;
  document.body.appendChild(tip);

  let alvoAtivo = null;

  document.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (!alvo) return;
    alvoAtivo = alvo;
    tip.textContent = alvo.getAttribute('data-tip');
    tip.style.opacity = '1';
  });

  document.addEventListener('mousemove', (e) => {
    if (!alvoAtivo) return;
    tip.style.left = e.clientX + 'px';
    tip.style.top = e.clientY + 'px';
  });

  document.addEventListener('mouseout', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (!alvo || alvo !== alvoAtivo) return;
    const relacionado = e.relatedTarget;
    if (relacionado && alvo.contains(relacionado)) return;
    alvoAtivo = null;
    tip.style.opacity = '0';
  });

  // Se o rato sair da janela/scroll acontecer, esconde por segurança
  document.addEventListener('scroll', () => { tip.style.opacity = '0'; alvoAtivo = null; }, true);
}


/* ==================== MINI-LIBRARY DE GRÁFICOS SVG (sem dependências) ==================== */
const CHART_CORES = {
  primaria: 'var(--accent, #2657c8)',
  sucesso: 'var(--success, #1f9d55)',
  perigo: 'var(--danger, #d1453b)',
  info: 'var(--info, #2f79c9)',
  neutro: 'var(--muted, #8a94a6)'
};

function chartMesLabelCurto(chaveMes) {
  const [ano, mes] = chaveMes.split('-');
  const rotulo = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-PT', { month: 'short' });
  return rotulo.replace('.', '').charAt(0).toUpperCase() + rotulo.replace('.', '').slice(1);
}

/* Gráfico de linha com área preenchida — usado para séries temporais simples (ex: receita mensal).
   Fix: em vez de <title> no <circle r=3.5"> (área minúscula), agora há um <circle> invisível
   maior (r=12) por cima de cada ponto, com data-tip, para uma área de hover muito mais fácil
   de acertar — e cobre também o hover na zona da linha junto ao ponto. */
function svgLineChart(labels, valores, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 220, pad = 36;
  const max = Math.max(1, ...valores) * 1.15;
  const passoX = (w - pad * 2) / Math.max(1, labels.length - 1);
  const cor = opts.cor || CHART_CORES.primaria;
  const pontos = valores.map((v, i) => [pad + i * passoX, h - pad - (v / max) * (h - pad * 2)]);
  const linhaPath = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${linhaPath} L ${pontos[pontos.length - 1][0].toFixed(1)} ${h - pad} L ${pontos[0][0].toFixed(1)} ${h - pad} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => h - pad - f * (h - pad * 2));

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      ${gridY.map(y => `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`).join('')}
      <path d="${areaPath}" fill="${cor}" opacity="0.12"/>
      <path d="${linhaPath}" fill="none" stroke="${cor}" stroke-width="2.5"/>
      ${pontos.map((p, i) => `
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${cor}"/>
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="12" fill="transparent"
          style="cursor:pointer" data-tip="${esc(labels[i])}: ${fmtNumeroOuMoeda(valores[i], opts.moeda)}"/>
      `).join('')}
      ${labels.map((l, i) => `<text x="${pontos[i][0].toFixed(1)}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>`).join('')}
    </svg>
  `;
}

// Ajuda a formatar o valor no tooltip como dinheiro quando aplicável (ex: receita mensal)
function fmtNumeroOuMoeda(v, moeda) {
  return moeda ? fmtMoney(v) : String(v);
}

/* Gráfico de barras agrupadas (duas séries), ex: aulas teóricas vs práticas por mês. */
function svgBarChartDuplo(labels, serieA, serieB, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 240, pad = 36;
  const max = Math.max(1, ...serieA, ...serieB) * 1.2;
  const grupoW = (w - pad * 2) / labels.length;
  const barraW = Math.min(18, grupoW / 3);
  const corA = opts.corA || CHART_CORES.primaria;
  const corB = opts.corB || CHART_CORES.info;

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" stroke-width="1"/>
      ${labels.map((l, i) => {
    const cx = pad + grupoW * i + grupoW / 2;
    const alturaA = (serieA[i] / max) * (h - pad * 2);
    const alturaB = (serieB[i] / max) * (h - pad * 2);
    return `
          <rect x="${(cx - barraW - 2).toFixed(1)}" y="${(h - pad - alturaA).toFixed(1)}" width="${barraW}" height="${Math.max(alturaA, 1).toFixed(1)}" fill="${corA}" rx="2"
            style="cursor:pointer" data-tip="${esc(l)}\n${esc(opts.nomeA || 'A')}: ${serieA[i]}"/>
          <rect x="${(cx + 2).toFixed(1)}" y="${(h - pad - alturaB).toFixed(1)}" width="${barraW}" height="${Math.max(alturaB, 1).toFixed(1)}" fill="${corB}" rx="2"
            style="cursor:pointer" data-tip="${esc(l)}\n${esc(opts.nomeB || 'B')}: ${serieB[i]}"/>
          <text x="${cx.toFixed(1)}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>
        `;
  }).join('')}
    </svg>
    <div style="display:flex; gap:16px; justify-content:center; margin-top:6px; font-size:12.5px">
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${corA}; margin-right:5px"></span>${esc(opts.nomeA || 'A')}</span>
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${corB}; margin-right:5px"></span>${esc(opts.nomeB || 'B')}</span>
    </div>
  `;
}

/* Gráfico de barras empilhadas (ex: aprovados/reprovados por mês). */
function svgBarChartEmpilhado(labels, serieBase, serieTopo, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 240, pad = 36;
  const totais = labels.map((_, i) => serieBase[i] + serieTopo[i]);
  const max = Math.max(1, ...totais) * 1.2;
  const grupoW = (w - pad * 2) / labels.length;
  const barraW = Math.min(28, grupoW * 0.5);
  const corBase = opts.corBase || CHART_CORES.sucesso;
  const corTopo = opts.corTopo || CHART_CORES.perigo;

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" stroke-width="1"/>
      ${labels.map((l, i) => {
    const cx = pad + grupoW * i + grupoW / 2;
    const alturaBase = (serieBase[i] / max) * (h - pad * 2);
    const alturaTopo = (serieTopo[i] / max) * (h - pad * 2);
    const total = serieBase[i] + serieTopo[i];
    const pct = total > 0 ? ((serieBase[i] / total) * 100).toFixed(0) : '—';
    return `
          <rect x="${(cx - barraW / 2).toFixed(1)}" y="${(h - pad - alturaBase).toFixed(1)}" width="${barraW}" height="${Math.max(alturaBase, 1).toFixed(1)}" fill="${corBase}" rx="2"
            style="cursor:pointer" data-tip="${esc(l)}\n${esc(opts.nomeBase || 'Aprovados')}: ${serieBase[i]}\nTaxa de aprovação: ${pct}%"/>
          <rect x="${(cx - barraW / 2).toFixed(1)}" y="${(h - pad - alturaBase - alturaTopo).toFixed(1)}" width="${barraW}" height="${Math.max(alturaTopo, 1).toFixed(1)}" fill="${corTopo}" rx="2"
            style="cursor:pointer" data-tip="${esc(l)}\n${esc(opts.nomeTopo || 'Reprovados')}: ${serieTopo[i]}"/>
          <text x="${cx.toFixed(1)}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>
        `;
  }).join('')}
    </svg>
    <div style="display:flex; gap:16px; justify-content:center; margin-top:6px; font-size:12.5px">
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${corBase}; margin-right:5px"></span>${esc(opts.nomeBase || 'Aprovados')}</span>
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${corTopo}; margin-right:5px"></span>${esc(opts.nomeTopo || 'Reprovados')}</span>
    </div>
  `;
}

/* Donut chart simples — usado para distribuições (estado dos alunos, categorias). */
function svgDonutChart(items, opts) {
  opts = opts || {};
  const size = opts.size || 180;
  const cx = size / 2, cy = size / 2, rExterno = size / 2 - 4, rInterno = rExterno * 0.6;
  const paleta = opts.paleta || [CHART_CORES.primaria, CHART_CORES.sucesso, CHART_CORES.info, CHART_CORES.perigo, CHART_CORES.neutro, '#a855f7', '#f59e0b'];
  const total = items.reduce((s, it) => s + it.total, 0);
  if (!total) return `<div class="muted" style="padding:12px">Sem dados para mostrar.</div>`;

  let anguloAcumulado = -Math.PI / 2;
  const fatias = items.map((it, i) => {
    const fracao = it.total / total;
    const anguloInicio = anguloAcumulado;
    const anguloFim = anguloAcumulado + fracao * Math.PI * 2;
    anguloAcumulado = anguloFim;
    const largeArc = (anguloFim - anguloInicio) > Math.PI ? 1 : 0;
    const p1x = cx + rExterno * Math.cos(anguloInicio), p1y = cy + rExterno * Math.sin(anguloInicio);
    const p2x = cx + rExterno * Math.cos(anguloFim), p2y = cy + rExterno * Math.sin(anguloFim);
    const p3x = cx + rInterno * Math.cos(anguloFim), p3y = cy + rInterno * Math.sin(anguloFim);
    const p4x = cx + rInterno * Math.cos(anguloInicio), p4y = cy + rInterno * Math.sin(anguloInicio);
    const d = `M ${p1x.toFixed(2)} ${p1y.toFixed(2)} A ${rExterno} ${rExterno} 0 ${largeArc} 1 ${p2x.toFixed(2)} ${p2y.toFixed(2)} L ${p3x.toFixed(2)} ${p3y.toFixed(2)} A ${rInterno} ${rInterno} 0 ${largeArc} 0 ${p4x.toFixed(2)} ${p4y.toFixed(2)} Z`;
    return { d, cor: paleta[i % paleta.length], label: it.label, total: it.total, pct: +(fracao * 100).toFixed(1) };
  });

  return `
    <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap">
      <svg viewBox="0 0 ${size} ${size}" style="width:${size}px; height:${size}px; flex-shrink:0">
        ${fatias.map(f => `<path d="${f.d}" fill="${f.cor}" style="cursor:pointer" data-tip="${esc(f.label)}: ${f.total} (${f.pct}%)"/>`).join('')}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--ink)">${total}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">total</text>
      </svg>
      <div style="display:flex; flex-direction:column; gap:6px; font-size:13px">
        ${fatias.map(f => `
          <div style="display:flex; align-items:center; gap:8px; cursor:pointer" data-tip="${esc(f.label)}: ${f.total} (${f.pct}%)">
            <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${f.cor}"></span>
            <span>${esc(f.label)}</span>
            <span class="muted">— ${f.total} (${f.pct}%)</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* Barras horizontais — usado para rankings (instrutores, veículos).
   Fix: esta função não tinha tooltip nenhum (nem <title>) — agora tem data-tip na linha toda. */
function svgBarChartHorizontal(items, opts) {
  opts = opts || {};
  if (!items.length) return `<div class="muted" style="padding:12px">Sem dados para mostrar.</div>`;
  const max = Math.max(1, ...items.map(i => i.total));
  const cor = opts.cor || CHART_CORES.primaria;
  return `
    <div style="display:flex; flex-direction:column; gap:10px">
      ${items.map(it => `
        <div style="display:grid; grid-template-columns:140px 1fr 40px; align-items:center; gap:10px; font-size:13px; cursor:pointer"
          data-tip="${esc(it.label)}: ${it.total}">
          <span class="cell-primary" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(it.label)}</span>
          <div class="progress-track" style="height:14px"><div class="progress-fill" style="width:${(it.total / max * 100).toFixed(1)}%; background:${cor}"></div></div>
          <span class="muted" style="text-align:right">${it.total}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function svgLineChartDuplo(labels, serieA, serieB, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 220, pad = 36;
  const max = Math.max(1, ...serieA, ...serieB) * 1.15;
  const passoX = (w - pad * 2) / Math.max(1, labels.length - 1);
  const corA = opts.corA || CHART_CORES.primaria;
  const corB = opts.corB || CHART_CORES.neutro;

  const pontosPara = serie => serie.map((v, i) => [pad + i * passoX, h - pad - (v / max) * (h - pad * 2)]);
  const pontosA = pontosPara(serieA);
  const pontosB = pontosPara(serieB);
  const pathDe = pontos => pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => h - pad - f * (h - pad * 2));

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      ${gridY.map(y => `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`).join('')}
      <path d="${pathDe(pontosB)}" fill="none" stroke="${corB}" stroke-width="2" stroke-dasharray="5,4"/>
      <path d="${pathDe(pontosA)}" fill="none" stroke="${corA}" stroke-width="2.5"/>
      ${pontosA.map((p, i) => `
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${corA}"/>
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="12" fill="transparent" style="cursor:pointer"
          data-tip="${esc(labels[i])}\n${esc(opts.nomeA || 'Atual')}: ${fmtNumeroOuMoeda(serieA[i], opts.moeda)}\n${esc(opts.nomeB || 'Ano anterior')}: ${fmtNumeroOuMoeda(serieB[i], opts.moeda)}"/>
      `).join('')}
      ${labels.map((l, i) => `<text x="${pontosA[i][0].toFixed(1)}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>`).join('')}
    </svg>
    <div style="display:flex; gap:16px; justify-content:center; margin-top:6px; font-size:12.5px">
      <span><span style="display:inline-block; width:16px; height:2.5px; background:${corA}; margin-right:5px; vertical-align:middle"></span>${esc(opts.nomeA || 'Atual')}</span>
      <span><span style="display:inline-block; width:16px; height:2px; background:${corB}; margin-right:5px; vertical-align:middle; border-top:2px dashed ${corB}"></span>${esc(opts.nomeB || 'Ano anterior')}</span>
    </div>
  `;
}


/* ---- Funil de conversão (barras horizontais decrescentes com % de conversão) ---- */
function svgFunilChart(etapas, opts) {
  opts = opts || {};
  if (!etapas.length || !etapas[0].total) return `<div class="muted" style="padding:12px">Sem dados para mostrar.</div>`;
  const max = etapas[0].total;
  const cor = opts.cor || CHART_CORES.primaria;

  return `
    <div style="display:flex; flex-direction:column; gap:12px">
      ${etapas.map((e, i) => `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px">
            <span class="cell-primary">${esc(e.etapa)}</span>
            <span class="muted">${e.total}${e.taxaConversaoDesdeInicio !== null ? ` (${e.taxaConversaoDesdeInicio}% do total)` : ''}</span>
          </div>
          <div class="progress-track" style="height:18px; cursor:pointer" data-tip="${esc(e.etapa)}: ${e.total}${i > 0 && e.taxaConversaoEtapaAnterior !== null ? `\nConversão vs etapa anterior: ${e.taxaConversaoEtapaAnterior}%` : ''}">
            <div class="progress-fill" style="width:${((e.total / max) * 100).toFixed(1)}%; background:${cor}"></div>
          </div>
          ${i > 0 && e.taxaConversaoEtapaAnterior !== null ? `<div class="muted" style="font-size:11.5px; margin-top:2px">↳ ${e.taxaConversaoEtapaAnterior}% dos que chegaram à etapa anterior</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function svgBarChartSimples(labels, valores, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 220, pad = 36;
  const max = Math.max(1, ...valores) * 1.2;
  const grupoW = (w - pad * 2) / labels.length;
  const barraW = Math.min(52, grupoW * 0.5);
  const cor = opts.cor || CHART_CORES.primaria;

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" stroke-width="1"/>
      ${labels.map((l, i) => {
    const cx = pad + grupoW * i + grupoW / 2;
    const altura = (valores[i] / max) * (h - pad * 2);
    const extra = opts.tips && opts.tips[i] ? `\n${opts.tips[i]}` : '';
    return `
          <rect x="${(cx - barraW / 2).toFixed(1)}" y="${(h - pad - altura).toFixed(1)}" width="${barraW}" height="${Math.max(altura, 1).toFixed(1)}" fill="${cor}" rx="3"
            style="cursor:pointer" data-tip="${esc(l)}: ${fmtNumeroOuMoeda(valores[i], opts.moeda)}${extra}"/>
          <text x="${cx.toFixed(1)}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>
        `;
  }).join('')}
    </svg>
  `;
}

/* Tabela detalhada do comparativo anual — complementa o gráfico com todos os números lado a lado. */
function tabelaComparativoAnualHTML(comparativoAnual) {
  if (!comparativoAnual || !comparativoAnual.length) {
    return `<div class="muted" style="padding:12px">Sem dados para mostrar.</div>`;
  }
  const corVariacao = v => v == null ? 'var(--muted)' : (v >= 0 ? 'var(--success, #1f9d55)' : 'var(--danger, #d1453b)');
  const fmtVariacao = v => v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%`;

  return `
    <div style="overflow-x:auto; margin-top:14px">
      <table style="width:100%; border-collapse:collapse; font-size:13px">
        <thead>
          <tr style="text-align:left; border-bottom:1px solid var(--border)">
            <th style="padding:8px 10px">Ano</th>
            <th style="padding:8px 10px">Receita</th>
            <th style="padding:8px 10px">Var. receita</th>
            <th style="padding:8px 10px">Inscrições</th>
            <th style="padding:8px 10px">Var. inscrições</th>
            <th style="padding:8px 10px">Aulas concluídas</th>
            <th style="padding:8px 10px">Taxa aprovação</th>
          </tr>
        </thead>
        <tbody>
          ${comparativoAnual.map(a => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 10px" class="cell-primary">${a.ano}</td>
              <td style="padding:8px 10px">${fmtMoney(a.receita)}</td>
              <td style="padding:8px 10px; color:${corVariacao(a.variacaoReceitaPct)}">${fmtVariacao(a.variacaoReceitaPct)}</td>
              <td style="padding:8px 10px">${a.inscricoes}</td>
              <td style="padding:8px 10px; color:${corVariacao(a.variacaoInscricoesPct)}">${fmtVariacao(a.variacaoInscricoesPct)}</td>
              <td style="padding:8px 10px">${a.aulasConcluidas}</td>
              <td style="padding:8px 10px">${a.taxaAprovacao ?? '—'}${a.taxaAprovacao != null ? '%' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function svgLineChartMediana(labels, valores, amostras, opts) {
  opts = opts || {};
  const w = opts.width || 760, h = opts.height || 220, pad = 36;
  const valoresValidos = valores.filter(v => v !== null);
  const max = Math.max(1, ...(valoresValidos.length ? valoresValidos : [1])) * 1.25;
  const passoX = (w - pad * 2) / Math.max(1, labels.length - 1);
  const cor = opts.cor || CHART_CORES.info;
  const pontos = valores.map((v, i) => v === null ? null : [pad + i * passoX, h - pad - (v / max) * (h - pad * 2)]);
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => h - pad - f * (h - pad * 2));

  // Constrói o path só entre pontos consecutivos válidos (evita "saltar" visualmente sobre meses sem dados)
  let path = '';
  pontos.forEach((p, i) => {
    if (p === null) return;
    const anterior = i > 0 ? pontos[i - 1] : null;
    path += (anterior === null ? 'M' : 'L') + ` ${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
  });

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px" preserveAspectRatio="xMidYMid meet">
      ${gridY.map(y => `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3"/>`).join('')}
      <path d="${path}" fill="none" stroke="${cor}" stroke-width="2.5"/>
      ${pontos.map((p, i) => p === null ? '' : `
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${cor}"/>
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="12" fill="transparent" style="cursor:pointer"
          data-tip="${esc(labels[i])}\nMediana: ${valores[i]} dias\nAmostra: ${amostras[i]} aluno(s)"/>
      `).join('')}
      ${labels.map((l, i) => `<text x="${pad + i * passoX}" y="${h - 10}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(l)}</text>`).join('')}
    </svg>
  `;
}

/* ==================== (2) FILTROS + CARREGAMENTO — substitui renderEstatisticas() ==================== */

/* Filtros vivem em state.estatisticasFiltros (cria o objeto global "state" se ainda não existir). */
if (typeof state === 'undefined') { var state = {}; }
state.estatisticasFiltros = state.estatisticasFiltros || { modo: 'rolante12', ano: null, anosComparacao: 5 };

function queryStringEstatisticas() {
  const f = state.estatisticasFiltros;
  const params = new URLSearchParams();
  if (f.modo === 'anoCivil' && f.ano) params.set('ano', f.ano);
  if (f.anosComparacao) params.set('anosComparacao', f.anosComparacao);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function renderEstatisticas() {
  initChartTooltip();
  const el = document.getElementById('view-estatisticas');
  if (!document.getElementById('estatisticas-conteudo')) {
    el.innerHTML = `
      <div id="estatisticas-filtros"></div>
      <div id="estatisticas-conteudo"><div class="muted" style="padding:12px">A carregar estatísticas...</div></div>
    `;
  } else {
    document.getElementById('estatisticas-conteudo').innerHTML = `<div class="muted" style="padding:12px">A carregar estatísticas...</div>`;
  }
  try {
    const dados = await api('GET', `/api/estatisticas${queryStringEstatisticas()}`);
    state.estatisticas = dados;
    montarFiltrosEstatisticasHTML(dados);
    montarEstatisticasHTML(dados);
    carregarMapaGeral().catch(() => { });
    carregarEsperaTeoricaPratica().catch(() => { });
    carregarInscricoesEspaco().catch(() => { });
    carregarFluxoCaixa().catch(() => { });
  } catch (err) {
    console.error('Erro ao carregar estatísticas:', err);
    document.getElementById('estatisticas-conteudo').innerHTML = emptyState('Erro ao carregar estatísticas', err.message);
  }
}
window.renderEstatisticas = renderEstatisticas;

/* Barra de filtros: período (rolante/ano civil) + ano + nº de anos a comparar. */
function montarFiltrosEstatisticasHTML(d) {
  const f = state.estatisticasFiltros;
  const anosDisponiveis = d.anosDisponiveis || [];
  const alvo = document.getElementById('estatisticas-filtros');

  alvo.innerHTML = `
    <div class="panel" style="margin-bottom:20px; display:flex; gap:20px; align-items:center; flex-wrap:wrap">
      <div style="display:flex; gap:8px; align-items:center">
        <label class="muted" style="font-size:12.5px">Período</label>
        <select id="filtro-modo-estatisticas" style="padding:6px 10px; border-radius:6px; border:1px solid var(--border)">
          <option value="rolante12" ${f.modo === 'rolante12' ? 'selected' : ''}>Últimos 12 meses</option>
          <option value="anoCivil" ${f.modo === 'anoCivil' ? 'selected' : ''}>Ano civil</option>
        </select>
      </div>
 
      ${f.modo === 'anoCivil' ? `
      <div style="display:flex; gap:8px; align-items:center">
        <label class="muted" style="font-size:12.5px">Ano</label>
        <select id="filtro-ano-estatisticas" style="padding:6px 10px; border-radius:6px; border:1px solid var(--border)">
          ${anosDisponiveis.map(a => `<option value="${a}" ${Number(f.ano) === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>` : ''}
 
      <div style="display:flex; gap:8px; align-items:center">
        <label class="muted" style="font-size:12.5px">Comparativo anual — últimos</label>
        <select id="filtro-anos-comparacao-estatisticas" style="padding:6px 10px; border-radius:6px; border:1px solid var(--border)">
          ${[3, 5, 8, 10].map(n => `<option value="${n}" ${f.anosComparacao === n ? 'selected' : ''}>${n} anos</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  document.getElementById('filtro-modo-estatisticas').addEventListener('change', async (e) => {
    const modo = e.target.value;
    const filtros = { modo };
    if (modo === 'anoCivil' && !state.estatisticasFiltros.ano) {
      filtros.ano = anosDisponiveis[anosDisponiveis.length - 1] || new Date().getFullYear();
    }
    state.estatisticasFiltros = { ...state.estatisticasFiltros, ...filtros };
    await renderEstatisticas();
  });

  const selAno = document.getElementById('filtro-ano-estatisticas');
  if (selAno) {
    selAno.addEventListener('change', async (e) => {
      state.estatisticasFiltros = { ...state.estatisticasFiltros, ano: Number(e.target.value) };
      await renderEstatisticas();
    });
  }

  document.getElementById('filtro-anos-comparacao-estatisticas').addEventListener('change', async (e) => {
    state.estatisticasFiltros = { ...state.estatisticasFiltros, anosComparacao: Number(e.target.value) };
    await renderEstatisticas();
  });
}

/* ==================== VISTA DE ESTATÍSTICAS ==================== */

function montarEstatisticasHTML(d) {
  const el = document.getElementById('estatisticas-conteudo') || document.getElementById('view-estatisticas');
  if (!el) return;
  if (!d) {
    el.innerHTML = emptyState('Sem dados', 'Não foram encontrados dados estatísticos.');
    return;
  }

  // --- Extração e Resolução Segura de Dados ---
  const kpis = d.kpis || {};
  const labelsMes = (d.receitaMensal || []).map(m => chartMesLabelCurto(m.mes));
  const conclusoes = gerarConclusoes(d);

  // Dados de comparação homóloga e do funil com fallbacks de segurança
  const h = d.comparacaoHomologa || kpis.comparacaoHomologa || {
    porMes: [],
    totais: {
      receita: { atual: 0, anterior: 0, variacaoPct: null },
      inscricoes: { atual: 0, anterior: 0, variacaoPct: null },
      aulasConcluidas: { atual: 0, anterior: 0, variacaoPct: null },
      taxaAprovacao: { atual: null, anterior: null, variacaoPP: null }
    }
  };
  const labelsHomologo = (h.porMes || []).map(m => chartMesLabelCurto(m.mes));

  const funil = d.funilConversao || kpis.funilConversao || [];
  const tentMedias = d.tentativasMediasExame || kpis.tentativasMediasExame || { teorico: null, pratico: null };
  const receitaCat = d.receitaPorCategoria || kpis.receitaPorCategoria || [];
  const desempInstr = d.desempenhoInstrutores || kpis.desempenhoInstrutores || [];
  const agingPag = d.agingPagamentosPendentes || kpis.agingPagamentosPendentes || [];

  // --- Auxiliar de Renderização para Cards de Variação ---
  const cardVariacao = (label, valorAtual, valorAnterior, variacao, formatador) => {
    const positivo = variacao !== null && variacao !== undefined && variacao >= 0;
    const corVariacao = (variacao === null || variacao === undefined)
      ? 'var(--muted)'
      : (positivo ? 'var(--success, #1f9d55)' : 'var(--danger, #d1453b)');
    const seta = (variacao === null || variacao === undefined) ? '' : (positivo ? '▲' : '▼');

    return `
      <div class="stat-card">
        <div class="stat-value">${formatador(valorAtual)}</div>
        <div class="stat-label">${label}</div>
        <div style="font-size:12px; margin-top:4px; color:${corVariacao}">
          ${(variacao === null || variacao === undefined)
        ? 'sem dados do ano anterior'
        : `${seta} ${Math.abs(variacao)}% vs ${formatador(valorAnterior)} no período homólogo`}
        </div>
      </div>
    `;
  };

  // --- Construção da Interface Unificada ---
  el.innerHTML = `
    <!-- 1. GRELHA DE KPIS PRINCIPAIS -->
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-value">${kpis.totalAlunosAtivos ?? 0}</div>
        <div class="stat-label">Alunos ativos</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(kpis.receitaMesAtual ?? 0)}</div>
        <div class="stat-label">Receita do mês atual</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(kpis.receitaUltimos12Meses ?? 0)}</div>
        <div class="stat-label">Receita últimos 12 meses</div>
      </div>
      <div class="stat-card ${kpis.receitaPendenteTotal > 0 ? 'cc-stat-danger' : ''}">
        <div class="stat-value">${fmtMoney(kpis.receitaPendenteTotal ?? 0)}</div>
        <div class="stat-label">Pagamentos pendentes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${kpis.taxaAprovacaoGeral ?? '—'}${kpis.taxaAprovacaoGeral !== null && kpis.taxaAprovacaoGeral !== undefined ? '%' : ''}</div>
        <div class="stat-label">Taxa de aprovação geral</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${kpis.aulasConcluidasUltimos12Meses ?? 0}</div>
        <div class="stat-label">Aulas concluídas (12 meses)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${kpis.inscricoesUltimos12Meses ?? 0}</div>
        <div class="stat-label">Novas inscrições (12 meses)</div>
      </div>
    </div>

    <!-- 2. CONCLUSÕES AUTOMÁTICAS -->
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Conclusões automáticas</h3></div>
      ${renderConclusoesHTML(conclusoes)}
    </div>

    <!-- 3. EVOLUÇÃO FINANCEIRA E INSCRIÇÕES -->
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Receita mensal (últimos 12 meses)</h3></div>
      ${svgLineChart(labelsMes, (d.receitaMensal || []).map(m => m.total), { cor: CHART_CORES.sucesso, moeda: true })}
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Novas inscrições por mês</h3></div>
      ${svgLineChart(labelsMes, (d.inscricoesMensais || []).map(m => m.total), { cor: CHART_CORES.primaria })}
    </div>

    <!-- 4. OPERAÇÃO: AULAS E EXAMES -->
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Aulas concluídas por mês — Teóricas vs Práticas</h3></div>
      ${svgBarChartDuplo(
    labelsMes,
    (d.aulasMensais || []).map(m => m.praticas),
    (d.aulasMensais || []).map(m => m.teoricas),
    { nomeA: 'Práticas', nomeB: 'Teóricas', corA: CHART_CORES.primaria, corB: CHART_CORES.info }
  )}
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Exames por mês — Aprovados vs Reprovados</h3>
        <span class="muted" style="font-size:12.5px">
          Teórico: ${kpis.taxaAprovacaoTeorico ?? '—'}${kpis.taxaAprovacaoTeorico !== null && kpis.taxaAprovacaoTeorico !== undefined ? '%' : ''} de aprovação ·
          Prático: ${kpis.taxaAprovacaoPratico ?? '—'}${kpis.taxaAprovacaoPratico !== null && kpis.taxaAprovacaoPratico !== undefined ? '%' : ''} de aprovação
        </span>
      </div>
      ${svgBarChartEmpilhado(
    labelsMes,
    (d.examesMensais || []).map(m => m.aprovados),
    (d.examesMensais || []).map(m => m.reprovados),
    {}
  )}
    </div>

    <div class="panel" style="margin-bottom:20px">
       <div class="panel-head">
         <h3>Tempo de espera até à 1.ª aula prática (mediana mensal)</h3>
         <span class="muted" style="font-size:12.5px">Contabilizado no mês em que ocorre a 1.ª aula prática</span>
       </div>
       ${(d.tempoEsperaMensal || []).some(m => m.medianaDias !== null)
      ? svgLineChartMediana(
        (d.tempoEsperaMensal || []).map(m => chartMesLabelCurto(m.mes)),
        (d.tempoEsperaMensal || []).map(m => m.medianaDias),
        (d.tempoEsperaMensal || []).map(m => m.amostras),
        { cor: CHART_CORES.info }
      )
      : `<div class="muted" style="padding:12px">Ainda sem dados suficientes (é preciso ter exame teórico aprovado e 1.ª aula prática concluída para o mesmo aluno).</div>`}
     </div>

    <!-- 5. COMPARAÇÃO HOMÓLOGA -->
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Comparação com o ano anterior (mesmo período)</h3></div>
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit, minmax(200px,1fr)); margin-bottom:16px">
        ${cardVariacao('Receita', h.totais.receita.atual, h.totais.receita.anterior, h.totais.receita.variacaoPct, fmtMoney)}
        ${cardVariacao('Novas inscrições', h.totais.inscricoes.atual, h.totais.inscricoes.anterior, h.totais.inscricoes.variacaoPct, v => String(v))}
        ${cardVariacao('Aulas concluídas', h.totais.aulasConcluidas.atual, h.totais.aulasConcluidas.anterior, h.totais.aulasConcluidas.variacaoPct, v => String(v))}
        
        <div class="stat-card">
          <div class="stat-value">${h.totais.taxaAprovacao.atual ?? '—'}${h.totais.taxaAprovacao.atual !== null && h.totais.taxaAprovacao.atual !== undefined ? '%' : ''}</div>
          <div class="stat-label">Taxa de aprovação</div>
          <div style="font-size:12px; margin-top:4px; color:var(--muted)">
            ${(h.totais.taxaAprovacao.variacaoPP === null || h.totais.taxaAprovacao.variacaoPP === undefined)
      ? 'sem dados do ano anterior'
      : `${h.totais.taxaAprovacao.variacaoPP >= 0 ? '▲' : '▼'} ${Math.abs(h.totais.taxaAprovacao.variacaoPP)} p.p. vs ${h.totais.taxaAprovacao.anterior}% no período homólogo`}
          </div>
        </div>
      </div>
      ${svgLineChartDuplo(
        labelsHomologo,
        (h.porMes || []).map(m => m.receitaAtual),
        (h.porMes || []).map(m => m.receitaAnterior),
        { cor: CHART_CORES.primaria, corA: CHART_CORES.primaria, corB: CHART_CORES.neutro, moeda: true, nomeA: 'Período atual', nomeB: 'Ano anterior' }
      )}
    </div>

    <!-- 6. FUNIL DE CONVERSÃO -->
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Funil de conversão</h3></div>
      ${svgFunilChart(funil)}
    </div>

      <div class="panel" style="margin-bottom:20px">
    <div class="panel-head">
      <h3>Comparativo anual</h3>
      <span class="muted" style="font-size:12px">${(d.comparativoAnual || []).length} anos · ${d.modo === 'anoCivil' ? `ano civil selecionado: ${d.anoSelecionado}` : 'período rolante de 12 meses'}</span>
    </div>
    ${svgBarChartSimples(
        (d.comparativoAnual || []).map(a => String(a.ano)),
        (d.comparativoAnual || []).map(a => a.receita),
        {
          cor: CHART_CORES.sucesso,
          moeda: true,
          tips: (d.comparativoAnual || []).map(a => a.variacaoReceitaPct != null ? `Variação vs ano anterior: ${a.variacaoReceitaPct >= 0 ? '+' : ''}${a.variacaoReceitaPct}%` : 'Sem ano anterior para comparar')
        }
      )}
    ${tabelaComparativoAnualHTML(d.comparativoAnual)}
  </div>

    <!-- 7. DISTRIBUIÇÕES DE ALUNOS -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px,1fr)); gap:20px; margin-bottom:20px">
      <div class="panel">
        <div class="panel-head"><h3>Distribuição de alunos por estado</h3></div>
        ${svgDonutChart((d.alunosPorEstado || []).map(e => ({ label: e.estado, total: e.total })), { paleta: [CHART_CORES.primaria, CHART_CORES.sucesso, CHART_CORES.perigo] })}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Distribuição de alunos por categoria</h3></div>
        ${svgDonutChart((d.alunosPorCategoria || []).map(c => ({ label: c.categoria, total: c.total })))}
      </div>
    </div>

    <!-- 8. RECURSOS E ANÁLISES AVANÇADAS -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px,1fr)); gap:20px; margin-bottom:20px">
      <div class="panel">
        <div class="panel-head"><h3>Tentativas médias até à aprovação</h3></div>
        <div class="stat-grid" style="grid-template-columns:repeat(auto-fit, minmax(140px,1fr))">
          <div class="stat-card">
            <div class="stat-value">${tentMedias.teorico ?? '—'}</div>
            <div class="stat-label">Exame teórico</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${tentMedias.pratico ?? '—'}</div>
            <div class="stat-label">Exame prático</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Receita por categoria</h3></div>
        ${svgBarChartHorizontal(receitaCat.map(c => ({ label: c.categoria, total: c.total })), { cor: CHART_CORES.sucesso })}
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px,1fr)); gap:20px; margin-bottom:20px">
      <div class="panel">
        <div class="panel-head"><h3>Carga de trabalho por instrutor</h3><span class="muted" style="font-size:12px">Últimos 3 meses</span></div>
        ${svgBarChartHorizontal((d.cargaPorInstrutor || []).map(i => ({ label: i.nome, total: i.total })), { cor: CHART_CORES.primaria })}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Utilização de veículos</h3><span class="muted" style="font-size:12px">Aulas práticas · últimos 3 meses</span></div>
        ${svgBarChartHorizontal((d.utilizacaoVeiculos || []).map(v => ({ label: v.matricula, total: v.total })), { cor: CHART_CORES.info })}
      </div>
    </div>

    <!-- 9. DESEMPENHO E AGING -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(340px,1fr)); gap:20px; margin-bottom:20px">
      <div class="panel">
        <div class="panel-head"><h3>Taxa de aprovação por instrutor</h3><span class="muted" style="font-size:12px">Exame prático · min. 3 exames</span></div>
        ${desempInstr.length
      ? svgBarChartHorizontal(desempInstr.map(i => ({ label: i.nome, total: i.taxaAprovacao })), { cor: CHART_CORES.info })
      : `<div class="muted" style="padding:12px">Ainda sem dados suficientes.</div>`}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Pagamentos pendentes por antiguidade</h3></div>
        ${svgBarChartHorizontal(agingPag.map(f => ({ label: f.label, total: f.total })), { cor: CHART_CORES.perigo })}
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>⚠ Alertas — espera exame teórico → prática</h3></div>
      <div id="alertasEsperaBox">A carregar...</div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Espera entre exame teórico aprovado e 1.ª aula prática</h3>
        <span class="muted" style="font-size:12.5px">Ordenado do maior para o menor tempo de espera</span>
      </div>
      <div id="esperaTeoricaPraticaBox">A carregar...</div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Inscrições por espaço</h3></div>
      <div id="inscricoesEspacoBox">A carregar...</div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h3>Fluxo de caixa (pagamentos recebidos)</h3></div>
      <div id="fluxoCaixaBox">A carregar...</div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>Mapa geral de assiduidade</h3>
        <button class="btn btn-ghost btn-sm" onclick="imprimirMapaGeral()">Exportar PDF do mapa</button>
      </div>
      <div id="mapaGeralBox">A carregar mapa…</div>
    </div>
  `;
}

/* ==================== CONCLUSÕES AUTOMÁTICAS ==================== */

const media = arr => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const variacaoPercentual = (atual, anterior) => anterior ? ((atual - anterior) / anterior) * 100 : null;
const desvioPercentualDaMedia = (valor, media) => media ? Math.abs((valor - media) / media) * 100 : 0;

function gerarConclusoes(d) {
  if (!d) return [];

  const conclusoes = [];
  const kpis = d.kpis || {};

  // Resoluções de dados seguras (raiz ou kpis)
  const homologa = d.comparacaoHomologa || kpis.comparacaoHomologa;
  const funil = d.funilConversao || kpis.funilConversao;
  const desempInstrutores = d.desempenhoInstrutores || kpis.desempenhoInstrutores;
  const aging = d.agingPagamentosPendentes || kpis.agingPagamentosPendentes;
  const tentMedias = d.tentativasMediasExame || kpis.tentativasMediasExame;

  // 1. Variação de receita mensal (mês atual vs anterior)
  const rMensal = d.receitaMensal;
  if (rMensal && rMensal.length >= 2) {
    const ultimo = rMensal[rMensal.length - 1];
    const penultimo = rMensal[rMensal.length - 2];
    const variacao = variacaoPercentual(ultimo.total, penultimo.total);
    if (variacao !== null) {
      const sinal = variacao >= 0 ? 'positivo' : 'negativo';
      const seta = variacao >= 0 ? '▲' : '▼';
      conclusoes.push({
        tipo: sinal,
        texto: `Receita mensal ${variacao >= 0 ? 'subiu' : 'desceu'} ${seta} ${Math.abs(variacao).toFixed(1)}% face ao mês anterior (${fmtMoney(penultimo.total)} → ${fmtMoney(ultimo.total)}).`
      });
    }
  }

  // 2. Alerta de receita pendente vs receita do mês
  if (kpis.receitaPendenteTotal > 0) {
    const pctPendente = kpis.receitaMesAtual > 0 ? (kpis.receitaPendenteTotal / kpis.receitaMesAtual) * 100 : null;
    conclusoes.push({
      tipo: kpis.receitaPendenteTotal > kpis.receitaMesAtual * 0.3 ? 'alerta' : 'neutro',
      texto: pctPendente !== null
        ? `Há ${fmtMoney(kpis.receitaPendenteTotal)} em pagamentos pendentes — equivalente a ${pctPendente.toFixed(0)}% da receita do mês atual.`
        : `Há ${fmtMoney(kpis.receitaPendenteTotal)} em pagamentos pendentes.`
    });
  }

  // 3. Aceleração/abrandamento das inscrições (trimestre vs trimestre anterior)
  const insc = d.inscricoesMensais;
  if (insc && insc.length >= 6) {
    const recentes = insc.slice(-3).map(m => m.total);
    const anteriores = insc.slice(-6, -3).map(m => m.total);
    const variacao = variacaoPercentual(media(recentes), media(anteriores));
    if (variacao !== null && Math.abs(variacao) >= 5) {
      conclusoes.push({
        tipo: variacao >= 0 ? 'positivo' : 'negativo',
        texto: `As novas inscrições ${variacao >= 0 ? 'aceleraram' : 'abrandaram'} ${Math.abs(variacao).toFixed(0)}% no último trimestre face ao trimestre anterior.`
      });
    }
  }

  // 4. Disparidade de aprovação entre Exame Teórico e Prático
  if (kpis.taxaAprovacaoTeorico != null && kpis.taxaAprovacaoPratico != null) {
    const diff = kpis.taxaAprovacaoTeorico - kpis.taxaAprovacaoPratico;
    if (Math.abs(diff) >= 10) {
      const maisFraco = diff > 0 ? 'prático' : 'teórico';
      conclusoes.push({
        tipo: 'alerta',
        texto: `A taxa de aprovação no exame ${maisFraco} está ${Math.abs(diff).toFixed(0)} pontos percentuais abaixo do outro exame — pode valer a pena reforçar preparação nessa vertente.`
      });
    }
  }

  // 5. Taxa de aprovação geral abaixo do objetivo
  if (kpis.taxaAprovacaoGeral != null && kpis.taxaAprovacaoGeral < 70) {
    conclusoes.push({
      tipo: 'alerta',
      texto: `A taxa de aprovação geral está em ${kpis.taxaAprovacaoGeral}%, abaixo dos 70% — vale a pena investigar causas.`
    });
  }

  const espera = d.tempoEsperaMensal;
  if (espera && espera.length >= 2) {
    const comDados = espera.filter(m => m.medianaDias !== null);
    if (comDados.length >= 2) {
      const ultimo = comDados[comDados.length - 1];
      const penultimo = comDados[comDados.length - 2];
      if (ultimo.medianaDias > penultimo.medianaDias * 1.3) {
        conclusoes.push({
          tipo: 'alerta',
          texto: `A mediana de espera até à 1.ª aula prática subiu de ${penultimo.medianaDias} para ${ultimo.medianaDias} dias — vale a pena verificar a disponibilidade de agenda para práticas.`
        });
      }
    }
  }

  // 6. Desequilíbrio na carga de trabalho dos instrutores
  const carga = d.cargaPorInstrutor;
  if (carga && carga.length >= 2) {
    const valores = carga.map(i => i.total);
    const mediaCarga = media(valores);
    const maisCarregado = carga.reduce((a, b) => (a.total > b.total ? a : b));
    const menosCarregado = carga.reduce((a, b) => (a.total < b.total ? a : b));
    const desvioMax = desvioPercentualDaMedia(maisCarregado.total, mediaCarga);
    if (desvioMax >= 40) {
      conclusoes.push({
        tipo: 'alerta',
        texto: `${maisCarregado.nome} tem uma carga de trabalho ${desvioMax.toFixed(0)}% acima da média da equipa, enquanto ${menosCarregado.nome} tem apenas ${menosCarregado.total} aulas — pode valer a pena redistribuir aulas.`
      });
    }
  }

  // 7. Subutilização de veículos
  const veiculos = d.utilizacaoVeiculos;
  if (veiculos && veiculos.length >= 2) {
    const valores = veiculos.map(v => v.total);
    const mediaUso = media(valores);
    const menosUsado = veiculos.reduce((a, b) => (a.total < b.total ? a : b));
    if (mediaUso > 0 && menosUsado.total < mediaUso * 0.4) {
      conclusoes.push({
        tipo: 'neutro',
        texto: `O veículo ${menosUsado.matricula} está claramente subutilizado (${menosUsado.total} aulas nos últimos 3 meses, vs. média de ${mediaUso.toFixed(0)}) — pondera reafectá-lo ou rever a frota.`
      });
    }
  }

  // 8. Concentração excessiva numa categoria de carta
  const categorias = d.alunosPorCategoria;
  if (categorias && categorias.length) {
    const totalAlunos = categorias.reduce((a, c) => a + c.total, 0);
    const dominante = categorias.reduce((a, b) => (a.total > b.total ? a : b));
    const pct = totalAlunos > 0 ? (dominante.total / totalAlunos) * 100 : 0;
    if (pct >= 60) {
      conclusoes.push({
        tipo: 'neutro',
        texto: `${pct.toFixed(0)}% dos alunos estão inscritos na categoria ${dominante.categoria} — a procura está fortemente concentrada nesta categoria.`
      });
    }
  }

  // 9. Rácio atípico de aulas práticas vs teóricas
  const aulas = d.aulasMensais;
  if (aulas && aulas.length) {
    const ultimoMes = aulas[aulas.length - 1];
    const total = ultimoMes.praticas + ultimoMes.teoricas;
    if (total > 0) {
      const pctPraticas = (ultimoMes.praticas / total) * 100;
      if (pctPraticas < 30 || pctPraticas > 80) {
        conclusoes.push({
          tipo: 'neutro',
          texto: `No último mês, ${pctPraticas.toFixed(0)}% das aulas concluídas foram práticas — um rácio pouco habitual entre práticas e teóricas.`
        });
      }
    }
  }

  // 10. Comparação homóloga — receita
  const hReceita = homologa?.totais?.receita;
  if (hReceita && hReceita.variacaoPct !== null && hReceita.variacaoPct !== undefined && Math.abs(hReceita.variacaoPct) >= 5) {
    conclusoes.push({
      tipo: hReceita.variacaoPct >= 0 ? 'positivo' : 'negativo',
      texto: `Receita do período atual está ${Math.abs(hReceita.variacaoPct)}% ${hReceita.variacaoPct >= 0 ? 'acima' : 'abaixo'} do mesmo período do ano anterior (${fmtMoney(hReceita.anterior)} → ${fmtMoney(hReceita.atual)}).`
    });
  }

  // 11. Comparação homóloga — taxa de aprovação
  const hTaxa = homologa?.totais?.taxaAprovacao;
  if (hTaxa && hTaxa.variacaoPP !== null && hTaxa.variacaoPP !== undefined && Math.abs(hTaxa.variacaoPP) >= 5) {
    conclusoes.push({
      tipo: hTaxa.variacaoPP >= 0 ? 'positivo' : 'alerta',
      texto: `A taxa de aprovação está ${Math.abs(hTaxa.variacaoPP)} pontos percentuais ${hTaxa.variacaoPP >= 0 ? 'acima' : 'abaixo'} da registada no mesmo período do ano anterior.`
    });
  }

  // 12. Funil de conversão — maior quebra
  if (funil && funil.length > 1) {
    const quebras = funil.slice(1).map((e, i) => ({
      de: funil[i].etapa,
      para: e.etapa,
      taxa: e.taxaConversaoEtapaAnterior
    })).filter(q => q.taxa !== null && q.taxa !== undefined);

    if (quebras.length) {
      const piorQuebra = quebras.reduce((a, b) => (a.taxa < b.taxa ? a : b));
      if (piorQuebra.taxa < 60) {
        conclusoes.push({
          tipo: 'alerta',
          texto: `A maior quebra no funil de conversão está entre "${piorQuebra.de}" e "${piorQuebra.para}" — só ${piorQuebra.taxa}% avançam para essa etapa.`
        });
      }
    }
  }

  // 13. Instrutor com melhor/pior desempenho no exame prático
  if (desempInstrutores && desempInstrutores.length >= 2) {
    const ordenados = [...desempInstrutores].sort((a, b) => b.taxaAprovacao - a.taxaAprovacao);
    const melhor = ordenados[0];
    const pior = ordenados[ordenados.length - 1];

    if (melhor && pior && melhor.taxaAprovacao !== null && pior.taxaAprovacao !== null) {
      if (melhor.taxaAprovacao - pior.taxaAprovacao >= 25) {
        conclusoes.push({
          tipo: 'neutro',
          texto: `${melhor.nome} tem a maior taxa de aprovação no exame prático entre os alunos que acompanhou (${melhor.taxaAprovacao}%), bastante acima de ${pior.nome} (${pior.taxaAprovacao}%) — pode valer a pena partilhar boas práticas entre a equipa.`
        });
      }
    }
  }

  // 14. Pagamentos pendentes há muito tempo (Aging 90+ dias)
  const faixaAntiga = aging?.find(f => f.label === '90+ dias' || f.label.includes('90'));
  if (faixaAntiga && faixaAntiga.total > 0) {
    conclusoes.push({
      tipo: 'alerta',
      texto: `Há ${fmtMoney(faixaAntiga.total)} em pagamentos pendentes há mais de 90 dias — risco de incobrabilidade, vale a pena priorizar a cobrança.`
    });
  }

  // 15. Tentativas médias até aprovação no prático
  if (tentMedias?.pratico !== null && tentMedias?.pratico !== undefined && tentMedias.pratico >= 2.5) {
    conclusoes.push({
      tipo: 'alerta',
      texto: `Em média, os alunos precisam de ${tentMedias.pratico} tentativas até aprovar no exame prático — vale a pena rever a preparação antes da marcação do exame.`
    });
  }

  // 16. Comparação homóloga — inscrições
  const hInsc = homologa?.totais?.inscricoes;
  if (hInsc && hInsc.variacaoPct != null && Math.abs(hInsc.variacaoPct) >= 10) {
    conclusoes.push({
      tipo: hInsc.variacaoPct >= 0 ? 'positivo' : 'negativo',
      texto: `Novas inscrições estão ${Math.abs(hInsc.variacaoPct)}% ${hInsc.variacaoPct >= 0 ? 'acima' : 'abaixo'} do mesmo período do ano anterior (${hInsc.anterior} → ${hInsc.atual}).`
    });
  }

  // 17. Comparação homóloga — aulas concluídas
  const hAulas = homologa?.totais?.aulasConcluidas;
  if (hAulas && hAulas.variacaoPct != null && Math.abs(hAulas.variacaoPct) >= 10) {
    conclusoes.push({
      tipo: hAulas.variacaoPct >= 0 ? 'positivo' : 'negativo',
      texto: `O número de aulas concluídas está ${Math.abs(hAulas.variacaoPct)}% ${hAulas.variacaoPct >= 0 ? 'acima' : 'abaixo'} do mesmo período do ano anterior.`
    });
  }

  // 18. Mês com maior subida/queda de receita face ao ano anterior (dentro do período homólogo)
  if (homologa?.porMes?.length) {
    const comVariacao = homologa.porMes
      .map(m => ({ mes: m.mes, variacao: m.receitaAnterior ? ((m.receitaAtual - m.receitaAnterior) / m.receitaAnterior) * 100 : null }))
      .filter(m => m.variacao !== null);
    if (comVariacao.length) {
      const maiorSubida = comVariacao.reduce((a, b) => (b.variacao > a.variacao ? b : a));
      const maiorQueda = comVariacao.reduce((a, b) => (b.variacao < a.variacao ? b : a));
      if (maiorSubida.variacao >= 20) {
        conclusoes.push({
          tipo: 'positivo',
          texto: `${chartMesLabelCurto(maiorSubida.mes)} foi o mês com maior crescimento de receita face ao ano anterior (+${maiorSubida.variacao.toFixed(0)}%).`
        });
      }
      if (maiorQueda.variacao <= -20 && maiorQueda.mes !== maiorSubida.mes) {
        conclusoes.push({
          tipo: 'alerta',
          texto: `${chartMesLabelCurto(maiorQueda.mes)} foi o mês com maior quebra de receita face ao ano anterior (${maiorQueda.variacao.toFixed(0)}%).`
        });
      }
    }
  }

  // 19-21. Comparativo anual: CAGR, melhor/pior ano, tendência consistente
  if (d.comparativoAnual && d.comparativoAnual.length >= 2) {
    const anos = d.comparativoAnual;
    const primeiro = anos[0];
    const ultimo = anos[anos.length - 1];

    // CAGR de receita ao longo de todo o período comparado
    if (primeiro.receita > 0 && anos.length >= 3) {
      const nAnos = anos.length - 1;
      const cagr = (Math.pow(ultimo.receita / primeiro.receita, 1 / nAnos) - 1) * 100;
      conclusoes.push({
        tipo: cagr >= 0 ? 'positivo' : 'negativo',
        texto: `A receita cresceu, em média, ${cagr.toFixed(1)}% ao ano entre ${primeiro.ano} e ${ultimo.ano} (crescimento anual composto).`
      });
    }

    // Melhor e pior ano em receita
    const melhorAno = anos.reduce((a, b) => (b.receita > a.receita ? b : a));
    const piorAno = anos.reduce((a, b) => (b.receita < a.receita ? b : a));
    if (melhorAno.ano !== piorAno.ano) {
      conclusoes.push({
        tipo: 'neutro',
        texto: `${melhorAno.ano} foi o melhor ano em receita (${fmtMoney(melhorAno.receita)}), enquanto ${piorAno.ano} foi o mais fraco (${fmtMoney(piorAno.receita)}).`
      });
    }

    // Tendência consistente nos últimos 3 anos disponíveis
    const ultimosTres = anos.slice(-3);
    if (ultimosTres.length === 3 && ultimosTres.every(a => a.variacaoReceitaPct != null)) {
      if (ultimosTres.every(a => a.variacaoReceitaPct > 0)) {
        conclusoes.push({ tipo: 'positivo', texto: `A receita cresceu de forma consistente nos últimos 3 anos — uma tendência sólida.` });
      } else if (ultimosTres.every(a => a.variacaoReceitaPct < 0)) {
        conclusoes.push({ tipo: 'alerta', texto: `A receita tem vindo a cair de forma consistente nos últimos 3 anos — vale a pena investigar as causas.` });
      }
    }
  }

  acrescentarReflexoesAnuaisEHomologas(conclusoes, d, homologa);

  return conclusoes;
}

function acrescentarReflexoesAnuaisEHomologas(conclusoes, d, homologa) {
  const hInsc = homologa?.totais?.inscricoes;
  if (hInsc && hInsc.variacaoPct != null && Math.abs(hInsc.variacaoPct) >= 10) {
    conclusoes.push({
      tipo: hInsc.variacaoPct >= 0 ? 'positivo' : 'negativo',
      texto: `Novas inscrições estão ${Math.abs(hInsc.variacaoPct)}% ${hInsc.variacaoPct >= 0 ? 'acima' : 'abaixo'} do mesmo período do ano anterior (${hInsc.anterior} → ${hInsc.atual}).`
    });
  }

  const hAulas = homologa?.totais?.aulasConcluidas;
  if (hAulas && hAulas.variacaoPct != null && Math.abs(hAulas.variacaoPct) >= 10) {
    conclusoes.push({
      tipo: hAulas.variacaoPct >= 0 ? 'positivo' : 'negativo',
      texto: `O número de aulas concluídas está ${Math.abs(hAulas.variacaoPct)}% ${hAulas.variacaoPct >= 0 ? 'acima' : 'abaixo'} do mesmo período do ano anterior.`
    });
  }

  if (homologa?.porMes?.length) {
    const comVariacao = homologa.porMes
      .map(m => ({ mes: m.mes, variacao: m.receitaAnterior ? ((m.receitaAtual - m.receitaAnterior) / m.receitaAnterior) * 100 : null }))
      .filter(m => m.variacao !== null);
    if (comVariacao.length) {
      const maiorSubida = comVariacao.reduce((a, b) => (b.variacao > a.variacao ? b : a));
      const maiorQueda = comVariacao.reduce((a, b) => (b.variacao < a.variacao ? b : a));
      if (maiorSubida.variacao >= 20) {
        conclusoes.push({
          tipo: 'positivo',
          texto: `${chartMesLabelCurto(maiorSubida.mes)} foi o mês com maior crescimento de receita face ao ano anterior (+${maiorSubida.variacao.toFixed(0)}%).`
        });
      }
      if (maiorQueda.variacao <= -20 && maiorQueda.mes !== maiorSubida.mes) {
        conclusoes.push({
          tipo: 'alerta',
          texto: `${chartMesLabelCurto(maiorQueda.mes)} foi o mês com maior quebra de receita face ao ano anterior (${maiorQueda.variacao.toFixed(0)}%).`
        });
      }
    }
  }

  if (d.comparativoAnual && d.comparativoAnual.length >= 2) {
    const anos = d.comparativoAnual;
    const primeiro = anos[0];
    const ultimo = anos[anos.length - 1];

    if (primeiro.receita > 0 && anos.length >= 3) {
      const nAnos = anos.length - 1;
      const cagr = (Math.pow(ultimo.receita / primeiro.receita, 1 / nAnos) - 1) * 100;
      conclusoes.push({
        tipo: cagr >= 0 ? 'positivo' : 'negativo',
        texto: `A receita cresceu, em média, ${cagr.toFixed(1)}% ao ano entre ${primeiro.ano} e ${ultimo.ano} (crescimento anual composto).`
      });
    }

    const melhorAno = anos.reduce((a, b) => (b.receita > a.receita ? b : a));
    const piorAno = anos.reduce((a, b) => (b.receita < a.receita ? b : a));
    if (melhorAno.ano !== piorAno.ano) {
      conclusoes.push({
        tipo: 'neutro',
        texto: `${melhorAno.ano} foi o melhor ano em receita (${fmtMoney(melhorAno.receita)}), enquanto ${piorAno.ano} foi o mais fraco (${fmtMoney(piorAno.receita)}).`
      });
    }

    const ultimosTres = anos.slice(-3);
    if (ultimosTres.length === 3 && ultimosTres.every(a => a.variacaoReceitaPct != null)) {
      if (ultimosTres.every(a => a.variacaoReceitaPct > 0)) {
        conclusoes.push({ tipo: 'positivo', texto: `A receita cresceu de forma consistente nos últimos 3 anos — uma tendência sólida.` });
      } else if (ultimosTres.every(a => a.variacaoReceitaPct < 0)) {
        conclusoes.push({ tipo: 'alerta', texto: `A receita tem vindo a cair de forma consistente nos últimos 3 anos — vale a pena investigar as causas.` });
      }
    }
  }
}

function renderConclusoesHTML(conclusoes) {
  if (!conclusoes || !conclusoes.length) {
    return `<div class="muted" style="padding:12px">Sem conclusões relevantes com os dados atuais.</div>`;
  }

  const icones = { positivo: '🟢', negativo: '🔴', alerta: '🟠', neutro: '🔵' };

  return `
    <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px">
      ${conclusoes.map(c => `
        <li style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:8px; background:rgba(0,0,0,0.03)">
          <span style="font-size:14px; line-height:1.4">${icones[c.tipo] || '🔵'}</span>
          <span style="font-size:13.5px; line-height:1.5">${c.texto}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

/* ==================== AVATARES (fotos de perfil) ==================== */
function avatarHtml(nome, id, size, temFoto) {
  size = size || 36;
  if (temFoto && id) {
    return `<img src="/api/alunos/${id}/foto" loading="lazy" alt="${esc(nome || '')}"
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;vertical-align:middle;border:1px solid var(--border)"
      onerror="this.replaceWith(Object.assign(document.createElement('span'), {outerHTML: avatarIniciaisHtml('${esc(nome || '').replace(/'/g, "\\'")}', ${size})}))">`;
  }
  return avatarIniciaisHtml(nome, size);
}
function avatarIniciaisHtml(nome, size) {
  const iniciais = String(nome || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:var(--accent-soft,#e7edf7);color:var(--accent,#2657c8);font-weight:700;font-size:${Math.round(size * 0.4)}px;vertical-align:middle">${esc(iniciais)}</span>`;
}

/* Liga um seletor de ficheiro de foto (aluno/instrutor) a um input hidden
   com o base64, um preview, e um checkbox opcional de remoção. */
function bindFotoPicker(form, prefix, fotoAtual, nomeAtualFn) {
  const fileInput = form.querySelector(`#${prefix}FotoFile`);
  const hiddenInput = form.querySelector(`#${prefix}FotoHidden`);
  const preview = document.getElementById(`${prefix}FotoPreview`);
  const removerChk = form.querySelector(`#${prefix}FotoRemover`);
  if (!fileInput || !hiddenInput || !preview) return;

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Escolhe um ficheiro de imagem válido.', 'error'); fileInput.value = ''; return; }
    if (file.size > 1.5 * 1024 * 1024) { toast('A imagem não pode exceder 1.5MB.', 'error'); fileInput.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      hiddenInput.value = reader.result;
      if (removerChk) removerChk.checked = false;
      preview.innerHTML = avatarHtml(nomeAtualFn(), reader.result, 64);
    };
    reader.readAsDataURL(file);
  });

  if (removerChk) {
    removerChk.addEventListener('change', () => {
      if (removerChk.checked) {
        hiddenInput.value = '';
        preview.innerHTML = avatarHtml(nomeAtualFn(), '', 64);
      } else {
        hiddenInput.value = fotoAtual || '';
        preview.innerHTML = avatarHtml(nomeAtualFn(), fotoAtual || '', 64);
      }
    });
  }
}

function renderCartasCategoriasListHTML(lista) {
  return lista.length ? lista.map((c, i) => `
    <div class="form-grid" style="grid-template-columns: 1fr 1fr auto; align-items:end; margin-bottom:6px" data-carta-row="${i}">
      <div class="form-field" style="margin-bottom:0">
        <label>Categoria</label>
        <select data-carta-categoria>${CATEGORIAS_TODAS.map(cat => `<option ${c.categoria === cat ? 'selected' : ''}>${cat}</option>`).join('')}</select>
      </div>
      <div class="form-field" style="margin-bottom:0">
        <label>Data de expiração</label>
        <input type="date" data-carta-validade value="${c.dataValidade || ''}">
      </div>
      <button type="button" class="btn btn-danger-ghost btn-sm" data-carta-remover>Remover</button>
    </div>
  `).join('') : `<p class="muted" style="margin-bottom:6px">Nenhuma categoria detida registada.</p>`;
}

function bindCartasCategoriasEditor(form, cartasCategoriasEdit) {
  const box = form.querySelector('#cartasCategoriasList');
  const btnAdd = form.querySelector('#btnAdicionarCartaCategoria');

  function render() {
    box.innerHTML = renderCartasCategoriasListHTML(cartasCategoriasEdit);
    box.querySelectorAll('[data-carta-row]').forEach(row => {
      const idx = Number(row.dataset.cartaRow);
      row.querySelector('[data-carta-categoria]').addEventListener('change', e => { cartasCategoriasEdit[idx].categoria = e.target.value; });
      row.querySelector('[data-carta-validade]').addEventListener('change', e => { cartasCategoriasEdit[idx].dataValidade = e.target.value; });
      row.querySelector('[data-carta-remover]').addEventListener('click', () => { cartasCategoriasEdit.splice(idx, 1); render(); });
    });
  }
  render();
  btnAdd.addEventListener('click', () => {
    cartasCategoriasEdit.push({ categoria: CATEGORIAS_TODAS[0], dataValidade: '' });
    render();
  });
}

function openAlunoForm(id) {
  const item = id ? findAluno(id) : null;
  const am = item?.atestadoMedico || {};
  const ep = item?.examePsicotecnico || {};
  const pi = item?.processoIMT || {};

  openModal(item ? `Editar Aluno · Nº ${item.numeroAluno ?? item.id}` : 'Novo Aluno', `
    <form id="alunoForm">
      <h4 class="form-section-title">Dados pessoais</h4>
      ${item ? `<p class="muted" style="margin:-6px 0 12px">Número de aluno <strong>#${item.numeroAluno ?? item.id}</strong> — atribuído automaticamente na criação e não pode ser alterado.</p>` : `<p class="muted" style="margin:-6px 0 12px">Ao criar o aluno é atribuído automaticamente um número de aluno único e sequencial.</p>`}
      <div style="display:flex; align-items:center; gap:16px; margin-bottom:14px">
        <div id="alunoFotoPreview">${avatarHtml(item?.nome || 'Novo aluno', item?.foto, 64)}</div>
        <div>
          <label style="display:block; text-transform:uppercase; font-size:11px; font-weight:700; color:var(--muted); margin-bottom:6px">Foto de perfil</label>
          <input type="file" id="alunoFotoFile" accept="image/*">
          <input type="hidden" name="foto" id="alunoFotoHidden" value="${esc(item?.foto || '')}">
          ${item?.foto ? `<label style="display:flex; align-items:center; gap:6px; margin-top:6px; text-transform:none; font-weight:500; color:var(--ink)"><input type="checkbox" id="alunoFotoRemover"> Remover foto atual</label>` : ''}
        </div>
      </div>
      <div class="form-grid">
        <div class="form-field full"><label>Nome completo</label><input name="nome" required value="${esc(item?.nome || '')}"></div>
        <div class="form-field"><label>Data de nascimento</label><input name="dataNascimento" type="date" value="${item?.dataNascimento || ''}"></div>
        <div class="form-field"><label>NIF</label><input name="nif" value="${esc(item?.nif || '')}" maxlength="9" placeholder="123456789"></div>
        <div class="form-field">
          <label>Tipo de documento</label>
          <select name="tipoDocumento">${['CC', 'Passaporte'].map(t => `<option ${item?.tipoDocumento === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>N.º do documento</label><input name="numeroDocumento" value="${esc(item?.numeroDocumento || '')}"></div>
        <div class="form-field"><label>Validade do documento</label><input name="validadeDocumento" type="date" value="${item?.validadeDocumento || ''}"></div>
        <div class="form-field full"><label>Morada</label><input name="morada" value="${esc(item?.morada || '')}"></div>
        <div class="form-field"><label>Código postal</label><input name="codigoPostal" value="${esc(item?.codigoPostal || '')}" placeholder="0000-000"></div>
        <div class="form-field"><label>Localidade</label><input name="localidade" value="${esc(item?.localidade || '')}"></div>
        <div class="form-field"><label>Email</label><input name="email" type="email" value="${esc(item?.email || '')}"></div>
        <div class="form-field"><label>Telefone</label><input name="telefone" value="${esc(item?.telefone || '')}"></div>
        <div class="form-field">
          <label>Espaço físico</label>
          <select name="espacoId" required>
            ${state.espacos.map(e => `<option value="${e.id}" ${item?.espacoId === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}
          </select>
        </div>
      </div>

      <h4 class="form-section-title">Processo de formação (IMT)</h4>
      <div class="form-grid">
        <div class="form-field">
          <label>Categoria pretendida</label>
          <select name="categoria" id="alunoCategoriaSelect">
            ${CATEGORIAS_TODAS.map(c => `<option ${item?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Plano de preço da carta</label>
          <select id="alunoPlanoCartaSelect"></select>
        </div>
        <div class="form-field"><label>Desconto do aluno (%)</label><input name="desconto" id="alunoDescontoInput" type="number" min="0" max="100" step="1" value="${item?.desconto ?? 0}"></div>
        <div class="form-field full">
          <p class="muted">O valor da carta e o desconto ficam definidos já aqui, na ficha do aluno — o desconto aplica-se apenas aos módulos práticos/teóricos; taxas de inscrição, exame e emissão mantêm-se sempre fixas. Este valor só se torna efetivamente conta corrente quando é criado o contrato.</p>
        </div>
        <div class="form-field full" id="alunoPrevisaoCarta"><span class="muted">A calcular valor da carta...</span></div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">
            ${['Ativo', 'Concluído', 'Suspenso'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Data de inscrição</label><input name="dataInscricao" type="date" value="${item?.dataInscricao || ''}"></div>
        <div class="form-field full"><label>Dispensa de módulos (ex: já detém categoria B)</label><input name="dispensaModulos" value="${esc(item?.dispensaModulos || '')}" placeholder="Ex: dispensa de módulos teóricos comuns"></div>
        <div class="form-field full"><label>Cartas de condução já detidas (categoria + data de expiração)</label><div id="cartasCategoriasList"></div><button type="button" class="btn btn-ghost btn-sm" id="btnAdicionarCartaCategoria">+ Adicionar categoria</button></div>
        <div class="form-field"><label>N.º processo / licença de aprendizagem (IMT)</label><input name="pi_numero" value="${esc(pi.numero || '')}"></div>
        <div class="form-field"><label>Data de emissão</label><input name="pi_dataEmissao" type="date" value="${pi.dataEmissao || ''}"></div>
        <div class="form-field"><label>Data de validade</label><input name="pi_dataValidade" type="date" value="${pi.dataValidade || ''}"></div>
      </div>

      <h4 class="form-section-title">Aptidão médica e psicológica</h4>
      <div class="form-grid">
        <div class="form-field"><label>Atestado médico — emissão</label><input name="am_dataEmissao" type="date" value="${am.dataEmissao || ''}"></div>
        <div class="form-field"><label>Atestado médico — validade</label><input name="am_dataValidade" type="date" value="${am.dataValidade || ''}"></div>
        <div class="form-field">
          <label>Considerado apto</label>
          <select name="am_apto">
            <option value="true" ${am.apto !== false ? 'selected' : ''}>Sim</option>
            <option value="false" ${am.apto === false ? 'selected' : ''}>Não</option>
          </select>
        </div>
        <div class="form-field full" style="margin-top:4px">
          <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-weight:500; color:var(--ink)">
            <input type="checkbox" name="ep_aplicavel" ${ep.aplicavel ? 'checked' : ''}> Exame psicotécnico aplicável a esta categoria
          </label>
        </div>
        <div class="form-field"><label>Exame psicotécnico — emissão</label><input name="ep_dataEmissao" type="date" value="${ep.dataEmissao || ''}"></div>
        <div class="form-field"><label>Exame psicotécnico — validade</label><input name="ep_dataValidade" type="date" value="${ep.dataValidade || ''}"></div>
      </div>

      <div class="form-grid" style="margin-top:8px">
        <div class="form-field full">
          <label>Contagem automática</label>
          <div class="muted">Baseada nas presenças validadas nas aulas teóricas e práticas. ${item ? `Atual: ${getAlunoContagens(item).aulasTeoricas} teóricas · ${getAlunoContagens(item).aulasPraticas} práticas.` : ''}</div>
        </div>
        <div class="form-field full"><label>Notas</label><textarea name="notas">${esc(item?.notas || '')}</textarea></div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar aluno'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('alunoForm');   // <-- moved up here
  let alunoPlanoCartaIdAtual = null;

  async function atualizarPrevisaoCartaAluno() {
    const box = document.getElementById('alunoPrevisaoCarta');
    const selectPlano = document.getElementById('alunoPlanoCartaSelect');
    if (!box) return;
    const categoria = document.getElementById('alunoCategoriaSelect')?.value;
    const desconto = Number(document.getElementById('alunoDescontoInput')?.value) || 0;
    if (!categoria) return;

    // Carrega os planos de preço disponíveis para a categoria escolhida.
    try {
      const planos = await api('GET', `/api/planosCarta/${encodeURIComponent(categoria)}`);
      if (selectPlano) {
        selectPlano.innerHTML = planos.length
          ? planos.map(p => `<option value="${p.id}" ${Number(alunoPlanoCartaIdAtual) === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')
          : '<option value="">Sem planos definidos para esta categoria</option>';
        if (!planos.some(p => p.id === Number(alunoPlanoCartaIdAtual))) {
          alunoPlanoCartaIdAtual = planos[0]?.id || null;
          selectPlano.value = alunoPlanoCartaIdAtual || '';
        }
      }
    } catch (err) { /* segue sem bloquear a pré-visualização */ }

    try {
      const qs = `?desconto=${desconto}${alunoPlanoCartaIdAtual ? `&planoCartaId=${alunoPlanoCartaIdAtual}` : ''}`;
      const res = await api('GET', `/api/precoCarta/${encodeURIComponent(categoria)}${qs}`);
      box.innerHTML = `
        <label>Valor da carta — categoria ${esc(categoria)}${res.planoNome ? ` · plano "${esc(res.planoNome)}"` : ''}</label>
        <div class="table-wrap" style="box-shadow:none">
          <table>
            <tbody>
              ${res.itens.length ? res.itens.map(i => `
                <tr>
                  <td class="muted" style="font-size:12px; white-space:nowrap">${esc(i.codigo || '—')}</td>
                  <td>${esc(i.descricao)}</td>
                  <td class="muted" style="font-size:12px">${i.descontavel ? `desconto ${desconto}%` : 'valor fixo'}</td>
                  <td style="text-align:right">${fmtMoney(i.valor)}</td>
                </tr>
              `).join('') : `<tr><td colspan="4" class="muted">Sem plano de preço definido para esta categoria — define-o em Configurações &gt; Composição da carta.</td></tr>`}
            </tbody>
          </table>
        </div>
        <p style="text-align:right; font-weight:700; margin-top:6px">Total: ${fmtMoney(res.total)}</p>
      `;
    } catch (err) {
      box.innerHTML = `<span class="muted">${esc(err.message)}</span>`;
    }
  }

  document.getElementById('alunoCategoriaSelect').addEventListener('change', () => { alunoPlanoCartaIdAtual = null; atualizarPrevisaoCartaAluno(); });
  document.getElementById('alunoPlanoCartaSelect').addEventListener('change', (e) => { alunoPlanoCartaIdAtual = Number(e.target.value) || null; atualizarPrevisaoCartaAluno(); });
  document.getElementById('alunoDescontoInput').addEventListener('input', atualizarPrevisaoCartaAluno);
  bindFotoPicker(form, 'aluno', item?.foto || '', () => form.querySelector('[name="nome"]')?.value || item?.nome || '');
  atualizarPrevisaoCartaAluno();

  let cartasCategoriasEdit = Array.isArray(item?.cartasCategorias)
    ? item.cartasCategorias.map(c => ({ ...c }))
    : [];
  bindCartasCategoriasEditor(form, cartasCategoriasEdit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      nome: fd.get('nome'), dataNascimento: fd.get('dataNascimento'), nif: fd.get('nif'),
      tipoDocumento: fd.get('tipoDocumento'), numeroDocumento: fd.get('numeroDocumento'), validadeDocumento: fd.get('validadeDocumento'),
      morada: fd.get('morada'), codigoPostal: fd.get('codigoPostal'), localidade: fd.get('localidade'),
      email: fd.get('email'), telefone: fd.get('telefone'),
      categoria: fd.get('categoria'), estado: fd.get('estado'), dataInscricao: fd.get('dataInscricao'),
      desconto: Number(fd.get('desconto') || 0),
      dispensaModulos: fd.get('dispensaModulos'),
      processoIMT: { numero: fd.get('pi_numero'), dataEmissao: fd.get('pi_dataEmissao'), dataValidade: fd.get('pi_dataValidade') },
      cartasCategorias: cartasCategoriasEdit.filter(c => c.categoria && c.dataValidade),
      atestadoMedico: { dataEmissao: fd.get('am_dataEmissao'), dataValidade: fd.get('am_dataValidade'), apto: fd.get('am_apto') === 'true' },
      examePsicotecnico: { aplicavel: !!fd.get('ep_aplicavel'), dataEmissao: fd.get('ep_dataEmissao'), dataValidade: fd.get('ep_dataValidade') },
      espacoId: Number(fd.get('espacoId') || 0),
      foto: fd.get('foto') || null,
      notas: fd.get('notas')
    };
    try {
      if (item) await api('PUT', `/api/alunos/${item.id}`, payload);
      else await api('POST', '/api/alunos', payload);
      await Promise.all([refreshCollections(['alunos', 'dashboard']), ensureAlunosAtivos({ force: true })]);
      closeModal();
      renderAlunos();
      renderDashboard();
      toast(item ? 'Aluno atualizado.' : 'Aluno criado.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== INSTRUTORES ==================== */
function renderInstrutores() {
  const el = document.getElementById('view-instrutores');
  const q = state.search.instrutores.toLowerCase();
  const list = state.instrutores.filter(i => i.nome.toLowerCase().includes(q));

  el.innerHTML = `
    <div class="toolbar">
      <input class="search-input" placeholder="Pesquisar instrutor..." value="${esc(state.search.instrutores)}" oninput="updateSearchAndRerender(this, 'instrutores', renderInstrutores)">
    </div>
    <div class="table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Instrutor</th><th>Cargo</th><th>Título profissional</th><th>Categorias</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(i => {
    const tag = selosValidade(i.tituloProfissionalValidade, 'Título');
    return `
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:10px">
                  ${avatarHtml(i.nome, i.foto, 36)}
                  <div>
                    <div class="cell-primary">${esc(i.nome)}</div>
                    <div class="cell-sub">${esc(i.email || '')} ${i.telefone ? '· ' + esc(i.telefone) : ''} ${i.nif ? '· NIF ' + esc(i.nif) : ''}</div>
                  </div>
                </div>
              </td>
              <td>${esc(i.cargo || 'Instrutor')}</td>
              <td>
                <div class="cell-sub">${esc(i.tituloProfissionalNumero || '—')}</div>
                <div class="cell-sub">${i.tituloProfissionalValidade ? 'Válido até ' + fmtDate(i.tituloProfissionalValidade) : ''} ${tag}</div>
              </td>
              <td>${(i.categorias || []).join(', ') || '—'}</td>
              <td><span class="${badgeClass(i.estado)}">${esc(i.estado || '—')}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openInstrutorForm(${i.id})">Editar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('instrutores', ${i.id}, '${escJs(i.nome)}')">Remover</button>
                </div>
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>` : emptyState('Nenhum instrutor encontrado', 'Adiciona um instrutor à equipa pedagógica.')}
    </div>
  `;
}

function openInstrutorForm(id) {
  const item = id ? findInstrutor(id) : null;
  const cats = ['A1', 'A2', 'A', 'B', 'BE', 'C'];
  openModal(item ? 'Editar Instrutor' : 'Novo Instrutor', `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field full" style="display:flex; align-items:center; gap:16px">
          <div id="instrutorFotoPreview">${avatarHtml(item?.nome || 'Novo instrutor', item?.foto, 64)}</div>
          <div>
            <label style="display:block; text-transform:uppercase; font-size:11px; font-weight:700; color:var(--muted); margin-bottom:6px">Foto de perfil</label>
            <input type="file" id="instrutorFotoFile" accept="image/*">
            <input type="hidden" name="foto" id="instrutorFotoHidden" value="${esc(item?.foto || '')}">
            ${item?.foto ? `<label style="display:flex; align-items:center; gap:6px; margin-top:6px; text-transform:none; font-weight:500; color:var(--ink)"><input type="checkbox" id="instrutorFotoRemover"> Remover foto atual</label>` : ''}
          </div>
        </div>
        <div class="form-field full"><label>Nome completo</label><input name="nome" required value="${esc(item?.nome || '')}"></div>
        <div class="form-field"><label>Email</label><input name="email" type="email" value="${esc(item?.email || '')}"></div>
        <div class="form-field"><label>Telefone</label><input name="telefone" value="${esc(item?.telefone || '')}"></div>
        <div class="form-field"><label>NIF</label><input name="nif" value="${esc(item?.nif || '')}" maxlength="9"></div>
        <div class="form-field">
          <label>Cargo</label>
          <select name="cargo">${['Instrutor', 'Diretor de Escola', 'Instrutor e Diretor'].map(c => `<option ${item?.cargo === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">${['Ativo', 'Inativo'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>N.º título profissional (IMT)</label><input name="tituloProfissionalNumero" value="${esc(item?.tituloProfissionalNumero || '')}"></div>
        <div class="form-field"><label>Validade do título</label><input name="tituloProfissionalValidade" type="date" value="${item?.tituloProfissionalValidade || ''}"></div>
        <div class="form-field full">
          <label>Categorias habilitadas</label>
          <div style="display:flex; gap:14px; flex-wrap:wrap; padding:8px 0;">
            ${cats.map(c => `<label style="display:flex; align-items:center; gap:6px; font-size:14px; text-transform:none; font-weight:500; color:var(--ink)">
              <input type="checkbox" name="cat_${c}" ${(item?.categorias || []).includes(c) ? 'checked' : ''}> ${c}
            </label>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar instrutor'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('entityForm');
  bindFotoPicker(form, 'instrutor', item?.foto || '', () => form.querySelector('[name="nome"]')?.value || item?.nome || '');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const categorias = cats.filter(c => fd.get('cat_' + c));
    const payload = {
      nome: fd.get('nome'), email: fd.get('email'), telefone: fd.get('telefone'), estado: fd.get('estado'),
      nif: fd.get('nif'), cargo: fd.get('cargo'),
      tituloProfissionalNumero: fd.get('tituloProfissionalNumero'), tituloProfissionalValidade: fd.get('tituloProfissionalValidade'),
      foto: fd.get('foto') || null,
      categorias
    };
    try {
      if (item) await api('PUT', `/api/instrutores/${item.id}`, payload);
      else await api('POST', '/api/instrutores', payload);
      await refreshCollections(['instrutores', 'dashboard']);
      closeModal();
      renderInstrutores();
      renderDashboard();
      toast(item ? 'Instrutor atualizado.' : 'Instrutor criado.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== VEICULOS ==================== */
function renderVeiculos() {
  const el = document.getElementById('view-veiculos');
  const q = state.search.veiculos.toLowerCase();
  const list = state.veiculos.filter(v => v.matricula.toLowerCase().includes(q) || (v.modelo || '').toLowerCase().includes(q));

  el.innerHTML = `
    <div class="toolbar">
      <input class="search-input" placeholder="Pesquisar por matrícula ou modelo..." value="${esc(state.search.veiculos)}" oninput="updateSearchAndRerender(this, 'veiculos', renderVeiculos)">
    </div>
    <div class="table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Veículo</th><th>Categoria</th><th>IPO válida até</th><th>Seguro instrução válido até</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(v => `
            <tr>
              <td>
                <div class="cell-primary">${esc(v.matricula)}</div>
                <div class="cell-sub">${esc(v.marca || '')} ${esc(v.modelo || '')}</div>
              </td>
              <td>${esc(v.categoria || '—')}</td>
              <td>${fmtDate(v.inspecaoValida)} ${selosValidade(v.inspecaoValida, 'IPO')}</td>
              <td>${fmtDate(v.seguroInstrucaoValidade)} ${selosValidade(v.seguroInstrucaoValidade, 'Seguro')}</td>
              <td><span class="${badgeClass(v.estado)}">${esc(v.estado || '—')}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openVeiculoForm(${v.id})">Editar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('veiculos', ${v.id}, '${escJs(v.matricula)}')">Remover</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : emptyState('Nenhum veículo encontrado', 'Adiciona um veículo à frota de instrução.')}
    </div>
  `;
}

function openVeiculoForm(id) {
  const item = id ? findVeiculo(id) : null;
  openModal(item ? 'Editar Veículo' : 'Novo Veículo', `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field"><label>Matrícula</label><input name="matricula" required value="${esc(item?.matricula || '')}"></div>
        <div class="form-field">
          <label>Categoria</label>
          <select name="categoria">${CATEGORIAS_TODAS.map(c => `<option ${item?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Marca</label><input name="marca" value="${esc(item?.marca || '')}"></div>
        <div class="form-field"><label>Modelo</label><input name="modelo" value="${esc(item?.modelo || '')}"></div>
        <div class="form-field"><label>IPO — inspeção válida até</label><input name="inspecaoValida" type="date" value="${item?.inspecaoValida || ''}"></div>
        <div class="form-field"><label>Seguro de instrução válido até</label><input name="seguroInstrucaoValidade" type="date" value="${item?.seguroInstrucaoValidade || ''}"></div>
        <div class="form-field"><label>Data de afetação a esta escola</label><input name="dataAfetacaoEscola" type="date" value="${item?.dataAfetacaoEscola || ''}"></div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">${['Disponível', 'Em uso', 'Manutenção'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar veículo'}</button>
      </div>
    </form>
  `);
  bindForm('veiculos', item?.id, {}, renderVeiculos);
}

/* Formato único usado nesta secção: DD/MM/AAAA HH:MM (sem segundos, sem texto extra) */
function fmtDataHora(dataISO, hora) {
  if (!dataISO) return '—';
  const [ano, mes, dia] = String(dataISO).slice(0, 10).split('-');
  if (!ano || !mes || !dia) return '—';
  const dataFmt = `${dia}/${mes}/${ano}`;
  const horaFmt = hora ? String(hora).slice(0, 5) : '';
  return horaFmt ? `${dataFmt} ${horaFmt}` : dataFmt;
}

function renderAulas() {
  const el = document.getElementById('view-aulas');
  state.aulasTab = state.aulasTab || 'praticas';

  el.innerHTML = `
    <div class="filter-row" style="margin-bottom:16px">
      <button class="chip ${state.aulasTab === 'praticas' ? 'active' : ''}" onclick="state.aulasTab='praticas'; renderAulas();">Aulas práticas</button>
      <button class="chip ${state.aulasTab === 'teoricas' ? 'active' : ''}" onclick="state.aulasTab='teoricas'; renderAulas();">Turmas teóricas</button>
    </div>
    <div id="aulasTabBody"></div>
  `;

  if (state.aulasTab === 'teoricas') renderTurmasTeoricasTab();
  else renderAulasPraticasTab();
}

function renderAulasPraticasTab() {
  const body = document.getElementById('aulasTabBody');
  const q = state.search.aulas.toLowerCase();
  if (state.filter.aulasPeriodo === undefined) state.filter.aulasPeriodo = 'Futuras';
  const periodo = state.filter.aulasPeriodo;
  const filtro = state.filter.aulas || 'Todos';
  const estados = ['Todos', 'Agendada', 'Concluída', 'Cancelada'];
  const hojeISO = new Date().toISOString().slice(0, 10);

  let list = state.aulas.filter(a => (a.tipo || 'Prática') === 'Prática');
  if (periodo === 'Futuras') list = list.filter(a => a.data >= hojeISO);
  list.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  if (periodo === 'Historico') list.reverse();
  if (filtro !== 'Todos') list = list.filter(a => a.estado === filtro);
  if (q) list = list.filter(a => { const aluno = findAluno(a.alunoId); return aluno && aluno.nome.toLowerCase().includes(q); });

  body.innerHTML = `
    <div class="toolbar">
      <input class="search-input" placeholder="Pesquisar por nome do aluno..." value="${esc(state.search.aulas)}" oninput="updateSearchAndRerender(this, 'aulas', renderAulas)">
      <div class="filter-row">
        <button class="chip ${periodo === 'Futuras' ? 'active' : ''}" onclick="state.filter.aulasPeriodo='Futuras'; renderAulas();">Hoje e futuras</button>
        <button class="chip ${periodo === 'Historico' ? 'active' : ''}" onclick="state.filter.aulasPeriodo='Historico'; renderAulas();">Histórico</button>
      </div>
      <select onchange="state.filter.aulas=this.value; renderAulas();" style="font-size:13px; padding:4px 8px; border-radius:6px; border:1px solid var(--border)">
        ${estados.map(e => `<option value="${e}" ${filtro === e ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
      <button class="btn btn-accent btn-sm" style="margin-left:auto" onclick="openAulaForm()">+ Nova aula prática</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Data / Hora</th><th>Aluno</th><th>Instrutor</th><th>Veículo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(a => {
    const aluno = findAluno(a.alunoId);
    const instrutor = findInstrutor(a.instrutorId);
    const veiculo = findVeiculo(a.veiculoId);
    return `
            <tr>
              <td class="cell-primary">${fmtDataHora(a.data, a.hora)}</td>
              <td>${esc(aluno?.nome || '—')}</td>
              <td>${esc(instrutor?.nome || '—')}</td>
              <td>${veiculo ? esc(veiculo.matricula) : '—'}</td>
              <td><span class="${badgeClass(a.estado)}">${esc(a.estado || '—')}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openAulaForm(${a.id})">Editar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('aulas', ${a.id}, 'esta aula')">Remover</button>
                </div>
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>` : emptyState('Nenhuma aula prática encontrada', periodo === 'Futuras' ? 'Não há aulas práticas agendadas — muda para "Histórico" para ver aulas passadas.' : 'Agenda uma nova aula prática individual.')}
    </div>
  `;
}

function renderTurmasTeoricasTab() {
  const body = document.getElementById('aulasTabBody');
  if (state.filter.turmasPeriodo === undefined) state.filter.turmasPeriodo = 'Agendadas';
  const periodo = state.filter.turmasPeriodo;
  const hojeISO = new Date().toISOString().slice(0, 10);

  let list = [...state.turmasTeoricas];
  if (periodo === 'Agendadas') list = list.filter(t => t.estado === 'Agendada' || t.data >= hojeISO);
  list.sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));
  if (periodo === 'Historico') list.reverse();

  body.innerHTML = `
    <div class="toolbar">
      <div class="filter-row">
        <button class="chip ${periodo === 'Agendadas' ? 'active' : ''}" onclick="state.filter.turmasPeriodo='Agendadas'; renderAulas();">Agendadas</button>
        <button class="chip ${periodo === 'Historico' ? 'active' : ''}" onclick="state.filter.turmasPeriodo='Historico'; renderAulas();">Histórico</button>
      </div>
      <button class="btn btn-accent btn-sm" style="margin-left:auto" onclick="openTurmaTeoricaForm()">+ Nova turma teórica</button>
    </div>
    ${list.length ? list.map(t => `
      <div class="agenda-item">
        <div class="agenda-time">${fmtDataHora(t.data, t.horaInicio)}</div>
        <div class="agenda-info">
          <div class="name">${esc(t.tema)}</div>
          <div class="sub">${(t.inscritos || []).length} inscritos · ${esc((findInstrutor(t.instrutorId) || {}).nome || 'Sem instrutor')} · <span class="${badgeClass(t.estado)}">${esc(t.estado || '—')}</span></div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="openTurmaTeoricaForm(${t.id})">Editar</button>
          ${t.estado === 'Agendada' ? `<button class="btn btn-accent btn-sm" onclick="abrirPresencasForm(${t.id})">Marcar presenças</button>` : ''}
        </div>
      </div>
    `).join('') : emptyState('Sem turmas teóricas', periodo === 'Agendadas' ? 'Não há turmas agendadas de momento.' : 'Sem histórico de turmas teóricas.')}
  `;
}

function openAulaForm(id) {
  const item = id ? state.aulas.find(a => a.id === id) : null;
  openModal(item ? 'Editar Aula Prática' : 'Nova Aula Prática', `
    <form id="aulaForm">
      <div class="form-grid">
        ${renderAlunoPickerHtml(item?.alunoId, { hint: 'Escolhe um aluno existente ou escreve o nome completo.' })}
        <div class="form-field full" id="alertaContratoExistente"></div>
        <div class="form-field">
          <label>Instrutor</label>
          <select name="instrutorId">
            <option value="">Sem atribuição</option>
            ${state.instrutores.map(i => `<option value="${i.id}" ${item?.instrutorId === i.id ? 'selected' : ''}>${esc(i.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Veículo</label>
          <select name="veiculoId">
            <option value="">Sem viatura</option>
            ${state.veiculos.map(v => `<option value="${v.id}" ${item?.veiculoId === v.id ? 'selected' : ''}>${esc(v.matricula)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Espaço</label>
          <select name="espacoId" required>
            ${state.espacos.map(e => `<option value="${e.id}" ${item?.espacoId === e.id ? 'selected' : ''}>${esc(e.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Data</label><input name="data" type="date" required value="${item?.data || ''}"></div>
        <div class="form-field"><label>Hora início</label><input name="hora" type="time" required value="${item?.hora || ''}"></div>
        <div class="form-field"><label>Duração (min)</label><input name="duracao" id="aulaDuracaoInput" type="number" min="10" value="${item?.duracao ?? 50}"></div>
        <div class="form-field"><label>Hora fim (calculada)</label><input type="time" id="aulaHoraFimCalc" readonly value="${calcularHoraFimStr(item?.hora, item?.duracao ?? 50)}" style="background:var(--bg-subtle,#f3f4f6); font-weight:600" tabindex="-1"></div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">${['Agendada', 'Concluída', 'Cancelada'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field full"><label>Conteúdo programático / módulo</label><input name="modulo" value="${esc(item?.modulo || '')}" placeholder="Ex: Rotundas e cruzamentos"></div>
        <div class="form-field"><label>Quilómetros percorridos</label><input name="km" type="number" min="0" step="0.1" value="${item?.km ?? ''}"></div>
        <div class="form-field full"><label>Notas</label><textarea name="notas">${esc(item?.notas || '')}</textarea></div>
      </div>
      <p class="muted" style="margin-top:8px">Esta aula é sempre do tipo <strong>Prática individual</strong>. Para formação teórica, cria ou usa uma Turma Teórica.</p>
      <div id="avisoLimiteDiario"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Agendar aula'}</button>
      </div>
    </form>
  `);

  const form = document.getElementById('aulaForm');
  bindAlunoPicker(form);

  function atualizarHoraFimAula() {
    const hora = form.querySelector('[name="hora"]')?.value;
    const duracao = form.querySelector('[name="duracao"]')?.value;
    const campo = document.getElementById('aulaHoraFimCalc');
    if (campo) campo.value = calcularHoraFimStr(hora, duracao);
  }
  ['hora', 'duracao'].forEach(name => {
    const campoEl = form.querySelector(`[name="${name}"]`);
    campoEl?.addEventListener('input', atualizarHoraFimAula);
    campoEl?.addEventListener('change', atualizarHoraFimAula);
  });
  atualizarHoraFimAula();

  async function verificarLimite() {
    const fd = new FormData(form);
    const alunoId = Number(fd.get('alunoId') || 0);
    const dataAula = fd.get('data');
    const duracao = Number(fd.get('duracao') || 0);
    const aviso = document.getElementById('avisoLimiteDiario');
    aviso.innerHTML = '';
    if (!alunoId || !dataAula) return;
    try {
      const r = await api('GET', `/api/aulas/verificar-limite-diario?alunoId=${alunoId}&data=${dataAula}&duracao=${duracao}${item ? `&excluirId=${item.id}` : ''}`);
      if (r.excedeLimite) {
        aviso.innerHTML = `<div class="inline-alert inline-alert-warning">⚠ Este aluno fica com ${(r.minutosTotais / 60).toFixed(1)}h de formação prática marcadas neste dia — acima do limite diário de referência (4h). Confirma se pretendes continuar.</div>`;
      }
    } catch (e) { /* verificação não bloqueia o registo */ }
  }
  ['alunoNome', 'data', 'duracao'].forEach(name => {
    const el = form.querySelector(`[name="${name}"]`);
    el?.addEventListener('change', verificarLimite);
    el?.addEventListener('input', verificarLimite);
  });
  verificarLimite();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const alunoId = Number(fd.get('alunoId') || 0);
    if (!alunoId) {
      toast('Seleciona ou escreve o nome de um aluno existente.', 'error');
      return;
    }
    const payload = {
      alunoId,
      instrutorId: fd.get('instrutorId') ? Number(fd.get('instrutorId')) : null,
      veiculoId: fd.get('veiculoId') ? Number(fd.get('veiculoId')) : null,
      data: fd.get('data'), hora: fd.get('hora'), horaFim: calcularHoraFimStr(fd.get('hora'), fd.get('duracao')),
      duracao: fd.get('duracao') ? Number(fd.get('duracao')) : null,
      tipo: 'Prática', // fixo — aulas individuais são sempre práticas
      estado: fd.get('estado'),
      espacoId: Number(fd.get('espacoId') || 0),
      modulo: fd.get('modulo'),
      km: fd.get('km') === '' ? null : Number(fd.get('km')),
      notas: fd.get('notas')
    };
    try {
      if (item) await api('PUT', `/api/aulas/${item.id}`, payload);
      else await api('POST', '/api/aulas', payload);
      await refreshCollections(['aulas', 'dashboard']);
      closeModal();
      render();
      renderDashboard();
      toast(item ? 'Aula atualizada.' : 'Aula agendada.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== HISTÓRICO DE AULAS ====================
   Registo de presenças em aulas teóricas e práticas.       */

async function abrirHistoricoAulasModal(alunoId) {
  const aluno = findAluno(alunoId);
  if (!aluno) return;

  openModal(`Histórico de Aulas · ${esc(aluno.nome)}`, `<div class="muted" style="padding:12px">A carregar histórico...</div>`);
  alargarModal();

  // Mesma regra de "todas exceto Cancelada" usada em getAlunoContagens (app-core.js)
  function normalizarEstado(v) {
    return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
  const ESTADOS_CANCELADA = ['Cancelada', 'Cancelado', 'Anulada', 'Anulado'].map(normalizarEstado);
  function isEstadoCancelada(estado) { return ESTADOS_CANCELADA.includes(normalizarEstado(estado)); }
  function fmtDataSegura(d) { return fmtDate(String(d || '').slice(0, 10)); }

  try {
    const rel = await api('GET', `/api/relatorios/aluno/${alunoId}`);
    const { praticas, teoricasIndividuais, turmasTeoricas } = rel;

    const linhasTeoricas = [
      ...teoricasIndividuais.map(t => ({ data: t.data, hora: t.hora, duracaoMin: t.duracaoMin, estado: t.estado })),
      ...turmasTeoricas.map(t => ({
        data: t.data, hora: t.horaInicio, duracaoMin: t.duracaoMin,
        estado: t.presente === null ? t.estado : (t.presente ? 'Presente' : 'Faltou')
      }))
    ].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

    const teoricasNaoCanceladas = [...teoricasIndividuais, ...turmasTeoricas].filter(t => !isEstadoCancelada(t.estado)).length;
    const praticasNaoCanceladas = praticas.filter(p => !isEstadoCancelada(p.estado)).length;
    const faltasTeoricas = turmasTeoricas.filter(t => t.presente === false).length;

    openModal(`Histórico de Aulas · ${esc(aluno.nome)}`, `
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); margin-bottom:16px">
        <div class="stat-card">
          <div class="stat-value">${teoricasNaoCanceladas}</div>
          <div class="stat-label">Sessões teóricas</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${praticasNaoCanceladas}</div>
          <div class="stat-label">Sessões práticas</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${faltasTeoricas}</div>
          <div class="stat-label">Faltas teóricas</div>
        </div>
      </div>

      <h4 style="margin-bottom:8px; font-size:14px">Aulas teóricas</h4>
      <div class="table-wrap" style="box-shadow:none; margin-bottom:18px">
        <table>
          <thead><tr><th>Data</th><th>Hora</th><th>Duração</th><th>Presença / Estado</th></tr></thead>
          <tbody>
            ${linhasTeoricas.length ? linhasTeoricas.map(t => `
              <tr>
                <td>${fmtDataSegura(t.data)}</td>
                <td>${esc(t.hora || '—')}</td>
                <td>${Math.round(t.duracaoMin)} min</td>
                <td><span class="${badgeClass(t.estado)}">${esc(t.estado)}</span></td>
              </tr>
            `).join('') : `<tr><td colspan="4" class="muted">Sem registos teóricos.</td></tr>`}
          </tbody>
        </table>
      </div>

      <h4 style="margin-bottom:8px; font-size:14px">Aulas práticas</h4>
      <div class="table-wrap" style="box-shadow:none">
        <table>
          <thead><tr><th>Data</th><th>Hora</th><th>Instrutor</th><th>Duração</th><th>Estado</th></tr></thead>
          <tbody>
            ${praticas.length ? praticas.map(p => `
              <tr>
                <td>${fmtDataSegura(p.data)}</td>
                <td>${esc(p.hora)}</td>
                <td>${esc(p.instrutorNome)}</td>
                <td>${p.duracaoMin} min</td>
                <td><span class="${badgeClass(p.estado)}">${esc(p.estado)}</span></td>
              </tr>
            `).join('') : `<tr><td colspan="6" class="muted">Sem registos práticos.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      </div>
    `);
    alargarModal();
  } catch (err) {
    openModal(`Histórico de Aulas · ${esc(aluno.nome)}`, emptyState('Erro ao carregar histórico', err.message));
  }
}

/* Alarga a caixa do modal para este histórico (a caixa tem largura fixa por omissão).
   Se a tua caixa de modal não tiver a classe "modal" como filho direto de
   #modalBackdrop, ajusta o seletor abaixo para o que se aplicar no teu CSS. */
function alargarModal() {
  const caixa = document.querySelector('#modalBackdrop .modal') || document.querySelector('#modalBackdrop > div');
  if (caixa) { caixa.style.maxWidth = '760px'; caixa.style.width = '90vw'; }
}

/* ==================== CONTA CORRENTE ====================
   Itens de débito por aluno (Inscrição, exames, aulas, etc.)
   com alocação automática dos pagamentos recebidos: cada
   depósito paga por inteiro o(s) primeiro(s) item(ns) em dívida
   e o valor que sobrar paga parcialmente o item seguinte.       */

async function abrirContaCorrente(alunoId) {
  try {
    const cc = await api('GET', `/api/contaCorrente/${alunoId}`);
    state.contaCorrenteAtual = cc;
    renderContaCorrenteModal(cc);
  } catch (err) { toast(err.message, 'error'); }
}

/* Agrupa os itens de conta corrente por "documento": um grupo por contrato
   de origem (identificado pelo padrão de faturação gerado ao assinar o
   contrato) e um grupo "Outros itens" para lançamentos avulsos/manuais.
   Isto dá às contas correntes de alunos diferentes uma estrutura
   consistente entre si, à semelhança de um extrato com documentos. */
function agruparItensConta(itens, contratos) {
  const porContrato = new Map();
  const avulsos = [];
  itens.forEach(it => {
    if (it.origemContratoId) {
      if (!porContrato.has(it.origemContratoId)) porContrato.set(it.origemContratoId, []);
      porContrato.get(it.origemContratoId).push(it);
    } else {
      avulsos.push(it);
    }
  });
  const grupos = [...porContrato.entries()].map(([contratoId, its]) => {
    const contrato = (contratos || []).find(c => c.id === contratoId);
    const plano = its[0]?.origemPlano || contrato?.planoPagamento || 'Contrato';
    return {
      titulo: `Contrato de formação${contrato ? ' — Categoria ' + esc(contrato.categoria || '—') : ''}`,
      plano,
      itens: its.sort((a, b) => (a.ordem ?? a.id) - (b.ordem ?? b.id))
    };
  });
  if (avulsos.length) grupos.push({ titulo: 'Outros itens (lançamentos avulsos)', plano: null, itens: avulsos.sort((a, b) => (a.ordem ?? a.id) - (b.ordem ?? b.id)) });
  return grupos;
}

function planoBadgeHtml(plano) {
  if (!plano) return '';
  const slug = plano.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  return `<span class="cc-plan-badge cc-plan-${slug}">${esc(plano)}</span>`;
}

function renderContaCorrenteModal(cc) {
  const { aluno, itens, pagamentos, contratos, valorTotal, totalPago, saldoTotal } = cc;
  const pagamentosOrdenados = [...pagamentos].sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.id - a.id);
  const grupos = agruparItensConta(itens, contratos);

  openModal(`Conta Corrente · ${aluno.nome} (Nº ${aluno.numeroAluno ?? aluno.id})`, `
    <div class="cc-summary">
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(valorTotal)}</div>
        <div class="stat-label">Valor total dos itens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(totalPago)}</div>
        <div class="stat-label">Total pago</div>
      </div>
      <div class="stat-card ${saldoTotal > 0 ? 'cc-stat-danger' : 'cc-stat-success'}">
        <div class="stat-value">${fmtMoney(saldoTotal)}</div>
        <div class="stat-label">Saldo em dívida</div>
      </div>
    </div>

    <div class="panel-head" style="margin-bottom:8px">
      <h3 style="font-size:14px">Itens de conta corrente</h3>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="imprimirContaCorrente(${aluno.id})">Exportar PDF</button>
        <button class="btn btn-accent btn-sm" onclick="abrirItemContaForm(${aluno.id})">+ Novo Item</button>
      </div>
    </div>

    <div class="cc-doc-list" style="margin-bottom:20px">
      ${grupos.length ? grupos.map(g => `
        <div class="cc-doc-group">
          <div class="cc-doc-group-head">
            <span class="cc-doc-title">${g.titulo}</span>
            ${planoBadgeHtml(g.plano)}
          </div>
          <div class="table-wrap" style="box-shadow:none; border-radius:0">
            <table>
              <thead><tr><th>Código</th><th>Descrição</th><th>Categoria</th><th>Qt.</th><th>Desconto</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${g.itens.map(it => `
                  <tr>
                    <td data-label="Código">${esc(it.codigo || '—')}</td>
                    <td data-label="Descrição" class="cell-primary">${esc(it.descricao)}</td>
                    <td data-label="Categoria">${esc(it.categoria || '—')}</td>
                    <td data-label="Qt.">${it.quantidade ?? 1}</td>
                    <td data-label="Desconto">${it.desconto ? it.desconto + '%' : '—'}</td>
                    <td data-label="Valor">${fmtMoney(it.valor)}</td>
                    <td data-label="Pago">${fmtMoney(it.valorPago)}</td>
                    <td data-label="Saldo">${fmtMoney(it.saldo)}</td>
                    <td data-label="Estado"><span class="${badgeClass(it.estado)}">${esc(it.estado)}</span></td>
                    <td data-label="Ações">
                      <div class="row-actions">
                        <button class="cc-item-action-btn cc-item-action-edit" title="Editar item" onclick="abrirItemContaForm(${aluno.id}, ${it.id})">Editar</button>
                        <button class="cc-item-action-btn cc-item-action-remove" title="Remover item" onclick="removerItemConta(${aluno.id}, ${it.id})">Remover</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `).join('') : `<div class="table-wrap" style="box-shadow:none"><table><tbody><tr><td class="muted">Sem itens registados.</td></tr></tbody></table></div>`}
      ${itens.length ? `
        <div class="cc-doc-total">
          <span>Total geral</span>
          <span>${fmtMoney(valorTotal)}</span>
          <span>Pago ${fmtMoney(totalPago)}</span>
          <span class="${saldoTotal > 0 ? 'cc-text-danger' : 'cc-text-success'}">Saldo ${fmtMoney(saldoTotal)}</span>
        </div>
      ` : ''}
    </div>

    <div class="panel-head" style="margin-bottom:8px">
      <h3 style="font-size:14px">Pagamentos / depósitos</h3>
      <button class="btn btn-accent btn-sm" onclick="abrirPagamentoContaForm(${aluno.id})">+ Registar Pagamento</button>
    </div>
    <div class="table-wrap" style="box-shadow:none">
      <table>
        <thead><tr><th>Data</th><th>Valor</th><th>Estado</th><th>Aplicado a</th></tr></thead>
        <tbody>
          ${pagamentosOrdenados.length ? pagamentosOrdenados.map(p => `
            <tr>
              <td>${fmtDate(p.data)}</td>
              <td class="cell-primary">${fmtMoney(p.valor)}</td>
              <td><span class="${badgeClass(p.estado)}">${esc(p.estado)}</span></td>
              <td>
                ${p.estado !== 'Pago'
      ? '<span class="muted" style="font-size:12px">Ainda não recebido — não aplicado ao saldo</span>'
      : (p.alocacoes && p.alocacoes.length
        ? p.alocacoes.map(a => `${esc(a.descricao)} (${fmtMoney(a.valor)})`).join(', ') + (p.sobra > 0.009 ? ` <span class="muted" style="font-size:12px">· sobra ${fmtMoney(p.sobra)} sem itens para aplicar</span>` : '')
        : '<span class="muted" style="font-size:12px">Sem itens em dívida para aplicar</span>')}
              </td>
            </tr>
          `).join('') : `<tr><td colspan="4" class="muted">Sem pagamentos registados.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button>
    </div>
  `);
}

function produtoLabel(p) {
  return `${p.codigo ? esc(p.codigo) + ' — ' : ''}${esc(p.descricao)} (${fmtMoney(p.valor)})`;
}

function abrirItemContaForm(alunoId, itemId) {
  const item = itemId ? (state.contaCorrenteAtual?.itens || []).find(i => i.id === itemId) : null;
  const produtos = [...(state.produtos || [])].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  const qtInicial = item?.quantidade ?? 1;
  const descontoInicial = item?.desconto ?? 0;
  const valorUnitInicial = item?.valorUnitario ?? item?.valor ?? '';
  openModal(item ? 'Editar Item de Conta Corrente' : 'Novo Item de Conta Corrente', `
    <form id="itemContaForm">
      <div class="form-field full" style="margin-bottom:14px">
        <label>Código do produto/serviço</label>
        <div style="display:flex; gap:8px; align-items:flex-start">
          <input name="produtoCodigo" id="itemContaCodigoInput" list="itemContaProdutosList" autocomplete="off"
            style="max-width:160px" placeholder="Ex: 000, 012..." value="${esc(item?.codigo || '')}">
          <input type="hidden" name="produtoId" id="itemContaProdutoId" value="">
          <div style="flex:1; align-self:center" id="itemContaProdutoResolvido" class="muted" style="font-size:12px"></div>
        </div>
        <datalist id="itemContaProdutosList">
          ${produtos.map(p => `<option value="${esc(p.codigo || '')}">${produtoLabel(p)}</option>`).join('')}
        </datalist>
        <p class="muted" style="margin-top:4px; font-size:12px">${produtos.length ? 'Escreve o código (ex: 012) e prime Tab — a descrição, categoria e valor são preenchidos automaticamente. Também podes escolher da lista de sugestões enquanto escreves. Os campos abaixo continuam editáveis.' : 'Sem produtos pré-definidos configurados. Podes criá-los em Configuração → Produtos/Serviços.'}</p>
      </div>
      <div class="form-grid">
        <div class="form-field full"><label>Descrição</label><input name="descricao" required value="${esc(item?.descricao || '')}" placeholder="Ex: Inscrição, Taxa de exame..."></div>
        <div class="form-field">
          <label>Categoria (Imp. proveito)</label>
          <select name="categoria">${CATEGORIAS_CONTA.map(c => `<option ${item?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Valor unitário (€)</label><input name="valorUnitario" id="itemContaValorUnit" type="number" step="0.01" min="0" required value="${esc(String(valorUnitInicial))}"></div>
        <div class="form-field"><label>Quantidade</label><input name="quantidade" id="itemContaQt" type="number" step="1" min="1" required value="${qtInicial}"></div>
        <div class="form-field"><label>Desconto (%)</label><input name="desconto" id="itemContaDesconto" type="number" step="0.01" min="0" max="100" value="${descontoInicial}"></div>
        <div class="form-field"><label>Valor total (€)</label><input name="valor" id="itemContaValorTotal" type="number" step="0.01" min="0" required value="${item?.valor ?? ''}" readonly style="background:var(--bg-subtle,#f3f4f6); font-weight:600"></div>
        <div class="form-field"><label>Ordem de pagamento (opcional)</label><input name="ordem" type="number" value="${item?.ordem ?? ''}" placeholder="Menor número = pago primeiro"></div>
      </div>
      <p class="muted" style="margin-top:6px">Os pagamentos são aplicados aos itens por esta ordem (ou pela ordem de criação, se não definires um número). O primeiro item por saldar é pago primeiro, na totalidade, antes de passar ao seguinte.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="abrirContaCorrente(${alunoId})">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar' : 'Criar item'}</button>
      </div>
    </form>
  `);
  const form = document.getElementById('itemContaForm');
  bindItemContaProdutoPicker(form, item);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      alunoId,
      codigo: fd.get('produtoCodigo') ? String(fd.get('produtoCodigo')).trim() : '',
      descricao: fd.get('descricao'),
      categoria: fd.get('categoria'),
      valorUnitario: Number(fd.get('valorUnitario')),
      quantidade: Number(fd.get('quantidade')) || 1,
      desconto: Number(fd.get('desconto')) || 0,
      valor: Number(fd.get('valor')),
      ordem: fd.get('ordem') === '' ? null : Number(fd.get('ordem'))
    };
    try {
      if (item) await api('PUT', `/api/itensConta/${item.id}`, payload);
      else await api('POST', '/api/itensConta', payload);
      toast(item ? 'Item atualizado.' : 'Item criado.');
      await abrirContaCorrente(alunoId);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* Liga o input de "código" (com datalist de sugestões) do formulário de item
   de conta corrente: ao escrever um código que corresponda exatamente a um
   produto do catálogo, preenche automaticamente descrição, categoria e valor
   unitário. Também recalcula o valor total sempre que valor unitário,
   quantidade ou desconto mudam — tudo continua editável manualmente depois. */
function bindItemContaProdutoPicker(form, itemExistente) {
  const codigoInput = form.querySelector('#itemContaCodigoInput');
  const produtoIdHidden = form.querySelector('#itemContaProdutoId');
  const resolvido = form.querySelector('#itemContaProdutoResolvido');
  const descricaoInput = form.querySelector('[name="descricao"]');
  const categoriaSelect = form.querySelector('[name="categoria"]');
  const valorUnitInput = form.querySelector('#itemContaValorUnit');
  const qtInput = form.querySelector('#itemContaQt');
  const descontoInput = form.querySelector('#itemContaDesconto');
  const valorTotalInput = form.querySelector('#itemContaValorTotal');
  if (!codigoInput) return;

  if (itemExistente?.codigo) {
    const p0 = (state.produtos || []).find(p => p.codigo === itemExistente.codigo);
    if (p0) { produtoIdHidden.value = p0.id; resolvido.textContent = `✓ ${produtoLabelPlain(p0)}`; }
  }

  function aplicarProduto(produto) {
    if (!produto) return;
    produtoIdHidden.value = produto.id;
    codigoInput.value = produto.codigo || '';
    descricaoInput.value = produto.descricao;
    if (produto.categoria) categoriaSelect.value = produto.categoria;
    valorUnitInput.value = produto.valor;
    resolvido.textContent = `✓ ${produtoLabelPlain(produto)}`;
    recalcularTotal();
  }

  function tentarResolverCodigo() {
    const texto = String(codigoInput.value || '').trim();
    if (!texto) { produtoIdHidden.value = ''; resolvido.textContent = ''; return; }
    // Correspondência exacta pelo código (o caso normal de uso: escrever "012").
    let produto = (state.produtos || []).find(p => String(p.codigo || '').toLowerCase() === texto.toLowerCase());
    if (!produto) {
      // Também aceita colar/escolher a etiqueta completa da lista de sugestões.
      produto = (state.produtos || []).find(p => produtoLabelPlain(p) === texto || `${p.codigo || ''} — ${p.descricao}` === texto);
    }
    if (produto) aplicarProduto(produto);
    else { produtoIdHidden.value = ''; resolvido.textContent = texto ? 'Código não encontrado — preenche os campos manualmente.' : ''; }
  }

  function recalcularTotal() {
    const unit = Number(valorUnitInput.value) || 0;
    const qt = Number(qtInput.value) || 1;
    const desc = Number(descontoInput.value) || 0;
    const total = +(unit * qt * (1 - desc / 100)).toFixed(2);
    valorTotalInput.value = total;
  }

  codigoInput.addEventListener('input', tentarResolverCodigo);
  codigoInput.addEventListener('change', tentarResolverCodigo);
  [valorUnitInput, qtInput, descontoInput].forEach(inp => inp.addEventListener('input', recalcularTotal));
  recalcularTotal();
}

function produtoLabelPlain(p) {
  return `${p.codigo ? p.codigo + ' — ' : ''}${p.descricao} (${fmtMoney(p.valor)})`;
}

async function removerItemConta(alunoId, itemId) {
  if (!confirm('Tens a certeza que queres remover este item de conta corrente?')) return;
  try {
    await api('DELETE', `/api/itensConta/${itemId}`);
    toast('Item removido.');
    await abrirContaCorrente(alunoId);
  } catch (err) { toast(err.message, 'error'); }
}

function imprimirContaCorrente(alunoId) {
  const cc = state.contaCorrenteAtual;
  if (!cc || cc.aluno.id !== alunoId) return;
  const { aluno, pagamentos, contratos, valorTotal, totalPago, saldoTotal } = cc;
  const grupos = agruparItensConta(cc.itens, contratos);
  const pagamentosOrdenados = [...pagamentos].sort((a, b) => (a.data || '').localeCompare(b.data || '') || a.id - b.id);
  const escola = state.escola || {};

  const html = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Extrato de Conta Corrente</h1>
        <p class="muted">${esc(escola.nome || 'Escola de Condução')}${escola.numeroLicencaIMT ? ` · Licença IMT n.º ${esc(escola.numeroLicencaIMT)}` : ''} · Emitido em ${fmtDate(new Date().toISOString().slice(0, 10))}</p>
      </div>
      <table class="print-info"><tbody>
        <tr><td><strong>Nº Aluno</strong></td><td>${aluno.numeroAluno ?? aluno.id}</td><td><strong>Categoria</strong></td><td>${esc(aluno.categoria || '—')}</td></tr>
        <tr><td><strong>Nome</strong></td><td>${esc(aluno.nome)}</td><td><strong>NIF</strong></td><td>${esc(aluno.nif || '—')}</td></tr>
      </tbody></table>

      ${grupos.map(g => `
        <h4 style="margin-top:16px; margin-bottom:6px; font-size:13.5px">${g.titulo}${g.plano ? ` <span class="muted" style="font-weight:400">(${esc(g.plano)})</span>` : ''}</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Descrição</th><th>Categoria</th><th>Qt.</th><th>Desconto</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              ${g.itens.map(it => `
                <tr>
                  <td>${esc(it.codigo || '—')}</td>
                  <td>${esc(it.descricao)}</td>
                  <td>${esc(it.categoria || '—')}</td>
                  <td>${it.quantidade ?? 1}</td>
                  <td>${it.desconto ? it.desconto + '%' : '—'}</td>
                  <td>${fmtMoney(it.valor)}</td>
                  <td>${fmtMoney(it.valorPago)}</td>
                  <td>${fmtMoney(it.saldo)}</td>
                  <td>${esc(it.estado)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('')}

      <table class="print-info" style="margin-top:14px"><tbody>
        <tr><td><strong>Valor total dos itens</strong></td><td>${fmtMoney(valorTotal)}</td></tr>
        <tr><td><strong>Total pago</strong></td><td>${fmtMoney(totalPago)}</td></tr>
        <tr><td><strong>Saldo em dívida</strong></td><td>${fmtMoney(saldoTotal)}</td></tr>
      </tbody></table>

      <h4 style="margin-top:18px; margin-bottom:6px; font-size:13.5px">Pagamentos / depósitos</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Valor</th><th>Estado</th><th>Aplicado a</th></tr></thead>
          <tbody>
            ${pagamentosOrdenados.length ? pagamentosOrdenados.map(p => `
              <tr>
                <td>${fmtDate(p.data)}</td>
                <td>${fmtMoney(p.valor)}</td>
                <td>${esc(p.estado)}</td>
                <td>${p.estado !== 'Pago' ? 'Pendente' : (p.alocacoes && p.alocacoes.length ? p.alocacoes.map(a => `${esc(a.descricao)} (${fmtMoney(a.valor)})`).join(', ') : '—')}</td>
              </tr>
            `).join('') : `<tr><td colspan="4" class="muted">Sem pagamentos registados.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="print-sign">
        <div><div class="sign-line"></div><span>Assinatura do responsável da escola</span></div>
        <div><div class="sign-line"></div><span>Aluno / Encarregado de educação</span></div>
      </div>
    </div>
  `;
  exportarHtmlParaPdf(html, `conta-corrente-${(aluno.nome || 'aluno').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.pdf`);
}

function abrirPagamentoContaForm(alunoId) {
  openModal('Registar Pagamento / Depósito', `
    <form id="pagamentoContaForm">
      <div class="form-grid">
        <div class="form-field"><label>Valor do depósito (€)</label><input name="valor" type="number" step="0.01" min="0" required></div>
        <div class="form-field"><label>Data</label><input name="data" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-field full"><label>Descrição (opcional)</label><input name="descricao" placeholder="Ex: Depósito inicial"></div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">
            <option value="Pago">Pago (aplica já ao saldo)</option>
            <option value="Pendente">Pendente (ainda não recebido)</option>
          </select>
        </div>
      </div>
      <p class="muted" style="margin-top:6px">Ao gravar como "Pago", o valor é automaticamente distribuído pelos itens de conta corrente em dívida, por ordem: paga por inteiro o primeiro item em falta e, com o que sobrar, paga parcialmente o item seguinte.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="abrirContaCorrente(${alunoId})">Cancelar</button>
        <button type="submit" class="btn btn-accent">Registar</button>
      </div>
    </form>
  `);
  const form = document.getElementById('pagamentoContaForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      alunoId,
      valor: Number(fd.get('valor')),
      data: fd.get('data'),
      descricao: fd.get('descricao') || 'Depósito',
      estado: fd.get('estado'),
      taxaIva: state.escola?.primavera?.taxaIvaDefault ?? 18
    };
    try {
      await api('POST', '/api/pagamentos', payload);
      await refreshCollections(['pagamentos', 'dashboard']);
      toast(payload.estado === 'Pago' ? 'Pagamento registado e aplicado ao saldo.' : 'Pagamento registado como pendente.');
      await abrirContaCorrente(alunoId);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== PAGAMENTOS + FATURAÇÃO PRIMAVERA ==================== */
function renderPagamentos() {
  const el = document.getElementById('view-pagamentos');
  const q = state.search.pagamentos.toLowerCase();
  let list = [...state.pagamentos].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  if (q) list = list.filter(p => { const a = findAluno(p.alunoId); return a && a.nome.toLowerCase().includes(q); });

  const primaveraAtivo = !!state.escola?.primavera?.ativo;

  el.innerHTML = `
    ${!primaveraAtivo ? `
      <div class="inline-alert inline-alert-info" style="margin-bottom:18px">
        A faturação automática é tratada pelo backend. Aqui escolhes apenas o aluno, o valor, a descrição e o estado do pagamento.
      </div>
    ` : ''}
    <div class="toolbar">
      <input class="search-input" placeholder="Pesquisar por nome do aluno..." value="${esc(state.search.pagamentos)}" oninput="updateSearchAndRerender(this, 'pagamentos', renderPagamentos)">
    </div>
    <div class="table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Aluno</th><th>Descrição</th><th>Data</th><th>Valor</th><th>Estado</th><th>Faturação</th><th></th></tr></thead>
        <tbody>
          ${list.map(p => {
    const aluno = findAluno(p.alunoId);
    const fat = p.faturacao;
    return `
            <tr>
              <td class="cell-primary">${esc(aluno?.nome || '—')} ${aluno ? `<span class="muted" style="font-size:12px">· Nº ${aluno.numeroAluno ?? aluno.id}</span>` : ''}</td>
              <td>${esc(p.descricao || '—')}</td>
              <td>${fmtDate(p.data)}</td>
              <td class="cell-primary">${fmtMoney(p.valor)}</td>
              <td><span class="${badgeClass(p.estado)}">${esc(p.estado || '—')}</span></td>
              <td>${fat ? `<span class="tag" style="background:var(--info-soft); color:var(--info)">${esc(fat.tipo)} ${esc(fat.serie || '')}/${esc(fat.numero || '')}</span>` : '<span class="muted" style="font-size:12px">Por emitir</span>'}</td>
              <td>
                <div class="row-actions">
                  ${aluno ? `<button class="btn btn-ghost btn-sm" onclick="abrirContaCorrente(${aluno.id})">Conta Corrente</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openPagamentoForm(${p.id})">Editar</button>
                  <button class="btn btn-accent btn-sm" onclick="abrirFaturacaoModal(${p.id})">Faturar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('pagamentos', ${p.id}, 'este pagamento')">Remover</button>
                </div>
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>` : emptyState('Nenhum pagamento encontrado', 'Regista um novo pagamento de um aluno.')}
    </div>
  `;
}

function openPagamentoForm(id) {
  const item = id ? state.pagamentos.find(p => p.id === id) : null;
  openModal(item ? 'Editar Pagamento' : 'Novo Pagamento', `
    <form id="entityForm">
      <div class="form-grid">
        ${renderAlunoPickerHtml(item?.alunoId, { hint: 'Escolhe um aluno existente ou escreve o nome completo.' })}
        <div class="form-field full">
          <label>Artigo / descrição do serviço</label>
          <select name="descricao">
            <option value="">Selecionar artigo</option>
            ${['Inscrição inicial', 'Aulas teóricas', 'Aulas práticas', 'Aulas de reforço', 'Exames / avaliação', 'Pack completo'].map(opt => `<option value="${opt}" ${item?.descricao === opt ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>Valor (€)</label><input name="valor" type="number" step="0.01" min="0" required value="${item?.valor ?? ''}"></div>
        <div class="form-field"><label>Data</label><input name="data" type="date" value="${item?.data || ''}"></div>
        <div class="form-field"><label>Taxa de IVA (%)</label><input name="taxaIva" type="number" min="0" max="100" value="${item?.taxaIva ?? state.escola?.primavera?.taxaIvaDefault ?? 18}"></div>
        <div class="form-field">
          <label>Estado</label>
          <select name="estado">${['Pago', 'Pendente'].map(c => `<option ${item?.estado === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
      </div>
      <p class="muted" style="margin-top:4px">O NIF e o email usados na faturação são os que estão na ficha do aluno selecionado. Quando marcado como "Pago", o valor é aplicado automaticamente à conta corrente do aluno.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Registar pagamento'}</button>
      </div>
    </form>
  `);
  const form = document.getElementById('entityForm');
  bindAlunoPicker(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const alunoId = Number(fd.get('alunoId') || 0);
    if (!alunoId) {
      toast('Seleciona ou escreve o nome de um aluno existente.', 'error');
      return;
    }
    const payload = {
      alunoId,
      descricao: fd.get('descricao'),
      valor: Number(fd.get('valor')),
      data: fd.get('data'),
      taxaIva: Number(fd.get('taxaIva') || 18),
      estado: fd.get('estado')
    };
    try {
      if (item) await api('PUT', `/api/pagamentos/${item.id}`, payload);
      else await api('POST', '/api/pagamentos', payload);
      await refreshCollections(['pagamentos', 'dashboard']);
      closeModal();
      renderPagamentos();
      renderDashboard();
      toast(item ? 'Pagamento atualizado.' : 'Pagamento registado.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ------- Configuração da integração Cegid Primavera (por escola) ------- */
function openPrimaveraConfigForm() {
  const cfg = state.escola.primavera || {};
  openModal('Faturação · Integração Cegid Primavera', `
    <p class="muted" style="margin-bottom:14px">
      Estes dados de ligação são específicos desta escola e nunca são partilhados com outras escolas na plataforma.
    </p>
    <form id="primaveraForm">
      <div class="form-grid">
        <div class="form-field full">
          <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-weight:500; color:var(--ink)">
            <input type="checkbox" name="ativo" ${cfg.ativo ? 'checked' : ''}> Ativar emissão automática de documentos na Cegid Primavera
          </label>
        </div>
        <div class="form-field full"><label>URL base do gateway Primavera</label><input name="baseUrl" value="${esc(cfg.baseUrl || '')}" placeholder="https://exemplo.gateway-primavera.pt"></div>
        <div class="form-field"><label>Empresa (Primavera)</label><input name="empresa" value="${esc(cfg.empresa || 'ESCOLAS')}" placeholder="Ex: ESCOLAS"></div>
        <div class="form-field"><label>Série do documento</label><input name="serie" value="${esc(cfg.serie || '1')}" placeholder="Ex: 1"></div>
        <div class="form-field"><label>X-Client-ID</label><input name="clientId" value="${esc(cfg.clientId || '')}"></div>
        <div class="form-field"><label>X-API-Key</label><input name="apiKey" type="password" value="${esc(cfg.apiKey || '')}" placeholder="${cfg.apiKey ? 'Preenchida (deixa em branco para manter)' : ''}"></div>
        <div class="form-field"><label>Modo de pagamento (recibos)</label><input name="modoPag" value="${esc(cfg.modoPag || 'NUM')}" placeholder="NUM, TRF..."></div>
        <div class="form-field"><label>Conta bancária</label><input name="contaBancaria" value="${esc(cfg.contaBancaria || '01')}"></div>
        <div class="form-field"><label>Filial</label><input name="filial" value="${esc(cfg.filial || '000')}"></div>
        <div class="form-field"><label>Armazém</label><input name="armazem" value="${esc(cfg.armazem || 'A1')}"></div>
        <div class="form-field"><label>Código do artigo</label><input name="artigoFormacao" value="${esc(cfg.artigoFormacao || 'FORMACAO')}" placeholder="Código do artigo configurado no ERP"></div>
        <div class="form-field"><label>Taxa de IVA por omissão (%)</label><input name="taxaIvaDefault" type="number" min="0" max="100" value="${cfg.taxaIvaDefault ?? 18}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">Guardar configuração</button>
      </div>
    </form>
  `);
  const form = document.getElementById('primaveraForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      ativo: !!fd.get('ativo'),
      baseUrl: fd.get('baseUrl'),
      empresa: fd.get('empresa'),
      serie: fd.get('serie'),
      clientId: fd.get('clientId'),
      apiKey: fd.get('apiKey'),
      modoPag: fd.get('modoPag'),
      contaBancaria: fd.get('contaBancaria'),
      filial: fd.get('filial'),
      armazem: fd.get('armazem'),
      artigoFormacao: fd.get('artigoFormacao'),
      taxaIvaDefault: Number(fd.get('taxaIvaDefault') || 18)
    };
    try {
      await api('PUT', '/api/escola/primavera', payload);
      await refreshCollections(['escola']);
      closeModal();
      renderPagamentos();
      toast('Configuração de faturação guardada.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ------- Emissão de documentos (Fatura / Fatura-Recibo / Recibo / Nota de Crédito) ------- */
function abrirFaturacaoModal(pagamentoId) {
  const p = state.pagamentos.find(x => x.id === pagamentoId);
  if (!p) return;
  const aluno = findAluno(p.alunoId);
  const fat = p.faturacao;
  const historico = p.historicoFaturacao || [];
  const primaveraAtivo = !!state.escola?.primavera?.ativo;

  const avisos = [];
  if (!primaveraAtivo) avisos.push('A integração com a Cegid Primavera não está ativa nesta escola.');
  if (aluno && !aluno.nif) avisos.push('Este aluno não tem NIF preenchido — é obrigatório para emitir documentos fiscais.');
  if (!aluno) avisos.push('Este pagamento não está associado a um aluno válido.');

  openModal(`Faturação · ${esc(aluno?.nome || 'Pagamento')}`, `
    <div class="print-info-grid" style="margin-bottom:16px">
      <div><strong>Descrição</strong><br>${esc(p.descricao || '—')}</div>
      <div><strong>Valor</strong><br>${fmtMoney(p.valor)}</div>
      <div><strong>NIF do aluno</strong><br>${esc(aluno?.nif || '—')}</div>
      <div><strong>Email do aluno</strong><br>${esc(aluno?.email || '—')}</div>
    </div>

    ${avisos.length ? `<div class="inline-alert inline-alert-warning" style="margin-bottom:16px">${avisos.map(a => `⚠ ${esc(a)}`).join('<br>')}</div>` : ''}

    ${fat ? `<div class="inline-alert inline-alert-info" style="margin-bottom:16px">Último documento emitido: <strong>${esc(fat.tipo)} ${esc(fat.serie || '')}/${esc(fat.numero || '')}</strong>, em ${new Date(fat.dataEmissao).toLocaleString('pt-PT')}.</div>` : ''}

    <div id="faturacaoAcoes" style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px">
      <!-- FATURA (FA) — desativada temporariamente, só se emite Fatura-Recibo
      <button class="btn btn-accent" ${avisos.length ? 'disabled' : ''} onclick="emitirDocumentoPagamento(${p.id}, 'fatura')">Emitir Fatura (FA)</button>
      -->
      <button class="btn btn-accent" ${avisos.length ? 'disabled' : ''} onclick="emitirDocumentoPagamento(${p.id}, 'fatura-recibo')">Emitir Fatura-Recibo (FR)</button>
      <!-- RECIBO (RE) — desativado temporariamente
      <button class="btn btn-ghost" ${avisos.length || !fat ? 'disabled' : ''} onclick="abrirReciboForm(${p.id})">Emitir Recibo a liquidar documento (RE)</button>
      -->
      <!-- NOTA DE CRÉDITO (NC) — desativada temporariamente
      <button class="btn btn-danger-ghost" ${avisos.length || !fat ? 'disabled' : ''} onclick="abrirNotaCreditoForm(${p.id})">Emitir Nota de Crédito (NC)</button>
      -->
    </div>

    ${historico.length ? `
      <h4 style="font-size:13px; margin-bottom:8px">Histórico de tentativas de faturação</h4>
      <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px">
        ${historico.slice().reverse().map(h => `
          <div style="padding:6px 4px; border-bottom:1px solid var(--border); font-size:12.5px">
            <strong>${esc(h.tipo)}</strong> · ${new Date(h.dataHora).toLocaleString('pt-PT')} ·
            ${h.sucesso ? `<span style="color:var(--success)">sucesso (${esc(h.doc_serie || '')}/${esc(h.doc_numero || '')})</span>` : `<span style="color:var(--danger)">${esc(h.erro || 'falha')}</span>`}
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button>
    </div>
  `);
}

async function emitirDocumentoPagamento(pagamentoId, tipo) {
  try {
    toast('A comunicar com a Cegid Primavera…');
    await api('POST', `/api/pagamentos/${pagamentoId}/${tipo}`, {});
    await refreshCollections(['pagamentos']);
    abrirFaturacaoModal(pagamentoId);
    renderPagamentos();
    toast('Documento emitido com sucesso.');
  } catch (err) {
    toast(err.message, 'error');
    abrirFaturacaoModal(pagamentoId);
  }
}

/* ------- RECIBO (RE) — função inteira desativada temporariamente -------
function abrirReciboForm(pagamentoId) {
  const p = state.pagamentos.find(x => x.id === pagamentoId);
  if (!p || !p.faturacao) return;
  const fat = p.faturacao;
  openModal('Emitir Recibo (liquidação)', `
    <form id="reciboForm">
      <div class="form-grid">
        <div class="form-field"><label>Tipo do documento original</label><input name="docOriginalTipo" value="${esc(fat.tipo || 'FA')}" required></div>
        <div class="form-field"><label>Série do documento original</label><input name="docOriginalSerie" value="${esc(fat.serie || '')}" required></div>
        <div class="form-field"><label>N.º do documento original</label><input name="docOriginalNumero" value="${esc(fat.numero || '')}" required></div>
        <div class="form-field"><label>N.º de prestação</label><input name="numPrestacao" type="number" min="1" value="1"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="abrirFaturacaoModal(${pagamentoId})">Cancelar</button>
        <button type="submit" class="btn btn-accent">Emitir recibo</button>
      </div>
    </form>
  `);
  const form = document.getElementById('reciboForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      toast('A comunicar com a Cegid Primavera…');
      await api('POST', `/api/pagamentos/${pagamentoId}/recibo`, {
        docOriginalTipo: fd.get('docOriginalTipo'),
        docOriginalSerie: fd.get('docOriginalSerie'),
        docOriginalNumero: fd.get('docOriginalNumero'),
        numPrestacao: Number(fd.get('numPrestacao') || 1)
      });
      await loadAll();
      renderPagamentos();
      abrirFaturacaoModal(pagamentoId);
      toast('Recibo emitido com sucesso.');
    } catch (err) { toast(err.message, 'error'); }
  });
}
*/

/* ------- NOTA DE CRÉDITO (NC) — função inteira desativada temporariamente -------
function abrirNotaCreditoForm(pagamentoId) {
  const p = state.pagamentos.find(x => x.id === pagamentoId);
  if (!p || !p.faturacao) return;
  const fat = p.faturacao;
  openModal('Emitir Nota de Crédito', `
    <form id="ncForm">
      <div class="form-grid">
        <div class="form-field"><label>Tipo do documento original</label><input name="docOriginalTipo" value="${esc(fat.tipo || 'FA')}" required></div>
        <div class="form-field"><label>Série do documento original</label><input name="docOriginalSerie" value="${esc(fat.serie || '')}" required></div>
        <div class="form-field"><label>N.º do documento original</label><input name="docOriginalNumero" value="${esc(fat.numero || '')}" required></div>
        <div class="form-field full"><label>Motivo do estorno (código)</label><input name="motivo" value="001"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="abrirFaturacaoModal(${pagamentoId})">Cancelar</button>
        <button type="submit" class="btn btn-danger-ghost">Emitir nota de crédito</button>
      </div>
    </form>
  `);
  const form = document.getElementById('ncForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      toast('A comunicar com a Cegid Primavera…');
      await api('POST', `/api/pagamentos/${pagamentoId}/nota-credito`, {
        docOriginalTipo: fd.get('docOriginalTipo'),
        docOriginalSerie: fd.get('docOriginalSerie'),
        docOriginalNumero: fd.get('docOriginalNumero'),
        motivo: fd.get('motivo')
      });
      await loadAll();
      renderPagamentos();
      abrirFaturacaoModal(pagamentoId);
      toast('Nota de crédito emitida com sucesso.');
    } catch (err) { toast(err.message, 'error'); }
  });
}
*/

function renderRelatorioAlunoHTML(rel) {
  const { aluno, requisito, resumo, praticas, teoricasIndividuais, turmasTeoricas, alertasDocumentais } = rel;
  const linhasTeoricas = [
    ...teoricasIndividuais.map(t => ({ data: t.data, hora: t.hora, tema: t.notas || 'Aula teórica individual', duracaoMin: t.duracaoMin, estado: t.estado, presenca: t.estado === 'Concluída' ? 'Presente' : t.estado })),
    ...turmasTeoricas.map(t => ({ data: t.data, hora: t.horaInicio, tema: t.tema, duracaoMin: t.duracaoMin, estado: t.estado, presenca: t.presente === null ? t.estado : (t.presente ? 'Presente' : 'Faltou') }))
  ].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

  return `
    ${alertasDocumentais && alertasDocumentais.length ? `
      <div class="inline-alert inline-alert-warning" style="margin-bottom:16px">
        ${alertasDocumentais.map(t => `⚠ ${esc(t)}`).join('<br>')}
      </div>` : ''}

    <div class="print-info-grid">
      <div><strong>NIF</strong><br>${esc(aluno.nif || '—')}</div>
      <div><strong>Documento</strong><br>${esc(aluno.tipoDocumento || '—')} ${esc(aluno.numeroDocumento || '')}</div>
      <div><strong>Data nascimento</strong><br>${fmtDate(aluno.dataNascimento)}</div>
      <div><strong>Processo IMT</strong><br>${esc(aluno.processoIMT?.numero || '—')}</div>
      <div><strong>Atestado médico válido até</strong><br>${fmtDate(aluno.atestadoMedico?.dataValidade)}</div>
      <div><strong>Dispensa de módulos</strong><br>${esc(aluno.dispensaModulos || 'Nenhuma')}</div>
    </div>

    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit, minmax(170px,1fr)); margin-bottom:18px">
      <div class="stat-card">
        <div class="stat-value">${fmtHorasMin(resumo.horasTeoricasRealizadas)}</div>
        <div class="stat-label">Horas teóricas realizadas ${requisito.horasTeoricasMin ? `/ mín. ${fmtHorasMin(requisito.horasTeoricasMin)}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtHorasMin(resumo.horasPraticasRealizadas)}</div>
        <div class="stat-label">Horas práticas realizadas ${requisito.horasPraticasMin ? `/ mín. ${fmtHorasMin(requisito.horasPraticasMin)}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${resumo.kmTotalPercorridos} km</div>
        <div class="stat-label">Km percorridos em prática ${resumo.kmMin ? `/ mín. ${resumo.kmMin} km` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${resumo.faltasTeoricas}</div>
        <div class="stat-label">Faltas a aulas teóricas</div>
      </div>
    </div>

    <h4 style="margin-bottom:8px; font-size:14px">Aulas teóricas frequentadas</h4>
    <div class="table-wrap" style="box-shadow:none; margin-bottom:18px">
      <table>
        <thead><tr><th>Data</th><th>Hora</th><th>Tema</th><th>Duração</th><th>Presença</th></tr></thead>
        <tbody>
          ${linhasTeoricas.length ? linhasTeoricas.map(t => `
            <tr>
              <td>${fmtDate(t.data)}</td><td>${esc(t.hora || '—')}</td><td>${esc(t.tema)}</td>
              <td>${Math.round(t.duracaoMin)} min</td>
              <td><span class="${badgeClass(t.presenca)}">${esc(t.presenca)}</span></td>
            </tr>`).join('') : `<tr><td colspan="5" class="muted">Sem registos teóricos.</td></tr>`}
        </tbody>
      </table>
    </div>

    <h4 style="margin-bottom:8px; font-size:14px">Aulas práticas frequentadas</h4>
    <div class="table-wrap" style="box-shadow:none">
      <table>
        <thead><tr><th>Data</th><th>Hora</th><th>Instrutor</th><th>Veículo</th><th>Módulo</th><th>Km</th><th>Duração</th><th>Estado</th></tr></thead>
        <tbody>
          ${praticas.length ? praticas.map(p => `
            <tr>
              <td>${fmtDate(p.data)}</td><td>${esc(p.hora)}</td><td>${esc(p.instrutorNome)}</td>
              <td>${esc(p.veiculoMatricula)}</td><td>${esc(p.modulo || '—')}</td><td>${p.km ?? '—'}</td><td>${p.duracaoMin} min</td>
              <td><span class="${badgeClass(p.estado)}">${esc(p.estado)}</span></td>
            </tr>`).join('') : `<tr><td colspan="8" class="muted">Sem registos práticos.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function abrirFichaIndividualModal(alunoId) {
  const aluno = findAluno(alunoId);
  if (!aluno) return;

  openModal(`Ficha Individual · ${esc(aluno.nome)}`, `<div class="muted" style="padding:12px">A carregar ficha...</div>`);
  alargarModal();

  try {
    const rel = await api('GET', `/api/relatorios/aluno/${alunoId}`);
    state.relatorios = state.relatorios || {};
    state.relatorios.dadosAtuais = rel; // permite reutilizar o botão de exportar PDF já existente

    openModal(`Ficha Individual · ${esc(aluno.nome)}`, `
      ${renderRelatorioAlunoHTML(rel)}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button>
        <button type="button" class="btn btn-accent" onclick="imprimirRelatorioAluno()">Exportar PDF</button>
      </div>
    `);
    alargarModal();
  } catch (err) {
    openModal(`Ficha Individual · ${esc(aluno.nome)}`, emptyState('Erro ao carregar ficha', err.message));
  }
}

async function carregarMapaGeral() {
  const box = document.getElementById('mapaGeralBox');
  if (!box) return;
  try {
    const linhas = await api('GET', '/api/relatorios/geral');
    state.relatorios = state.relatorios || {};
    state.relatorios.mapaAtual = linhas;
    box.innerHTML = `
      <div class="table-wrap" style="box-shadow:none">
        <table>
          <thead><tr><th>Aluno</th><th>Categoria</th><th>Horas teóricas</th><th>Horas práticas</th><th>Km percorridos</th><th>Faltas teóricas</th><th>Conformidade</th></tr></thead>
          <tbody>
            ${linhas.map(l => {
      const okTeorica = l.horasTeoricasMin ? l.horasTeoricasRealizadas >= l.horasTeoricasMin : null;
      const okPratica = l.horasPraticasMin ? l.horasPraticasRealizadas >= l.horasPraticasMin : null;
      const okKm = l.kmMin ? l.kmTotalPercorridos >= l.kmMin : null;
      const semDados = okTeorica === null && okPratica === null && okKm === null;
      const conforme = semDados ? null : (okTeorica !== false && okPratica !== false && okKm !== false);
      return `
              <tr>
                <td class="cell-primary">${esc(l.nome)}</td>
                <td>${esc(l.categoria || '—')}</td>
                <td>${fmtHorasMin(l.horasTeoricasRealizadas)}${l.horasTeoricasMin ? ` / ${fmtHorasMin(l.horasTeoricasMin)}` : ''}</td>
                <td>${fmtHorasMin(l.horasPraticasRealizadas)}${l.horasPraticasMin ? ` / ${fmtHorasMin(l.horasPraticasMin)}` : ''}</td>
                <td>${l.kmTotalPercorridos}km${l.kmMin ? ` / ${l.kmMin}km` : ''}</td>
                <td>${l.faltasTeoricas}</td>
                <td>${semDados ? '<span class="badge badge-inativo">Sem requisito definido</span>' : (conforme ? '<span class="badge badge-ativo">Conforme</span>' : '<span class="badge badge-suspenso">Por completar</span>')}</td>
              </tr>`;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    box.innerHTML = emptyState('Erro ao carregar mapa', err.message);
  }
}

async function carregarEsperaTeoricaPratica() {
  const box = document.getElementById('esperaTeoricaPraticaBox');
  const alertBox = document.getElementById('alertasEsperaBox');
  if (!box && !alertBox) return;
  try {
    const lista = await api('GET', '/api/relatorios/espera-teorica-pratica');
    state.relatorios = state.relatorios || {};
    state.relatorios.esperaAtual = lista;

    const emAlerta = (lista || []).filter(r => r.diasEspera > 60);
    if (alertBox) {
      alertBox.innerHTML = emAlerta.length ? `
        <div class="inline-alert inline-alert-warning" style="margin:12px">
          ${emAlerta.map(r => `⚠ ${esc(r.nome)} (${esc(r.espacoNome)}) — ${r.diasEspera} dias de espera desde a aprovação teórica em ${fmtDate(r.dataExameAprovado)}.`).join('<br>')}
        </div>
      ` : `<div class="muted" style="padding:12px">Sem casos acima de 60 dias de espera.</div>`;
    }

    if (box) {
      box.innerHTML = (lista && lista.length) ? `
      <div class="table-wrap" style="box-shadow:none">
        <table>
          <thead><tr><th>Aluno</th><th>Espaço</th><th>Exame teórico aprovado</th><th>1.ª aula prática</th><th>Dias de espera</th></tr></thead>
          <tbody>
            ${lista.map(r => `
              <tr>
                <td class="cell-primary">${esc(r.nome)}</td>
                <td>${esc(r.espacoNome)}</td>
                <td>${fmtDate(r.dataExameAprovado)}</td>
                <td>${fmtDate(r.dataAula1)}</td>
                <td>${r.diasEspera > 60 ? `<span class="badge badge-suspenso">${r.diasEspera} dias</span>` : `${r.diasEspera} dias`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : emptyState('Sem dados', 'Ainda não há alunos com exame teórico aprovado e aula prática registada.');
    } // <-- fecha o "if (box)" que faltava
  } catch (err) {
    if (box) box.innerHTML = emptyState('Erro ao carregar', err.message);
    if (alertBox) alertBox.innerHTML = '';
  }
}

async function carregarInscricoesEspaco() {
  const box = document.getElementById('inscricoesEspacoBox');
  try {
    const { porEspaco } = await api('GET', '/api/relatorios/inscricoes-espaco');
    const anoAtual = new Date().getFullYear();
    box.innerHTML = porEspaco.length ? porEspaco.map(e => {
      const porMesAno = e.porMes.filter(m => m.mes.startsWith(String(anoAtual)));
      return `
        <div style="margin-bottom:18px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
            <strong>${esc(e.espacoNome)}</strong>
            <span class="muted">${e.totalAlunos} inscrições no total</span>
          </div>
          <div class="table-wrap" style="box-shadow:none; margin-bottom:8px">
            <table>
              <thead><tr><th>Mês (${anoAtual})</th><th>Inscrições</th></tr></thead>
              <tbody>
                ${porMesAno.length ? porMesAno.map(m => `<tr><td>${fmtMesLabel(m.mes)}</td><td>${m.total}</td></tr>`).join('') : `<tr><td colspan="2" class="muted">Sem inscrições este ano.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="table-wrap" style="box-shadow:none">
            <table>
              <thead><tr><th>Ano</th><th>Inscrições</th></tr></thead>
              <tbody>
                ${e.porAno.length ? e.porAno.map(a => `<tr><td>${esc(a.ano)}</td><td>${a.total}</td></tr>`).join('') : `<tr><td colspan="2" class="muted">Sem dados.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('') : emptyState('Sem espaços configurados', 'Cria um espaço em Configurações.');
  } catch (err) {
    box.innerHTML = emptyState('Erro ao carregar', err.message);
  }
}

async function carregarFluxoCaixa() {
  const box = document.getElementById('fluxoCaixaBox');
  try {
    const { global, porEspaco } = await api('GET', '/api/relatorios/fluxo-caixa');
    const anoAtual = new Date().getFullYear();

    function blocoHtml(titulo, dados) {
      const porMesAno = dados.porMes.filter(m => m.chave.startsWith(String(anoAtual)));
      return `
        <div style="margin-bottom:18px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
            <strong>${esc(titulo)}</strong>
            <span class="muted">Total geral: ${fmtMoney(dados.total)}</span>
          </div>
          <div class="table-wrap" style="box-shadow:none; margin-bottom:8px">
            <table>
              <thead><tr><th>Mês (${anoAtual})</th><th>Valor recebido</th></tr></thead>
              <tbody>
                ${porMesAno.length ? porMesAno.map(m => `<tr><td>${fmtMesLabel(m.chave)}</td><td>${fmtMoney(m.total)}</td></tr>`).join('') : `<tr><td colspan="2" class="muted">Sem pagamentos este ano.</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="table-wrap" style="box-shadow:none">
            <table>
              <thead><tr><th>Ano</th><th>Valor recebido</th></tr></thead>
              <tbody>
                ${dados.porAno.length ? dados.porAno.map(a => `<tr><td>${esc(a.chave)}</td><td>${fmtMoney(a.total)}</td></tr>`).join('') : `<tr><td colspan="2" class="muted">Sem dados.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    box.innerHTML = `
      ${blocoHtml('Global (todos os espaços)', global)}
      <hr style="border:none; border-top:1px solid var(--border); margin:18px 0">
      ${porEspaco.length ? porEspaco.map(e => blocoHtml(e.espacoNome, e)).join('') : emptyState('Sem espaços configurados', 'Cria um espaço em Configurações.')}
    `;
  } catch (err) {
    box.innerHTML = emptyState('Erro ao carregar', err.message);
  }
}

const CATEGORIAS_TODAS = ['A', 'A1', 'A2', 'AM', 'B', 'B1', 'C', 'C+E', 'D'];
let composicaoCartaEdit = {};

function calcularTotalComposicaoLinhas(linhas) {
  return +(linhas || []).reduce((s, l) => {
    const produto = state.produtos.find(p => p.id === Number(l.produtoId));
    if (!produto) return s;
    const qtd = Math.max(1, Number(l.quantidade) || 1);
    return s + (Number(produto.valor) || 0) * qtd;
  }, 0).toFixed(2);
}

function renderConfig() {
  document.getElementById('view-config').innerHTML = `
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Espaços da escola</h3>
        <p class="muted">Sub-unidades/locais onde a escola dá aulas (ex: dois polos). Cada aluno, aula ou turma teórica fica associado a um destes espaços, mas continua a pertencer sempre a esta mesma escola.</p>
      </div>
      <div id="espacosList"></div>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn btn-accent" onclick="openEspacoForm()">Novo espaço</button>
      </div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Produtos / Serviços (conta corrente)</h3>
        <p class="muted">Catálogo de itens pré-definidos (código, descrição, categoria e valor) para compor o preço de cada categoria de carta ou lançar rapidamente na conta corrente de um aluno. Os produtos marcados como <strong>Descontável</strong> (tipicamente os módulos de lições práticas/teóricas) são os únicos que recebem o desconto do aluno — todos os outros (inscrição, taxas de exame, viatura de exame, emissão, etc.) mantêm sempre o valor de catálogo.</p>
      </div>
      <div id="produtosList"></div>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn btn-accent" onclick="openProdutoForm()">Novo produto/serviço</button>
      </div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Composição do preço da carta por categoria</h3>
        <p class="muted">Cada categoria pode ter <strong>vários planos de preço</strong> (ex: "Standard", "Promo", "Fim de semana"), cada um com a sua própria lista de produtos e valores. Ao criar um contrato, a escola escolhe a categoria e depois qual destes planos aplicar.</p>
      </div>
      <div id="composicaoCartaBox"></div>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn btn-accent" id="btnGuardarComposicao">Guardar composição</button>
      </div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Faturação · Integração Cegid Primavera</h3>
        <p class="muted">Liga esta escola ao ERP Cegid Primavera para emissão automática de faturas, faturas-recibo e recibos.</p>
      </div>
      <button type="button" class="btn btn-accent" onclick="openPrimaveraConfigForm()">Configurar integração Primavera</button>
    </div>
  `;

  renderEspacosList();
  renderProdutosList();

  composicaoCartaEdit = JSON.parse(JSON.stringify(state.config?.composicaoCarta || {}));
  CATEGORIAS_TODAS.forEach(cat => { if (!Array.isArray(composicaoCartaEdit[cat])) composicaoCartaEdit[cat] = []; });
  renderComposicaoCartaBox();

  document.getElementById('btnGuardarComposicao').addEventListener('click', async () => {
    try {
      const updated = await api('PUT', '/api/config', { composicaoCarta: composicaoCartaEdit });
      state.config = updated;
      composicaoCartaEdit = JSON.parse(JSON.stringify(state.config?.composicaoCarta || {}));
      CATEGORIAS_TODAS.forEach(cat => { if (!Array.isArray(composicaoCartaEdit[cat])) composicaoCartaEdit[cat] = []; });
      renderComposicaoCartaBox();
      toast('Composição da carta guardada com sucesso.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderComposicaoCartaBox() {
  const box = document.getElementById('composicaoCartaBox');
  if (!box) return;

  box.innerHTML = CATEGORIAS_TODAS.map(cat => {
    const planos = composicaoCartaEdit[cat] || [];
    return `
      <div style="border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:16px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
          <strong>Categoria ${esc(cat)}</strong>
          <span class="muted" style="font-size:12.5px">${planos.length} plano${planos.length === 1 ? '' : 's'} de preço definido${planos.length === 1 ? '' : 's'}</span>
        </div>
        ${planos.length ? planos.map((plano, pIdx) => {
      const total = calcularTotalComposicaoLinhas(plano.linhas);
      return `
          <div style="border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:10px; background:var(--bg-subtle,#f9fafb)">
            <div class="form-grid" style="grid-template-columns: 2fr auto; align-items:end; margin-bottom:8px">
              <div class="form-field" style="margin-bottom:0">
                <label>Nome do plano</label>
                <input data-plano-nome data-cat="${cat}" data-pidx="${pIdx}" value="${esc(plano.nome || '')}" placeholder="Ex: Standard, Promo...">
              </div>
              <button type="button" class="btn btn-danger-ghost btn-sm" data-plano-remover data-cat="${cat}" data-pidx="${pIdx}">Remover plano</button>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-bottom:6px">
              <span class="muted" style="font-size:12.5px">Valor base deste plano: ${fmtMoney(total)}</span>
            </div>
            <div data-comp-linhas data-cat="${cat}" data-pidx="${pIdx}">
              ${(plano.linhas || []).length ? plano.linhas.map((l, i) => {
        const produto = state.produtos.find(p => p.id === Number(l.produtoId));
        return `
                <div class="form-grid" style="grid-template-columns: 2fr 1fr auto; align-items:end; margin-bottom:6px">
                  <div class="form-field">
                    <label>Produto</label>
                    <select data-comp-produto data-cat="${cat}" data-pidx="${pIdx}" data-idx="${i}">
                      ${state.produtos.map(p => `<option value="${p.id}" ${Number(l.produtoId) === p.id ? 'selected' : ''}>${esc(p.codigo || '')} ${esc(p.descricao)} — ${fmtMoney(p.valor)}${p.descontavel ? ' · descontável' : ' · fixo'}</option>`).join('')}
                    </select>
                  </div>
                  <div class="form-field"><label>Quantidade</label><input type="number" min="1" step="1" data-comp-qtd data-cat="${cat}" data-pidx="${pIdx}" data-idx="${i}" value="${l.quantidade ?? 1}"></div>
                  <button type="button" class="btn btn-danger-ghost btn-sm" data-comp-remover data-cat="${cat}" data-pidx="${pIdx}" data-idx="${i}">Remover</button>
                </div>
                ${!produto ? '<p class="muted" style="margin:-4px 0 8px; color:var(--danger)">Produto removido do catálogo — escolhe outro.</p>' : ''}
                `;
      }).join('') : '<p class="muted">Sem produtos neste plano — o contrato não poderá usá-lo enquanto não adicionares pelo menos um.</p>'}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-comp-add data-cat="${cat}" data-pidx="${pIdx}">+ Adicionar produto</button>
          </div>
        `;
    }).join('') : '<p class="muted" style="margin-bottom:10px">Sem planos de preço definidos para esta categoria — os contratos desta categoria não poderão ser criados (exceto com plano de pagamento "Personalizado") enquanto não criares pelo menos um plano.</p>'}
        <button type="button" class="btn btn-accent btn-sm" data-plano-add data-cat="${cat}">+ Novo plano de preço para ${esc(cat)}</button>
      </div>
    `;
  }).join('');

  // ---- Planos: nome / remover / adicionar ----
  box.querySelectorAll('[data-plano-nome]').forEach(inp => inp.addEventListener('input', (e) => {
    const { cat, pidx } = e.target.dataset;
    composicaoCartaEdit[cat][Number(pidx)].nome = e.target.value;
  }));
  box.querySelectorAll('[data-plano-remover]').forEach(btn => btn.addEventListener('click', (e) => {
    const { cat, pidx } = e.target.dataset;
    if (!confirm('Remover este plano de preço? Contratos já criados com este plano mantêm os valores que já tinham, mas deixará de estar disponível para novos contratos.')) return;
    composicaoCartaEdit[cat].splice(Number(pidx), 1);
    renderComposicaoCartaBox();
  }));
  box.querySelectorAll('[data-plano-add]').forEach(btn => btn.addEventListener('click', (e) => {
    const cat = e.target.dataset.cat;
    composicaoCartaEdit[cat] = composicaoCartaEdit[cat] || [];
    composicaoCartaEdit[cat].push({ id: null, nome: 'Novo plano', linhas: [] });
    renderComposicaoCartaBox();
  }));

  // ---- Linhas (produtos) dentro de cada plano ----
  box.querySelectorAll('[data-comp-produto]').forEach(sel => sel.addEventListener('change', (e) => {
    const { cat, pidx, idx } = e.target.dataset;
    composicaoCartaEdit[cat][Number(pidx)].linhas[Number(idx)].produtoId = Number(e.target.value);
    renderComposicaoCartaBox();
  }));
  box.querySelectorAll('[data-comp-qtd]').forEach(inp => inp.addEventListener('input', (e) => {
    const { cat, pidx, idx } = e.target.dataset;
    composicaoCartaEdit[cat][Number(pidx)].linhas[Number(idx)].quantidade = Math.max(1, Number(e.target.value) || 1);
    renderComposicaoCartaBox();
  }));
  box.querySelectorAll('[data-comp-remover]').forEach(btn => btn.addEventListener('click', (e) => {
    const { cat, pidx, idx } = e.target.dataset;
    composicaoCartaEdit[cat][Number(pidx)].linhas.splice(Number(idx), 1);
    renderComposicaoCartaBox();
  }));
  box.querySelectorAll('[data-comp-add]').forEach(btn => btn.addEventListener('click', (e) => {
    const { cat, pidx } = e.target.dataset;
    const plano = composicaoCartaEdit[cat][Number(pidx)];
    plano.linhas = plano.linhas || [];
    const primeiro = state.produtos[0];
    plano.linhas.push({ produtoId: primeiro ? primeiro.id : null, quantidade: 1 });
    renderComposicaoCartaBox();
  }));
}

function renderEspacosList() {
  const el = document.getElementById('espacosList');
  if (!el) return;
  const contagem = (espacoId) => ({
    alunos: state.alunos.filter(a => a.espacoId === espacoId).length,
    aulas: state.aulas.filter(a => a.espacoId === espacoId).length,
    turmas: state.turmasTeoricas.filter(t => t.espacoId === espacoId).length
  });
  el.innerHTML = state.espacos.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Espaço</th><th>Observações</th><th>Alunos atribuídos</th><th></th></tr></thead>
        <tbody>
          ${state.espacos.map(e => {
    const c = contagem(e.id);
    return `
            <tr>
              <td><strong>${esc(e.nome)}</strong></td>
              <td>${esc(e.observacoes || '—')}</td>
              <td>${c.alunos} aluno(s) · ${c.aulas} aula(s) · ${c.turmas} turma(s)</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openEspacoForm(${e.id})">Editar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteEspaco(${e.id}, '${escJs(e.nome)}')">Remover</button>
                </div>
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>
  ` : emptyState('Nenhum espaço configurado', 'Cria pelo menos um espaço para poderes inscrever alunos.');
}

function openEspacoForm(id) {
  const item = id ? state.espacos.find(e => e.id === id) : null;
  openModal(item ? 'Editar espaço' : 'Novo espaço', `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field"><label>Nome</label><input name="nome" required value="${esc(item?.nome || '')}"></div>
        <div class="form-field full"><label>Observações</label><input name="observacoes" value="${esc(item?.observacoes || '')}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar espaço'}</button>
      </div>
    </form>
  `);
  bindForm('espacos', item?.id, {}, renderConfig);
}

async function deleteEspaco(id, nome) {
  if (!confirm(`Tens a certeza que queres remover o espaço "${nome}"?`)) return;
  try {
    await api('DELETE', `/api/espacos/${id}`);
    await refreshCollections(['espacos']);
    renderConfig();
    toast('Espaço removido.');
  } catch (err) { toast(err.message, 'error'); }
}

function renderProdutosList() {
  const el = document.getElementById('produtosList');
  if (!el) return;
  const lista = [...(state.produtos || [])].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  el.innerHTML = lista.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Código</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>IVA</th><th>Descontável</th><th></th></tr></thead>
        <tbody>
          ${lista.map(p => `
            <tr>
              <td><strong>${esc(p.codigo || '—')}</strong></td>
              <td>${esc(p.descricao)}</td>
              <td>${esc(p.categoria || '—')}</td>
              <td>${fmtMoney(p.valor)}</td>
              <td>${p.taxaIva ?? 23}%</td>
              <td>${p.descontavel ? '<span class="badge badge-ativo">Sim</span>' : '<span class="badge badge-inativo">Não (fixo)</span>'}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openProdutoForm(${p.id})">Editar</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteProduto(${p.id}, '${escJs(p.descricao)}')">Remover</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : emptyState('Nenhum produto/serviço configurado', 'Cria os itens que a escola cobra com mais frequência para os poderes selecionar rapidamente na conta corrente.');
}

function openProdutoForm(id) {
  const item = id ? state.produtos.find(p => p.id === id) : null;
  openModal(item ? 'Editar produto/serviço' : 'Novo produto/serviço', `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field"><label>Código (opcional)</label><input name="codigo" value="${esc(item?.codigo || '')}" placeholder="Ex: 000, 012..."></div>
        <div class="form-field full"><label>Descrição</label><input name="descricao" required value="${esc(item?.descricao || '')}" placeholder="Ex: Taxa de exame 1.ª vez ligeiros"></div>
        <div class="form-field">
          <label>Categoria</label>
          <select name="categoria">${CATEGORIAS_CONTA.map(c => `<option ${item?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Valor (€)</label><input name="valor" type="number" step="0.01" min="0" required value="${item?.valor ?? ''}"></div>
        <div class="form-field"><label>Taxa de IVA (%)</label><input name="taxaIva" type="number" min="0" max="100" step="1" value="${item?.taxaIva ?? 23}"></div>
        <div class="form-field">
          <label>Descontável</label>
          <select name="descontavel">
            <option value="false" ${!item?.descontavel ? 'selected' : ''}>Não — valor fixo (ex: inscrição, taxa de exame, emissão)</option>
            <option value="true" ${item?.descontavel ? 'selected' : ''}>Sim — recebe o desconto do aluno (ex: módulos práticos/teóricos)</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar produto/serviço'}</button>
      </div>
    </form>
  `);
  bindForm('produtos', item?.id, { valor: true, taxaIva: true }, renderConfig);
}

async function deleteProduto(id, descricao) {
  if (!confirm(`Tens a certeza que queres remover "${descricao}" do catálogo?`)) return;
  try {
    await api('DELETE', `/api/produtos/${id}`);
    await refreshCollections(['produtos']);
    renderConfig();
    toast('Produto/serviço removido.');
  } catch (err) { toast(err.message, 'error'); }
}

function openRequisitoForm(id) {
  const item = state.requisitos.find(r => r.id === id);
  if (!item) return;
  openModal(`Requisitos · Categoria ${item.categoria}`, `
    <form id="entityForm">
      <div class="form-grid">
        <div class="form-field"><label>Mín. horas teóricas</label><input name="horasTeoricasMin" type="number" min="0" step="0.5" value="${item.horasTeoricasMin ?? ''}"></div>
        <div class="form-field"><label>Mín. horas práticas</label><input name="horasPraticasMin" type="number" min="0" step="0.5" value="${item.horasPraticasMin ?? ''}"></div>
        <div class="form-field"><label>Mín. km de prática (ex: 500 km cat. B)</label><input name="kmPraticaMin" type="number" min="0" step="1" value="${item.kmPraticaMin ?? ''}"></div>
      </div>
      <p class="muted" style="margin-top:10px">Estes valores são de configuração livre da escola. Confirma sempre os mínimos legais em vigor junto do IMT antes de os usar para decidir se um aluno está apto a exame.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">Guardar</button>
      </div>
    </form>
  `);
  const form = document.getElementById('entityForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      categoria: item.categoria,
      horasTeoricasMin: fd.get('horasTeoricasMin') === '' ? null : Number(fd.get('horasTeoricasMin')),
      horasPraticasMin: fd.get('horasPraticasMin') === '' ? null : Number(fd.get('horasPraticasMin')),
      kmPraticaMin: fd.get('kmPraticaMin') === '' ? null : Number(fd.get('kmPraticaMin'))
    };
    try {
      await api('PUT', `/api/requisitos/${item.id}`, payload);
      await loadAll();
      closeModal();
      renderRelatorios();
      toast('Requisitos atualizados.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ------- Impressão / exportação para inspeção ------- */
function exportarHtmlParaPdf(html, filename) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '-9999px';
  iframe.style.bottom = '-9999px';
  iframe.style.width = '794px';
  iframe.style.height = '1123px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const styles = `
    <style>
      @page { size: A4; margin: 12mm; }
      body { margin: 0; padding: 0; font-family: Inter, Arial, sans-serif; background: #fff; color: #16233B; line-height: 1.45; }
      .print-doc { padding: 16px 18px; }
      .print-head { margin-bottom: 18px; }
      .print-head h1 { font-size: 20px; margin: 0 0 4px; }
      .print-info { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      .print-info td { padding: 6px 8px; font-size: 13px; border-bottom: 1px solid #d2dcea; }
      .print-sign { display: flex; justify-content: space-between; margin-top: 40px; gap: 40px; }
      .print-sign > div { flex: 1; text-align: center; font-size: 12px; color: #556170; }
      .sign-line { border-top: 1px solid #16233B; margin-bottom: 6px; height: 40px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 6px 8px; text-align: left; }
      .muted { color: #556170; }
      .table-wrap { border: 1px solid #d2dcea; border-radius: 8px; overflow: hidden; }
      .table-wrap table { border-collapse: collapse; }
      .table-wrap th { background: #f4f7fc; }
    </style>
  `;

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${filename}</title>${styles}</head><body>${html}</body></html>`);
  doc.close();

  iframe.contentWindow.addEventListener('load', () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 1200);
    }, 700);
  });
}

function imprimirRelatorioAluno() {
  const rel = state.relatorios.dadosAtuais;
  if (!rel) return;
  const { aluno, requisito, resumo } = rel;
  const html = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Ficha de Formação do Aluno</h1>
        <p class="muted">Documento gerado para efeitos de comprovação de assiduidade / inspeção IMT · Emitido em ${fmtDate(new Date().toISOString().slice(0, 10))}</p>
      </div>
      <table class="print-info"><tbody>
        <tr><td><strong>Nº Aluno</strong></td><td>${aluno.numeroAluno ?? aluno.id}</td><td><strong>Categoria</strong></td><td>${esc(aluno.categoria || '—')}</td></tr>
        <tr><td><strong>Nome</strong></td><td>${esc(aluno.nome)}</td><td><strong>Estado</strong></td><td>${esc(aluno.estado || '—')}</td></tr>
        <tr><td><strong>Email</strong></td><td>${esc(aluno.email || '—')}</td><td><strong>Telefone</strong></td><td>${esc(aluno.telefone || '—')}</td></tr>
        <tr><td><strong>Data de inscrição</strong></td><td>${fmtDate(aluno.dataInscricao)}</td><td></td><td></td></tr>
      </tbody></table>
      <table class="print-info" style="margin-top:10px"><tbody>
        <tr><td><strong>Horas teóricas realizadas</strong></td><td>${fmtHorasMin(resumo.horasTeoricasRealizadas)} ${requisito.horasTeoricasMin ? `(mín. configurado: ${fmtHorasMin(requisito.horasTeoricasMin)})` : ''}</td></tr>
        <tr><td><strong>Horas práticas realizadas</strong></td><td>${fmtHorasMin(resumo.horasPraticasRealizadas)} ${requisito.horasPraticasMin ? `(mín. configurado: ${fmtHorasMin(requisito.horasPraticasMin)})` : ''}</td></tr>
        <tr><td><strong>Km percorridos em prática</strong></td><td>${resumo.kmTotalPercorridos}km ${resumo.kmMin ? `(mín. configurado: ${resumo.kmMin}km)` : ''}</td></tr>
        <tr><td><strong>Faltas a aulas teóricas</strong></td><td>${resumo.faltasTeoricas}</td></tr>
      </tbody></table>
      ${renderRelatorioAlunoHTML(rel)}
      <div class="print-sign">
        <div><div class="sign-line"></div><span>Assinatura do responsável da escola</span></div>
        <div><div class="sign-line"></div><span>Carimbo / Data</span></div>
      </div>
    </div>
  `;
  exportarHtmlParaPdf(html, `ficha-${(aluno.nome || 'aluno').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.pdf`);
}

function imprimirMapaGeral() {
  const linhas = state.relatorios.mapaAtual || [];
  const html = `
    <div class="print-doc">
      <div class="print-head">
        <h1>Mapa Geral de Assiduidade</h1>
        <p class="muted">Documento gerado para efeitos de inspeção IMT · Emitido em ${fmtDate(new Date().toISOString().slice(0, 10))}</p>
      </div>
      <div id="mapaGeralBoxPrint"></div>
    </div>
  `;
  const mapaHtml = `${html}<div style="margin-top:18px">${document.getElementById('mapaGeralBox').innerHTML}</div>`;
  exportarHtmlParaPdf(mapaHtml, 'mapa-geral-assiduidade.pdf');
}

/* ==================== CONTRATOS ==================== */
const PLANOS_PAGAMENTO = ['Pagamento único', 'Mensalidades', 'Personalizado'];

function renderContratos() {
  const el = document.getElementById('view-contratos');
  const q = state.search.contratos.toLowerCase();
  const list = state.contratos.filter(c => {
    const aluno = findAluno(c.alunoId);
    return !q || (aluno && aluno.nome.toLowerCase().includes(q));
  }).sort((a, b) => (b.dataCriacao || '').localeCompare(a.dataCriacao || ''));

  el.innerHTML = `
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-head">
        <h3>Dados da escola (usados no cabeçalho dos contratos)</h3>
        <button class="btn btn-ghost btn-sm" onclick="openEscolaForm()">Editar dados da escola</button>
      </div>
      <div class="print-info-grid">
        <div><strong>Nome</strong><br>${esc(state.escola.nome || '—')}</div>
        <div><strong>NIPC</strong><br>${esc(state.escola.nipc || '—')}</div>
        <div><strong>Morada</strong><br>${esc(state.escola.morada || '—')}</div>
        <div><strong>N.º licença IMT</strong><br>${esc(state.escola.numeroLicencaIMT || '—')}</div>
        <div><strong>Diretor de escola</strong><br>${esc(state.escola.nomeDiretor || '—')}</div>
        <div><strong>Contactos</strong><br>${esc(state.escola.telefone || '—')} · ${esc(state.escola.email || '—')}</div>
      </div>
    </div>

    <div class="toolbar">
      <input class="search-input" placeholder="Pesquisar contrato por nome do aluno..." value="${esc(state.search.contratos)}" oninput="updateSearchAndRerender(this, 'contratos', renderContratos)">
    </div>
    <div class="table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Aluno</th><th>Categoria</th><th>Valor</th><th>Plano</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${list.map(c => {
    const aluno = findAluno(c.alunoId);
    return `
            <tr>
              <td>
                <div class="cell-primary">${esc(aluno?.nome || 'Aluno removido')}</div>
                <div class="cell-sub">Criado em ${fmtDate(c.dataCriacao)}</div>
              </td>
              <td>${esc(c.categoria || '—')}</td>
              <td>${fmtMoney(c.valorTotal)}</td>
              <td>${esc(c.planoPagamento || '—')}</td>
              <td><span class="${badgeClass(c.estado)}">${esc(c.estado || '—')}</span></td>
              <td>
                <div class="row-actions">
                  ${c.estado === 'Pendente' ? `<button class="btn btn-ghost btn-sm" onclick="openContratoForm(${c.id})">Editar</button>` : ''}
                  ${c.estado === 'Pendente' ? `<button class="btn btn-accent btn-sm" onclick="abrirAssinaturaContrato(${c.id})">Assinar</button>` : ''}
                  ${c.estado === 'Assinado' ? `<button class="btn btn-ghost btn-sm" onclick="abrirDocumentoContrato(${c.id})">${c.faturacao ? 'PDF / Fatura' : 'Submeter PDF'}</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="imprimirContrato(${c.id})">${c.estado === 'Assinado' ? 'Baixar PDF' : 'Pré-visualizar PDF'}</button>
                  <button class="btn btn-danger-ghost btn-sm" onclick="deleteItem('contratos', ${c.id}, 'este contrato')">Remover</button>
                </div>
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>` : emptyState('Nenhum contrato encontrado', 'Cria o primeiro contrato de formação para um aluno.')}
    </div>
  `;
}

function openEscolaForm() {
  const e = state.escola || {};
  openModal('Dados da Escola', `
    <form id="escolaForm">
      <div class="form-grid">
        <div class="form-field full"><label>Nome da escola</label><input name="nome" required value="${esc(e.nome || '')}"></div>
        <div class="form-field"><label>NIPC</label><input name="nipc" value="${esc(e.nipc || '')}"></div>
        <div class="form-field"><label>N.º licença IMT</label><input name="numeroLicencaIMT" value="${esc(e.numeroLicencaIMT || '')}"></div>
        <div class="form-field full"><label>Morada</label><input name="morada" value="${esc(e.morada || '')}"></div>
        <div class="form-field"><label>Telefone</label><input name="telefone" value="${esc(e.telefone || '')}"></div>
        <div class="form-field"><label>Email</label><input name="email" type="email" value="${esc(e.email || '')}"></div>
        <div class="form-field full"><label>Nome do diretor de escola</label><input name="nomeDiretor" value="${esc(e.nomeDiretor || '')}"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">Guardar</button>
      </div>
    </form>
  `);
  const form = document.getElementById('escolaForm');
  form.addEventListener('submit', async (e2) => {
    e2.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api('PUT', '/api/escola', payload);
      await refreshCollections(['escola']);
      closeModal();
      renderContratos();
      toast('Dados da escola atualizados.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function openContratoForm(id) {
  const item = id ? state.contratos.find(c => c.id === id) : null;
  let planoAtual = item?.planoPagamento || PLANOS_PAGAMENTO[0];
  let parcelas = (item?.parcelasPersonalizadas && item.parcelasPersonalizadas.length)
    ? item.parcelasPersonalizadas.map(p => ({ descricao: p.descricao || '', valor: p.valor ?? '' }))
    : [{ descricao: '', valor: '' }];
  let itensCartaAtual = Array.isArray(item?.itensCarta) ? item.itensCarta : [];
  let valorCartaCalculado = Number(item?.valorCartaCalculado ?? item?.valorTotal ?? 0);

  openModal(item ? 'Editar Contrato' : 'Novo Contrato', `
    <form id="contratoForm">
      <div class="form-grid">
        ${renderAlunoPickerHtml(item?.alunoId, { label: 'Aluno', required: !item, hint: 'Escolhe um aluno existente ou escreve o nome completo.' })}
        <div class="form-field">
          <label>Categoria</label>
          <select name="categoria" id="contratoCategoriaSelect">${['A', 'A1', 'A2', 'AM', 'B', 'B1', 'C', 'C+E', 'D'].map(c => `<option ${item?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>        
        </div>
        <div class="form-field">
          <label>Plano de preço da carta</label>
          <select name="planoCartaId" id="planoCartaSelect"></select>
        </div>
        <div class="form-field">
          <label>Valor total (€)</label>
          <input name="valorTotal" id="contratoValorTotalInput" type="number" step="0.01" min="0" required readonly value="${item?.valorTotal ?? ''}">
        </div>
        <div class="form-field full">
          <p class="muted" style="margin-top:-6px">O valor total é calculado automaticamente a partir da categoria e do desconto próprio do aluno (definido na ficha do aluno). Só é possível alterá-lo escolhendo o plano "Personalizado" com parcelas próprias.</p>
        </div>
        <div class="form-field">
          <label>Plano de pagamento</label>
          <select name="planoPagamento" id="planoPagamentoSelect">${PLANOS_PAGAMENTO.map(p => `<option ${planoAtual === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </div>
        <div class="form-field" id="numeroPrestacoesField"><label>N.º de prestações</label><input name="numeroPrestacoes" type="number" min="1" value="${item?.numeroPrestacoes ?? 1}"></div>
        <div class="form-field"><label>Aulas teóricas incluídas</label><input name="aulasTeoricasIncluidas" type="number" min="0" value="${item?.aulasTeoricasIncluidas ?? 20}"></div>
        <div class="form-field"><label>Aulas práticas incluídas</label><input name="aulasPraticasIncluidas" type="number" min="0" value="${item?.aulasPraticasIncluidas ?? 28}"></div>
        <div class="form-field"><label>Prazo de validade do contrato</label><input name="prazoValidade" type="date" value="${item?.prazoValidade || ''}"></div>
        <div class="form-field full"><label>Cláusulas adicionais / condições personalizadas</label><textarea name="clausulasAdicionais" placeholder="Ex: inclui 2 aulas de reforço, desconto por pagamento antecipado, etc.">${esc(item?.clausulasAdicionais || '')}</textarea></div>
      </div>

      <div class="form-section-title">Conta corrente gerada</div>
      <p class="muted" style="margin-bottom:10px">${item ? (item.estado === 'Assinado' ? 'Este contrato já está assinado — a conta corrente já foi criada e não é alterada ao editar campos como cláusulas ou datas.' : 'Estes itens são recriados sempre que gravares alterações, enquanto o contrato não for assinado.') : 'Estes itens são criados de imediato na conta corrente do aluno, assim que o contrato for criado — de acordo com o valor praticado ao aluno (categoria + desconto) e o plano de pagamento escolhido.'}</p>
      <div id="planoBox"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">${item ? 'Guardar alterações' : 'Criar contrato'}</button>
      </div>
    </form>
  `);

  function alunoIdAtual() { return Number(document.querySelector('#contratoForm [name="alunoId"]')?.value || 0); }
  function numeroPrestacoesAtual() { return Math.max(1, Number(document.querySelector('#contratoForm [name="numeroPrestacoes"]')?.value) || 1); }
  function setValorTotalInput(v) {
    const campo = document.getElementById('contratoValorTotalInput');
    if (campo) campo.value = v;
  }

  let planoCartaIdAtual = item?.planoCartaId || null;

  async function carregarPlanosCarta() {
    const categoria = document.getElementById('contratoCategoriaSelect')?.value;
    const select = document.getElementById('planoCartaSelect');
    if (!categoria || !select) return [];
    try {
      const planos = await api('GET', `/api/planosCarta/${encodeURIComponent(categoria)}`);
      select.innerHTML = planos.length
        ? planos.map(p => `<option value="${p.id}" ${Number(planoCartaIdAtual) === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')
        : '<option value="">Sem planos definidos para esta categoria</option>';
      if (!planos.some(p => p.id === Number(planoCartaIdAtual))) {
        planoCartaIdAtual = planos[0]?.id || null;
        select.value = planoCartaIdAtual || '';
      }
      return planos;
    } catch (err) {
      select.innerHTML = '<option value="">Sem planos definidos</option>';
      return [];
    }
  }

  async function atualizarValorCarta() {
    const categoria = document.getElementById('contratoCategoriaSelect')?.value;
    const aluno = findAluno(alunoIdAtual());
    const desconto = Number(aluno?.desconto || 0);
    if (!categoria) { itensCartaAtual = []; valorCartaCalculado = 0; renderPlanoBox(); return; }
    await carregarPlanosCarta();
    try {
      const qs = `?desconto=${desconto}${planoCartaIdAtual ? `&planoCartaId=${planoCartaIdAtual}` : ''}`;
      const res = await api('GET', `/api/precoCarta/${encodeURIComponent(categoria)}${qs}`);
      itensCartaAtual = res.itens;
      valorCartaCalculado = res.total;
      planoCartaIdAtual = res.planoCartaId || planoCartaIdAtual;
    } catch (err) {
      itensCartaAtual = [];
      valorCartaCalculado = 0;
    }
    if (planoAtual !== 'Personalizado') setValorTotalInput(valorCartaCalculado);
    renderPlanoBox();
  }

  function atualizarSomaParcelas() {
    const info = document.getElementById('parcelasSomaInfo');
    const soma = +parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0).toFixed(2);
    setValorTotalInput(soma);
    if (!info) return;
    info.innerHTML = `<span style="font-weight:600">Soma das parcelas (valor total do contrato): ${fmtMoney(soma)}</span>`;
  }

  function contratosExistentesMesmaCategoria() {
    if (item) return []; // só interessa para contratos novos
    const aluno = alunoIdAtual();
    const categoria = document.getElementById('contratoCategoriaSelect')?.value;
    if (!aluno || !categoria) return [];
    return state.contratos.filter(c => c.alunoId === aluno && c.categoria === categoria);
  }

  function renderAlertaContratoExistente() {
    const box = document.getElementById('alertaContratoExistente');
    if (!box) return;
    const existentes = contratosExistentesMesmaCategoria();
    box.innerHTML = existentes.length
      ? `<div class="inline-alert inline-alert-warning">
          Este aluno já tem ${existentes.length > 1 ? `${existentes.length} contratos` : 'um contrato'} da categoria ${esc(document.getElementById('contratoCategoriaSelect').value)}:
          ${existentes.map(c => `${esc(c.estado)} (criado em ${fmtDate(c.dataCriacao)})`).join(', ')}.
          Ao gravar, vai ser pedida confirmação.
        </div>`
      : '';
  }

  function renderPlanoBox() {
    const box = document.getElementById('planoBox');
    const prestField = document.getElementById('numeroPrestacoesField');
    if (prestField) prestField.style.display = planoAtual === 'Mensalidades' ? '' : 'none';

    if (planoAtual === 'Personalizado') {
      box.innerHTML = `
        <div id="parcelasList">
          ${parcelas.map((p, i) => `
            <div class="form-grid" style="grid-template-columns: 2fr 1fr auto; align-items:end; margin-bottom:8px" data-parcela-row="${i}">
              <div class="form-field"><label>Descrição da parcela ${i + 1}</label><input data-parcela-desc value="${esc(p.descricao)}" placeholder="Ex: Sinal, 2.ª prestação..."></div>
              <div class="form-field"><label>Valor (€)</label><input data-parcela-valor type="number" step="0.01" min="0" value="${p.valor}"></div>
              <button type="button" class="btn btn-danger-ghost btn-sm" data-parcela-remover>Remover</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btnAdicionarParcela">+ Adicionar parcela</button>
        <p class="muted" id="parcelasSomaInfo" style="margin-top:10px"></p>
        <p class="muted" style="margin-top:4px">Plano personalizado: o valor total do contrato passa a ser a soma destas parcelas, em vez do valor calculado pela categoria/desconto do aluno (valor de referência da categoria: ${fmtMoney(valorCartaCalculado)}).</p>
      `;
      box.querySelectorAll('[data-parcela-row]').forEach(row => {
        const idx = Number(row.dataset.parcelaRow);
        row.querySelector('[data-parcela-desc]').addEventListener('input', (e) => { parcelas[idx].descricao = e.target.value; });
        row.querySelector('[data-parcela-valor]').addEventListener('input', (e) => { parcelas[idx].valor = e.target.value; atualizarSomaParcelas(); });
        row.querySelector('[data-parcela-remover]').addEventListener('click', () => {
          parcelas.splice(idx, 1);
          if (!parcelas.length) parcelas.push({ descricao: '', valor: '' });
          renderPlanoBox();
        });
      });
      document.getElementById('btnAdicionarParcela').addEventListener('click', () => { parcelas.push({ descricao: '', valor: '' }); renderPlanoBox(); });
      document.getElementById('planoCartaSelect').addEventListener('change', (e) => {
        planoCartaIdAtual = Number(e.target.value) || null;
        atualizarValorCarta();
      });
      document.getElementById('contratoCategoriaSelect').addEventListener('change', () => { atualizarValorCarta(); renderAlertaContratoExistente(); });
      atualizarSomaParcelas();
      return;
    }

    setValorTotalInput(valorCartaCalculado);
    let rows;
    if (planoAtual === 'Mensalidades') {
      const n = numeroPrestacoesAtual();
      const parcela = +(valorCartaCalculado / n).toFixed(2);
      let acumulado = 0;
      rows = Array.from({ length: n }, (_, i) => {
        const valor = i < n - 1 ? parcela : +(valorCartaCalculado - acumulado).toFixed(2);
        acumulado = +(acumulado + valor).toFixed(2);
        return { descricao: `Mensalidade ${i + 1}/${n}`, valor, sub: '' };
      });
    } else {
      rows = itensCartaAtual.length
        ? itensCartaAtual.map(i => ({ codigo: i.codigo, descricao: i.descricao, valor: i.valor, sub: i.descontavel ? 'descontável' : 'valor fixo' }))
        : [{ codigo: '', descricao: 'Sem composição de preço definida para esta categoria — define-a em Configurações > Composição da carta.', valor: 0, sub: '' }];
    }
    box.innerHTML = `
      <div class="table-wrap" style="box-shadow:none">
        <table>
          <thead><tr><th>Código</th><th>Descrição do item gerado</th><th>Valor</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td class="muted" style="font-size:12px">${esc(r.codigo || '—')}</td><td>${esc(r.descricao)} ${r.sub ? `<span class="muted" style="font-size:12px">(${r.sub})</span>` : ''}</td><td>${fmtMoney(r.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td></td><td style="font-weight:700">Total</td><td style="font-weight:700">${fmtMoney(valorCartaCalculado)}</td></tr></tfoot>
        </table>
      </div>
    `;
  }

  document.getElementById('planoPagamentoSelect').addEventListener('change', (e) => { planoAtual = e.target.value; renderPlanoBox(); });
  document.getElementById('contratoCategoriaSelect').addEventListener('change', atualizarValorCarta);
  document.querySelector('#contratoForm [name="numeroPrestacoes"]').addEventListener('input', renderPlanoBox);

  const form = document.getElementById('contratoForm');
  bindAlunoPicker(form);
  // Ao escolher/alterar o aluno: se ainda não houver contrato (novo), sugere
  // a categoria do próprio aluno e recalcula sempre o valor com o desconto dele.
  const alunoNomeInput = form.querySelector('[name="alunoNome"]');
  if (alunoNomeInput) {
    alunoNomeInput.addEventListener('change', () => {
      if (!item) {
        const aluno = findAluno(alunoIdAtual());
        if (aluno?.categoria) document.getElementById('contratoCategoriaSelect').value = aluno.categoria;
      }
      atualizarValorCarta();
      renderAlertaContratoExistente();
    });
  }
  atualizarValorCarta();
  document.getElementById('contratoCategoriaSelect').addEventListener('change', () => { atualizarValorCarta(); renderAlertaContratoExistente(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const alunoId = Number(fd.get('alunoId') || 0);
    if (!alunoId) {
      toast('Seleciona ou escreve o nome de um aluno existente.', 'error');
      return;
    }

    if (!item) {
      const existentes = contratosExistentesMesmaCategoria();
      if (existentes.length) {
        const confirmar = confirm(
          `Este aluno já tem ${existentes.length > 1 ? 'contratos' : 'um contrato'} da categoria ${fd.get('categoria')}. ` +
          `Tens a certeza que queres criar mais um contrato?`
        );
        if (!confirmar) return;
      }
    }

    const payload = {
      alunoId,
      categoria: fd.get('categoria'),
      planoCartaId: planoAtual === 'Personalizado' ? null : planoCartaIdAtual,
      planoPagamento: fd.get('planoPagamento'),
      numeroPrestacoes: Number(fd.get('numeroPrestacoes') || 1),
      parcelasPersonalizadas: planoAtual === 'Personalizado'
        ? parcelas.filter(p => p.descricao || Number(p.valor) > 0).map((p, i) => ({ descricao: p.descricao || `Parcela ${i + 1}`, valor: Number(p.valor) || 0 }))
        : null,
      aulasTeoricasIncluidas: Number(fd.get('aulasTeoricasIncluidas') || 0),
      aulasPraticasIncluidas: Number(fd.get('aulasPraticasIncluidas') || 0),
      prazoValidade: fd.get('prazoValidade'),
      clausulasAdicionais: fd.get('clausulasAdicionais')
    };
    try {
      if (item) {
        await api('PUT', `/api/contratos/${item.id}`, payload);
      } else {
        await api('POST', '/api/contratos', { ...payload, estado: 'Pendente', dataCriacao: new Date().toISOString().slice(0, 10), textoContrato: null, assinatura: null });
      }
      await refreshCollections(['contratos']);
      closeModal();
      renderContratos();
      toast(item ? 'Contrato atualizado.' : 'Contrato criado.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ------- Geração do texto do contrato ------- */
function gerarTextoContrato(contrato) {
  const aluno = findAluno(contrato.alunoId) || {};
  const escola = state.escola || {};

  // Data de assinatura por extenso
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const dataAssinatura = contrato.dataAssinatura ? new Date(contrato.dataAssinatura) : new Date();
  const dataExtenso = `${dataAssinatura.getDate()} de ${MESES[dataAssinatura.getMonth()]} de ${dataAssinatura.getFullYear()}`;

  return `
    <div style="font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #000; text-align: justify;">
      
      <p style="text-align: right; margin-bottom: 12px;">Contrato<br>n.º ${esc(contrato.numero || '—')}</p>
      
      <h2 style="text-align: center; margin-bottom: 24px; font-size: 16px; text-transform: uppercase;">CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE FORMAÇÃO PARA CONDUTORES</h2>

      <p style="margin-bottom: 12px;"><strong>Outorgantes</strong></p>
      <p style="margin-bottom: 12px;"><strong>PRIMEIRO:</strong> ${esc(escola.nome || '—')}, com sede em ${esc(escola.morada || '—')}, pessoa coletiva n.º ${esc(escola.nipc || '—')}, na qualidade de entidade formadora, representada por ${esc(escola.nomeDiretor || '—')}, ${esc(escola.cargoDiretor || 'gerente')} com poderes para o ato, adiante designada por primeiro outorgante.</p>
      <p style="margin-bottom: 12px;"><strong>SEGUNDO:</strong> ${esc(aluno.nome || '—')}, residente em ${esc(aluno.morada || '—')}, ${esc(aluno.codigoPostal || '')} ${esc(aluno.localidade || '')}, nascido em ${aluno.dataNascimento ? fmtDate(aluno.dataNascimento) : '—'}, portador do documento de identificação n.º ${esc(aluno.numeroDocumento || '—')}, contribuinte n.º ${esc(aluno.nif || '—')}, na qualidade de formando, adiante designado por segundo outorgante.</p>
      <p style="margin-bottom: 16px;">Entre os outorgantes é livremente e de boa fé celebrado o presente contrato de prestação de serviços de formação que se rege pelas seguintes cláusulas:</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Primeira</strong></p>
      <p style="margin-bottom: 12px;">O primeiro outorgante faculta ao segundo, que aceita, a ministração da formação legalmente exigida para obtenção de carta de condução, ou reaquisição de competências, da categoria ${esc(contrato.categoria || aluno.categoria || '—')}, com a seguinte carga horária mínima:<br>
      • Formação teórica: ${esc(contrato.horasTeoricas ?? 28)} horas<br>
      • Formação prática: ${esc(contrato.horasPraticas ?? 32)} horas</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Segunda</strong></p>
      <p style="margin-bottom: 12px;">A formação referida na cláusula anterior é ministrada nas instalações d${esc(escola.artigoNome || 'a')} ${esc(escola.nome || '—')}, com a licença n.º ${esc(escola.numeroLicencaIMT || '—')}, sita em ${esc(escola.morada || '—')}.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Terceira</strong></p>
      <p style="margin-bottom: 12px;">${esc(escola.nome || 'A Escola')} obriga-se a:<br>
      a) Promover a organização do processo do candidato a condutor com os elementos legalmente exigidos;<br>
      b) Emitir e entregar ao candidato a condutor cópia da ficha de inscrição;<br>
      c) Desenvolver o processo de aprendizagem de acordo com os conteúdos programáticos e demais condições fixadas na lei;<br>
      d) Realizar a avaliação formativa do candidato a condutor;<br>
      e) Propor o candidato a condutor às provas do exame de condução.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Quarta</strong></p>
      <p style="margin-bottom: 8px;">1. O segundo outorgante pagará ao primeiro outorgante, pelos serviços prestados, os valores constantes da tabela afixada na área de acolhimento da escola de condução que, na data da assinatura do presente contrato, são os seguintes:</p>
      
      ${Array.isArray(contrato.itensCarta) && contrato.itensCarta.length ? `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 12px 0;">
        <tbody>
          ${contrato.itensCarta.map(it => `
            <tr>
              <td style="padding: 4px 8px 4px 0; border-bottom: 1px dashed #ccc;">${esc(it.descricao)}</td>
              <td style="padding: 4px 0; text-align: right; border-bottom: 1px dashed #ccc;">${fmtMoney(it.valor)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}

      <p style="margin-bottom: 12px;">
      2. A tabela de preços afixada poderá ser alterada sem aviso prévio.<br>
      3. A transferência do segundo outorgante para outra escola de condução está sujeita ao pagamento de ${fmtMoney(contrato.valorTransferencia ?? 50)} que corresponde a custos de documentação do primeiro outorgante e depende do pagamento integral de todas as quantias em dívida pelo segundo outorgante.<br>
      4. A transferência do segundo outorgante para outra escola de condução realiza-se nos termos do Artigo 12.º da Portaria n.º 185/2015:<br>
      &nbsp;&nbsp;a) O candidato a condutor que pretenda mudar de escola de condução durante a aprendizagem deve informar a escola de condução de destino do ensino que já frequentou.<br>
      &nbsp;&nbsp;b) O diretor da nova escola de condução deve, no prazo de dois dias, comunicar a transferência ao IMT, I.P., e ao diretor da escola de condução de origem.<br>
      &nbsp;&nbsp;c) O diretor da escola de condução de origem deve, no prazo de cinco dias após a comunicação referida no número anterior, remeter à nova escola de condução o atestado médico do candidato a condutor transferido e informação sobre o ensino da condução já ministrado.<br>
      &nbsp;&nbsp;d) Caso o diretor da escola de condução de origem não cumpra com as obrigações previstas no número anterior, o diretor da escola de condução de destino comunica o facto ao IMT, I.P.<br>
      &nbsp;&nbsp;e) Na situação de transferência de escola de condução só são contabilizadas as horas de formação ministradas há menos de um ano.<br>
      5. No caso do aluno não ter terminado com sucesso a sua carta de condução no prazo máximo de 1 ano, o mesmo está sujeito ao pagamento de ${fmtMoney(contrato.valorNaoConclusao1Ano ?? 50)} que corresponde ao acordo efetuado no ato da inscrição. Se ultrapassar os 2 anos, está sujeito ao pagamento de ${fmtMoney(contrato.valorNaoConclusao2Anos ?? 230)} para a revalidação da licença de aprendizagem.<br>
      6. Durante a aprendizagem, o instruendo é responsável por todos os danos provocados pelo mesmo nos veículos das categorias AM, A1, A2 e A.<br>
      7. Deve ser substituída a lição a que o instruendo haja faltado, caso este tenha avisado com, pelo menos, 24 horas de antecedência.<br>
      8. As faltas sem aviso prévio são consideradas como lições prestadas apenas para o efeito do respetivo pagamento.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Quinta</strong></p>
      <p style="margin-bottom: 12px;">${esc(escola.nome || 'A Escola')} pode realizar exames nos centros de exames de ${esc(escola.centroExames || 'DVGPDL')}. Cabe ao segundo outorgante escolher o centro de exames onde pretende realizar o exame de condução.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Sexta</strong></p>
      <p style="margin-bottom: 12px;">O segundo outorgante obriga-se a frequentar a formação com interesse, assiduidade e pontualidade. Em caso de falta ou atraso, o formando obriga-se a repetir a frequência do período em falta, sendo responsável pelo pagamento dos respetivos custos.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Sétima</strong></p>
      <p style="margin-bottom: 12px;">1. A responsabilidade civil específica para a condução de veículos em situação de instrução está coberta pela apólice n.º 206855006 (ALLIANZ).<br>
      2. A responsabilidade civil para a condução de veículos utilizados na atividade comum da escola de condução está coberta por apólice autónoma.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Oitava</strong></p>
      <p style="margin-bottom: 12px;">Este contrato tem a duração de um ano, podendo extinguir-se antes do termo da sua validade, caso se verifique qualquer das seguintes situações: aprovação no exame de condução, caducidade da licença de aprendizagem, cancelamento ou caducidade da inscrição na escola. Não ocorrendo nenhuma das causas extintivas durante o período de validade, o contrato é renovado por igual período, sendo aplicados os preços da tabela em vigor afixada na área de acolhimento da escola de condução.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Nona</strong></p>
      <p style="margin-bottom: 12px;">O candidato é informado das seguintes condições:<br>
      1. Em caso de litígio, pode recorrer a uma Entidade de Resolução Alternativa de Conflitos de Consumo (RAL), designadamente CNIACC - Centro Nacional de Informação e Arbitragem de Conflitos de Consumo (Tel.: 213 847 484 | E-mail: cniacc@fd.unl.pt). Para mais informações, consulte o portal do consumidor www.consumidor.pt ou www.arbitragemdeconsumo.org.<br>
      2. A propositura a qualquer das provas constituintes do exame de condução depende do preenchimento dos seguintes requisitos pelo segundo outorgante:<br>
      &nbsp;&nbsp;a) Idade mínima exigida para a respetiva habilitação;<br>
      &nbsp;&nbsp;b) Ausência de dívidas ao primeiro outorgante;<br>
      &nbsp;&nbsp;c) Frequência da respetiva formação mínima obrigatória com aproveitamento.<br>
      3. Quando a formação mínima obrigatória não se mostre suficiente para a conclusão da formação com aproveitamento, o segundo outorgante frequentará formação extra, de acordo com indicação do instrutor ou do diretor da escola.<br>
      4. A reprovação na prova teórica obriga à frequência de, pelo menos, 5 horas, a incidir nos temas que deram origem à reprovação.<br>
      5. A reprovação na prova prática obriga à frequência de, pelo menos, 25% das horas e quilómetros da formação prática mínima obrigatória para a categoria em que se inscreve.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Décima</strong></p>
      <p style="margin-bottom: 12px;">1. O primeiro outorgante procede à recolha, processamento e utilização de dados pessoais do segundo outorgante necessários para a prestação de serviços de formação para condutor e para assegurar o cumprimento das obrigações legais.<br>
      2. O primeiro outorgante é a entidade responsável pelo tratamento da informação pessoal recolhida, a qual é processada e armazenada mediante medidas adequadas de proteção efetiva dos dados pessoais tratados, designadamente contra a sua destruição, acidental ou ilícita, a perda acidental, a alteração, o tratamento ilícito, a difusão ou o acesso não autorizados.<br>
      3. Os dados pessoais recolhidos destinam-se, exclusivamente, a dar execução ao presente contrato, não serão utilizados para qualquer outra finalidade e respeitam à seguinte informação relevante: nome, morada, data de nascimento, endereço de correio eletrónico, número de telemóvel e/ou telefone, número de identificação fiscal, número do documento de identificação pessoal, número de licença de aprendizagem / carta de condução, indicação dos preços contratados e identificação da(s) escola(s) de condução que ministra(m) o ensino.<br>
      4. O primeiro outorgante não divulga a terceiros quaisquer dados pessoais do segundo sem o seu consentimento, exceto quando tal for exigido por lei, designadamente para efeitos de cumprimento das obrigações jurídicas de comunicação ao IMT, I.P. e ao centro de exames para onde requer as provas de exame, nos termos e para os efeitos do disposto na lei aplicável.<br>
      5. Os dados pessoais recolhidos serão conservados pelo período mínimo de cinco anos de acordo com a legislação aplicável, findo o qual os mesmos serão eliminados, podendo o segundo outorgante exercer, a qualquer momento, os direitos de acesso, retificação, limitação, oposição ou apagamento dos seus dados pessoais.<br>
      6. O segundo outorgante poderá apresentar reclamação relativamente ao tratamento e regras de exercício dos direitos que lhe assistem à Comissão Nacional de Proteção de Dados, enquanto autoridade de controlo nacional para efeitos do normativo legal e regulamentar aplicável.</p>

      <p style="text-align: center; margin-top: 16px; margin-bottom: 8px;"><strong>Cláusula Décima Primeira</strong></p>
      <p style="margin-bottom: 12px;">O presente contrato é celebrado de boa fé por ambas as partes, sendo competente para resolver qualquer litígio o Tribunal da Comarca de Ponta Delgada.<br>
      Este contrato é feito em duplicado e assinado por ambos os outorgantes, que aceitam as condições estipuladas, ficando cada outorgante na posse de uma das vias do contrato.</p>

      <p style="margin-top: 24px; margin-bottom: 40px;">Ponta Delgada, ${dataExtenso}</p>

      <table style="width: 100%; font-size: 12px; text-align: center; border-collapse: collapse;">
        <tr>
          <td style="width: 33%; vertical-align: top;">
            PRIMEIRO OUTORGANTE<br>
            <div class="assinatura-slot" data-slot="primeiro" style="height:65px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px;"></div>
            ____________________________
          </td>
          <td style="width: 33%; vertical-align: top;">
            SEGUNDO OUTORGANTE<br>
            <div class="assinatura-slot" data-slot="segundo" style="height:65px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px;"></div>
            ____________________________
          </td>
          <td style="width: 33%; vertical-align: top;">
            TUTOR DE CANDIDATO MENOR<br>
            <div class="assinatura-slot" data-slot="tutor" style="height:65px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px;"></div>
            ____________________________<br>
            <span style="font-size: 11px; color: #555;">(se aplicável)</span>
          </td>
        </tr>
      </table>

    </div>
  `;
}

function renderSignaturePadHTML() {
  return `
    <div class="form-field full" style="margin-bottom:10px">
      <label>Assinatura do formando</label>
      <div style="border:2px dashed var(--border); border-radius:10px; overflow:hidden; touch-action:none; background:#fff">
        <canvas id="assinaturaCanvas" style="width:100%; height:220px; display:block; cursor:crosshair"></canvas>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px">
        <span class="muted" style="font-size:12px">Assina com o dedo (tablet/telemóvel) ou com o rato, dentro da caixa acima.</span>
        <button type="button" class="btn btn-ghost btn-sm" id="btnLimparAssinatura">Limpar</button>
      </div>
    </div>
  `;
}

/* Liga um <canvas> a eventos de "pointer" (cobre rato, dedo e caneta ao
   mesmo tempo) para desenhar a assinatura. Devolve helpers para saber se
   já foi desenhado algo e para extrair a imagem final em base64. */
function bindSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  let desenhando = false;
  let temTraco = false;
  let ultimo = null;

  function redimensionar() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const dadosAntigos = temTraco ? canvas.toDataURL() : null;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16233B';
    if (dadosAntigos) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = dadosAntigos;
    }
  }
  redimensionar();
  window.addEventListener('resize', redimensionar);

  function posicaoRelativa(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function iniciar(e) {
    desenhando = true;
    temTraco = true;
    ultimo = posicaoRelativa(e);
    canvas.setPointerCapture(e.pointerId);
  }
  function mover(e) {
    if (!desenhando) return;
    const p = posicaoRelativa(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.x, ultimo.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo = p;
  }
  function terminar() { desenhando = false; }

  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  canvas.addEventListener('pointerleave', terminar);

  function limpar() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    temTraco = false;
  }
  document.getElementById('btnLimparAssinatura')?.addEventListener('click', limpar);

  return {
    temAssinatura: () => temTraco,
    obterImagemBase64: () => canvas.toDataURL('image/png'),
    limpar
  };
}

function abrirAssinaturaContrato(id) {
  const contrato = state.contratos.find(c => c.id === id);
  if (!contrato) return;
  const aluno = findAluno(contrato.alunoId);
  const texto = gerarTextoContrato(contrato);

  openModal('Aceitação do Contrato', `
    <div style="max-height:240px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; font-size:13.5px; line-height:1.6; margin-bottom:16px">
      ${texto}
    </div>
    <form id="assinaturaForm">
      <p class="muted" style="margin-bottom:10px">Podes entregar o telemóvel ou tablet ao formando para ler e assinar diretamente no ecrã — não é preciso imprimir antes. Depois de confirmado, o contrato fica submetido e pode ser impresso a qualquer momento.</p>
      <div class="form-field full">
        <label>Nome completo do Formando (para confirmar aceitação)</label>
        <input name="nomeDigitado" required placeholder="${esc(aluno?.nome || '')}">
      </div>
      ${renderSignaturePadHTML()}
      <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-weight:500; color:var(--ink); margin:12px 0">
        <input type="checkbox" name="aceite" required> Li e aceito os termos e condições descritos acima.
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent">Confirmar aceitação</button>
      </div>
    </form>
  `);
  alargarModal();

  const pad = bindSignaturePad('assinaturaCanvas');
  const form = document.getElementById('assinaturaForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pad.temAssinatura()) {
      toast('É necessário desenhar a assinatura no ecrã antes de confirmar.', 'error');
      return;
    }
    const fd = new FormData(form);
    try {
      await api('PUT', `/api/contratos/${id}/assinar`, {
        nomeDigitado: fd.get('nomeDigitado'),
        textoContrato: texto,
        assinaturaImagem: pad.obterImagemBase64()
      });
      await refreshCollections(['contratos']);
      closeModal();
      renderContratos();
      toast('Contrato aceite e assinado.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function imprimirContrato(id) {
  const contrato = state.contratos.find(c => c.id === id);
  if (!contrato) return;
  let texto = contrato.textoContrato || gerarTextoContrato(contrato);

  // A caixa da assinatura tem sempre 65px de altura fixa (esteja vazia ou
  // preenchida), para a linha "____" ficar sempre alinhada nas 3 colunas,
  // independentemente de haver ou não imagem de assinatura.
  if (contrato.assinatura?.imagemBase64) {
    texto = texto.replace(
      '<div class="assinatura-slot" data-slot="segundo" style="height:65px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px;"></div>',
      `<div class="assinatura-slot" data-slot="segundo" style="height:65px; display:flex; align-items:flex-end; justify-content:center; margin-bottom:4px;">
         <img src="${contrato.assinatura.imagemBase64}" style="max-width:170px; max-height:60px; display:block; margin:0 auto">
       </div>`
    );
  }

  const html = `
    <div class="print-doc">
      ${texto}
      ${contrato.assinatura ? `
        <div style="margin-top:24px; font-size:13px">
          <p><strong>Aceite eletronicamente por:</strong> ${esc(contrato.assinatura.nomeDigitado)}</p>
          <p><strong>Data/hora:</strong> ${new Date(contrato.assinatura.dataHora).toLocaleString('pt-PT')}</p>
        </div>
      ` : ''}
    </div>
  `;
  exportarHtmlParaPdf(html, `contrato-${contrato.id}.pdf`);
}

function abrirDocumentoContrato(id) {
  const contrato = state.contratos.find(c => c.id === id);
  if (!contrato) return;
  const aluno = findAluno(contrato.alunoId);
  const fat = contrato.faturacao;
  const pdf = contrato.pdfAssinado;

  openModal(`Contrato assinado · ${esc(aluno?.nome || 'Aluno removido')}`, `
    ${pdf ? `
      <div class="inline-alert inline-alert-info" style="margin-bottom:16px">
        PDF submetido em ${new Date(pdf.uploadedAt).toLocaleString('pt-PT')} (${esc(pdf.filename)}, ${(pdf.size / 1024).toFixed(0)} KB).
        <br><a href="/api/contratos/${id}/pdf-assinado" target="_blank">Ver / descarregar PDF</a>
      </div>
    ` : `<div class="inline-alert inline-alert-warning" style="margin-bottom:16px">Ainda não foi submetido o PDF do contrato assinado.</div>`}

    ${fat ? `
      <div class="inline-alert inline-alert-info" style="margin-bottom:16px">
        Fatura emitida: <strong>${esc(fat.tipo)} ${esc(fat.serie || '')}/${esc(fat.numero || '')}</strong>, em ${new Date(fat.dataEmissao).toLocaleString('pt-PT')}.
        Os recibos dos pagamentos deste aluno passam a ser emitidos automaticamente contra esta fatura.
      </div>
    ` : `<div class="inline-alert inline-alert-warning" style="margin-bottom:16px">
        Ainda não foi emitida fatura para este contrato${!state.escola?.primavera?.ativo ? ' — a integração com a Cegid Primavera não está ativa (Pagamentos → Faturação).' : (aluno && !aluno.nif ? ' — falta o NIF do aluno.' : '.')}
      </div>`}

    <form id="pdfContratoForm">
      <div class="form-field full">
        <label>${pdf ? 'Substituir ficheiro PDF' : 'Carregar PDF do contrato assinado'}</label>
        <input type="file" name="pdf" accept="application/pdf" required>
      </div>
      <p class="muted" style="margin-top:6px">
        Máximo 15MB. ${fat
      ? 'Este contrato já tem fatura emitida — submeter um novo PDF substitui apenas o ficheiro, não gera uma nova fatura.'
      : 'Ao submeter, se a integração estiver ativa e o aluno tiver NIF, a fatura é emitida automaticamente na Cegid Primavera.'}
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Fechar</button>
        <button type="submit" class="btn btn-accent">Submeter PDF</button>
      </div>
    </form>
  `);

  const form = document.getElementById('pdfContratoForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.querySelector('input[name="pdf"]').files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('O ficheiro tem de ser um PDF.', 'error'); return; }
    if (file.size > 15 * 1024 * 1024) { toast('O ficheiro não pode exceder 15MB.', 'error'); return; }

    try {
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
        reader.readAsDataURL(file);
      });
      toast('A submeter PDF…');
      const resultado = await api('POST', `/api/contratos/${id}/pdf-assinado`, { pdfBase64, filename: file.name });
      await refreshCollections(['contratos']);
      renderContratos();
      abrirDocumentoContrato(id);
      toast('PDF submetido.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- Generic form binder ---------------- */
function bindForm(collection, id, numberFields, rerender) {
  const form = document.getElementById('entityForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {};
    for (const [key, val] of fd.entries()) {
      if (numberFields[key]) payload[key] = val === '' ? null : Number(val);
      else payload[key] = val;
    }
    try {
      if (id) await api('PUT', `/api/${collection}/${id}`, payload);
      else await api('POST', `/api/${collection}`, payload);
      await refreshCollections([collection, 'dashboard']);   // era: await loadAll();
      closeModal();
      rerender();
      renderDashboard();
      toast(id ? 'Registo atualizado.' : 'Registo criado com sucesso.');
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function deleteItem(collection, id, label) {
  if (!confirm(`Tens a certeza que queres remover ${label}?`)) return;
  try {
    await api('DELETE', `/api/${collection}/${id}`);
    const tarefas = [refreshCollections([collection, 'dashboard'])];
    if (collection === 'alunos' && typeof ensureAlunosAtivos === 'function') {
      tarefas.push(ensureAlunosAtivos({ force: true }));
    }
    await Promise.all(tarefas);
    render();
    toast('Registo removido.');
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------------- Modal ---------------- */
function openModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------------- Init ---------------- */
(async function init() {
  try {
    await loadEssential();               // só auth + escola + dashboard
    renderNavItems();
    renderGlobalSearchBox('global-search-container');
    const defaultView = canAccessView('calendario')
      ? 'calendario'
      : ['dashboard', 'aulas', 'alunos', 'instrutores', 'veiculos', 'pagamentos', 'contratos', 'config'].find(canAccessView) || 'dashboard';
    state.view = defaultView;
    await switchView(defaultView);        // agora switchView já garante os dados
  } catch (err) {
    toast('Erro ao carregar dados: ' + err.message, 'error');
  }
})();