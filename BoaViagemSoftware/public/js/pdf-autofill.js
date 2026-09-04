(function () {
  /**
   * MAPA DE CAMPOS EDITÁVEIS DOS MODELOS IMT / SCTT
   * -------------------------------------------------------------
   * CORREÇÕES (verificadas campo a campo contra os PDFs reais):
   *
   * 1) Mod1_IMT: os nomes internos dos checkboxes de "2 - CATEGORIAS"
   *    NÃO correspondem à categoria impressa (ex: o campo "catB[0]"
   *    é visualmente a caixa "A1", não "B"). Foi criado
   *    CATEGORY_FIELD_MAP com o mapeamento real (confirmado por
   *    inspeção das coordenadas + tooltip de cada campo no PDF).
   *
   * 2) Mod1_IMT: o campo "requerimento[0]" (LICENÇA DE APRENDIZAGEM /
   *    LICENÇA DE CONDUÇÃO / CARTA DE CONDUÇÃO / ...) nunca era
   *    preenchido. É um "radio group" (um único campo com várias
   *    opções via valor de exportação /0.../11), não uma checkbox
   *    normal — precisa de field.select(valor), não field.check().
   *    A função setField agora trata isso automaticamente.
   *
   * 3) C3 / C2 Teórico / C2 Prático: "Linha3[0]" a "Linha6[0]" NÃO
   *    são campos da escola (Nome/NIF/"O Diretor da Escola" são
   *    texto estático no PDF, sem campo preenchível associado) —
   *    são as 4 primeiras linhas da própria tabela de candidatos.
   *    O código antigo estava a "gastar" essas 4 linhas com dados
   *    da escola, perdendo capacidade e desalinhando a tabela.
   *    Agora TODAS as linhas (Linha3..Linha6 + Linha7[0..N]) são
   *    tratadas como linhas de candidatos:
   *      - C3: 18 linhas
   *      - C2 Teórico: 16 linhas
   *      - C2 Prático: 16 linhas
   *
   * 4) C2 Teórico / C2 Prático: "CampoTexto[3]" de cada linha é o
   *    "N.º LA" (nº da licença de aprendizagem), NÃO a categoria.
   *    A categoria é assinalada através das checkboxes próprias
   *    ("CaixaVerificação[n]"), mapeadas por CATEGORY_CHECKBOX_MAP_*.
   *
   * Como a escola (Nome/NIF/Diretor) não tem campos preenchíveis
   * nestes 3 modelos, essa informação continua a ter de ser
   * preenchida/assinada à mão (é assim que o impresso oficial foi
   * desenhado).
   *
   * 5) NOVO: Modelo 1 (mod1IMT) e Mod. C3 (modC3) só aceitam UM
   *    aluno de cada vez (são documentos individuais/por requerente).
   *    Os restantes modelos continuam a aceitar seleção múltipla.
   *    A lista de alunos no modal passa a suportar pesquisa por
   *    nome ou código, e fica limitada em altura (scroll interno)
   *    para não deformar o modal quando há muitos alunos.
   */

  // Mapeia a categoria (como aparece nos dados do aluno) para o
  // nome real do campo no Mod1_IMT. Verificado por posição (x,y)
  // de cada widget + tooltip (/TU) no PDF original.
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

  // Valores a usar em field.select() para o radio group
  // "requerimento[0]" (topo do Mod1_IMT). Alterar aqui se precisar
  // de gerar outro tipo de requerimento (por omissão gera
  // "CARTA DE CONDUÇÃO").
  // IMPORTANTE: estes NÃO são os valores de exportação brutos do PDF
  // (/0../11) — a biblioteca pdf-lib usa a sua própria indexação
  // 1-based (ordem dos widgets/"kids" do campo). Os valores abaixo
  // foram confirmados empiricamente com pdf-lib (select('1')..
  // select('12')) e a verificação visual de cada opção resultante.
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

  // Ordem real das checkboxes de categoria na tabela do C2 - Mod. C1
  // (Prova Teórica): AM | B/B1 | A/A1/A2 c/B | A/A1/A2 s/B | C/C1 | D/D1 | G2/G3
  const CATEGORY_CHECKBOX_MAP_TEORICO = {
    'AM': 0,
    'B': 1, 'B1': 1,
    // Ambíguo no impresso original (depende de o candidato já ter ou
    // não a categoria B); por omissão assinala "s/B".
    'A': 3, 'A1': 3, 'A2': 3,
    'C': 4, 'C1': 4,
    'D': 5, 'D1': 5,
    'G2': 6, 'G3': 6
  };

  // Ordem real das checkboxes de categoria na tabela do C2 - Mod. C2
  // (Prova Prática): AM|A1|A2|A|B1|B|C1|C|D1|D|E|G2|G3
  const CATEGORY_CHECKBOX_MAP_PRATICO = {
    'AM': 0, 'A1': 1, 'A2': 2, 'A': 3, 'B1': 4, 'B': 5,
    'C1': 6, 'C': 7, 'D1': 8, 'D': 9, 'E': 10, 'G2': 11, 'G3': 12
  };

  // Todas as linhas da tabela de candidatos (Linha3..Linha6 são
  // linhas normais da tabela, não campos da escola).
  function buildRowNames(extraCount) {
    var rows = ['Linha3[0]', 'Linha4[0]', 'Linha5[0]', 'Linha6[0]'];
    for (var i = 0; i < extraCount; i++) {
      rows.push('Linha7[' + i + ']');
    }
    return rows;
  }
  const C3_ROWS = buildRowNames(14);        // 18 linhas no total
  const C2_ROWS = buildRowNames(12);        // 16 linhas no total (Teórico e Prático)

  // Modelos que representam documentos individuais (por requerente):
  // só é permitido selecionar UM aluno de cada vez.
  const SINGLE_SELECTION_TEMPLATES = ['mod1IMT', 'modC3'];

  function isSingleSelectionTemplate(templateKey) {
    return SINGLE_SELECTION_TEMPLATES.indexOf(templateKey) !== -1;
  }

  const OFFICIAL_PDF_TEMPLATES = {
    // 1. Modelo 1 - IMT (Requerimento do Condutor)
    mod1IMT: {
      label: 'Modelo 1 - IMT (Requerimento)',
      filename: 'Mod1_IMT.pdf',
      fill: function (setField, auto, aluno, ctx) {
        if (!aluno) return;
        const BASE = 'F[0].Page_1[0].';

        // --- Tipo de requerimento (topo do impresso) ---
        // Por omissão "CARTA DE CONDUÇÃO"; mude para outro valor de
        // MOD1_REQUERIMENTO_VALUES se necessário.
        setField(BASE + 'requerimento[0]', MOD1_REQUERIMENTO_VALUES.CARTA_CONDUCAO);

        // --- Motivo do Pedido (Padrão: Emissão de Carta) ---
        setField(BASE + 'emissao[0]', true);

        // --- Categorias (usa o mapa corrigido, não "cat"+categoria) ---
        var cat = (aluno.categoria || 'B').toUpperCase().replace(/\s+/g, '');
        var catField = MOD1_CATEGORY_FIELD_MAP[cat];
        if (catField) {
          setField(BASE + catField, true);
        } else {
          console.warn('Categoria desconhecida para o Mod1-IMT: ' + cat);
        }

        // --- Dados Pessoais do Requerente ---
        setField(BASE + 'apelido[0]', aluno.apelido || '');
        setField(BASE + 'nome1[0]', aluno.nome || '');
        setField(BASE + 'dataNascimento[0]', ctx.fmtDate(aluno.dataNascimento) || aluno.dataNascimento || '');
        setField(BASE + 'naturalidade[0]', aluno.naturalidade || '');
        setField(BASE + 'nacionalidade[0]', aluno.nacionalidade || 'Portuguesa');

        // --- Documento de Identificação (BI / CC) ---
        setField(BASE + 'tipo[0]', aluno.tipoDocumento || 'CC');
        setField(BASE + 'numero[0]', aluno.numeroDocumento || '');
        setField(BASE + 'validade[0]', ctx.fmtDate(aluno.validadeDocumento) || aluno.validadeDocumento || '');
        setField(BASE + 'emissorDI[0]', aluno.emissorDocumento || 'IRN');

        // --- NIF e Contactos ---
        setField(BASE + 'nContribuinte[0]', aluno.nif || '');
        setField(BASE + 'contribuintefinal[0]', aluno.nif || '');
        setField(BASE + 'telemovel[0]', aluno.telemovel || aluno.telefone || '');
        setField(BASE + 'email[0]', aluno.email || '');

        // --- Morada ---
        setField(BASE + 'moradaActual[0]', aluno.morada || '');
        setField(BASE + 'localidadeActual[0]', aluno.localidade || '');

        // Código Postal (Divide "4700-000" em 4 e 3 dígitos)
        if (aluno.codigoPostal && aluno.codigoPostal.includes('-')) {
          var cpPartes = aluno.codigoPostal.split('-');
          setField(BASE + 'codPostal4[0]', cpPartes[0] || '');
          setField(BASE + 'codPostal3[0]', cpPartes[1] || '');
        } else if (aluno.codigoPostal) {
          setField(BASE + 'codPostal4[0]', aluno.codigoPostal.substring(0, 4));
          setField(BASE + 'codPostal3[0]', aluno.codigoPostal.substring(4, 7));
        } else {
          setField(BASE + 'codPostal4[0]', '');
          setField(BASE + 'codPostal3[0]', '');
        }
        setField(BASE + 'localidadeCP[0]', aluno.localidadePostal || aluno.localidade || '');

        // --- Data do Pedido ---
        setField(BASE + 'dataPedido[0]', ctx.dataHoje);
      }
    },

    // 2. SCTT - Mod. C3 (Licença de Aprendizagem)
    modC3: {
      label: 'SCTT - Mod. C3 (Licença de Aprendizagem)',
      filename: 'C3.pdf',
      fill: function (setField, auto, alunos, ctx) {
        const BASE = 'formulário1[0].#subform[0].Tabela1[0].';

        // NOTA: "Nome"/"NIF"/"O Diretor da Escola" (secção
        // "1 - ESCOLA DE CONDUÇÃO") são texto estático no PDF, sem
        // campo preenchível — têm de ser assinados/preenchidos à mão.

        // Tabela de Alunos (até 18 linhas: Linha3..Linha6 + Linha7[0..13])
        for (var i = 0; i < C3_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C3_ROWS[i];

          setField(BASE + linhaKey + '.CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(BASE + linhaKey + '.CampoTexto[1]', aluno ? (aluno.numeroDocumento || '') : '');
          setField(BASE + linhaKey + '.CampoTexto[2]', aluno ? '0,00' : '');
        }
      }
    },

    // 3. SCTT - Mod. C1 (Pauta Exame Teórico)
    modC2Teorico: {
      label: 'SCTT - Mod. C1 (Pauta Exame Teórico)',
      filename: 'C2Teorico.pdf',
      fill: function (setField, auto, alunos, ctx) {
        const BASE = 'formulário1[0].#subform[0].';

        // "2 - DATA DE EXAME": CampoData = data; CampoDataHora1 é o
        // campo da "Hora" (não outra data), por isso não usamos
        // ctx.dataHoje aí.
        setField(BASE + '#area[0].CampoData[0]', ctx.dataHoje);

        // NOTA: "1 - ESCOLA DE CONDUÇÃO" (Nome/NIF/Diretor) é texto
        // estático, sem campo preenchível — preencher à mão.

        // Tabela de Alunos (até 16 linhas: Linha3..Linha6 + Linha7[0..11])
        for (var i = 0; i < C2_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C2_ROWS[i];
          var rowBase = BASE + 'Tabela1[0].' + linhaKey + '.';

          setField(rowBase + 'CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(rowBase + 'CampoTexto[1]', aluno ? (aluno.numeroDocumento || '') : '');
          setField(rowBase + 'CampoTexto[2]', aluno ? (aluno.nif || '') : '');
          // CampoTexto[3] = "N.º LA" (licença de aprendizagem), NÃO categoria
          setField(rowBase + 'CampoTexto[3]', aluno ? (aluno.numeroLA || '') : '');
          setField(rowBase + 'CampoTexto[4]', aluno ? '0,00' : '');

          if (aluno) {
            var cat = (aluno.categoria || 'B').toUpperCase().replace(/\s+/g, '');
            var idx = CATEGORY_CHECKBOX_MAP_TEORICO[cat];
            if (idx !== undefined) {
              setField(rowBase + 'CaixaVerificação[' + idx + ']', true);
            } else {
              console.warn('Categoria desconhecida (C2 Teórico): ' + cat);
            }
          }
        }
      }
    },

    // 4. SCTT - Mod. C2 (Pauta Exame Prático)
    modC2Pratico: {
      label: 'SCTT - Mod. C2 (Pauta Exame Prático)',
      filename: 'C2Pratico.pdf',
      fill: function (setField, auto, alunos, ctx) {
        const BASE = 'formulário1[0].#subform[0].';

        setField(BASE + '#area[0].CampoData[0]', ctx.dataHoje);

        // NOTA: "1 - ESCOLA DE CONDUÇÃO" (Nome/NIF/Diretor) é texto
        // estático, sem campo preenchível — preencher à mão.

        // Tabela de Alunos (até 16 linhas: Linha3..Linha6 + Linha7[0..11])
        for (var i = 0; i < C2_ROWS.length; i++) {
          var aluno = alunos[i];
          var linhaKey = C2_ROWS[i];
          var rowBase = BASE + 'Tabela1[0].' + linhaKey + '.';

          setField(rowBase + 'CampoTexto[0]', aluno ? (aluno.nome || '') : '');
          setField(rowBase + 'CampoTexto[1]', aluno ? (aluno.numeroDocumento || '') : '');
          setField(rowBase + 'CampoTexto[2]', aluno ? (aluno.nif || '') : '');
          // CampoTexto[3] = "N.º LA" (licença de aprendizagem), NÃO categoria
          setField(rowBase + 'CampoTexto[3]', aluno ? (aluno.numeroLA || '') : '');
          setField(rowBase + 'CampoTexto[4]', aluno ? '0,00' : '');
          // CampoTexto[5] = MATRÍCULA do veículo de exame
          setField(rowBase + 'CampoTexto[5]', aluno ? (aluno.matricula || '') : '');

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
    if (d.includes('/')) return d; // Já está formatada
    var parts = d.split('-');
    if (parts.length === 3) {
      return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return d;
  }

  function buildDocumentContext(studentIds) {
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
      alunos: alunos
    };
  }

  async function gerarDocumentoAutopreenchido(studentIds, templateKey) {
    var config = OFFICIAL_PDF_TEMPLATES[templateKey];
    if (!config) return;

    if (isSingleSelectionTemplate(templateKey) && studentIds.length > 1) {
      if (typeof toast === 'function') toast('Este modelo só permite um aluno de cada vez.', 'error');
      return;
    }

    var ctx = buildDocumentContext(studentIds);
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
      var form = pdfDoc.getForm();

      var fields = form.getFields();
      console.log('=== LISTA DE CAMPOS EDITÁVEIS DETETADOS NO PDF (' + fields.length + ') ===');

      var fieldMapExact = {};
      var fieldMapLower = {};

      fields.forEach(function (f) {
        var rawName = f.getName();
        fieldMapExact[rawName] = f;
        fieldMapLower[rawName.toLowerCase()] = f;
      });

      // Função 1: Atribuição Direta
      // Agora também trata radio groups (ex: "requerimento[0]" do
      // Mod1-IMT), que usam field.select(valorExportacao) em vez de
      // field.check().
      var setField = function (fieldName, value) {
        if (value == null || value === '') return;
        var field = fieldMapExact[fieldName] || fieldMapLower[String(fieldName).toLowerCase()];
        if (field) {
          try {
            if (typeof field.select === 'function' && typeof field.check !== 'function') {
              // Radio group: value é o valor de exportação (ex: '2')
              field.select(String(value));
            } else if (field.setText) {
              field.setText(String(value));
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

      // Função 2: Pesquisa Parcial
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
                field.setText(String(value));
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
        // Envia a lista de alunos inteira para modelos de pauta (modC) e apenas o primeiro aluno para requerimentos individuais (mod1IMT)
        var targetAluno = templateKey.startsWith('modC') ? ctx.alunos : ctx.alunos[0];
        config.fill(setField, autoFillField, targetAluno, ctx);
      }

      // Consolida o PDF
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

    // Gera o HTML de uma linha da lista de alunos, com data-attributes
    // para permitir a pesquisa por nome/código no cliente.
    function renderAlunoItem(aluno, inputType, checked) {
      var codigo = aluno.codigo != null ? aluno.codigo : aluno.id;
      var nomeAttr = esc(String(aluno.nome || '').toLowerCase());
      var codigoAttr = esc(String(codigo).toLowerCase());
      var codigoLabel = aluno.codigo ? ' <span style="color:#888">(' + esc(aluno.codigo) + ')</span>' : '';

      return '<label class="pdf-autofill-aluno-item" data-nome="' + nomeAttr + '" data-codigo="' + codigoAttr + '" ' +
        'style="display:block; margin-bottom:4px; font-size:13px">' +
        '<input type="' + inputType + '" name="alunoId" value="' + aluno.id + '" ' + (checked ? 'checked' : '') + '> ' +
        esc(aluno.nome || 'Sem nome') + codigoLabel +
        '</label>';
    }

    // Reconstrói a lista de alunos consoante o modelo escolhido:
    // radio (seleção única) para mod1IMT/modC3, checkbox (seleção
    // múltipla) para os restantes.
    function renderAlunosList(templateKey) {
      var inputType = isSingleSelectionTemplate(templateKey) ? 'radio' : 'checkbox';
      var seenSingleChecked = false;

      return alunos.map(function (aluno) {
        var checked = selected.indexOf(aluno.id) !== -1;
        if (inputType === 'radio') {
          // Garante no máximo um pré-selecionado quando se muda para
          // um modelo de seleção única.
          if (checked && seenSingleChecked) checked = false;
          if (checked) seenSingleChecked = true;
        }
        return renderAlunoItem(aluno, inputType, checked);
      }).join('');
    }

    var modalHtml = `
      <form id="pdfAutofillForm">
        <div style="margin-bottom: 12px;">
          <label style="display:block; font-weight:bold; margin-bottom:5px;">Modelo de Documento Oficial</label>
          <select id="pdfAutofillTemplateSelect" name="templateKey" style="width:100%; padding:8px; border-radius:4px; border:1px solid #ccc">
            ${templateKeys.map(function (key) {
              return '<option value="' + key + '">' + esc(OFFICIAL_PDF_TEMPLATES[key].label) + '</option>';
            }).join('')}
          </select>
        </div>
        <div>
          <label style="display:block; font-weight:bold; margin-bottom:5px;">Selecionar Aluno(s)</label>
          <input type="text" id="pdfAutofillSearch" placeholder="Pesquisar por nome ou código..."
            style="width:100%; padding:8px; margin-bottom:6px; border-radius:4px; border:1px solid #ccc; box-sizing:border-box;">
          <div id="pdfAutofillAlunoHint" style="font-size:12px; color:#888; margin-bottom:6px;"></div>
          <div id="pdfAutofillAlunoList" style="max-height: 220px; overflow-y: auto; border: 1px solid #ccc; padding: 8px; border-radius: 4px; background: #fafafa;">
            ${renderAlunosList(initialTemplateKey)}
          </div>
        </div>
        <button type="submit" style="margin-top:15px; width:100%; padding:10px; background:#0066cc; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer">Gerar e Descarregar PDF</button>
      </form>
    `;

    if (typeof openModal === 'function') openModal('Imprimir Impresso Oficial', modalHtml);

    var form = document.getElementById('pdfAutofillForm');
    var listContainer = document.getElementById('pdfAutofillAlunoList');
    var searchInput = document.getElementById('pdfAutofillSearch');
    var templateSelect = document.getElementById('pdfAutofillTemplateSelect');
    var hintEl = document.getElementById('pdfAutofillAlunoHint');

    function updateHint(templateKey) {
      if (!hintEl) return;
      hintEl.textContent = isSingleSelectionTemplate(templateKey)
        ? 'Este modelo permite apenas um aluno.'
        : 'Podes selecionar um ou mais alunos.';
    }

    // Aplica o termo de pesquisa (nome ou código) aos itens já
    // renderizados, sem precisar de voltar a construir a lista.
    function applySearchFilter() {
      if (!listContainer || !searchInput) return;
      var term = searchInput.value.trim().toLowerCase();
      var items = listContainer.querySelectorAll('.pdf-autofill-aluno-item');
      items.forEach(function (item) {
        var nome = item.getAttribute('data-nome') || '';
        var codigo = item.getAttribute('data-codigo') || '';
        var visible = !term || nome.indexOf(term) !== -1 || codigo.indexOf(term) !== -1;
        item.style.display = visible ? 'block' : 'none';
      });
    }

    if (templateSelect && listContainer) {
      templateSelect.addEventListener('change', function () {
        listContainer.innerHTML = renderAlunosList(templateSelect.value);
        updateHint(templateSelect.value);
        applySearchFilter();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', applySearchFilter);
    }

    updateHint(initialTemplateKey);

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

        gerarDocumentoAutopreenchido(selectedIds, templateKey);
        if (typeof closeModal === 'function') closeModal();
      });
    }
  }

  window.openAutoFillPdfModal = openAutoFillPdfModal;
  window.gerarDocumentoAutopreenchido = gerarDocumentoAutopreenchido;
})();