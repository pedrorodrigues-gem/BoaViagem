const test = require('node:test');
const assert = require('node:assert/strict');
const { findAlunoBySearchText } = require('../public/js/aluno-search-utils');

test('encontra aluno por nome', () => {
  const alunos = [
    { id: 1, nome: 'Ana Silva', numeroAluno: 12 },
    { id: 2, nome: 'Bruno Costa', numeroAluno: 55 }
  ];

  assert.equal(findAlunoBySearchText(alunos, 'ana').id, 1);
  assert.equal(findAlunoBySearchText(alunos, '12').id, 1);
  assert.equal(findAlunoBySearchText(alunos, 'Bruno Costa').id, 2);
});

test('devolve null para texto sem correspondência', () => {
  const alunos = [{ id: 1, nome: 'Ana Silva', numeroAluno: 12 }];
  assert.equal(findAlunoBySearchText(alunos, 'zzz'), null);
});
