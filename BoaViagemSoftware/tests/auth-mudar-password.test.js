const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

test('Validação de mudança de palavra-passe: campos obrigatórios e regras de negócio', () => {
  function validarMudarPassword({ passwordAtual, novaPassword, confirmarPassword }) {
    const atualStr = String(passwordAtual || '').trim();
    const novaStr = String(novaPassword || '').trim();
    const confStr = String(confirmarPassword !== undefined ? confirmarPassword : '').trim();

    if (!atualStr) {
      return 'A palavra-passe atual é obrigatória.';
    }
    if (!novaStr || novaStr.length < 6) {
      return 'A nova palavra-passe deve ter pelo menos 6 caracteres.';
    }
    if (confirmarPassword !== undefined && novaStr !== confStr) {
      return 'A confirmação não coincide com a nova palavra-passe.';
    }
    if (atualStr === novaStr) {
      return 'A nova palavra-passe deve ser diferente da palavra-passe atual.';
    }
    return null;
  }

  // Erro 1: Falta palavra-passe atual
  assert.equal(
    validarMudarPassword({ passwordAtual: '', novaPassword: 'NovaPassword123!', confirmarPassword: 'NovaPassword123!' }),
    'A palavra-passe atual é obrigatória.'
  );

  // Erro 2: Nova palavra-passe curta (< 6)
  assert.equal(
    validarMudarPassword({ passwordAtual: 'Antiga123', novaPassword: '123', confirmarPassword: '123' }),
    'A nova palavra-passe deve ter pelo menos 6 caracteres.'
  );

  // Erro 3: Confirmação não coincide
  assert.equal(
    validarMudarPassword({ passwordAtual: 'Antiga123', novaPassword: 'NovaPassword123!', confirmarPassword: 'OutraPassword123!' }),
    'A confirmação não coincide com a nova palavra-passe.'
  );

  // Erro 4: Nova palavra-passe igual à atual
  assert.equal(
    validarMudarPassword({ passwordAtual: 'MesmaPassword123', novaPassword: 'MesmaPassword123', confirmarPassword: 'MesmaPassword123' }),
    'A nova palavra-passe deve ser diferente da palavra-passe atual.'
  );

  // Sucesso
  assert.equal(
    validarMudarPassword({ passwordAtual: 'Antiga123', novaPassword: 'NovaPassword123!', confirmarPassword: 'NovaPassword123!' }),
    null
  );
});

test('Verificação e hashing de palavra-passe com bcryptjs', () => {
  const passwordOriginal = 'PalavraPasseSegura2026!';
  const hashOriginal = bcrypt.hashSync(passwordOriginal, 10);

  // Validação correta da palavra-passe antiga
  assert.ok(bcrypt.compareSync(passwordOriginal, hashOriginal), 'Deve aceitar a palavra-passe atual correta');
  assert.ok(!bcrypt.compareSync('Errada123', hashOriginal), 'Deve rejeitar palavra-passe incorreta');

  // Criação de nova hash para a nova palavra-passe
  const novaPassword = 'MaisSeguraAinda#99';
  const novaHash = bcrypt.hashSync(novaPassword, 10);
  assert.ok(bcrypt.compareSync(novaPassword, novaHash), 'A nova hash deve validar a nova palavra-passe');
  assert.ok(!bcrypt.compareSync(passwordOriginal, novaHash), 'A nova hash não deve validar a antiga');
});

test('Medidor de força da palavra-passe (verificarForcaPassword)', () => {
  function testarForca(pwd) {
    if (!pwd) return null;
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 2) return 'Fraca';
    if (score <= 3) return 'Razoável';
    return 'Forte';
  }

  assert.equal(testarForca('12345'), 'Fraca');
  assert.equal(testarForca('abcdef12'), 'Razoável');
  assert.equal(testarForca('Abcdef123!'), 'Forte');
});
