/* ==========================================================
   sp_seed_escola — popula o catálogo por omissão de UMA escola
   recém-criada: espaço inicial, requisitos por categoria,
   catálogo de produtos, e a composição da carta (planos de
   preço) por categoria.

   Isto substitui o que hoje está hardcoded em db.js:
   defaultEspacos(), defaultRequisitos(), defaultProdutos(),
   defaultConfig().composicaoCarta — chamado uma única vez,
   depois de fazer INSERT em escolas e obter o novo id.

   Nota: o "espaço" por omissão passa a ser genérico ("Sede"),
   em vez dos nomes específicos da escola de demonstração
   ("Boa Viagem" / "Estrela da Manhã") que estavam no código
   antigo — cada escola nova edita/renomeia os seus espaços em
   Configurações.

   Uso:
     DECLARE @novoId INT;
     INSERT INTO escolas (...) VALUES (...);
     SET @novoId = SCOPE_IDENTITY();
     EXEC sp_seed_escola @escola_id = @novoId;
   ========================================================== */

USE RotaCerta;
GO

CREATE OR ALTER PROCEDURE sp_seed_escola
    @escola_id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM escolas WHERE id = @escola_id)
    BEGIN
        RAISERROR('Escola %d não encontrada — não é possível gerar o seed.', 16, 1, @escola_id);
        RETURN;
    END

    /* ---------- 1) Espaço físico inicial ---------- */
    IF NOT EXISTS (SELECT 1 FROM espacos WHERE escola_id = @escola_id)
    BEGIN
        INSERT INTO espacos (escola_id, nome, observacoes)
        VALUES (@escola_id, N'Sede', NULL);
    END

    /* ---------- 2) Requisitos mínimos por categoria ---------- */
    IF NOT EXISTS (SELECT 1 FROM requisitos WHERE escola_id = @escola_id)
    BEGIN
        INSERT INTO requisitos (escola_id, categoria, horas_teoricas_min, horas_praticas_min, km_pratica_min)
        VALUES
            (@escola_id, N'B',  NULL, NULL, NULL),
            (@escola_id, N'A1', NULL, NULL, NULL),
            (@escola_id, N'A2', NULL, NULL, NULL),
            (@escola_id, N'A',  NULL, NULL, NULL),
            (@escola_id, N'BE', NULL, NULL, NULL),
            (@escola_id, N'C',  NULL, NULL, NULL);
    END

    /* ---------- 3) Catálogo de produtos/serviços ---------- */
    IF EXISTS (SELECT 1 FROM produtos WHERE escola_id = @escola_id)
    BEGIN
        -- Já tem catálogo (procedimento chamado duas vezes) — não duplica.
        RETURN;
    END

    DECLARE @src TABLE (old_id INT PRIMARY KEY, codigo NVARCHAR(20), descricao NVARCHAR(200), categoria NVARCHAR(50), valor DECIMAL(10,2), descontavel BIT, taxa_iva DECIMAL(5,2));
    INSERT INTO @src (old_id, codigo, descricao, categoria, valor, descontavel, taxa_iva) VALUES
        (1,  N'000', N'Inscrição', N'Diversos', 100, 0, 16),
        (2,  N'001', N'Livro de Código', N'Diversos', 20, 0, 16),
        (3,  N'002', N'2.ª Inscrição -50%', N'Diversos', 50, 0, 16),
        (4,  N'003', N'Tarifa Plus', N'Diversos', 100, 0, 16),
        (5,  N'005', N'Livro de Código - Versão Inglês', N'Diversos', 25, 0, 16),
        (6,  N'006', N'Livro Mecânica C e D', N'Diversos', 25, 0, 16),
        (7,  N'010', N'Módulo de Teórico de AM, A1, A2 e A', N'Exames teóricos', 50, 1, 16),
        (8,  N'011', N'Módulo de Teórico de condução específico', N'Exames teóricos', 10, 1, 16),
        (9,  N'012', N'Módulo de Teórico de Condução B, C e D', N'Exames teóricos', 80, 1, 16),
        (10, N'020', N'Prática de Condução AM 5 aulas', N'Lições práticas', 60, 1, 16),
        (11, N'021', N'Prática de Condução A1, A2 e A - 12 aulas', N'Lições práticas', 180, 1, 16),
        (12, N'022', N'Prática de Condução A1, A2 e A - 12 aulas', N'Lições práticas', 130, 1, 16),
        (13, N'025', N'Prática de Condução B - 32 aulas', N'Lições práticas', 600, 1, 16),
        (14, N'026', N'Promo Mensal 15% 32 práticas B', N'Lições práticas', 450, 1, 16),
        (15, N'028', N'Promo Mensal Estudante 30% 32 práticas B', N'Lições práticas', 300, 1, 16),
        (16, N'030', N'Práticas de Condução 2ª vez', N'Lições práticas', 150, 1, 16),
        (17, N'031', N'Promo 20% - 32 aulas', N'Lições práticas', 400, 1, 16),
        (18, N'034', N'Prática c/ Carta B1 ou A1 - 32 aulas', N'Lições práticas', 270, 1, 16),
        (19, N'040', N'Prática de Condução C - 16 aulas', N'Lições práticas', 640, 1, 16),
        (20, N'041', N'Prática de Condução C+E - 10 aulas', N'Lições práticas', 400, 1, 16),
        (21, N'042', N'Prática de Condução D - 18 aulas', N'Lições práticas', 740, 1, 16),
        (22, N'043', N'Prática de Condução B1 - 12 aulas', N'Lições práticas', 200, 1, 16),
        (23, N'050', N'Viatura de Exame 1ª vez AM', N'Diversos', 20, 0, 16),
        (24, N'051', N'Viatura de Exame 1ª vez A1, A2 e A', N'Diversos', 20, 0, 16),
        (25, N'052', N'Viatura de Exame 1ª vez B e A', N'Diversos', 30, 0, 16),
        (26, N'053', N'Viatura de Exame 1ª vez C', N'Diversos', 100, 0, 16),
        (27, N'054', N'Viatura de Exame 1ª vez C+E', N'Diversos', 120, 0, 16),
        (28, N'055', N'Seguro Viatura para Exame', N'Diversos', 20, 0, 0),
        (29, N'056', N'Viatura de Exame 1ª vez D', N'Diversos', 120, 0, 16),
        (30, N'059', N'Taxa Revalidação C e D', N'Diversos', 150, 0, 16),
        (31, N'060', N'Taxa de exame 1.ª vez Ciclomotor', N'Diversos', 170, 0, 16),
        (32, N'061', N'Taxa de exame 1.ª vez A1, A2 e A', N'Diversos', 130, 0, 16),
        (33, N'062', N'Taxa de exame 1.ª vez Ligeiros', N'Diversos', 180, 0, 16),
        (34, N'063', N'Taxa de exame Reprovação', N'Diversos', 60, 0, 16),
        (35, N'064', N'Taxa de exame de condução', N'Diversos', 60, 0, 16),
        (36, N'065', N'Taxa de exame A2 ou A', N'Diversos', 60, 0, 16),
        (37, N'070', N'Viatura de exame 2.ª vez B e A', N'Diversos', 40, 0, 16),
        (38, N'079', N'Lições Práticas AM, A1, A2 e A', N'Lições práticas', 30, 1, 16),
        (39, N'080', N'Lições Práticas B', N'Lições práticas', 25, 1, 16),
        (40, N'081', N'Lições Práticas B1', N'Lições práticas', 25, 1, 16),
        (41, N'082', N'Lições Práticas C', N'Lições práticas', 45, 1, 16),
        (42, N'083', N'Lições Práticas D', N'Lições práticas', 50, 1, 16),
        (43, N'084', N'Lições Práticas C+E', N'Lições práticas', 60, 1, 16),
        (44, N'085', N'3 Lições Práticas Ligeiros', N'Lições práticas', 67.5, 1, 16),
        (45, N'086', N'5 Lições Práticas Ligeiros', N'Lições práticas', 110, 1, 16),
        (46, N'087', N'10 Lições Práticas Ligeiros', N'Lições práticas', 215, 1, 16),
        (47, N'088', N'20 Lições Práticas Ligeiros', N'Lições práticas', 420, 1, 16),
        (48, N'089', N'30 Lições Práticas Ligeiros', N'Lições práticas', 615, 1, 16),
        (49, N'090', N'Taxa reprovação ou Falta Exame Teórico', N'Diversos', 70, 0, 16),
        (50, N'093', N'Falta Exame Prático', N'Diversos', 60, 0, 16),
        (51, N'095', N'Penalização Licença mais um ano', N'Diversos', 50, 0, 16),
        (52, N'096', N'2.ª via Licença de Aprendizagem', N'Diversos', 50, 0, 16),
        (53, N'097', N'Transferência do Processo outra DGV', N'Diversos', 50, 0, 16),
        (54, N'098', N'Transferência do Processo DGV PDL', N'Diversos', 30, 0, 16),
        (55, N'099', N'Atestado Médico', N'Diversos', 50, 0, 16),
        (56, N'100', N'Taxa de Emissão de Carta', N'Diversos', 50, 0, 16),
        (57, N'110', N'Energia Injetada na Rede (kWh)', N'Diversos', 1, 0, 16),
        (58, N'150', N'Formação Inicial Prática de Instrutor - 125h', N'Diversos', 500, 1, 16),
        (59, N'151', N'Taxa Averb do Grupo 2 (997)', N'Diversos', 50, 0, 16),
        (60, N'152', N'Taxa Averb do CAM', N'Diversos', 50, 0, 16),
        (61, N'C',   N'Combustível (Norma Açores)', N'Diversos', 150, 0, 16),
        (62, N'FA',  N'Formação Autocarro (Norma Açores)', N'Diversos', 1652, 0, 16),
        (63, N'VC',  N'Venda Automóveis', N'Diversos', 1, 0, 16),
        (64, N'041', N'Prática de Condução C+E - 10 aulas Desconto', N'Lições práticas', 200, 1, 16);

    DECLARE @map TABLE (old_id INT PRIMARY KEY, new_id INT);

    MERGE produtos AS tgt
    USING @src AS s
    ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (escola_id, codigo, descricao, categoria, valor, descontavel, taxa_iva)
        VALUES (@escola_id, s.codigo, s.descricao, s.categoria, s.valor, s.descontavel, s.taxa_iva)
    OUTPUT s.old_id, inserted.id INTO @map(old_id, new_id);

    /* ---------- 4) Planos de preço da carta, por categoria ---------- */
    DECLARE @planoSrc TABLE (old_id INT PRIMARY KEY, categoria NVARCHAR(10), nome NVARCHAR(100));
    INSERT INTO @planoSrc (old_id, categoria, nome) VALUES
        (1,  N'B',   N'Base'),
        (2,  N'B',   N'Promo Mensal 15%'),
        (3,  N'B',   N'Promo Universidade 30%'),
        (4,  N'B',   N'Promo 20%'),
        (5,  N'B',   N'Ligeiros 2ª Carta'),
        (6,  N'A1',  N'Base s/Carta + Novo Cliente'),
        (7,  N'A1',  N'Base s/Carta + Cliente Antigo'),
        (8,  N'A2',  N'Base s/Carta + Novo Cliente'),
        (9,  N'A2',  N'Base s/Carta + Cliente Antigo'),
        (10, N'A',   N'Base s/Carta + Novo Cliente'),
        (11, N'A',   N'Base s/Carta + Cliente Antigo'),
        (12, N'C',   N'Base'),
        (13, N'AM',  N'Base'),
        (14, N'B1',  N'Base'),
        (15, N'C+E', N'Base'),
        (16, N'C+E', N'Conjunto c/ Categoria C'),
        (17, N'D',   N'Base');

    DECLARE @planoMap TABLE (old_id INT PRIMARY KEY, new_id INT);

    MERGE planos_carta AS tgt
    USING @planoSrc AS s
    ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (escola_id, categoria, nome)
        VALUES (@escola_id, s.categoria, s.nome)
    OUTPUT s.old_id, inserted.id INTO @planoMap(old_id, new_id);

    /* ---------- 5) Linhas de cada plano (produto + quantidade) ---------- */
    DECLARE @linhaSrc TABLE (plano_old_id INT, produto_old_id INT, quantidade INT);
    INSERT INTO @linhaSrc (plano_old_id, produto_old_id, quantidade) VALUES
        -- B / Base
        (1,1,1), (1,9,1), (1,33,1), (1,25,1), (1,13,1), (1,56,1),
        -- B / Promo Mensal 15%
        (2,1,1), (2,9,1), (2,33,1), (2,25,1), (2,14,1), (2,56,1),
        -- B / Promo Universidade 30%
        (3,1,1), (3,9,1), (3,33,1), (3,25,1), (3,15,1), (3,56,1),
        -- B / Promo 20%
        (4,1,1), (4,9,1), (4,33,1), (4,25,1), (4,17,1), (4,56,1),
        -- B / Ligeiros 2ª Carta
        (5,3,1), (5,9,1), (5,33,1), (5,25,1), (5,16,1), (5,56,1),
        -- A1 / Novo Cliente
        (6,1,1), (6,7,1), (6,8,1), (6,33,1), (6,24,1), (6,11,1), (6,56,1),
        -- A1 / Cliente Antigo
        (7,3,1), (7,7,1), (7,8,1), (7,33,1), (7,24,1), (7,11,1), (7,56,1),
        -- A2 / Novo Cliente
        (8,1,1), (8,7,1), (8,8,1), (8,33,1), (8,24,1), (8,11,1), (8,56,1),
        -- A2 / Cliente Antigo
        (9,3,1), (9,7,1), (9,8,1), (9,33,1), (9,24,1), (9,11,1), (9,56,1),
        -- A / Novo Cliente
        (10,1,1), (10,7,1), (10,8,1), (10,33,1), (10,24,1), (10,11,1), (10,56,1),
        -- A / Cliente Antigo
        (11,3,1), (11,7,1), (11,8,1), (11,33,1), (11,24,1), (11,11,1), (11,56,1),
        -- C / Base
        (12,1,1), (12,9,1), (12,36,1), (12,26,1), (12,20,1), (12,56,1),
        -- AM / Base
        (13,3,1), (13,9,1), (13,33,1), (13,25,1), (13,22,1), (13,56,1),
        -- B1 / Base
        (14,1,1), (14,9,1), (14,33,1), (14,25,1), (14,15,1), (14,56,1),
        -- C+E / Base
        (15,1,1), (15,36,1), (15,27,1), (15,20,1), (15,56,1),
        -- C+E / Conjunto c/ Categoria C
        (16,1,1), (16,36,1), (16,27,1), (16,64,1), (16,56,1),
        -- D / Base
        (17,1,1), (17,9,1), (17,36,1), (17,29,1), (17,21,1), (17,56,1);

    INSERT INTO plano_carta_linhas (plano_carta_id, produto_id, quantidade)
    SELECT pm.new_id, prm.new_id, ls.quantidade
    FROM @linhaSrc ls
    JOIN @planoMap pm  ON pm.old_id = ls.plano_old_id
    JOIN @map      prm ON prm.old_id = ls.produto_old_id;

END
GO