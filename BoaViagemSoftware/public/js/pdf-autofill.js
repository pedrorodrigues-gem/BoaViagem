(function () {
  /**
   * MAPA DE CAMPOS EDITÁVEIS E PREENCHIMENTO AUTOMÁTICO DOS MODELOS IMT / SCTT
   * --------------------------------------------------------------------------
   * Documentos suportados:
   * 1) Modelo 1 - IMT (Requerimento do Condutor - Mod1_IMT.pdf)
   *    - Requerimento individual (1 aluno) com dados pessoais completos,
   *      categoria pretendida, documento de identificação, NIF, contactos,
   *      morada, documento/licença atual e embutimento de fotografia caso exista.
   * 2) SCTT - Mod. C1 (Pauta de Exame Teórico - C2Teorico.pdf)
   *    - Cabeçalho da escola preenchido (Nome, NIF, Diretor), data e hora de exame.
   *    - Taxa fixa: 16,00 € por aluno.
   *    - Total calculado automaticamente: (n.º de alunos * 16,00 €).
   *    - Tabela até 16 candidatos com N.º LA, NIF, BI/CC e checkbox de categoria.
   * 3) SCTT - Mod. C2 (Pauta de Exame Prático - C2Pratico.pdf)
   *    - Cabeçalho da escola preenchido (Nome, NIF, Diretor), data de exame.
   *    - Taxa fixa: 31,50 € por aluno.
   *    - Total calculado automaticamente: (n.º de alunos * 31,50 €).
   *    - Tabela até 16 candidatos com N.º LA, NIF, BI/CC, checkbox de categoria
   *      e matrícula do veículo (obtida automaticamente das aulas práticas ou viaturas).
   * 4) SCTT - Mod. C3 (Licença de Aprendizagem - C3.pdf)
   *    - Cabeçalho da escola preenchido (Nome, NIF, Diretor).
   *    - Pauta de requerimento até 18 candidatos com Nome e BI/CC.
   */

  // Mapeia a categoria do aluno para o nome real do campo no Mod1_IMT.
  const MOD1_CATEGORY_FIELD_MAP = {
    'AM': 'catA[0]',
    'B1': 'catA1[0]',
    'C1E': 'catMoto[0]',
    'CICLOMOTORES': 'catCiclo[0]',
    'A1': 'catB[0]',
    'B': 'catB1[0]',
    'C': 'catBE[0]',
    'D1E': 'Check Box2',
    'A2': 'catC[0]',
    'BE': 'catC1[0]',
    'CE': 'catCE[0]',
    'D': 'catC1E[0]',
    'A': 'catD[0]',
    'C1': 'catD1[0]',
    'D1': 'catDE[0]',
    'DE': 'catD1E[0]',
    'I': 'catVeicAgrI[0]',
    'II': 'catVeicAgrII[0]',
    'III': 'catVeicAgrIII[0]'
  };

  // Valores de exportação para o radio group "requerimento[0]" no Mod1_IMT
  const MOD1_REQUERIMENTO_VALUES = {
    LICENCA_APRENDIZAGEM: '1',
    LICENCA_CONDUCAO: '2',
    CARTA_CONDUCAO: '3',
    MOTORISTA_DE: '4',
    CAPTAXI: '5',
    CQM: '6',
    EXAMINADOR: '7',
    INSPETOR_CITV: '8',
    INSTRUTOR: '9',
    DIRETOR_EC: '10',
    SUBDIRETOR_EC: '11',
    OUTRA: '12'
  };

  // Checkboxes de categoria no C2 Teórico (SCTT - Mod. C1):
  // 0: AM | 1: B/B1 | 2: A/A1/A2 c/B | 3: A/A1/A2 s/B | 4: C/C1 | 5: D/D1 | 6: G2/G3
  const CATEGORY_CHECKBOX_MAP_TEORICO = {
    'AM': 0,
    'B': 1, 'B1': 1,
    'A': 3, 'A1': 3, 'A2': 3, // Se detiver B passa dinamicamente a 2 (c/B)
    'C': 4, 'C1': 4,
    'D': 5, 'D1': 5,
    'G2': 6, 'G3': 6
  };

  // Checkboxes de categoria no C2 Prático (SCTT - Mod. C2):
  // AM (0) | A1 (1) | A2 (2) | A (3) | B1 (4) | B (5) | C1 (6) | C (7) | D1 (8) | D (9) | E (10) | G2 (11) | G3 (12)
  const CATEGORY_CHECKBOX_MAP_PRATICO = {
    'AM': 0, 'A1': 1, 'A2': 2, 'A': 3, 'B1': 4, 'B': 5,
    'C1': 6, 'C': 7, 'D1': 8, 'D': 9, 'E': 10,
    'BE': 10, 'CE': 10, 'DE': 10, 'C1E': 10, 'D1E': 10,
    'G2': 11, 'G3': 12
  };

  function buildRowNames(extraCount) {
    var rows = ['Linha3[0]', 'Linha4[0]', 'Linha5[0]', 'Linha6[0]'];
    for (var i = 0; i < extraCount; i++) {
      rows.push('Linha7[' + i + ']');
    }
    return rows;
  }
  const C3_ROWS = buildRowNames(14); // 18 linhas no total
  const C2_ROWS = buildRowNames(12); // 16 linhas no total

  // Apenas o Modelo 1 é um requerimento estritamente individual (1 pessoa com foto e assinatura).
  // C3, C2 Teórico e C2 Prático são pautas e aceitam múltiplos candidatos.
  const SINGLE_SELECTION_TEMPLATES = ['mod1IMT'];

  function isSingleSelectionTemplate(templateKey) {
    return SINGLE_SELECTION_TEMPLATES.indexOf(templateKey) !== -1;
  }

  function sanitizePdfText(str) {
    if (str == null) return '';
    return String(str)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .trim();
  }

  function getAlunoNumeroDocumento(aluno, ctxOrOptions) {
    if (!aluno) return '';
    var options = (ctxOrOptions && ctxOrOptions.options) ? ctxOrOptions.options : ctxOrOptions;
    if (options && options.documentos && options.documentos[aluno.id]) {
      var optDoc = String(options.documentos[aluno.id]).trim();
      if (optDoc) return optDoc;
    }
    if (options && options.numeroDocumento && (!options.alunoId || options.alunoId === aluno.id)) {
      var singleDoc = String(options.numeroDocumento).trim();
      if (singleDoc) return singleDoc;
    }
    var doc = aluno.numeroDocumento ||
              aluno.numero_documento ||
              aluno.documentoNumero ||
              aluno.numDocumento ||
              aluno.num_documento ||
              aluno.documento ||
              aluno.cc ||
              aluno.bi ||
              aluno.biCc ||
              aluno.numCC ||
              aluno.numeroCC ||
              aluno.identificacao ||
              '';
    return String(doc).trim();
  }

  function getAlunoNumeroLA(aluno) {
    if (!aluno) return '';
    if (aluno.numeroLA) return String(aluno.numeroLA).trim();
    if (aluno.processoIMT && aluno.processoIMT.numero) return String(aluno.processoIMT.numero).trim();
    if (aluno.imtNumero) return String(aluno.imtNumero).trim();
    return '';
  }

  function getAlunoMatricula(aluno, ctx) {
    if (!aluno) return '';
    if (ctx && ctx.options && ctx.options.matricula) {
      return String(ctx.options.matricula).trim();
    }
    if (aluno.matricula) return String(aluno.matricula).trim();

    // 1. Procurar nas aulas práticas mais recentes do aluno
    if (window.state && Array.isArray(window.state.aulasPraticas)) {
      var aulas = window.state.aulasPraticas.filter(function (a) {
        return a.alunoId === aluno.id && a.veiculoId;
      });
      if (aulas.length) {
        aulas.sort(function (a, b) {
          return String(b.data || '').localeCompare(String(a.data || ''));
        });
        var veic = typeof findVeiculo === 'function'
          ? findVeiculo(aulas[0].veiculoId)
          : (window.state.veiculos || []).find(function (v) { return v.id === aulas[0].veiculoId; });
        if (veic && veic.matricula) return String(veic.matricula).trim();
      }
    }

    // 2. Procurar na lista de veículos da escola pela mesma categoria
    if (window.state && Array.isArray(window.state.veiculos)) {
      var catAluno = (aluno.categoria || 'B').toUpperCase().trim();
      var vCat = window.state.veiculos.find(function (v) {
        return (v.categoria || '').toUpperCase().trim() === catAluno && v.estado === 'Disponível';
      }) || window.state.veiculos.find(function (v) {
        return (v.categoria || '').toUpperCase().trim() === catAluno;
      }) || window.state.veiculos[0];
      if (vCat && vCat.matricula) return String(vCat.matricula).trim();
    }

    return '';
  }

  function desenharCabecalhoEscola(pdfDoc, templateKey, ctx) {
    if (templateKey === 'mod1IMT') return;
    try {
      var font = ctx.embeddedFont;
      if (!font) return;
      var page = pdfDoc.getPage(0);
      var escola = ctx.escola || {};
      var nomeEscola = sanitizePdfText(escola.nome || 'Escola de Condução Boa Viagem');
      var nifEscola = sanitizePdfText(escola.nipc || escola.nif || '');
      var diretorEscola = sanitizePdfText(escola.nomeDiretor || escola.diretor || escola.responsavel || escola.nomeResponsavel || '');

      var coords = {
        modC2Teorico: { nomeY: 466.5, nifY: 447.8, dirY: 429.0 },
        modC2Pratico: { nomeY: 467.2, nifY: 448.5, dirY: 429.7 },
        modC3:        { nomeY: 464.2, nifY: 445.5, dirY: 426.7 }
      }[templateKey];

      if (coords) {
        if (nomeEscola) {
          page.drawText(nomeEscola, { x: 55, y: coords.nomeY, size: 8.5, font: font, color: PDFLib.rgb(0, 0, 0) });
        }
        if (nifEscola) {
          page.drawText(nifEscola, { x: 45, y: coords.nifY, size: 8.5, font: font, color: PDFLib.rgb(0, 0, 0) });
        }
        if (diretorEscola) {
          page.drawText(diretorEscola, { x: 120, y: coords.dirY, size: 8.5, font: font, color: PDFLib.rgb(0, 0, 0) });
        }
      }
    } catch (err) {
      console.warn('Erro ao desenhar dados da escola:', err);
    }
  }

  async function desenharFotoAluno(pdfDoc, aluno) {
    if (!aluno || !aluno.foto || typeof aluno.foto !== 'string' || !aluno.foto.startsWith('data:image/')) return;
    try {
      var page = pdfDoc.getPage(0);
      var img;
      if (aluno.foto.includes('image/png')) {
        img = await pdfDoc.embedPng(aluno.foto);
      } else {
        img = await pdfDoc.embedJpg(aluno.foto);
      }
      // Caixa "Fotografia (colada)" no Mod1_IMT: x=35, y=228, width=85, height=105
      page.drawImage(img, { x: 35, y: 228, width: 85, height: 105 });
    } catch (err) {
      console.warn('Não foi possível desenhar a foto do aluno no Mod1:', err);
    }
  }

  const OFFICIAL_PDF_TEMPLATES = {
    // 1. Modelo 1 - IMT (Requerimento do Condutor)
    mod1IMT: {
      label: 'Modelo 1 - IMT (Requerimento)',
      filename: 'Mod1_IMT.pdf',
      fill: async function (setField, auto, aluno, ctx, pdfDoc) {
        if (!aluno) return;
        const BASE = 'F[0].Page_1[0].';

        // --- Tipo de requerimento (topo) ---
        setField(BASE + 'requerimento[0]', MOD1_REQUERIMENTO_VALUES.CARTA_CONDUCAO);

        // --- Motivo do Pedido (Padrão: Emissão de Carta) ---
        setField(BASE + 'emissao[0]', true);

        // --- Categorias ---
        var cat = (aluno.categoria || 'B').toUpperCase().replace(/\s+/g, '');
        var catField = MOD1_CATEGORY_FIELD_MAP[cat];
        if (catField) {
          setField(BASE + catField, true);
        } else {
          console.warn('Categoria desconhecida para o Mod1-IMT: ' + cat);
        }

        // --- Nome e Apelido separados ---
        var nomeCompleto = (aluno.nome || '').trim();
        var apelido = aluno.apelido || '';
        var nome1 = '';
        var nome2 = '';

        if (!apelido) {
          var parts = nomeCompleto.split(/\s+/);
          if (parts.length === 1) {
            nome1 = parts[0];
            apelido = '';
          } else if (parts.length === 2) {
            nome1 = parts[0];
            apelido = parts[1];
          } else if (parts.length === 3) {
            nome1 = parts[0];
            apelido = parts.slice(1).join(' ');
          } else {
            nome1 = parts.slice(0, 2).join(' ');
            apelido = parts.slice(2).join(' ');
          }
        } else {
          nome1 = nomeCompleto.replace(apelido, '').trim();
        }

        // Truncar ou transbordar se necessário para cumprir o limite dos campos
        if (nome1.length > 25) {
          var nParts = nome1.split(/\s+/);
          nome1 = nParts.slice(0, Math.ceil(nParts.length / 2)).join(' ');
          nome2 = nParts.slice(Math.ceil(nParts.length / 2)).join(' ');
        }

        setField(BASE + 'apelido[0]', apelido);
        setField(BASE + 'nome1[0]', nome1);
        if (nome2) setField(BASE + 'nome2[0]', nome2);

        // --- Dados Pessoais ---
        setField(BASE + 'dataNascimento[0]', ctx.fmtDate(aluno.dataNascimento) || aluno.dataNascimento || '');
        setField(BASE + 'naturalidade[0]', aluno.naturalidade || aluno.localidade || '');
        setField(BASE + 'nacionalidade[0]', aluno.nacionalidade || 'Portuguesa');

        // --- Documento de Identificação (BI / CC) ---
        var tipoDocStr = (aluno.tipoDocumento || 'CC').trim().toUpperCase();
        setField(BASE + 'tipo[0]', tipoDocStr.charAt(0) || 'C');

        var numDocRaw = getAlunoNumeroDocumento(aluno, ctx);
        var cleanDoc = numDocRaw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        var docNum = numDocRaw;
        var docDC = aluno.digitoControlo || '';

        if (cleanDoc.length >= 11) {
          // Formato CC Português completo (8 dígitos + 1 controlo + 2 letras + 1 controlo, ex: 12345678 9 ZZ4)
          docNum = cleanDoc.slice(0, cleanDoc.length - 4);
          docDC = cleanDoc.charAt(cleanDoc.length - 4);
        } else if (cleanDoc.length === 9) {
          docNum = cleanDoc.slice(0, 8);
          docDC = cleanDoc.charAt(8);
        } else if (cleanDoc.length > 0) {
          docNum = cleanDoc;
        }

        setField(BASE + 'numero[0]', docNum);
        setField(BASE + 'DocDC[0]', docDC ? String(docDC).charAt(0) : '');
        setField(BASE + 'validade[0]', ctx.fmtDate(aluno.validadeDocumento) || aluno.validadeDocumento || '');
        setField(BASE + 'emissorDI[0]', aluno.emissorDocumento || 'IRN');

        // --- NIF e Contactos ---
        var nifLimpo = (aluno.nif || '').toString().replace(/\D/g, '').slice(0, 9);
        setField(BASE + 'nContribuinte[0]', nifLimpo);
        setField(BASE + 'contribuintefinal[0]', nifLimpo);

        var telLimpo = (aluno.telemovel || aluno.telefone || '').toString().replace(/\D/g, '').slice(-9);
        setField(BASE + 'telemovel[0]', telLimpo);
        setField(BASE + 'email[0]', aluno.email || '');

        // --- Morada ---
        setField(BASE + 'moradaActual[0]', aluno.morada || '');
        setField(BASE + 'localidadeActual[0]', aluno.localidade || '');

        // Código Postal
        if (aluno.codigoPostal && aluno.codigoPostal.includes('-')) {
          var cpPartes = aluno.codigoPostal.split('-');
          setField(BASE + 'codPostal4[0]', cpPartes[0] || '');
          setField(BASE + 'codPostal3[0]', cpPartes[1] || '');
        } else if (aluno.codigoPostal) {
          setField(BASE + 'codPostal4[0]', aluno.codigoPostal.substring(0, 4));
          setField(BASE + 'codPostal3[0]', aluno.codigoPostal.substring(4, 7));
        }
        setField(BASE + 'localidadeCP[0]', aluno.localidadePostal || aluno.localidade || '');

        // --- Caixas de Caracteres na Secção 5 ---
        setField(BASE + 'tipoDoc[0]', tipoDocStr.charAt(0) || 'C');
        for (var d = 0; d < 15; d++) {
          setField(BASE + 'docId' + (d + 1) + '[0]', cleanDoc.charAt(d) || '');
        }
        if (cleanDoc.length >= 11) {
          setField(BASE + 'DocumentDC[0]', cleanDoc.slice(-1));
        } else if (docDC) {
          setField(BASE + 'DocumentDC[0]', String(docDC).charAt(0));
        }

        // --- Secção 4: Documento Atual / Título detido ---
        var laNum = getAlunoNumeroLA(aluno);
        var temCartas = Array.isArray(aluno.cartasCategorias) && aluno.cartasCategorias.length > 0;
        if (temCartas) {
          setField(BASE + 'licenca3[0]', true); // Carta de Condução
          var numCarta = aluno.cartasCategorias[0].numero || laNum;
          setField(BASE + 'nTitCond[0]', numCarta);
          setField(BASE + 'emissorTitCond[0]', 'IMT');

          var ccMatch = String(numCarta).trim().match(/^([A-Za-z]{1,2})[-\s]?(\d+)$/);
          if (ccMatch) {
            setField(BASE + 'ccL1[0]', ccMatch[1].charAt(0).toUpperCase());
            if (ccMatch[1].length > 1) setField(BASE + 'ccL2[0]', ccMatch[1].charAt(1).toUpperCase());
            var numDigits = ccMatch[2];
            for (var k = 0; k < 14; k++) {
              setField(BASE + 'ccN' + (k + 1) + '[0]', numDigits.charAt(k) || '');
            }
          }
        } else if (laNum) {
          setField(BASE + 'licenca1[0]', true); // Licença de Aprendizagem
          setField(BASE + 'nTitCond[0]', laNum);
          setField(BASE + 'emissorTitCond[0]', 'IMT');
        }

        // --- Data do Pedido ---
        setField(BASE + 'dataPedido[0]', ctx.dataHoje);

        // --- Embutir Foto se disponível ---
        if (pdfDoc) {
          await desenharFotoAluno(pdfDoc, aluno);
        }
      }
    },

    // 2. SCTT - Mod. C3 (Licença de Aprendizagem)
    modC3: {
      label: 'SCTT - Mod. C3 (Licença de Aprendizagem)',
      filename: 'C3.pdf',
      fill: function (setField, auto, alunos, ctx, pdfDoc) {
        const BASE = 'formulário1[0].#subform[0].Tabela1[0].';

        // Cabeçalho da escola desenhado
        desenharCabecalhoEscola(pdfDoc, 'modC3', ctx);

        // Tabela de Alunos (até 18 linhas: Linha3..Linha6 + Linha7[0..13])
        for (var i = 0; i < C3_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C3_ROWS[i];
          var rowBase = BASE + linhaKey + '.';

          setField(rowBase + 'CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(rowBase + 'CampoTexto[1]', aluno ? getAlunoNumeroDocumento(aluno, ctx) : '');
          setField(rowBase + 'CampoTexto[2]', aluno ? '0,00' : '');
        }
      }
    },

    // 3. SCTT - Mod. C1 (Pauta Exame Teórico)
    modC2Teorico: {
      label: 'SCTT - Mod. C1 (Pauta Exame Teórico)',
      filename: 'C2Teorico.pdf',
      fill: function (setField, auto, alunos, ctx, pdfDoc) {
        const BASE = 'formulário1[0].#subform[0].';

        // Cabeçalho da escola desenhado
        desenharCabecalhoEscola(pdfDoc, 'modC2Teorico', ctx);

        // Data e Hora de Exame
        var dataExame = (ctx.options && ctx.options.dataExame) ? ctx.fmtDate(ctx.options.dataExame) : ctx.dataHoje;
        setField(BASE + '#area[0].CampoData[0]', dataExame);

        if (ctx.options && ctx.options.horaExame) {
          setField(BASE + '#area[0].CampoDataHora1[0]', ctx.options.horaExame);
        }

        // Taxa C2 Teórico: SEMPRE 16,00 € por candidato
        var TAXA_TEORICO = '16,00';
        var totalCandidatos = 0;

        // Tabela de Alunos (até 16 linhas: Linha3..Linha6 + Linha7[0..11])
        for (var i = 0; i < C2_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C2_ROWS[i];
          var rowBase = BASE + 'Tabela1[0].' + linhaKey + '.';

          if (aluno) totalCandidatos++;

          setField(rowBase + 'CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(rowBase + 'CampoTexto[1]', aluno ? getAlunoNumeroDocumento(aluno, ctx) : '');
          setField(rowBase + 'CampoTexto[2]', aluno ? (aluno.nif || '') : '');
          setField(rowBase + 'CampoTexto[3]', aluno ? getAlunoNumeroLA(aluno) : '');
          setField(rowBase + 'CampoTexto[4]', aluno ? TAXA_TEORICO : '');

          if (aluno) {
            var cat = (aluno.categoria || 'B').toUpperCase().replace(/\s+/g, '');
            var idx = CATEGORY_CHECKBOX_MAP_TEORICO[cat];

            // Para categorias A/A1/A2: verificar se já possui categoria B
            if (cat === 'A' || cat === 'A1' || cat === 'A2') {
              var temB = (aluno.cartasCategorias || []).some(function (c) {
                return (c.categoria || '').toUpperCase().trim() === 'B';
              }) || ((aluno.dispensaModulos || '').toUpperCase().includes('B'));
              idx = temB ? 2 : 3; // 2 = c/B, 3 = s/B
            }

            if (idx !== undefined) {
              setField(rowBase + 'CaixaVerificação[' + idx + ']', true);
            } else {
              console.warn('Categoria desconhecida (C2 Teórico): ' + cat);
            }
          }
        }

        // Total da taxa calculado e preenchido
        var valorTotal = (totalCandidatos * 16).toFixed(2).replace('.', ',');
        setField(BASE + 'DecimalField1[0]', valorTotal);
      }
    },

    // 4. SCTT - Mod. C2 (Pauta Exame Prático)
    modC2Pratico: {
      label: 'SCTT - Mod. C2 (Pauta Exame Prático)',
      filename: 'C2Pratico.pdf',
      fill: function (setField, auto, alunos, ctx, pdfDoc) {
        const BASE = 'formulário1[0].#subform[0].';

        // Cabeçalho da escola desenhado
        desenharCabecalhoEscola(pdfDoc, 'modC2Pratico', ctx);

        // Data de Exame
        var dataExame = (ctx.options && ctx.options.dataExame) ? ctx.fmtDate(ctx.options.dataExame) : ctx.dataHoje;
        setField(BASE + '#area[0].CampoData[0]', dataExame);

        // Taxa C2 Prático: SEMPRE 31,50 € por candidato
        var TAXA_PRATICO = '31,50';
        var totalCandidatos = 0;

        // Tabela de Alunos (até 16 linhas: Linha3..Linha6 + Linha7[0..11])
        for (var i = 0; i < C2_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C2_ROWS[i];
          var rowBase = BASE + 'Tabela1[0].' + linhaKey + '.';

          if (aluno) totalCandidatos++;

          setField(rowBase + 'CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(rowBase + 'CampoTexto[1]', aluno ? getAlunoNumeroDocumento(aluno, ctx) : '');
          setField(rowBase + 'CampoTexto[2]', aluno ? (aluno.nif || '') : '');
          setField(rowBase + 'CampoTexto[3]', aluno ? getAlunoNumeroLA(aluno) : '');
          setField(rowBase + 'CampoTexto[4]', aluno ? TAXA_PRATICO : '');
          setField(rowBase + 'CampoTexto[5]', aluno ? getAlunoMatricula(aluno, ctx) : '');

          if (aluno) {
            var cat = (aluno.categoria || 'B').toUpperCase().replace(/\s+/g, '');
            var idx = CATEGORY_CHECKBOX_MAP_PRATICO[cat];
            if (idx !== undefined) {
              setField(rowBase + 'CaixaVerificação[' + idx + ']', true);
            } else {
              console.warn('Categoria desconhecida (C2 Prático): ' + cat);
            }
          }
        }

        // Total da taxa calculado e preenchido
        var valorTotal = (totalCandidatos * 31.5).toFixed(2).replace('.', ',');
        setField(BASE + 'DecimalField1[0]', valorTotal);
      }
    }
  };

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function fmtDate(d) {
    if (!d) return '';
    if (d.includes('/')) return d;
    var parts = d.split('-');
    if (parts.length === 3) {
      return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return d;
  }

  function buildDocumentContext(studentIds, options) {
    var alunos = (studentIds || []).map(function (id) {
      return typeof findAluno === 'function' ? findAluno(Number(id)) : null;
    }).filter(Boolean);

    if (!alunos.length && window.state && window.state.alunos) {
      alunos = window.state.alunos.filter(function (a) {
        return studentIds.indexOf(a.id) !== -1;
      });
    }

    return {
      escola: (window.state && window.state.escola) || {},
      dataHoje: fmtDate(new Date().toISOString().slice(0, 10)),
      esc: esc,
      fmtDate: fmtDate,
      alunos: alunos,
      options: options || {}
    };
  }

  async function gerarDocumentoAutopreenchido(studentIds, templateKey, options) {
    var config = OFFICIAL_PDF_TEMPLATES[templateKey];
    if (!config) return;

    if (isSingleSelectionTemplate(templateKey) && studentIds.length > 1) {
      if (typeof toast === 'function') toast('Este modelo só permite um aluno de cada vez.', 'error');
      return;
    }

    var ctx = buildDocumentContext(studentIds, options);
    if (!ctx.alunos.length) {
      if (typeof toast === 'function') toast('Seleciona pelo menos um aluno.', 'error');
      return;
    }

    try {
      var pdfPath = '/pdf-templates/' + config.filename;
      var res = await fetch(pdfPath);

      if (!res.ok) {
        throw new Error('Ficheiro PDF não encontrado em: ' + pdfPath);
      }

      var existingPdfBytes = await res.arrayBuffer();
      var pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);

      // Carregar fonte padrão para escrita direta se necessário
      try {
        ctx.embeddedFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      } catch (fontErr) {
        console.warn('Fonte padrão Helvetica não pôde ser embutida:', fontErr);
      }

      var form = pdfDoc.getForm();
      var fields = form.getFields();

      var fieldMapExact = {};
      var fieldMapLower = {};

      fields.forEach(function (f) {
        var rawName = f.getName();
        fieldMapExact[rawName] = f;
        fieldMapLower[rawName.toLowerCase()] = f;
      });

      // Atribuição com suporte para radio groups, checkboxes e text fields com limite de caracteres
      var setField = function (fieldName, value) {
        if (value == null || value === '') return;
        var field = fieldMapExact[fieldName] || fieldMapLower[String(fieldName).toLowerCase()];
        if (field) {
          try {
            if (typeof field.select === 'function' && typeof field.check !== 'function') {
              field.select(String(value));
            } else if (field.setText) {
              var strVal = String(value);
              var maxLen = typeof field.getMaxLength === 'function' ? field.getMaxLength() : undefined;
              if (maxLen && strVal.length > maxLen) {
                strVal = strVal.substring(0, maxLen);
              }
              // Ajuste de tamanho de fonte para colunas estreitas de pautas (ex: CampoTexto[1] para BI/CC que tem 43.4pt em C2Pratico e 60.3pt em C2Teorico)
              if (fieldName.includes('CampoTexto[1]')) {
                if (typeof field.setFontSize === 'function') {
                  field.setFontSize(strVal.length > 10 ? 6.5 : 7.5);
                }
              } else if (fieldName.includes('CampoTexto[3]') || fieldName.includes('CampoTexto[5]')) {
                if (typeof field.setFontSize === 'function') field.setFontSize(8);
              }
              field.setText(strVal);
            } else if (field.check && (value === true || String(value).toUpperCase() === 'X')) {
              field.check();
            }
          } catch (err) {
            console.warn('Erro ao atribuir campo (' + fieldName + '):', err);
          }
        } else {
          console.warn('Campo não encontrado no PDF: ' + fieldName);
        }
      };

      // Pesquisa Parcial
      var autoFillField = function (searchTerm, value) {
        if (value == null || value === '') return;
        var term = String(searchTerm).toLowerCase();

        for (var rawName in fieldMapLower) {
          if (rawName.includes(term)) {
            try {
              var field = fieldMapLower[rawName];
              if (typeof field.select === 'function' && typeof field.check !== 'function') {
                field.select(String(value));
              } else if (field.setText) {
                var strVal = String(value);
                var maxLen = typeof field.getMaxLength === 'function' ? field.getMaxLength() : undefined;
                if (maxLen && strVal.length > maxLen) {
                  strVal = strVal.substring(0, maxLen);
                }
                field.setText(strVal);
              } else if (field.check && (value === true || String(value).toUpperCase() === 'X')) {
                field.check();
              }
            } catch (e) {
              console.warn('Erro ao preencher por palavra-chave (' + rawName + '):', e);
            }
          }
        }
      };

      // Executa a função de preenchimento
      if (typeof config.fill === 'function') {
        var targetAluno = isSingleSelectionTemplate(templateKey) ? ctx.alunos[0] : ctx.alunos;
        await config.fill(setField, autoFillField, targetAluno, ctx, pdfDoc);
      }

      // Consolidação do PDF
      try {
        form.flatten();
      } catch (e) {
        console.warn('Flattening ignorado:', e);
      }

      var pdfBytes = await pdfDoc.save();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = config.filename.replace('.pdf', '') + '-preenchido.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (typeof toast === 'function') toast('PDF preenchido com sucesso!');
    } catch (err) {
      console.error('Erro ao preencher PDF:', err);
      if (typeof toast === 'function') toast('Erro ao gerar PDF: ' + err.message, 'error');
    }
  }

  function openAutoFillPdfModal(alunoId) {
    var selected = alunoId ? [alunoId] : [];
    var alunos = (window.state && window.state.alunos) || [];
    var templateKeys = Object.keys(OFFICIAL_PDF_TEMPLATES);
    var initialTemplateKey = templateKeys[0];

    function renderAlunoItem(aluno, inputType, checked) {
      var codigo = aluno.codigo != null ? aluno.codigo : aluno.id;
      var docNum = getAlunoNumeroDocumento(aluno);
      var nomeAttr = esc(String(aluno.nome || '').toLowerCase());
      var codigoAttr = esc(String(codigo).toLowerCase());
      var docAttr = esc(String(docNum).toLowerCase());
      var codigoLabel = aluno.codigo ? ' <span style="color:#888">(' + esc(aluno.codigo) + ')</span>' : '';
      var catBadge = aluno.categoria ? ' <span class="badge" style="font-size:11px; padding:2px 6px; background:#e2e8f0; color:#334155; border-radius:4px">' + esc(aluno.categoria) + '</span>' : '';
      var docBadge = docNum
        ? ' <span style="font-size:11px; padding:1px 6px; background:#f1f5f9; color:#475569; border-radius:4px; font-family:monospace;">CC: ' + esc(docNum) + '</span>'
        : ' <span style="font-size:11px; padding:1px 6px; background:#fef2f2; color:#b91c1c; border-radius:4px; font-weight:600;">(Sem CC)</span>';

      return '<label class="pdf-autofill-aluno-item" data-id="' + aluno.id + '" data-nome="' + nomeAttr + '" data-codigo="' + codigoAttr + '" data-doc="' + docAttr + '" ' +
        'style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:13px; cursor:pointer; padding:4px 6px; border-radius:4px; transition:background 0.15s;">' +
        '<input type="' + inputType + '" name="alunoId" value="' + aluno.id + '" ' + (checked ? 'checked' : '') + '> ' +
        '<span style="flex:1; font-weight:500;">' + esc(aluno.nome || 'Sem nome') + codigoLabel + '</span>' +
        docBadge +
        catBadge +
        '</label>';
    }

    function renderAlunosList(templateKey) {
      var inputType = isSingleSelectionTemplate(templateKey) ? 'radio' : 'checkbox';
      var seenSingleChecked = false;

      return alunos.map(function (aluno) {
        var checked = selected.indexOf(aluno.id) !== -1;
        if (inputType === 'radio') {
          if (checked && seenSingleChecked) checked = false;
          if (checked) seenSingleChecked = true;
        }
        return renderAlunoItem(aluno, inputType, checked);
      }).join('');
    }

    var hoje = new Date().toISOString().slice(0, 10);

    var modalHtml = `
      <form id="pdfAutofillForm">
        <div style="margin-bottom: 14px;">
          <label style="display:block; font-weight:bold; margin-bottom:6px; font-size:13px">Modelo de Documento Oficial</label>
          <select id="pdfAutofillTemplateSelect" name="templateKey" style="width:100%; padding:9px 12px; border-radius:6px; border:1px solid #cbd5e1; font-size:14px; background:#fff">
            ${templateKeys.map(function (key) {
              return '<option value="' + key + '">' + esc(OFFICIAL_PDF_TEMPLATES[key].label) + '</option>';
            }).join('')}
          </select>
        </div>

        <div id="pdfAutofillExtraOptions" style="display:none; margin-bottom:14px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px;">
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <div style="flex:1; min-width:140px;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:4px;">Data de Exame</label>
              <input type="date" name="dataExame" id="pdfAutofillDataExame" value="${hoje}" style="width:100%; padding:6px 8px; border-radius:4px; border:1px solid #cbd5e1; font-size:13px; box-sizing:border-box;">
            </div>
            <div id="pdfAutofillHoraWrap" style="flex:1; min-width:110px;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:4px;">Hora de Exame</label>
              <input type="time" name="horaExame" id="pdfAutofillHoraExame" style="width:100%; padding:6px 8px; border-radius:4px; border:1px solid #cbd5e1; font-size:13px; box-sizing:border-box;">
            </div>
            <div id="pdfAutofillMatriculaWrap" style="flex:1; min-width:130px; display:none;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:4px;">Matrícula (opcional)</label>
              <input type="text" name="matricula" id="pdfAutofillMatricula" placeholder="Ex: AA-00-BB" style="width:100%; padding:6px 8px; border-radius:4px; border:1px solid #cbd5e1; font-size:13px; box-sizing:border-box;">
            </div>
          </div>
          <div id="pdfAutofillTaxaHint" style="font-size:12px; color:#0369a1; margin-top:8px; font-weight:500;"></div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="font-weight:bold; font-size:13px">Selecionar Candidato(s)</label>
            <span id="pdfAutofillAlunoHint" style="font-size:12px; color:#64748b;"></span>
          </div>
          <input type="text" id="pdfAutofillSearch" placeholder="Pesquisar por nome, código ou CC..."
            style="width:100%; padding:8px 10px; margin-bottom:8px; border-radius:6px; border:1px solid #cbd5e1; box-sizing:border-box; font-size:13px">
          <div id="pdfAutofillAlunoList" style="max-height: 200px; overflow-y: auto; border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; background: #fff;">
            ${renderAlunosList(initialTemplateKey)}
          </div>
        </div>

        <!-- Painel para CC do Candidato quando 1 aluno está selecionado -->
        <div id="pdfAutofillSingleDocWrap" style="margin-top: 12px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
          <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#334155; margin-bottom:4px;">
            N.º do Documento de Identificação (BI / CC) do Candidato
          </label>
          <input type="text" id="pdfAutofillSingleDoc" placeholder="Ex: 12345678 9 ZZ4"
            style="width:100%; padding:7px 10px; border-radius:4px; border:1px solid #cbd5e1; font-size:13px; font-family:monospace; font-weight:600; box-sizing:border-box;">
          <div style="font-size:11px; color:#64748b; margin-top:4px;">
            O número de identificação será inserido no documento oficial e guardado na ficha do aluno.
          </div>
        </div>

        <!-- Painel de aviso e preenchimento de CCs em falta para múltiplos candidatos -->
        <div id="pdfAutofillMissingDocsWrap" style="display:none; margin-top:12px; padding:10px 12px; background:#fff7ed; border:1px solid #fed7aa; border-radius:6px;">
          <div style="font-size:12px; font-weight:700; color:#c2410c; margin-bottom:6px;">
            ⚠️ Os seguintes candidatos selecionados não têm CC guardado. Insira o N.º de CC para constar no PDF:
          </div>
          <div id="pdfAutofillMissingDocsList" style="display:flex; flex-direction:column; gap:6px;"></div>
        </div>

        <button type="submit" style="margin-top:16px; width:100%; padding:11px; background:#0066cc; color:#fff; border:none; border-radius:6px; font-weight:bold; font-size:14px; cursor:pointer">Gerar e Descarregar PDF</button>
      </form>
    `;

    if (typeof openModal === 'function') openModal('Imprimir Impresso Oficial', modalHtml);

    var form = document.getElementById('pdfAutofillForm');
    var listContainer = document.getElementById('pdfAutofillAlunoList');
    var searchInput = document.getElementById('pdfAutofillSearch');
    var templateSelect = document.getElementById('pdfAutofillTemplateSelect');
    var hintEl = document.getElementById('pdfAutofillAlunoHint');
    var extraOptionsEl = document.getElementById('pdfAutofillExtraOptions');
    var horaWrap = document.getElementById('pdfAutofillHoraWrap');
    var matriculaWrap = document.getElementById('pdfAutofillMatriculaWrap');
    var taxaHintEl = document.getElementById('pdfAutofillTaxaHint');

    function updateTemplateOptions(templateKey) {
      if (hintEl) {
        hintEl.textContent = isSingleSelectionTemplate(templateKey)
          ? 'Modelo individual (1 candidato)'
          : 'Pauta (seleção múltipla permitida)';
      }

      if (extraOptionsEl) {
        if (templateKey === 'modC2Teorico') {
          extraOptionsEl.style.display = 'block';
          if (horaWrap) horaWrap.style.display = 'block';
          if (matriculaWrap) matriculaWrap.style.display = 'none';
          if (taxaHintEl) taxaHintEl.textContent = 'Taxa regulamentar: 16,00 € por candidato (calculada no total)';
        } else if (templateKey === 'modC2Pratico') {
          extraOptionsEl.style.display = 'block';
          if (horaWrap) horaWrap.style.display = 'none';
          if (matriculaWrap) matriculaWrap.style.display = 'block';
          if (taxaHintEl) taxaHintEl.textContent = 'Taxa regulamentar: 31,50 € por candidato (calculada no total)';
        } else {
          extraOptionsEl.style.display = 'none';
        }
      }
      updateDocInputs();
    }

    function updateDocInputs() {
      if (!form) return;
      var checkedBoxes = form.querySelectorAll('input[name="alunoId"]:checked');
      var selIds = [];
      checkedBoxes.forEach(function (b) { selIds.push(Number(b.value)); });

      var singleWrap = document.getElementById('pdfAutofillSingleDocWrap');
      var singleInput = document.getElementById('pdfAutofillSingleDoc');
      var missingWrap = document.getElementById('pdfAutofillMissingDocsWrap');
      var missingList = document.getElementById('pdfAutofillMissingDocsList');

      if (selIds.length === 1) {
        if (singleWrap) singleWrap.style.display = 'block';
        if (missingWrap) missingWrap.style.display = 'none';
        var singleAluno = typeof findAluno === 'function' ? findAluno(selIds[0]) : (alunos || []).find(function (a) { return a.id === selIds[0]; });
        if (singleInput && singleAluno) {
          singleInput.value = getAlunoNumeroDocumento(singleAluno);
          if (!singleInput.value) {
            singleInput.style.borderColor = '#f59e0b';
            singleInput.placeholder = '⚠️ Digite aqui o CC do aluno (ex: 12345678 9 ZZ4)';
          } else {
            singleInput.style.borderColor = '#cbd5e1';
            singleInput.placeholder = 'Ex: 12345678 9 ZZ4';
          }
        }
      } else if (selIds.length > 1) {
        if (singleWrap) singleWrap.style.display = 'none';
        var missingAlunos = selIds.map(function (id) {
          return typeof findAluno === 'function' ? findAluno(id) : (alunos || []).find(function (a) { return a.id === id; });
        }).filter(function (a) {
          return a && !getAlunoNumeroDocumento(a);
        });

        if (missingAlunos.length > 0) {
          if (missingWrap) missingWrap.style.display = 'block';
          if (missingList) {
            missingList.innerHTML = missingAlunos.map(function (ma) {
              return '<div style="display:flex; align-items:center; gap:8px;">' +
                '<span style="font-size:12px; font-weight:600; min-width:140px; color:#1e293b;">' + esc(ma.nome || 'Aluno') + ':</span>' +
                '<input type="text" class="pdf-missing-doc-input" data-alunoid="' + ma.id + '" placeholder="Ex: 12345678 9 ZZ4" ' +
                'style="flex:1; padding:5px 8px; border-radius:4px; border:1px solid #cbd5e1; font-size:12px; font-family:monospace; box-sizing:border-box;">' +
                '</div>';
            }).join('');
          }
        } else {
          if (missingWrap) missingWrap.style.display = 'none';
        }
      } else {
        if (singleWrap) singleWrap.style.display = 'none';
        if (missingWrap) missingWrap.style.display = 'none';
      }
    }

    function applySearchFilter() {
      if (!listContainer || !searchInput) return;
      var term = searchInput.value.trim().toLowerCase();
      var items = listContainer.querySelectorAll('.pdf-autofill-aluno-item');
      items.forEach(function (item) {
        var nome = item.getAttribute('data-nome') || '';
        var codigo = item.getAttribute('data-codigo') || '';
        var doc = item.getAttribute('data-doc') || '';
        var visible = !term || nome.indexOf(term) !== -1 || codigo.indexOf(term) !== -1 || doc.indexOf(term) !== -1;
        item.style.display = visible ? 'flex' : 'none';
      });
    }

    if (templateSelect && listContainer) {
      templateSelect.addEventListener('change', function () {
        listContainer.innerHTML = renderAlunosList(templateSelect.value);
        updateTemplateOptions(templateSelect.value);
        applySearchFilter();
      });
    }

    if (listContainer) {
      listContainer.addEventListener('change', function () {
        updateDocInputs();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', applySearchFilter);
    }

    updateTemplateOptions(initialTemplateKey);
    updateDocInputs();

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var checkedBoxes = form.querySelectorAll('input[name="alunoId"]:checked');
        var selectedIds = [];
        checkedBoxes.forEach(function (box) { selectedIds.push(Number(box.value)); });
        var templateKey = templateSelect.value;

        if (!selectedIds.length) {
          if (typeof toast === 'function') toast('Seleciona pelo menos um aluno.', 'error');
          return;
        }

        if (isSingleSelectionTemplate(templateKey) && selectedIds.length > 1) {
          if (typeof toast === 'function') toast('Este modelo só permite um aluno de cada vez.', 'error');
          return;
        }

        var options = {
          dataExame: form.querySelector('#pdfAutofillDataExame')?.value || null,
          horaExame: form.querySelector('#pdfAutofillHoraExame')?.value || null,
          matricula: form.querySelector('#pdfAutofillMatricula')?.value || null,
          documentos: {}
        };

        if (selectedIds.length === 1) {
          var sDoc = (form.querySelector('#pdfAutofillSingleDoc')?.value || '').trim();
          if (sDoc) {
            options.documentos[selectedIds[0]] = sDoc;
            options.numeroDocumento = sDoc;
          }
        } else {
          var missingInputs = form.querySelectorAll('.pdf-missing-doc-input');
          missingInputs.forEach(function (inp) {
            var aid = Number(inp.getAttribute('data-alunoid'));
            var v = (inp.value || '').trim();
            if (aid && v) {
              options.documentos[aid] = v;
            }
          });
        }

        // Atualizar estado em memória e persistir na base de dados se foram introduzidos novos CCs
        Object.keys(options.documentos).forEach(function (aidStr) {
          var aid = Number(aidStr);
          var novoCC = options.documentos[aid];
          var a = typeof findAluno === 'function' ? findAluno(aid) : (alunos || []).find(function (x) { return x.id === aid; });
          if (a && novoCC) {
            a.numeroDocumento = novoCC;
            if (window.api && typeof window.api === 'function') {
              window.api('PUT', '/api/alunos/' + a.id, Object.assign({}, a, { numeroDocumento: novoCC })).catch(function (err) {
                console.warn('Não foi possível gravar o CC na BD para o aluno ' + aid + ':', err);
              });
            }
          }
        });

        gerarDocumentoAutopreenchido(selectedIds, templateKey, options);
        if (typeof closeModal === 'function') closeModal();
      });
    }
  }

  window.openAutoFillPdfModal = openAutoFillPdfModal;
  window.gerarDocumentoAutopreenchido = gerarDocumentoAutopreenchido;
})();