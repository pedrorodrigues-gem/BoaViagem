/**
 * declaracoes-utils.js
 * Utilitários para geração de declarações e documentos oficiais da Escola de Condução:
 * - Exame Prático
 * - Exame Teórico
 * - Lição Prática
 * - Lição Teórica
 * - Consulta Médica
 * - Comprovativo de Transferência de Escola / DGV
 * - Comprovativo de Cancelamento / Anulação de Inscrição
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    var exp = factory();
    for (var k in exp) {
      root[k] = exp[k];
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var MESES_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  function formatarDataPt(dataStr) {
    if (!dataStr) return '';
    var str = String(dataStr).trim().slice(0, 10);
    var parts = str.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return parts[2] + '-' + parts[1] + '-' + parts[0];
    }
    return str;
  }

  function formatarDataExtenso(dataStr) {
    var d = dataStr ? new Date(dataStr) : new Date();
    if (isNaN(d.getTime())) {
      var partes = String(dataStr || '').split('-');
      if (partes.length === 3) {
        if (partes[0].length === 4) d = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
        else if (partes[2].length === 4) d = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
      }
    }
    if (isNaN(d.getTime())) d = new Date();
    return d.getDate() + ' de ' + MESES_PT[d.getMonth()] + ' de ' + d.getFullYear();
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var TIPOS_DOCUMENTOS = [
    {
      id: 'exame_pratico',
      label: 'Exame Prático',
      descricao: 'Declaração de presença na prova prática de condução no centro de exames',
      icone: '🚗',
      categoriaTipo: 'declaracao'
    },
    {
      id: 'exame_teorico',
      label: 'Exame Teórico',
      descricao: 'Declaração de presença na prova teórica de código no centro de exames',
      icone: '💻',
      categoriaTipo: 'declaracao'
    },
    {
      id: 'licao_pratica',
      label: 'Lição Prática',
      descricao: 'Declaração de presença em lição prática de condução',
      icone: '🚘',
      categoriaTipo: 'declaracao'
    },
    {
      id: 'licao_teorica',
      label: 'Lição Teórica',
      descricao: 'Declaração de presença em lição teórica de código',
      icone: '📖',
      categoriaTipo: 'declaracao'
    },
    {
      id: 'medico',
      label: 'Consulta Médica',
      descricao: 'Declaração de comparência a consulta de avaliação médica para condutores',
      icone: '🩺',
      categoriaTipo: 'declaracao'
    },
    {
      id: 'transferencia',
      label: 'Transferência',
      descricao: 'Certidão / declaração de transferência de processo de condução para outra escola ou DGV',
      icone: '🔄',
      categoriaTipo: 'estado'
    },
    {
      id: 'cancelamento',
      label: 'Cancelamento',
      descricao: 'Declaração oficial de cancelamento / anulação de inscrição na escola',
      icone: '🛑',
      categoriaTipo: 'estado'
    }
  ];

  function obterTiposDocumentos() {
    return TIPOS_DOCUMENTOS.slice();
  }

  function extrairDadosAluno(aluno, opts) {
    opts = opts || {};
    var a = aluno || {};
    var nome = (a.nome || 'Nome do Aluno').trim();
    var cat = (a.categoria || 'B').toUpperCase().trim();
    var tipoDoc = a.tipoDocumento || a.tipo_documento || 'CC';
    var numDoc = a.numeroDocumento || a.numero_documento || '—';
    var nif = a.nif || '—';
    var numLA = (a.processoIMT && a.processoIMT.numero) || a.imtNumero || a.pi_numero || a.numeroLA || '—';
    var numAluno = a.numeroAluno != null ? a.numeroAluno : (a.id != null ? a.id : '—');
    var estado = a.estado || 'Ativo';

    var aulasTeoricas = 0;
    var aulasPraticas = 0;
    if (opts.aulasTeoricas != null) {
      aulasTeoricas = Number(opts.aulasTeoricas) || 0;
    } else if (typeof opts.getAlunoContagens === 'function') {
      var c = opts.getAlunoContagens(a);
      aulasTeoricas = c.aulasTeoricas || 0;
      aulasPraticas = c.aulasPraticas || 0;
    } else if (a.aulasTeoricasRealizadas != null) {
      aulasTeoricas = Number(a.aulasTeoricasRealizadas) || 0;
      aulasPraticas = Number(a.aulasPraticasRealizadas) || 0;
    }

    if (opts.aulasPraticas != null) {
      aulasPraticas = Number(opts.aulasPraticas) || 0;
    }

    return {
      id: a.id,
      nome: nome,
      nomeMaiusculas: nome.toUpperCase(),
      categoria: cat,
      tipoDocumento: tipoDoc,
      numeroDocumento: numDoc,
      nif: nif,
      numeroLA: numLA,
      numeroAluno: numAluno,
      estado: estado,
      aulasTeoricas: aulasTeoricas,
      aulasPraticas: aulasPraticas
    };
  }

  /**
   * Gera o texto simples (plain text) da declaração ou comprovativo
   */
  function gerarTextoDeclaracaoAluno(tipo, params) {
    params = params || {};
    var a = extrairDadosAluno(params.aluno, params);
    var nomeAluno = (params.nome || a.nomeMaiusculas).toUpperCase();
    var cat = (params.categoria || a.categoria || 'B').toUpperCase();
    var horaInicio = params.horaInicio || '10:00';
    var horaFim = params.horaFim || '11:00';
    var dataPt = formatarDataPt(params.data || new Date().toISOString().slice(0, 10));
    var escolaNome = params.escolaNome || 'Escola de Condução Boa Viagem';
    var local = params.local;
    var destino = params.destino || 'DGV Ponta Delgada';
    var motivo = params.motivo || 'a pedido do próprio formando';

    if (tipo === 'exame_pratico' || tipo === 'exame_teorico') {
      var tipoProva = tipo === 'exame_pratico' ? ('PRÁTICA CAT. ' + cat) : ('TEÓRICA CAT. ' + cat);
      var centroExames = local || 'IMTT PONTA DELGADA';
      return [
        'Para os devidos efeitos se declara que,',
        nomeAluno,
        'Se deslocou ao Centro de exames',
        'onde prestou a prova',
        centroExames,
        tipoProva,
        'das',
        horaInicio,
        'às',
        horaFim,
        'no dia',
        'para obtenção da carta de condução.',
        dataPt + ' .'
      ].join('\n');
    }

    if (tipo === 'licao_pratica') {
      var localLicaoP = local || escolaNome.toUpperCase();
      return [
        'Para os devidos efeitos se declara que,',
        nomeAluno,
        'Se deslocou à Escola de Condução',
        'onde realizou a lição',
        localLicaoP,
        'PRÁTICA CAT. ' + cat,
        'das',
        horaInicio,
        'às',
        horaFim,
        'no dia',
        'para obtenção da carta de condução.',
        dataPt + ' .'
      ].join('\n');
    }

    if (tipo === 'licao_teorica') {
      var localLicaoT = local || escolaNome.toUpperCase();
      return [
        'Para os devidos efeitos se declara que,',
        nomeAluno,
        'Se deslocou à Escola de Condução',
        'onde assistiu à lição',
        localLicaoT,
        'TEÓRICA CAT. ' + cat,
        'das',
        horaInicio,
        'às',
        horaFim,
        'no dia',
        'para obtenção da carta de condução.',
        dataPt + ' .'
      ].join('\n');
    }

    if (tipo === 'medico') {
      var localMed = local || 'CONSULTÓRIO MÉDICO';
      return [
        'Para os devidos efeitos se declara que,',
        nomeAluno,
        'Se deslocou ao consultório médico',
        'onde realizou a consulta de avaliação médica',
        localMed,
        'CAT. ' + cat,
        'das',
        horaInicio,
        'às',
        horaFim,
        'no dia',
        'para obtenção da carta de condução.',
        dataPt + ' .'
      ].join('\n');
    }

    if (tipo === 'transferencia') {
      return [
        'DOCUMENTO COMPROVATIVO DE TRANSFERÊNCIA DE PROCESSO',
        '',
        'Para os devidos efeitos se declara que,',
        nomeAluno + ',',
        'portador(a) do documento de identificação ' + a.tipoDocumento + ' n.º ' + a.numeroDocumento + ', NIF ' + a.nif + ', matriculado(a) nesta Escola de Condução com o n.º de aluno #' + a.numeroAluno + ' e titular da Licença de Aprendizagem n.º ' + a.numeroLA + ', para obtenção da carta de condução da categoria ' + cat + ',',
        'requereu a transferência do seu processo de ensino de condução para ' + destino + ', averbada na data de ' + dataPt + '.',
        '',
        'Mais se certifica que até à data da cessação da formação nesta escola, o(a) formando(a) registou a seguinte formação ministrada:',
        '• Formação Teórica ministrada: ' + a.aulasTeoricas + ' horas',
        '• Formação Prática ministrada: ' + a.aulasPraticas + ' horas',
        '',
        'A situação administrativa do processo encontra-se devidamente regularizada.',
        '',
        'Por ser verdade e me haver sido pedido, emite-se a presente declaração.'
      ].join('\n');
    }

    if (tipo === 'cancelamento') {
      return [
        'DOCUMENTO COMPROVATIVO DE CANCELAMENTO DE INSCRIÇÃO',
        '',
        'Para os devidos efeitos se declara que,',
        nomeAluno + ',',
        'portador(a) do documento de identificação ' + a.tipoDocumento + ' n.º ' + a.numeroDocumento + ', NIF ' + a.nif + ', matriculado(a) nesta Escola de Condução com o n.º de aluno #' + a.numeroAluno + ', para obtenção da carta de condução da categoria ' + cat + ',',
        'teve a sua matrícula e inscrição cancelada nesta escola de condução na data de ' + dataPt + ', por motivo de ' + motivo + '.',
        '',
        'Mais se certifica o registo das horas de formação ministradas até à data do cancelamento:',
        '• Formação Teórica realizada: ' + a.aulasTeoricas + ' horas',
        '• Formação Prática realizada: ' + a.aulasPraticas + ' horas',
        '',
        'Cessam a partir desta data todos os direitos e deveres formativos do candidato perante esta entidade de ensino de condução.',
        '',
        'Por ser verdade e para os devidos efeitos legais, se emite o presente comprovativo.'
      ].join('\n');
    }

    return '';
  }

  /**
   * Gera o HTML completo oficial do documento pronto a imprimir / guardar PDF
   */
  function gerarHtmlDeclaracaoAluno(tipo, params) {
    params = params || {};
    var a = extrairDadosAluno(params.aluno, params);
    var nomeAluno = (params.nome || a.nomeMaiusculas).toUpperCase();
    var cat = (params.categoria || a.categoria || 'B').toUpperCase();
    var horaInicio = params.horaInicio || '10:00';
    var horaFim = params.horaFim || '11:00';
    var dataIso = params.data || new Date().toISOString().slice(0, 10);
    var dataPt = formatarDataPt(dataIso);
    var dataExtenso = formatarDataExtenso(dataIso);

    var escola = params.escola || {};
    var escolaNome = params.escolaNome || escola.nome || 'Escola de Condução Boa Viagem';
    var escolaLicenca = escola.numeroLicencaIMT || escola.numeroLicencaImt || escola.licenca || '—';
    var escolaNipc = escola.nipc || '—';
    var escolaMorada = escola.morada || 'Ponta Delgada, Açores';
    var escolaTelefone = escola.telefone || '';
    var escolaEmail = escola.email || '';
    var localidade = escola.localidade || 'Ponta Delgada';

    var local = params.local;
    var destino = params.destino || 'DGV Ponta Delgada';
    var motivo = params.motivo || 'a pedido do próprio formando';

    var tituloDoc = 'DECLARAÇÃO DE PRESENÇA';
    var corpoHtml = '';

    if (tipo === 'exame_pratico' || tipo === 'exame_teorico' || tipo === 'licao_pratica' || tipo === 'licao_teorica' || tipo === 'medico') {
      var acaoDeslocacao = 'Se deslocou ao Centro de exames';
      var acaoOnde = 'onde prestou a prova';
      var localFinal = local || 'IMTT PONTA DELGADA';
      var provaOuLicao = 'PRÁTICA CAT. ' + cat;

      if (tipo === 'exame_pratico') {
        tituloDoc = 'DECLARAÇÃO DE PRESENÇA EM PROVA PRÁTICA';
        acaoDeslocacao = 'Se deslocou ao Centro de exames';
        acaoOnde = 'onde prestou a prova';
        localFinal = local || 'IMTT PONTA DELGADA';
        provaOuLicao = 'PRÁTICA CAT. ' + cat;
      } else if (tipo === 'exame_teorico') {
        tituloDoc = 'DECLARAÇÃO DE PRESENÇA EM PROVA TEÓRICA';
        acaoDeslocacao = 'Se deslocou ao Centro de exames';
        acaoOnde = 'onde prestou a prova';
        localFinal = local || 'IMTT PONTA DELGADA';
        provaOuLicao = 'TEÓRICA CAT. ' + cat;
      } else if (tipo === 'licao_pratica') {
        tituloDoc = 'DECLARAÇÃO DE PRESENÇA EM LIÇÃO PRÁTICA';
        acaoDeslocacao = 'Se deslocou à Escola de Condução';
        acaoOnde = 'onde realizou a lição';
        localFinal = (local || escolaNome).toUpperCase();
        provaOuLicao = 'PRÁTICA CAT. ' + cat;
      } else if (tipo === 'licao_teorica') {
        tituloDoc = 'DECLARAÇÃO DE PRESENÇA EM LIÇÃO TEÓRICA';
        acaoDeslocacao = 'Se deslocou à Escola de Condução';
        acaoOnde = 'onde assistiu à lição';
        localFinal = (local || escolaNome).toUpperCase();
        provaOuLicao = 'TEÓRICA CAT. ' + cat;
      } else if (tipo === 'medico') {
        tituloDoc = 'DECLARAÇÃO DE COMPARÊNCIA A EXAME MÉDICO';
        acaoDeslocacao = 'Se deslocou ao consultório médico';
        acaoOnde = 'onde realizou a consulta de avaliação médica';
        localFinal = (local || 'CONSULTÓRIO MÉDICO').toUpperCase();
        provaOuLicao = 'CAT. ' + cat;
      }

      corpoHtml = [
        '<div style="text-align:center; margin:32px 0 24px 0; line-height:2.2; font-size:15.5px;">',
        '  <p style="margin:0 0 16px 0; font-size:16px;">Para os devidos efeitos se declara que,</p>',
        '  <p style="margin:0 0 16px 0; font-size:18px; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase; color:#0f172a;">' + escHtml(nomeAluno) + '</p>',
        '  <p style="margin:0 0 10px 0; font-size:15px; color:#334155;">' + escHtml(acaoDeslocacao) + '</p>',
        '  <p style="margin:0 0 12px 0; font-size:15px; color:#334155;">' + escHtml(acaoOnde) + '</p>',
        '  <p style="margin:0 0 12px 0; font-size:16.5px; font-weight:bold; text-transform:uppercase; color:#0f172a;">' + escHtml(localFinal) + '</p>',
        '  <p style="margin:0 0 18px 0; font-size:16.5px; font-weight:bold; text-transform:uppercase; color:#0f172a;">' + escHtml(provaOuLicao) + '</p>',
        '  <p style="margin:0 0 8px 0; font-size:14.5px; color:#475569;">das</p>',
        '  <p style="margin:0 0 8px 0; font-size:16px; font-weight:bold; color:#0f172a;">' + escHtml(horaInicio) + '</p>',
        '  <p style="margin:0 0 8px 0; font-size:14.5px; color:#475569;">às</p>',
        '  <p style="margin:0 0 18px 0; font-size:16px; font-weight:bold; color:#0f172a;">' + escHtml(horaFim) + '</p>',
        '  <p style="margin:0 0 8px 0; font-size:14.5px; color:#475569;">no dia</p>',
        '  <p style="margin:0 0 12px 0; font-size:15.5px; color:#334155;">para obtenção da carta de condução.</p>',
        '  <p style="margin:0; font-size:18px; font-weight:bold; color:#0f172a;">' + escHtml(dataPt) + ' .</p>',
        '</div>'
      ].join('\n');
    } else if (tipo === 'transferencia') {
      tituloDoc = 'DOCUMENTO COMPROVATIVO DE TRANSFERÊNCIA DE PROCESSO';
      corpoHtml = [
        '<div style="text-align:justify; margin:28px 0; line-height:1.9; font-size:15px;">',
        '  <p style="margin-bottom:18px;">Para os devidos efeitos se declara que,</p>',
        '  <p style="font-size:17px; font-weight:bold; text-transform:uppercase; margin-bottom:12px; color:#0f172a;">' + escHtml(nomeAluno) + '</p>',
        '  <p style="margin-bottom:16px;">',
        '    titular do documento de identificação <strong>' + escHtml(a.tipoDocumento) + '</strong> n.º <strong>' + escHtml(a.numeroDocumento) + '</strong>, ',
        '    NIF <strong>' + escHtml(a.nif) + '</strong>, matriculado(a) nesta Escola de Condução com o n.º de aluno <strong>#' + escHtml(a.numeroAluno) + '</strong> ',
        '    e titular da Licença de Aprendizagem n.º <strong>' + escHtml(a.numeroLA) + '</strong>, para obtenção da carta de condução da categoria <strong>' + escHtml(cat) + '</strong>, ',
        '    requereu a transferência do seu processo de instrução para <strong>' + escHtml(destino) + '</strong>, averbada na data de <strong>' + escHtml(dataPt) + '</strong>.',
        '  </p>',
        '  <p style="margin-bottom:16px;">Mais se certifica que até à data da cessação da formação nesta escola, o(a) formando(a) registou a seguinte formação ministrada:</p>',
        '  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:14px 18px; margin:16px 0 20px 0;">',
        '    <p style="margin:4px 0;">• Formação Teórica ministrada: <strong>' + a.aulasTeoricas + '</strong> ' + (a.aulasTeoricas === 1 ? 'hora/lição' : 'horas/lições') + '</p>',
        '    <p style="margin:4px 0;">• Formação Prática ministrada: <strong>' + a.aulasPraticas + '</strong> ' + (a.aulasPraticas === 1 ? 'hora/lição' : 'horas/lições') + '</p>',
        '  </div>',
        '  <p style="margin-bottom:16px;">A situação administrativa do formando encontra-se regularizada perante esta instituição.</p>',
        '  <p style="margin-top:20px;">Por ser verdade e para os efeitos tidos por convenientes, se passa a presente declaração que vai devidamente assinada e autenticada com o carimbo oficial em uso nesta escola.</p>',
        '</div>'
      ].join('\n');
    } else if (tipo === 'cancelamento') {
      tituloDoc = 'DOCUMENTO COMPROVATIVO DE CANCELAMENTO DE INSCRIÇÃO';
      corpoHtml = [
        '<div style="text-align:justify; margin:28px 0; line-height:1.9; font-size:15px;">',
        '  <p style="margin-bottom:18px;">Para os devidos efeitos se declara que,</p>',
        '  <p style="font-size:17px; font-weight:bold; text-transform:uppercase; margin-bottom:12px; color:#0f172a;">' + escHtml(nomeAluno) + '</p>',
        '  <p style="margin-bottom:16px;">',
        '    titular do documento de identificação <strong>' + escHtml(a.tipoDocumento) + '</strong> n.º <strong>' + escHtml(a.numeroDocumento) + '</strong>, ',
        '    NIF <strong>' + escHtml(a.nif) + '</strong>, matriculado(a) nesta Escola de Condução com o n.º de aluno <strong>#' + escHtml(a.numeroAluno) + '</strong>, ',
        '    para obtenção da carta de condução da categoria <strong>' + escHtml(cat) + '</strong>, ',
        '    teve a sua matrícula e inscrição cancelada / anulada nesta instituição em <strong>' + escHtml(dataPt) + '</strong>, por motivo de <em>' + escHtml(motivo) + '</em>.',
        '  </p>',
        '  <p style="margin-bottom:16px;">Mais se certifica o registo das horas de formação ministradas até à data do cancelamento:</p>',
        '  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:14px 18px; margin:16px 0 20px 0;">',
        '    <p style="margin:4px 0;">• Formação Teórica realizada: <strong>' + a.aulasTeoricas + '</strong> ' + (a.aulasTeoricas === 1 ? 'hora/lição' : 'horas/lições') + '</p>',
        '    <p style="margin:4px 0;">• Formação Prática realizada: <strong>' + a.aulasPraticas + '</strong> ' + (a.aulasPraticas === 1 ? 'hora/lição' : 'horas/lições') + '</p>',
        '  </div>',
        '  <p style="margin-bottom:16px;">Cessam a partir da referida data quaisquer direitos e deveres formativos do candidato perante esta entidade de ensino de condução.</p>',
        '  <p style="margin-top:20px;">Por ser verdade e para os devidos efeitos legais, se emite a presente declaração devidamente assinada e autenticada com o carimbo oficial desta escola.</p>',
        '</div>'
      ].join('\n');
    }

    return [
      '<div class="print-doc declaracao-a4-page" style="font-family:\'Times New Roman\', Times, Georgia, serif; color:#0f172a; max-width:700px; margin:0 auto; padding:24px 28px; line-height:1.6; background:#ffffff;">',
      '  <!-- CABEÇALHO OFICIAL DA ESCOLA -->',
      '  <div style="border-bottom:2px solid #0f172a; padding-bottom:14px; margin-bottom:28px; display:flex; justify-content:space-between; align-items:flex-start;">',
      '    <div>',
      '      <div style="font-size:20px; font-weight:bold; letter-spacing:0.5px; text-transform:uppercase; color:#0f172a; font-family:Inter, Arial, sans-serif;">' + escHtml(escolaNome) + '</div>',
      '      <div style="font-size:12.5px; color:#334155; margin-top:4px; font-family:Inter, Arial, sans-serif;">Alvará / Licença IMT n.º <strong>' + escHtml(escolaLicenca) + '</strong> · NIPC: <strong>' + escHtml(escolaNipc) + '</strong></div>',
      '      <div style="font-size:11.5px; color:#64748b; margin-top:2px; font-family:Inter, Arial, sans-serif;">' + escHtml(escolaMorada) + (escolaTelefone ? ' · Tel: ' + escHtml(escolaTelefone) : '') + (escolaEmail ? ' · ' + escHtml(escolaEmail) : '') + '</div>',
      '    </div>',
      '    <div style="text-align:right; font-family:Inter, Arial, sans-serif;">',
      '      <span style="display:inline-block; border:1px solid #cbd5e1; background:#f8fafc; padding:3px 9px; border-radius:4px; font-size:11px; font-weight:600; text-transform:uppercase; color:#475569;">Documento Oficial</span>',
      '      <div style="font-size:11.5px; color:#64748b; margin-top:4px;">N.º Aluno: #' + escHtml(a.numeroAluno) + '</div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- TÍTULO -->',
      '  <div style="text-align:center; margin-bottom:28px;">',
      '    <h2 style="font-size:18px; font-weight:bold; text-transform:uppercase; letter-spacing:1px; margin:0 0 4px 0; color:#0f172a; font-family:Inter, Arial, sans-serif;">' + escHtml(tituloDoc) + '</h2>',
      '    <div style="font-size:12px; color:#64748b; font-style:italic;">Para os devidos e legais efeitos</div>',
      '  </div>',
      '',
      '  <!-- CORPO -->',
      corpoHtml,
      '',
      '  <!-- LOCAL, DATA E ASSINATURAS -->',
      '  <div style="margin-top:46px; font-size:14px;">',
      '    <div style="margin-bottom:34px; font-size:14px; color:#1e293b;">',
      '      ' + escHtml(localidade) + ', ' + escHtml(dataExtenso),
      '    </div>',
      '    <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:40px;">',
      '      <div style="flex:1; text-align:center;">',
      '        <div style="border-top:1px solid #475569; padding-top:6px; font-size:12px; font-family:Inter, Arial, sans-serif; color:#475569;">',
      '          O(A) Formando(a)<br>',
      '          <span style="font-size:11px; color:#64748b;">(Assinatura)</span>',
      '        </div>',
      '      </div>',
      '      <div style="flex:1; text-align:center;">',
      '        <div style="border-top:1px solid #475569; padding-top:6px; font-size:12px; font-family:Inter, Arial, sans-serif; color:#475569;">',
      '          Pela Escola de Condução<br>',
      '          <span style="font-size:11px; color:#64748b;">(A Direção / Carimbo Oficial)</span>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  return {
    formatarDataPt: formatarDataPt,
    formatarDataExtenso: formatarDataExtenso,
    obterTiposDocumentos: obterTiposDocumentos,
    extrairDadosAluno: extrairDadosAluno,
    gerarTextoDeclaracaoAluno: gerarTextoDeclaracaoAluno,
    gerarHtmlDeclaracaoAluno: gerarHtmlDeclaracaoAluno
  };
});
