function normalizeRole(sessionUser) {
    const rawRole = sessionUser && typeof sessionUser.role === 'string' ? sessionUser.role.trim() : '';
    return rawRole.toLowerCase();
}

function isAlunoRole(sessionUser) {
    return ['aluno'].includes(normalizeRole(sessionUser));
}

/**
 * Quem pode marcar presenças por qualquer aluno (não só a sua própria).
 * NOTA: os roles válidos na aplicação são 'super', 'admin', 'instrutor' e
 * 'aluno' (ver server.js). O código antigo verificava 'superuser', que
 * nunca existe como valor de role — por isso o utilizador 'super' nunca
 * caía nesta condição em lado nenhum da aplicação (incluindo o menu do
 * back-office). Foi corrigido para usar os valores reais.
 */
function canManageAttendance(sessionUser) {
    if (!sessionUser) return false;
    const role = normalizeRole(sessionUser);
    if (['admin', 'super', 'staff'].includes(role)) return true;
    return Boolean(sessionUser.isImpersonating);
}

/**
 * Quem pode ver/gerir o back-office de perguntas (banco de questões):
 * visível para todos exceto para o próprio aluno. O 'super' está sempre
 * incluído porque não é um aluno.
 */
function canAccessQuestionBank(sessionUser) {
    if (!sessionUser) return false;
    return !isAlunoRole(sessionUser);
}

function parseClassDateTime(dateValue, timeValue) {
    if (!dateValue || !timeValue) return null;
    const normalizedTime = String(timeValue).trim();
    if (!normalizedTime) return null;

    const safeDate = typeof dateValue === 'string' ? dateValue : dateValue.toISOString ? dateValue.toISOString().slice(0, 10) : String(dateValue);
    const timeWithSeconds = normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime;
    const dt = new Date(`${safeDate}T${timeWithSeconds}`);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
}

function canSelfMarkAttendance(sessionUser, turma, now = new Date()) {
    if (canManageAttendance(sessionUser)) return true;
    if (!sessionUser || !isAlunoRole(sessionUser)) return false;
    if (!turma) return false;

    const dateValue = turma.data || turma.date || turma.data_aula;
    const timeValue = turma.hora_inicio || turma.horaInicio || turma.hora;
    const start = parseClassDateTime(dateValue, timeValue);
    
    // Se não houver data/hora válida, por segurança permite a marcação
    if (!start) return true;

    // Janela de validação:
    // A aula pode ser marcada a qualquer momento a partir de hoje/data da aula 
    // e até 24 horas DEPOIS da hora de início da aula.
    const endWindow = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return now <= endWindow;
}

module.exports = {
    canManageAttendance,
    canSelfMarkAttendance,
    canAccessQuestionBank,
    parseClassDateTime,
    normalizeRole,
    isAlunoRole
};
