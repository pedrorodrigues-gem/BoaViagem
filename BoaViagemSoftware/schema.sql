/* ==========================================================
   RotaCerta — Schema SQL Server (multi-tenant)
   Cada "escola" (autoescola) é um inquilino isolado por escola_id.
   Todas as tabelas nascem vazias — não há dados de exemplo aqui,
   só a estrutura. Ver 02_seed_procedure.sql para o catálogo por
   omissão (produtos, requisitos, espaços, composição da carta)
   que é inserido automaticamente quando uma escola é criada.
   ========================================================== */

IF DB_ID('BoaViagem') IS NULL
BEGIN
    CREATE DATABASE BoaViagem;
END
GO

USE BoaViagem;
GO

/* ---------- Escolas (tenants) ---------- */
CREATE TABLE escolas (
    id                      INT IDENTITY(1,1) PRIMARY KEY,
    nome                    NVARCHAR(200)   NOT NULL,
    username                NVARCHAR(100)   NOT NULL,
    password_hash           NVARCHAR(200)   NOT NULL,
    email                   NVARCHAR(200)   NULL,
    telefone                NVARCHAR(50)    NULL,
    nipc                    NVARCHAR(30)    NULL,
    morada                  NVARCHAR(300)   NULL,
    numero_licenca_imt      NVARCHAR(50)    NULL,
    nome_diretor            NVARCHAR(200)   NULL,
    data_criacao            DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),

    -- Integração Cegid Primavera (antigo escola.primavera)
    primavera_ativo             BIT             NOT NULL DEFAULT 0,
    primavera_base_url          NVARCHAR(300)   NULL,
    primavera_empresa           NVARCHAR(50)    NULL DEFAULT 'ESCOLAS',
    primavera_client_id         NVARCHAR(200)   NULL,
    primavera_api_key           NVARCHAR(500)   NULL,   -- guardar cifrado na aplicação, nunca em claro
    primavera_serie             NVARCHAR(20)    NULL DEFAULT '1',
    primavera_modo_pag          NVARCHAR(20)    NULL DEFAULT 'PGNUM',
    primavera_conta_bancaria    NVARCHAR(20)    NULL DEFAULT '01',
    primavera_filial            NVARCHAR(20)    NULL DEFAULT '000',
    primavera_taxa_iva_default  DECIMAL(5,2)    NULL DEFAULT 23,
    primavera_armazem           NVARCHAR(20)    NULL DEFAULT 'A1',
    primavera_artigo_formacao   NVARCHAR(50)    NULL DEFAULT 'FORMACAO',

    CONSTRAINT uq_escolas_username UNIQUE (username)
);
GO

/* ---------- Utilizadores (logins) por escola ---------- */
CREATE TABLE users (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome            NVARCHAR(200) NOT NULL,
    username        NVARCHAR(100) NOT NULL,
    password_hash   NVARCHAR(200) NOT NULL,
    role            NVARCHAR(20)  NOT NULL CHECK (role IN ('super','admin','instrutor','aluno')),
    instrutor_id    INT NULL,       -- FK para instrutores, adicionada depois (ordem de criação de tabelas)
    CONSTRAINT uq_users_escola_username UNIQUE (escola_id, username)
);
GO

/* ---------- Espaços físicos (locais/polos da escola) ---------- */
CREATE TABLE espacos (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome            NVARCHAR(150) NOT NULL,
    observacoes     NVARCHAR(500) NULL,
    CONSTRAINT uq_espacos_escola_nome UNIQUE (escola_id, nome)
);
GO

/* ---------- Pessoas (registo unificado de identidade) ---------- */
CREATE TABLE pessoas (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    escola_id           INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome                NVARCHAR(200) NOT NULL,
    tipo_pessoa         NVARCHAR(20)  NOT NULL CHECK (tipo_pessoa IN ('aluno','instrutor')),
    origem_collection   NVARCHAR(30)  NULL,
    origem_id           INT           NULL,
    email               NVARCHAR(200) NULL,
    telefone            NVARCHAR(50)  NULL,
    estado              NVARCHAR(30)  NULL DEFAULT 'Ativo'
);
GO

/* ---------- Instrutores ---------- */
CREATE TABLE instrutores (
    id                              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id                       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    pessoa_id                       INT NULL REFERENCES pessoas(id),
    nome                            NVARCHAR(200) NOT NULL,
    email                           NVARCHAR(200) NULL,
    telefone                        NVARCHAR(50)  NULL,
    estado                          NVARCHAR(30)  NOT NULL DEFAULT 'Ativo',
    cargo                           NVARCHAR(50)  NULL,
    nif                             NVARCHAR(20)  NULL,
    titulo_profissional_numero      NVARCHAR(50)  NULL,
    titulo_profissional_validade    DATE          NULL,
    foto                            VARBINARY(MAX) NULL
);
GO

ALTER TABLE users ADD CONSTRAINT fk_users_instrutor FOREIGN KEY (instrutor_id) REFERENCES instrutores(id);
GO

/* Categorias que cada instrutor pode lecionar (era um array em JS) */
CREATE TABLE instrutor_categorias (
    instrutor_id    INT NOT NULL REFERENCES instrutores(id) ON DELETE CASCADE,
    categoria       NVARCHAR(10) NOT NULL,
    PRIMARY KEY (instrutor_id, categoria)
);
GO

/* ---------- Veículos ---------- */
CREATE TABLE veiculos (
    id                          INT IDENTITY(1,1) PRIMARY KEY,
    escola_id                   INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    matricula                   NVARCHAR(20) NOT NULL,
    marca                       NVARCHAR(50) NULL,
    modelo                      NVARCHAR(50) NULL,
    categoria                   NVARCHAR(10) NULL,
    estado                      NVARCHAR(30) NOT NULL DEFAULT 'Disponível',
    inspecao_valida             DATE NULL,
    seguro_instrucao_validade   DATE NULL,
    data_afetacao_escola        DATE NULL
);
GO

/* ---------- Catálogo de produtos/serviços (por escola) ----------
   Seed automático em 02_seed_procedure.sql, editável depois em
   Configurações. */
CREATE TABLE produtos (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    codigo          NVARCHAR(20)  NOT NULL,
    descricao       NVARCHAR(200) NOT NULL,
    categoria       NVARCHAR(50)  NOT NULL DEFAULT 'Diversos',
    valor           DECIMAL(10,2) NOT NULL DEFAULT 0,
    descontavel     BIT           NOT NULL DEFAULT 0,
    taxa_iva        DECIMAL(5,2)  NOT NULL DEFAULT 23
);
GO

/* ---------- Requisitos mínimos por categoria de carta ---------- */
CREATE TABLE requisitos (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    escola_id           INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    categoria           NVARCHAR(10) NOT NULL,
    horas_teoricas_min  DECIMAL(6,2) NULL,
    horas_praticas_min  DECIMAL(6,2) NULL,
    km_pratica_min      DECIMAL(8,2) NULL,
    CONSTRAINT uq_requisitos_escola_categoria UNIQUE (escola_id, categoria)
);
GO

/* ---------- Composição da carta: planos de preço por categoria ---------- */
CREATE TABLE planos_carta (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    categoria       NVARCHAR(10)  NOT NULL,
    nome            NVARCHAR(100) NOT NULL DEFAULT 'Standard'
);
GO

CREATE TABLE plano_carta_linhas (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    plano_carta_id  INT NOT NULL REFERENCES planos_carta(id) ON DELETE CASCADE,
    produto_id      INT NOT NULL REFERENCES produtos(id),
    quantidade      INT NOT NULL DEFAULT 1
);
GO

/* ---------- Alunos ---------- */
CREATE TABLE alunos (
    id                          INT IDENTITY(1,1) PRIMARY KEY,
    escola_id                   INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    pessoa_id                   INT NULL REFERENCES pessoas(id),
    espaco_id                   INT NOT NULL REFERENCES espacos(id),
    numero_aluno                INT NULL,           -- por omissão = id, mantido editável
    nome                        NVARCHAR(200) NOT NULL,
    email                       NVARCHAR(200) NULL,
    telefone                    NVARCHAR(50)  NULL,
    categoria                   NVARCHAR(10)  NULL,
    estado                      NVARCHAR(30)  NOT NULL DEFAULT 'Ativo',
    data_inscricao               DATE NULL,
    aulas_teoricas               INT  NULL,
    aulas_praticas                INT  NULL,
    notas                       NVARCHAR(MAX) NULL,
    data_nascimento              DATE NULL,
    nif                          NVARCHAR(20) NULL,
    tipo_documento                NVARCHAR(10) NULL,
    numero_documento              NVARCHAR(50) NULL,
    validade_documento            DATE NULL,
    morada                       NVARCHAR(300) NULL,
    codigo_postal                 NVARCHAR(20)  NULL,
    localidade                   NVARCHAR(100) NULL,
    dispensa_modulos              NVARCHAR(200) NULL,
    desconto                    DECIMAL(5,2)  NOT NULL DEFAULT 0 CHECK (desconto BETWEEN 0 AND 100),
    foto                        VARBINARY(MAX) NULL,

    -- Atestado médico
    atestado_data_emissao        DATE NULL,
    atestado_data_validade       DATE NULL,
    atestado_apto                BIT  NULL,

    -- Exame psicotécnico
    psicotecnico_aplicavel       BIT  NOT NULL DEFAULT 0,
    psicotecnico_data_emissao    DATE NULL,
    psicotecnico_data_validade   DATE NULL,

    -- Processo / licença de aprendizagem IMT
    imt_numero                  NVARCHAR(50) NULL,
    imt_data_emissao            DATE NULL,
    imt_data_validade           DATE NULL
);
GO

/* Documentos anexados à ficha do aluno */
CREATE TABLE aluno_documentos (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    aluno_id        INT NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
    nome            NVARCHAR(200) NOT NULL,
    filename        NVARCHAR(300) NULL,
    mime_type       NVARCHAR(100) NULL,
    conteudo        VARBINARY(MAX) NOT NULL,
    tamanho_bytes   INT NULL,
    uploaded_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- Aulas (práticas e teóricas individuais) ---------- */
CREATE TABLE aulas (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id        INT NOT NULL REFERENCES alunos(id),
    instrutor_id    INT NULL REFERENCES instrutores(id),
    veiculo_id      INT NULL REFERENCES veiculos(id),
    espaco_id       INT NOT NULL REFERENCES espacos(id),
    data            DATE NOT NULL,
    hora            NVARCHAR(5) NOT NULL,
    hora_fim        NVARCHAR(5) NULL,
    duracao         INT NULL DEFAULT 50,
    km              DECIMAL(8,2) NULL,
    tipo            NVARCHAR(20) NOT NULL DEFAULT 'Prática',   -- Prática | Teórica
    modulo          NVARCHAR(200) NULL,
    estado          NVARCHAR(20) NOT NULL DEFAULT 'Agendada',
    notas           NVARCHAR(MAX) NULL
);
GO

/* ---------- Turmas teóricas ---------- */
CREATE TABLE turmas_teoricas (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    espaco_id       INT NOT NULL REFERENCES espacos(id),
    instrutor_id    INT NULL REFERENCES instrutores(id),
    tema            NVARCHAR(200) NOT NULL,
    data            DATE NOT NULL,
    hora_inicio     NVARCHAR(5) NOT NULL,
    hora_fim        NVARCHAR(5) NOT NULL,
    sala            NVARCHAR(50) NULL,
    estado          NVARCHAR(20) NOT NULL DEFAULT 'Agendada'
);
GO

CREATE TABLE turma_inscritos (
    turma_id        INT NOT NULL REFERENCES turmas_teoricas(id) ON DELETE CASCADE,
    aluno_id        INT NOT NULL REFERENCES alunos(id),
    presente        BIT NULL,       -- NULL = ainda sem registo de presença
    PRIMARY KEY (turma_id, aluno_id)
);
GO

/* ---------- Contratos ---------- */
CREATE TABLE contratos (
    id                          INT IDENTITY(1,1) PRIMARY KEY,
    escola_id                   INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id                    INT NOT NULL REFERENCES alunos(id),
    categoria                   NVARCHAR(10) NOT NULL,
    plano_carta_id               INT NULL REFERENCES planos_carta(id),
    plano_pagamento               NVARCHAR(30) NOT NULL DEFAULT 'Pagamento único',  -- Pagamento único | Mensalidades | Personalizado
    numero_prestacoes             INT NULL,
    estado                      NVARCHAR(20) NOT NULL DEFAULT 'Rascunho',           -- Rascunho | Assinado
    data_criacao                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

    valor_carta_calculado         DECIMAL(10,2) NULL,
    desconto_aplicado             DECIMAL(5,2)  NULL,
    valor_total                  DECIMAL(10,2) NULL,

    texto_contrato               NVARCHAR(MAX) NULL,
    assinatura_nome_digitado      NVARCHAR(200) NULL,
    assinatura_data_hora           DATETIME2 NULL,

    pdf_assinado_filename         NVARCHAR(300) NULL,
    pdf_assinado_uploaded_at       DATETIME2 NULL,
    pdf_assinado_tamanho_bytes     INT NULL
);
GO

/* Parcelas manuais quando plano_pagamento = 'Personalizado' */
CREATE TABLE contrato_parcelas_personalizadas (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    contrato_id     INT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    descricao       NVARCHAR(200) NULL,
    valor           DECIMAL(10,2) NOT NULL,
    ordem           INT NOT NULL DEFAULT 1
);
GO

/* ---------- Conta corrente (itens de débito por aluno) ---------- */
CREATE TABLE itens_conta (
    id                      INT IDENTITY(1,1) PRIMARY KEY,
    escola_id               INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id                INT NOT NULL REFERENCES alunos(id),
    origem_contrato_id       INT NULL REFERENCES contratos(id),
    descricao               NVARCHAR(300) NOT NULL,
    categoria               NVARCHAR(50) NOT NULL DEFAULT 'Diversos',
    valor                   DECIMAL(10,2) NOT NULL,
    taxa_iva                 DECIMAL(5,2) NULL,      -- NULL = usa a taxa por omissão da escola
    estado                  NVARCHAR(20) NOT NULL DEFAULT 'Pendente',  -- Pendente | Parcial | Pago
    origem_plano             NVARCHAR(30) NULL,
    ordem                   INT NOT NULL DEFAULT 1
);
GO

/* ---------- Pagamentos ---------- */
CREATE TABLE pagamentos (
    id                          INT IDENTITY(1,1) PRIMARY KEY,
    escola_id                   INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id                    INT NOT NULL REFERENCES alunos(id),
    valor                       DECIMAL(10,2) NOT NULL,
    data                        DATE NOT NULL,
    descricao                   NVARCHAR(300) NULL,
    taxa_iva                     DECIMAL(5,2) NULL,
    estado                      NVARCHAR(20) NOT NULL DEFAULT 'Pendente',   -- Pendente | Pago

    -- Última emissão fiscal associada a este pagamento (fatura/fatura-recibo)
    faturacao_tipo               NVARCHAR(10) NULL,   -- FA | FR
    faturacao_serie              NVARCHAR(20) NULL,
    faturacao_numero             NVARCHAR(30) NULL,
    faturacao_entidade           NVARCHAR(100) NULL,
    faturacao_data_emissao        DATETIME2 NULL
);
GO

/* Histórico completo de tentativas de faturação de um pagamento
   (era pagamento.historicoFaturacao, um array) */
CREATE TABLE pagamento_historico_faturacao (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    pagamento_id    INT NOT NULL REFERENCES pagamentos(id) ON DELETE CASCADE,
    tipo            NVARCHAR(10) NOT NULL,     -- FA | FR | NC | RE
    sucesso         BIT NOT NULL,
    doc_numero      NVARCHAR(30) NULL,
    doc_serie       NVARCHAR(20) NULL,
    erro            NVARCHAR(500) NULL,
    data_hora       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* Documentos fiscais emitidos (fatura, fatura-recibo, recibo, nota de
   crédito) — substitui aluno.faturasEmitidas / recibosEmitidos e
   contrato.recibosEmitidos, tudo numa única tabela consultável. */
CREATE TABLE documentos_fiscais (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    escola_id           INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id            INT NOT NULL REFERENCES alunos(id),
    contrato_id         INT NULL REFERENCES contratos(id),
    pagamento_id        INT NULL REFERENCES pagamentos(id),
    tipo                NVARCHAR(10) NOT NULL,      -- FA | FR | NC | RE
    serie               NVARCHAR(20) NULL,
    numero              NVARCHAR(30) NULL,
    valor               DECIMAL(10,2) NULL,
    doc_original_tipo   NVARCHAR(10) NULL,          -- para RE/NC: a que documento se refere
    doc_original_serie  NVARCHAR(20) NULL,
    doc_original_numero NVARCHAR(30) NULL,
    data_emissao        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- Pré-inscrições ---------- */
CREATE TABLE pre_inscricoes (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    escola_id           INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    nome                NVARCHAR(200) NOT NULL,
    email               NVARCHAR(200) NOT NULL,
    categoria           NVARCHAR(10) NOT NULL,
    desconto            DECIMAL(5,2) NOT NULL DEFAULT 0,
    estado              NVARCHAR(20) NOT NULL DEFAULT 'Pendente',   -- Pendente | Inscrita
    observacoes         NVARCHAR(500) NULL,
    data_pre_inscricao   DATE NOT NULL DEFAULT CAST(SYSUTCDATETIME() AS DATE),
    data_inscricao       DATE NULL,
    aluno_id            INT NULL REFERENCES alunos(id)
);
GO

/* ---------- Marcações de exame ---------- */
CREATE TABLE exames_marcacoes (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    escola_id       INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
    aluno_id        INT NOT NULL REFERENCES alunos(id),
    tipo            NVARCHAR(10) NOT NULL CHECK (tipo IN ('Teórico','Prático')),
    data            DATE NOT NULL,
    hora            NVARCHAR(5) NULL,
    hora_fim        NVARCHAR(5) NULL,
    duracao         INT NULL,
    local           NVARCHAR(200) NULL,
    estado          NVARCHAR(20) NOT NULL DEFAULT 'Marcado',
    observacoes     NVARCHAR(500) NULL,
    resultado       NVARCHAR(10) NULL CHECK (resultado IN ('Aprovado','Reprovado') OR resultado IS NULL)
);
GO

/* ---------- Índices para os acessos mais frequentes da aplicação ---------- */
CREATE INDEX ix_alunos_escola          ON alunos(escola_id);
CREATE INDEX ix_alunos_espaco          ON alunos(espaco_id);
CREATE INDEX ix_aulas_escola_data      ON aulas(escola_id, data);
CREATE INDEX ix_aulas_aluno            ON aulas(aluno_id);
CREATE INDEX ix_turmas_escola_data     ON turmas_teoricas(escola_id, data);
CREATE INDEX ix_pagamentos_aluno       ON pagamentos(aluno_id);
CREATE INDEX ix_pagamentos_estado      ON pagamentos(escola_id, estado);
CREATE INDEX ix_itens_conta_aluno      ON itens_conta(aluno_id);
CREATE INDEX ix_contratos_aluno        ON contratos(aluno_id);
CREATE INDEX ix_exames_aluno           ON exames_marcacoes(aluno_id);
CREATE INDEX ix_produtos_escola        ON produtos(escola_id);
CREATE INDEX ix_planos_carta_escola_cat ON planos_carta(escola_id, categoria);
GO