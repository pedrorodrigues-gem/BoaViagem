const assert = require('assert');
const { canSelfMarkAttendance } = require('../attendance');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const start = `${today}T09:30:00`;
const before30 = new Date(new Date(start).getTime() - 30 * 60 * 1000 + 1000);
const after30 = new Date(new Date(start).getTime() + 30 * 60 * 1000 - 1000);
const outside = new Date(new Date(start).getTime() + 31 * 60 * 1000);
const insideWindow = new Date(new Date(start).getTime() + 5 * 60 * 1000);

assert.strictEqual(canSelfMarkAttendance({ role: 'aluno' }, { data: today, hora_inicio: '09:30' }, before30), true, 'deve permitir 30 min antes');
assert.strictEqual(canSelfMarkAttendance({ role: 'aluno' }, { data: today, hora_inicio: '09:30' }, after30), true, 'deve permitir até 30 min depois');
assert.strictEqual(canSelfMarkAttendance({ role: 'aluno' }, { data: today, hora_inicio: '09:30' }, outside), false, 'deve bloquear fora da janela');
assert.strictEqual(canSelfMarkAttendance({ role: 'Aluno' }, { data: today, hora_inicio: '09:30' }, insideWindow), true, 'deve aceitar role em maiúsculas');
assert.strictEqual(canSelfMarkAttendance({ role: 'student' }, { data: today, hora_inicio: '09:30' }, insideWindow), true, 'deve aceitar role alternada de aluno');
assert.strictEqual(canSelfMarkAttendance({ role: 'admin' }, { data: today, hora_inicio: '09:30' }, new Date()), true, 'staff continua autorizado');

console.log('attendance-window tests passed');
