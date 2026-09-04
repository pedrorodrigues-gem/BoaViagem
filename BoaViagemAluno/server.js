const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('./mailer');
const fs = require('fs');
const path = require('path');
const { sql, poolPromise } = require('./db');
const {
    canManageAttendance,
    canSelfMarkAttendance,
    canAccessQuestionBank,
    normalizeRole,
    isAlunoRole
} = require('./attendance');
require('dotenv').config({ path: './config.env' });

const MIN_AULAS_PRACTICAS = 32;
const MIN_AULAS_TEORICAS = 28;

const QUESTION_BANK_PATH = path.join(__dirname, 'data', 'question-bank.json');
const TEST_HISTORY_DIR = path.join(__dirname, 'data', 'test-history');

// Formato do simulado alinhado com o exame oficial do IMT: 30 perguntas, aprovação com no máximo 3 erros (>=90%)
const EXAM_SIZE = 30;
const EXAM_PASS_RATIO = 0.9;
const EXAM_TIME_MINUTES = 30;
const HISTORY_LIMIT = 20; // nº de tentativas guardadas por aluno
const READY_LOOKBACK = 3; // nº de últimas tentativas usadas para aferir a prontidão

// Estados legados que indicam aula cumprida na ausência de marcação explícita
const ESTADOS_CONCLUIDA = ['Realizada', 'Concluída', 'Concluido', 'Concluida', 'Concluído'];

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'boaviagem_chave_secreta_987654321',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 * 8 } // 8 horas
}));

// ---------------- HELPERS DE NORMALIZAÇÃO ----------------
//
// O driver `mssql` pode devolver colunas do tipo BIT como boolean (true/false)
// em vez de 1/0, e strings com acentuação podem vir gravadas de forma
// inconsistente ("Prática" vs "pratica", "Concluída" vs "concluida"). Isto
// fazia com que comparações estritas (=== 1, === 'Prática') falhassem
// silenciosamente e a contagem/marcação de presenças parecesse "não
// funcionar", mesmo com os dados corretos na base de dados.

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

// Converte qualquer representação de presença (1/0, true/false, '1'/'0') num
// valor canónico: 1 (presente), 0 (faltou) ou null (ainda não marcado).
function normalizePresenceValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (raw === true || raw === 1 || raw === '1') return 1;
    if (raw === false || raw === 0 || raw === '0') return 0;
    return null;
}

function isTipo(aula, tipoAlvo) {
    return normalizeText(aula && aula.tipo) === normalizeText(tipoAlvo);
}

const ESTADOS_CONCLUIDA_NORM = ESTADOS_CONCLUIDA.map(normalizeText);
function isEstadoConcluida(estado) {
    return ESTADOS_CONCLUIDA_NORM.includes(normalizeText(estado));
}

// Middleware de Autenticação
function checkAuth(req, res, next) {
    const role = normalizeRole(req.session.user);
    if (req.session.user && ['aluno', 'admin', 'super', 'instrutor'].includes(role)) {
        return next();
    }
    res.redirect('/login');
}

function checkStaff(req, res, next) {
    const currentUser = req.session.originalUser || req.session.user;
    const role = normalizeRole(currentUser);
    if (currentUser && ['admin', 'super'].includes(role)) {
        return next();
    }
    res.status(403).send('Acesso não autorizado.');
}

// ---------------- BANCO DE QUESTÕES ----------------

function ensureQuestionBankFile() {
    const dir = path.dirname(QUESTION_BANK_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(QUESTION_BANK_PATH)) {
        const seedQuestions = [
            {
                id: 1,
                categoria: 'Velocidade',
                pergunta: 'Qual a velocidade máxima permitida a um ligeiro numa autoestrada em Portugal?',
                opcoes: ['90 km/h', '100 km/h', '120 km/h', '130 km/h'],
                correta: 2,
                explicacao: 'Numa autoestrada, a velocidade máxima para veículos ligeiros é de 120 km/h, salvo indicação em contrário.'
            },
            {
                id: 2,
                categoria: 'Sinalização',
                pergunta: 'Perante um sinal de STOP, o condutor deve obrigatoriamente:',
                opcoes: ['Reduzir a velocidade', 'Parar antes da linha de paragem', 'Avançar se não vier ninguém', 'Buzinar'],
                correta: 1,
                explicacao: 'O sinal STOP obriga a parar completamente antes da linha ou da zona de cruzamento.'
            },
            {
                id: 3,
                categoria: 'Estacionamento e Paragem',
                pergunta: 'Onde é proibido parar ou estacionar?',
                opcoes: ['Nas passagens para peões', 'Nos parques de estacionamento', 'Em vias urbanas', 'A mais de 5 metros dos cruzamentos'],
                correta: 0,
                explicacao: 'Nas passagens para peões é sempre proibido parar ou estacionar.'
            }
        ];
        fs.writeFileSync(QUESTION_BANK_PATH, JSON.stringify(seedQuestions, null, 2));
    }

    return QUESTION_BANK_PATH;
}

function loadQuestionBank() {
    ensureQuestionBankFile();
    const raw = fs.readFileSync(QUESTION_BANK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
}

function saveQuestionBank(questions) {
    ensureQuestionBankFile();
    fs.writeFileSync(QUESTION_BANK_PATH, JSON.stringify(questions, null, 2));
}

function getQuestionCategories(questions) {
    return [...new Set(questions.map(q => q.categoria).filter(Boolean))].sort();
}

function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildExam(bank) {
    const size = Math.min(EXAM_SIZE, bank.length);
    const questoes = shuffle(bank).slice(0, size);
    return { questoes, isParcial: bank.length < EXAM_SIZE };
}

// ---------------- HISTÓRICO DE TESTES (por aluno) ----------------

function ensureHistoryDir() {
    if (!fs.existsSync(TEST_HISTORY_DIR)) {
        fs.mkdirSync(TEST_HISTORY_DIR, { recursive: true });
    }
}

function historyPath(alunoId) {
    ensureHistoryDir();
    return path.join(TEST_HISTORY_DIR, `${alunoId}.json`);
}

function loadTestHistory(alunoId) {
    if (!alunoId) return [];
    const filePath = historyPath(alunoId);
    if (!fs.existsSync(filePath)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function appendTestHistory(alunoId, record) {
    if (!alunoId) return [];
    const history = loadTestHistory(alunoId);
    history.unshift(record);
    const trimmed = history.slice(0, HISTORY_LIMIT);
    fs.writeFileSync(historyPath(alunoId), JSON.stringify(trimmed, null, 2));
    return trimmed;
}

// ---------------- ASSIDUIDADE ----------------

// Uma aula é válida/realizada se foi marcada presente OU se o estado é 'Concluída' (e não foi marcada falta)
const isAulaPresente = (a) => {
    // Se foi marcada falta explicitamente (0 ou false), não conta
    if (a.presente === 0 || a.presente === false) return false;
    
    // É presente se o campo presente for 1/true OU se o estado for 'Concluída'
    return a.presente === 1 || a.presente === true || String(a.estado).toLowerCase() === 'concluída';
};

function isAulaContabilizavel(aula) {
    if (aula.presente === 1 || aula.presente === 0) return true;
    return isEstadoConcluida(aula.estado);
}

async function getAttendanceStats(alunoId, escolaId) {
    const pool = await poolPromise;

    // 1. Procura todas as aulas do aluno ordenadas por data e hora de início (crescente)
    const aulasRes = await pool.request()
        .input('aluno_id', sql.Int, alunoId)
        .query(`
            SELECT 
                a.*, 
                i.nome as instrutor_nome, 
                v.matricula, 
                v.modelo, 
                e.nome as espaco_nome
            FROM aulas a
            LEFT JOIN instrutores i ON a.instrutor_id = i.id
            LEFT JOIN veiculos v ON a.veiculo_id = v.id
            LEFT JOIN espacos e ON a.espaco_id = e.id
            WHERE a.aluno_id = @aluno_id
            ORDER BY a.data ASC, a.hora ASC
        `);

    // 2. Procura todas as turmas teóricas ordenadas por data e hora de início (crescente)
    const turmasRes = await pool.request()
        .input('aluno_id', sql.Int, alunoId)
        .input('escola_id', sql.Int, escolaId)
        .query(`
            SELECT 
                t.*, 
                ti.presente, 
                ti.data_marcacao, 
                ti.marcado_por, 
                i.nome as instrutor_nome,
                e.nome as espaco_nome
            FROM turmas_teoricas t
            LEFT JOIN turma_inscritos ti 
                ON ti.turma_id = t.id AND ti.aluno_id = @aluno_id
            LEFT JOIN instrutores i 
                ON t.instrutor_id = i.id
            LEFT JOIN espacos e 
                ON t.espaco_id = e.id
            WHERE t.escola_id = @escola_id
            ORDER BY t.data ASC, t.hora_inicio ASC
        `);

    // Função auxiliar para ordenar arrays por hora de início (ex: "09:00" ou "09:00 - 10:00")
    const sortByTime = (a, b) => {
        const timeA = String(a.hora || a.hora_inicio || a.time || '').split(' - ')[0].trim();
        const timeB = String(b.hora || b.hora_inicio || b.time || '').split(' - ')[0].trim();
        return timeA.localeCompare(timeB);
    };

    // Normaliza os dados
    const todasAulas = (aulasRes.recordset || [])
        .map(a => ({
            ...a,
            presente: normalizePresenceValue(a.presente)
        }))
        .sort(sortByTime);
    
    const todasTurmas = (turmasRes.recordset || [])
        .map(t => ({
            ...t,
            sala: t.espaco_nome || t.sala || 'Sala da escola',
            presente: normalizePresenceValue(t.presente)
        }))
        .sort(sortByTime);

    // Data atual no formato YYYY-MM-DD
    const hojeStr = new Date().toISOString().slice(0, 10);

    // FILTRAGEM: Apenas aulas e turmas DO DIA ATUAL (já ordenadas cronologicamente)
    const aulasDoDia = todasAulas
        .filter(a => new Date(a.data).toISOString().slice(0, 10) === hojeStr)
        .map(a => ({ ...a, canMark: canSelfMarkAttendance({ role: 'aluno' }, a) }))
        .sort(sortByTime);

    const turmasDoDia = todasTurmas
        .filter(t => new Date(t.data).toISOString().slice(0, 10) === hojeStr)
        .map(t => ({ ...t, canMark: canSelfMarkAttendance({ role: 'aluno' }, t) }))
        .sort(sortByTime);

    // Cálculos globais
    const aulasPraticas = todasAulas.filter(a => isTipo(a, 'Prática'));
    const aulasPraticasRealizadas = aulasPraticas.filter(isAulaPresente);

    const aulasTeoricasIndividuais = todasAulas.filter(a => isTipo(a, 'Teórica'));
    const aulasTeoricasIndividuaisContabilizadas = aulasTeoricasIndividuais.filter(isAulaContabilizavel);
    const presencasTeoricasIndividuais = aulasTeoricasIndividuaisContabilizadas.filter(isAulaPresente).length;

    const turmasContabilizadas = todasTurmas.filter(t => t.presente !== null || isEstadoConcluida(t.estado));
    const presencasTurmas = todasTurmas.filter(t => t.presente === 1).length;

    const teoricasTotal = turmasContabilizadas.length + aulasTeoricasIndividuaisContabilizadas.length;
    const presencasTeoricas = presencasTurmas + presencasTeoricasIndividuais;
    const faltasTeoricas = teoricasTotal - presencasTeoricas;

    const taxaPraticas = Math.min(100, Math.round((aulasPraticasRealizadas.length / MIN_AULAS_PRACTICAS) * 100));
    const taxaTeoricas = Math.min(100, Math.round((presencasTeoricas / MIN_AULAS_TEORICAS) * 100));

    return {
        aulas: aulasDoDia,
        turmas: turmasDoDia,
        todasAulas,
        todasTurmas,
        historicoPraticas: aulasPraticas.filter(isAulaPresente),

        historicoTeoricas: [
            ...todasTurmas.filter(t => t.presente === 1),
            ...aulasTeoricasIndividuais.filter(isAulaPresente)
        ].sort((a, b) => new Date(b.data) - new Date(a.data)),       
        stats: {
            praticas: aulasPraticasRealizadas.length,
            praticasMin: MIN_AULAS_PRACTICAS,
            praticasTotal: aulasPraticas.length,
            teoricas: presencasTeoricas,
            teoricasMin: MIN_AULAS_TEORICAS,
            teoricasTotal,
            faltasTeoricas,
            taxaPraticas,
            taxaTeoricas,
            praticasCompletas: aulasPraticasRealizadas.length >= MIN_AULAS_PRACTICAS,
            teoricasCompletas: presencasTeoricas >= MIN_AULAS_TEORICAS
        }
    };
}

function getExamReadiness(history, attendanceStats) {
    const attendanceReady = Boolean(attendanceStats && attendanceStats.praticasCompletas && attendanceStats.teoricasCompletas);
    const recent = history.slice(0, READY_LOOKBACK);
    const hasAttempts = recent.length > 0;
    const avgPercent = hasAttempts
        ? Math.round(recent.reduce((sum, r) => sum + r.percent, 0) / recent.length)
        : 0;
    const lastPassed = hasAttempts ? recent[0].aprovado : false;
    const testReady = hasAttempts && lastPassed && avgPercent >= Math.round(EXAM_PASS_RATIO * 100);

    if (!hasAttempts) {
        return {
            label: 'Ainda sem simulados',
            tone: 'info',
            detail: 'Realize o simulado de 30 perguntas para começar a avaliar a sua prontidão teórica.',
            attendanceReady,
            testReady: false,
            avgPercent: 0
        };
    }

    if (testReady && attendanceReady) {
        return {
            label: 'Pronto para exame',
            tone: 'success',
            detail: `Média das últimas tentativas: ${avgPercent}%. Horas mínimas de formação cumpridas.`,
            attendanceReady,
            testReady,
            avgPercent
        };
    }

    if (testReady && !attendanceReady) {
        return {
            label: 'Falta cumprir horas mínimas',
            tone: 'warn',
            detail: 'O desempenho nos simulados já é suficiente, mas ainda faltam aulas práticas e/ou teóricas obrigatórias.',
            attendanceReady,
            testReady,
            avgPercent
        };
    }

    if (!testReady && attendanceReady) {
        return {
            label: 'Reforçar preparação teórica',
            tone: 'warn',
            detail: `Horas mínimas cumpridas, mas a média dos simulados (${avgPercent}%) ainda não atinge os 90% exigidos no exame oficial.`,
            attendanceReady,
            testReady,
            avgPercent
        };
    }

    return {
        label: 'Necessita revisão',
        tone: 'danger',
        detail: `Média dos simulados: ${avgPercent}%. Reforce o estudo teórico e cumpra as horas mínimas de formação.`,
        attendanceReady,
        testReady,
        avgPercent
    };
}

// ---------------- REENCAMINHAMENTO AUTOMÁTICO DA RAIZ ----------------

app.get('/', (req, res) => {
    if (req.session.user && isAlunoRole(req.session.user)) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// ---------------- AUTENTICAÇÃO ----------------

app.get('/login', (req, res) => {
    if (req.session.user && isAlunoRole(req.session.user)) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const ESCOLA_ID = 1;

    try {
        const pool = await poolPromise;
       
        const result = await pool.request()
            .input('escola_id', sql.Int, ESCOLA_ID)
            .input('username', sql.NVarChar, username)
            .query(`
                SELECT u.*, a.nome as aluno_nome, a.categoria 
                FROM users u
                LEFT JOIN alunos a ON a.id = u.aluno_id
                WHERE u.escola_id = @escola_id AND u.username = @username
            `);

        const user = result.recordset[0];
        if (!user) {
            return res.render('login', { error: 'Utilizador não encontrado.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.render('login', { error: 'Palavra-passe incorreta.' });
        }

        req.session.user = {
            id: user.id,
            escola_id: user.escola_id,
            aluno_id: user.aluno_id,
            username: user.username,
            nome: user.aluno_nome || user.nome,
            categoria: user.categoria,
            role: normalizeRole({ role: user.role })
        };

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Erro de servidor ao autenticar.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Impersonate
app.get('/admin/impersonate/:aluno_id', checkStaff, async (req, res) => {
    const currentUser = req.session.originalUser || req.session.user;
    const { aluno_id } = req.params;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('aluno_id', sql.Int, aluno_id)
            .query(`
                SELECT a.id as aluno_id, a.escola_id, a.nome as aluno_nome, a.email, a.categoria, u.id as user_id
                FROM alunos a
                LEFT JOIN users u ON u.escola_id = a.escola_id AND u.username = a.email
                WHERE a.id = @aluno_id
            `);

        const aluno = result.recordset[0];
        if (!aluno) return res.status(404).send('Aluno não encontrado.');

        req.session.originalUser = currentUser;
        req.session.user = {
            id: aluno.user_id || 0,
            escola_id: aluno.escola_id,
            aluno_id: aluno.aluno_id,
            username: aluno.email,
            nome: aluno.aluno_nome,
            categoria: aluno.categoria,
            role: 'aluno',
            isImpersonating: true
        };

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao simular acesso do aluno.');
    }
});

app.get('/admin/stop-impersonating', (req, res) => {
    if (req.session.originalUser) {
        req.session.user = req.session.originalUser;
        delete req.session.originalUser;
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// ---------------- RECUPERAÇÃO DE PALAVRA-PASSE (esqueci-me) ----------------

const RESET_TOKEN_MINUTES = 30;

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

app.get('/recuperar-password', (req, res) => {
    res.render('recuperar-password', { error: null, sucesso: null });
});

app.post('/recuperar-password', async (req, res) => {
    const { username } = req.body;
    const mensagemGenerica = 'Se existir uma conta com esse email, enviámos instruções de recuperação.';

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('username', sql.NVarChar, username)
            .query('SELECT id, username FROM users WHERE username = @username');

        const user = result.recordset[0];

        // Resposta é sempre igual, exista ou não a conta, para não revelar emails registados.
        if (user) {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = hashToken(rawToken);
            const expires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);

            await pool.request()
                .input('id', sql.Int, user.id)
                .input('token_hash', sql.NVarChar, tokenHash)
                .input('expires', sql.DateTime, expires)
                .query(`
                    UPDATE users 
                    SET reset_token_hash = @token_hash, reset_token_expires = @expires 
                    WHERE id = @id
                `);

            const resetUrl = `${process.env.APP_BASE_URL}/recuperar-password/${rawToken}`;
            await sendPasswordResetEmail(user.username, resetUrl);
        }

        res.render('recuperar-password', { error: null, sucesso: mensagemGenerica });
    } catch (err) {
        console.error('Erro ao pedir recuperação de password:', err);
        res.render('recuperar-password', { error: 'Erro de servidor. Tente novamente.', sucesso: null });
    }
});

app.get('/recuperar-password/:token', async (req, res) => {
    try {
        const pool = await poolPromise;
        const tokenHash = hashToken(req.params.token);

        const result = await pool.request()
            .input('token_hash', sql.NVarChar, tokenHash)
            .query(`
                SELECT id FROM users 
                WHERE reset_token_hash = @token_hash AND reset_token_expires > GETDATE()
            `);

        if (!result.recordset[0]) {
            return res.render('reset-password', { token: null, error: 'Este link é inválido ou já expirou.' });
        }

        res.render('reset-password', { token: req.params.token, error: null });
    } catch (err) {
        console.error('Erro ao validar token de recuperação:', err);
        res.status(500).send('Erro de servidor.');
    }
});

app.post('/recuperar-password/:token', async (req, res) => {
    const { password, confirmarPassword } = req.body;

    if (!password || password.length < 8) {
        return res.render('reset-password', { token: req.params.token, error: 'A password deve ter pelo menos 8 caracteres.' });
    }
    if (password !== confirmarPassword) {
        return res.render('reset-password', { token: req.params.token, error: 'As passwords não coincidem.' });
    }

    try {
        const pool = await poolPromise;
        const tokenHash = hashToken(req.params.token);

        const result = await pool.request()
            .input('token_hash', sql.NVarChar, tokenHash)
            .query(`
                SELECT id FROM users 
                WHERE reset_token_hash = @token_hash AND reset_token_expires > GETDATE()
            `);

        const user = result.recordset[0];
        if (!user) {
            return res.render('reset-password', { token: null, error: 'Este link é inválido ou já expirou.' });
        }

        const novoHash = await bcrypt.hash(password, 10);

        await pool.request()
            .input('id', sql.Int, user.id)
            .input('password_hash', sql.NVarChar, novoHash)
            .query(`
                UPDATE users 
                SET password_hash = @password_hash, reset_token_hash = NULL, reset_token_expires = NULL 
                WHERE id = @id
            `);

        res.render('login', { error: null, sucesso: 'Palavra-passe redefinida com sucesso. Pode agora iniciar sessão.' });
    } catch (err) {
        console.error('Erro ao repor password via token:', err);
        res.render('reset-password', { token: req.params.token, error: 'Erro de servidor. Tente novamente.' });
    }
});

// ---------------- REPOR PALAVRA-PASSE (utilizador autenticado) ----------------

app.post('/conta/password', checkAuth, async (req, res) => {
    const { passwordAtual, novaPassword, confirmarPassword } = req.body;
    const userId = req.session.user.id;
    const wantsJson = req.xhr || req.headers.accept?.includes('application/json');

    const fail = (status, message) => {
        if (wantsJson) return res.status(status).json({ ok: false, error: message });
        return res.render('repor-password', { user: req.session.user, error: message, sucesso: null });
    };

    if (!novaPassword || novaPassword.length < 8) {
        return fail(400, 'A nova password deve ter pelo menos 8 caracteres.');
    }
    if (novaPassword !== confirmarPassword) {
        return fail(400, 'As passwords não coincidem.');
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT password_hash FROM users WHERE id = @id');

        const user = result.recordset[0];
        if (!user) return fail(404, 'Utilizador não encontrado.');

        const match = await bcrypt.compare(passwordAtual, user.password_hash);
        if (!match) return fail(401, 'Palavra-passe atual incorreta.');

        const novoHash = await bcrypt.hash(novaPassword, 10);
        await pool.request()
            .input('id', sql.Int, userId)
            .input('password_hash', sql.NVarChar, novoHash)
            .query('UPDATE users SET password_hash = @password_hash WHERE id = @id');

        if (wantsJson) return res.json({ ok: true, message: 'Palavra-passe alterada com sucesso.' });
        res.render('repor-password', { user: req.session.user, error: null, sucesso: 'Palavra-passe alterada com sucesso.' });
    } catch (err) {
        console.error('Erro ao repor password:', err);
        fail(500, 'Erro de servidor. Tente novamente.');
    }
});

// ---------------- MARCAÇÃO DE PRESENÇA ----------------
//
// NOTA IMPORTANTE: esta rota existia duplicada no ficheiro original (duas
// definições idênticas de app.post('/aulas/marcar-presenca', ...)). O
// Express usa sempre a primeira, pelo que a segunda nunca era executada —
// mas a duplicação escondia o verdadeiro problema, que era a rota (única,
// aqui) impor uma janela de marcação ("apenas hoje") diferente e mais
// restritiva do que a janela real definida em attendance.js
// (canSelfMarkAttendance: de 1h antes até 30h depois da aula). Isso fazia
// com que, mesmo quando a interface mostrasse o botão de marcação (depois
// de corrigida), o pedido fosse sempre rejeitado com 403 se a aula não
// fosse "hoje" à data do servidor. Agora usa-se uma única fonte de verdade
// (canSelfMarkAttendance) tanto para mostrar o botão como para validar o
// POST.
app.post('/aulas/marcar-presenca', checkAuth, async (req, res) => {
    const { turma_id, aula_id, presente } = req.body;
    const valorPresenca = presente === '0' ? 0 : 1;
    const marcadoPor = req.session.user.id;

    try {
        const pool = await poolPromise;

        // ---- Aula Individual ----
        if (aula_id) {
            const aulaRes = await pool.request()
                .input('aula_id', sql.Int, Number(aula_id))
                .query(`SELECT id, aluno_id, data, hora, hora_fim FROM aulas WHERE id = @aula_id`);

            const aula = aulaRes.recordset[0];
            if (!aula) return res.status(404).send('Aula não encontrada.');

            const isManaging = canManageAttendance(req.session.user);

            // Um aluno só pode marcar a presença da sua própria aula.
            if (!isManaging && Number(aula.aluno_id) !== Number(req.session.user.aluno_id)) {
                return res.status(403).send('Não pode marcar presença numa aula que não é sua.');
            }

            if (!canSelfMarkAttendance(req.session.user, aula)) {
                return res.status(403).send('Fora do prazo permitido para marcar presença nesta aula.');
            }

            await pool.request()
                .input('aula_id', sql.Int, Number(aula_id))
                .input('presente', sql.Int, valorPresenca)
                .input('marcado_por', sql.Int, marcadoPor)
                .query(`
                    UPDATE aulas 
                    SET presente = @presente, data_marcacao = GETDATE(), marcado_por = @marcado_por 
                    WHERE id = @aula_id
                `);

            return res.redirect(req.get('referer') || '/dashboard');
        }

        // ---- Turma Teórica de Grupo ----
        if (turma_id) {
            const alunoId = Number(req.session.user.aluno_id || req.session.user.id);
            const turmaRes = await pool.request()
                .input('turma_id', sql.Int, Number(turma_id))
                .query(`SELECT id, data, hora_inicio, hora_fim FROM turmas_teoricas WHERE id = @turma_id`);

            const turma = turmaRes.recordset[0];
            if (!turma) return res.status(404).send('Turma não encontrada.');

            if (!canSelfMarkAttendance(req.session.user, turma)) {
                return res.status(403).send('Fora do prazo permitido para marcar presença nesta turma.');
            }

            await pool.request()
                .input('turma_id', sql.Int, Number(turma_id))
                .input('aluno_id', sql.Int, alunoId)
                .input('presente', sql.Int, valorPresenca)
                .input('marcado_por', sql.Int, marcadoPor)
                .query(`
                    IF EXISTS (SELECT 1 FROM turma_inscritos WHERE turma_id = @turma_id AND aluno_id = @aluno_id)
                        UPDATE turma_inscritos
                        SET presente = @presente, data_marcacao = GETDATE(), marcado_por = @marcado_por
                        WHERE turma_id = @turma_id AND aluno_id = @aluno_id
                    ELSE
                        INSERT INTO turma_inscritos (turma_id, aluno_id, presente, data_marcacao, marcado_por)
                        VALUES (@turma_id, @aluno_id, @presente, GETDATE(), @marcado_por)
                `);

            return res.redirect(req.get('referer') || '/dashboard');
        }

        return res.status(400).send('Pedido de marcação de presença inválido.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao registar presença.');
    }
});

// ------------ DASHBOARD PRINCIPAL (INCLUI CALENDÁRIO) ----------------
function toSqlInt(value) {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

app.get('/dashboard', checkAuth, async (req, res) => {
    const { aluno_id } = req.session.user;

    const selectedMonth = req.query.month || new Date().toISOString().slice(0, 7);
    const [year, month] = selectedMonth.split('-').map(Number);
    const monthDate = new Date(year, month - 1, 1);
    const firstDay = new Date(year, month - 1, 1);
    const startWeekDay = (firstDay.getDay() + 6) % 7; 

    const days = Array.from({ length: 42 }, (_, index) => {
        const dayNumber = index - startWeekDay + 1;
        const current = new Date(year, month - 1, dayNumber);
        return { 
            dayNumber: current.getDate(), 
            isCurrentMonth: current.getMonth() === month - 1, 
            date: current.toISOString().slice(0, 10) 
        };
    });

    try {
        const pool = await poolPromise;

        const alunoRes = await pool.request()
            .input('aluno_id', sql.Int, aluno_id)
            .query(`SELECT * FROM alunos WHERE id = @aluno_id`);

        const attendanceData = await getAttendanceStats(aluno_id, req.session.user.escola_id);
        const history = loadTestHistory(aluno_id);
        const readiness = getExamReadiness(history, attendanceData.stats);

        const hojeStr = new Date().toISOString().slice(0, 10);

        const eventos = [
            ...(attendanceData.todasAulas || []).map(aula => {
                const type = isTipo(aula, 'Teórica') ? 'teorica' : 'pratica';
                const dateStr = new Date(aula.data || aula.data_aula).toISOString().slice(0, 10);
                return {
                    id: aula.id,
                    source: 'aula',
                    date: dateStr,
                    type,
                    title: aula.modulo || (type === 'teorica' ? 'Aula teórica' : 'Aula prática'),
                    time: `${aula.hora || ''}${aula.hora_fim ? ` - ${aula.hora_fim}` : ''}`,
                    presente: aula.presente,
                    location: aula.espaco_nome || aula.modelo || 'Escola',
                    isHoje: dateStr === hojeStr,
                    canMark: canSelfMarkAttendance(req.session.user, aula)
                };
            }),
            ...(attendanceData.todasTurmas || []).map(turma => {
                const dateStr = new Date(turma.data || turma.data_aula).toISOString().slice(0, 10);
                return {
                    id: turma.id,
                    source: 'turma',
                    date: dateStr,
                    type: 'teorica',
                    title: turma.tema,
                    time: `${turma.hora_inicio} - ${turma.hora_fim}`,
                    presente: turma.presente,
                    location: turma.espaco_nome || turma.sala || 'Sala da escola',
                    isHoje: dateStr === hojeStr,
                    canMark: canSelfMarkAttendance(req.session.user, turma)
                };
            })
        ].sort((a, b) => a.date.localeCompare(b.date));

        // CORREÇÃO: Passa TODAS as aulas/turmas (todasAulas e todasTurmas) calculando a permissão canMark.
        // O EJS trata de filtrar apenas as que ocorreram nas últimas 24 horas ou hoje.
        const fonteAulas = attendanceData.todasAulas || attendanceData.aulas || [];
        const fonteTurmas = attendanceData.todasTurmas || attendanceData.turmas || [];

        const aulasRecentesEHoje = fonteAulas.map(a => ({
            ...a,
            canMark: canSelfMarkAttendance(req.session.user, a)
        }));

        const turmasRecentesEHoje = fonteTurmas.map(t => ({
            ...t,
            canMark: canSelfMarkAttendance(req.session.user, t)
        }));

        res.render('dashboard', {
            user: req.session.user,
            aluno: alunoRes.recordset[0] || {},
            aulas: aulasRecentesEHoje,
            turmas: turmasRecentesEHoje,
            historicoPraticas: attendanceData.historicoPraticas,
            historicoTeoricas: attendanceData.historicoTeoricas,
            stats: { ...attendanceData.stats, exameEstado: readiness.label },
            readiness,
            monthValue: selectedMonth,
            monthLabel: monthDate.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }),
            days,
            eventos,
            MIN_AULAS_PRACTICAS,
            MIN_AULAS_TEORICAS,
            canManageAttendance: canManageAttendance(req.session.user)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao carregar o dashboard.');
    }
});

// ---------------- CONTA CORRENTE E EXTRATOS ----------------

// ---------------- CONTA CORRENTE E EXTRATOS ----------------

app.get('/conta-corrente', checkAuth, async (req, res) => {
    const { aluno_id, escola_id } = req.session.user;

    try {
        const pool = await poolPromise;

        // Procura todos os itens de débito/conta do aluno
        const financeiroRes = await pool.request()
            .input('aluno_id', sql.Int, aluno_id)
            .input('escola_id', sql.Int, escola_id)
            .query(`
                SELECT 
                    id,
                    origem_contrato_id,
                    descricao,
                    categoria,
                    valor,
                    taxa_iva,
                    estado,
                    origem_plano,
                    ordem
                FROM itens_conta
                WHERE aluno_id = @aluno_id AND escola_id = @escola_id
                ORDER BY ordem ASC, id ASC
            `);

        // Procura os pagamentos efetuados pelo aluno
        const pagamentosRes = await pool.request()
            .input('aluno_id', sql.Int, aluno_id)
            .input('escola_id', sql.Int, escola_id)
            .query(`
                SELECT ISNULL(SUM(valor), 0) AS total_pago
                FROM pagamentos
                WHERE aluno_id = @aluno_id 
                  AND escola_id = @escola_id 
                  AND estado = 'Pago'
            `);

        const itens = financeiroRes.recordset;

        // Cálculo dos totais
        const totalDebito = itens.reduce((acc, item) => acc + Number(item.valor || 0), 0);
        const totalPago = Number(pagamentosRes.recordset[0].total_pago || 0);
        const saldoPendente = totalDebito - totalPago;

        res.render('conta-corrente', {
            user: req.session.user,
            itens,
            resumo: { 
                totalDebito: totalDebito.toFixed(2), 
                totalPago: totalPago.toFixed(2), 
                saldoPendente: saldoPendente.toFixed(2) 
            }
        });
    } catch (err) {
        console.error('Erro ao carregar conta-corrente:', err);
        res.render('conta-corrente', {
            user: req.session.user,
            itens: [],
            resumo: { totalDebito: '0.00', totalPago: '0.00', saldoPendente: '0.00' }
        });
    }
});

// ---------------- EXAMES TEÓRICOS ----------------

app.get('/testes', checkAuth, async (req, res) => {
    const bank = loadQuestionBank();
    const { questoes, isParcial } = buildExam(bank);

    // Guarda o conjunto exato de perguntas do simulado na sessão, para que a submissão
    // seja avaliada sobre as mesmas perguntas apresentadas (e não sobre o banco inteiro).
    req.session.currentExam = {
        ids: questoes.map(q => q.id),
        startedAt: Date.now()
    };

    const { aluno_id } = req.session.user;
    const history = loadTestHistory(aluno_id);

    let readiness = {
        label: 'Indisponível',
        tone: 'info',
        detail: 'Não foi possível carregar os dados de assiduidade neste momento.',
        attendanceReady: false,
        testReady: false,
        avgPercent: 0
    };

    try {
        const { stats } = await getAttendanceStats(aluno_id, req.session.user.escola_id);
        readiness = getExamReadiness(history, stats);
    } catch (err) {
        console.error('Erro ao calcular prontidão para exame:', err);
    }

    res.render('testes', {
        user: req.session.user,
        questoes,
        isParcial,
        resultado: null,
        readiness,
        history,
        EXAM_SIZE,
        EXAM_TIME_MINUTES,
        EXAM_PASS_RATIO,
        MIN_AULAS_TEORICAS,
        MIN_AULAS_PRACTICAS
    });
});

app.post('/testes/submeter', checkAuth, async (req, res) => {
    const bank = loadQuestionBank();
    const currentExam = req.session.currentExam;

    if (!currentExam || !Array.isArray(currentExam.ids) || currentExam.ids.length === 0) {
        return res.redirect('/testes');
    }

    // Avalia exatamente as perguntas que foram mostradas ao aluno, pela mesma ordem.
    const questoes = currentExam.ids
        .map(id => bank.find(q => String(q.id) === String(id)))
        .filter(Boolean);

    const respostas = req.body || {};
    let certas = 0;
    const detalhe = [];
    const porCategoria = {};

    questoes.forEach((q) => {
        const respostaDada = respostas[`q_${q.id}`];
        const respondida = respostaDada !== undefined && respostaDada !== '';
        const selecionada = respondida ? parseInt(respostaDada, 10) : null;
        const correta = selecionada === q.correta;
        if (correta) certas++;

        const cat = q.categoria || 'Geral';
        if (!porCategoria[cat]) porCategoria[cat] = { total: 0, certas: 0 };
        porCategoria[cat].total++;
        if (correta) porCategoria[cat].certas++;

        detalhe.push({
            id: q.id,
            categoria: q.categoria,
            pergunta: q.pergunta,
            opcoes: q.opcoes,
            correta: q.correta,
            selecionada,
            acertou: correta,
            explicacao: q.explicacao
        });
    });

    const total = questoes.length;
    const percent = total ? Math.round((certas / total) * 100) : 0;
    const aprovado = total ? (certas / total) >= EXAM_PASS_RATIO : false;
    const erros = total - certas;

    const record = {
        data: new Date().toISOString(),
        total,
        certas,
        erros,
        percent,
        aprovado
    };

    const { aluno_id } = req.session.user;
    const history = appendTestHistory(aluno_id, record);

    let readiness;
    try {
        const { stats } = await getAttendanceStats(aluno_id, req.session.user.escola_id);
        readiness = getExamReadiness(history, stats);
    } catch (err) {
        console.error('Erro ao calcular prontidão para exame:', err);
        readiness = getExamReadiness(history, null);
    }

    delete req.session.currentExam;

    res.render('testes', {
        user: req.session.user,
        questoes,
        isParcial: false,
        resultado: { certas, total, erros, percent, aprovado, detalhe, porCategoria },
        readiness,
        history,
        EXAM_SIZE,
        EXAM_TIME_MINUTES,
        EXAM_PASS_RATIO,
        MIN_AULAS_TEORICAS,
        MIN_AULAS_PRACTICAS
    });
});

// ---------------- BACK-OFFICE DE QUESTÕES ----------------
//
// Usa canAccessQuestionBank() (attendance.js) em vez de comparar a role
// diretamente: evita repetir listas de roles divergentes em cada rota.

app.get('/admin/questoes', checkAuth, (req, res) => {
    if (!canAccessQuestionBank(req.session.user)) {
        return res.status(403).send('Acesso não autorizado.');
    }

    const questoes = loadQuestionBank();
    const editId = req.query.edit;
    const questaoEmEdicao = editId ? questoes.find(q => String(q.id) === String(editId)) : null;

    res.render('admin-questoes', {
        user: req.session.user,
        questoes,
        categorias: getQuestionCategories(questoes),
        questaoEmEdicao,
        EXAM_SIZE,
        MIN_AULAS_TEORICAS,
        MIN_AULAS_PRACTICAS
    });
});

app.post('/admin/questoes', checkAuth, (req, res) => {
    if (!canAccessQuestionBank(req.session.user)) {
        return res.status(403).send('Acesso não autorizado.');
    }

    const questoes = loadQuestionBank();
    const { pergunta, categoria, opcao1, opcao2, opcao3, opcao4, correta } = req.body;

    if (!pergunta || !opcao1 || !opcao2 || !opcao3 || !opcao4 || correta === undefined) {
        return res.status(400).send('Preencha todos os campos da questão.');
    }

    const novaQuestao = {
        id: Date.now(),
        categoria: (categoria || 'Geral').trim(),
        pergunta: pergunta.trim(),
        opcoes: [opcao1.trim(), opcao2.trim(), opcao3.trim(), opcao4.trim()],
        correta: parseInt(correta, 10),
        explicacao: req.body.explicacao ? req.body.explicacao.trim() : 'Resposta correta conforme legislação e material de formação.'
    };

    questoes.push(novaQuestao);
    saveQuestionBank(questoes);
    res.redirect('/admin/questoes');
});

app.post('/admin/questoes/:id/editar', checkAuth, (req, res) => {
    if (!canAccessQuestionBank(req.session.user)) {
        return res.status(403).send('Acesso não autorizado.');
    }

    const questoes = loadQuestionBank();
    const idx = questoes.findIndex(q => String(q.id) === String(req.params.id));
    if (idx === -1) return res.status(404).send('Questão não encontrada.');

    const { pergunta, categoria, opcao1, opcao2, opcao3, opcao4, correta, explicacao } = req.body;
    if (!pergunta || !opcao1 || !opcao2 || !opcao3 || !opcao4 || correta === undefined) {
        return res.status(400).send('Preencha todos os campos da questão.');
    }

    questoes[idx] = {
        ...questoes[idx],
        categoria: (categoria || 'Geral').trim(),
        pergunta: pergunta.trim(),
        opcoes: [opcao1.trim(), opcao2.trim(), opcao3.trim(), opcao4.trim()],
        correta: parseInt(correta, 10),
        explicacao: explicacao ? explicacao.trim() : questoes[idx].explicacao
    };

    saveQuestionBank(questoes);
    res.redirect('/admin/questoes');
});

app.post('/admin/questoes/:id/delete', checkAuth, (req, res) => {
    if (!canAccessQuestionBank(req.session.user)) {
        return res.status(403).send('Acesso não autorizado.');
    }

    const questoes = loadQuestionBank().filter(q => String(q.id) !== String(req.params.id));
    saveQuestionBank(questoes);
    res.redirect('/admin/questoes');
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log(`Boa Viagem Portal do Aluno ativo em http://localhost:${PORT}`));