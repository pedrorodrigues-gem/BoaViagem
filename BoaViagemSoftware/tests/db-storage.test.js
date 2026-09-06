const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DB_PATH, TENANTS_DIR, load, save, defaultRoot, defaultTenantData } = require('../db');

if (!DB_PATH) {
  // DB_PATH is not defined in MSSQL mode; skip this legacy JSON test
  process.exit(0);
}

function backupExisting() {
  const backupDir = path.join(__dirname, '..', 'data', '__db-test-backup');
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.mkdirSync(backupDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, path.join(backupDir, 'db.json'));
  }
  if (fs.existsSync(TENANTS_DIR)) {
    fs.cpSync(TENANTS_DIR, path.join(backupDir, 'tenants'), { recursive: true });
  }

  return backupDir;
}

function restoreExisting(backupDir) {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH, { force: true });
  if (fs.existsSync(TENANTS_DIR)) fs.rmSync(TENANTS_DIR, { recursive: true, force: true });

  if (fs.existsSync(path.join(backupDir, 'db.json'))) {
    fs.copyFileSync(path.join(backupDir, 'db.json'), DB_PATH);
  }
  if (fs.existsSync(path.join(backupDir, 'tenants'))) {
    fs.mkdirSync(TENANTS_DIR, { recursive: true });
    fs.cpSync(path.join(backupDir, 'tenants'), TENANTS_DIR, { recursive: true });
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
}

(function () {
  const backupDir = backupExisting();
  try {
    const root = defaultRoot();
    const tenant = defaultTenantData();
    tenant.alunos.push({ id: 1, nome: 'Ana Silva', estado: 'Ativo' });
    tenant._seq.alunos = 1;
    root.tenants['1'] = tenant;

    save(root);

    const persistedRoot = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    assert.ok(persistedRoot.tenants['1'] && persistedRoot.tenants['1'].__storage, 'O root devia guardar metadados do tenant');
    assert.ok(fs.existsSync(path.join(TENANTS_DIR, '1.json')), 'O tenant devia ser escrito para um ficheiro separado');

    const reloaded = load();
    assert.strictEqual(reloaded.tenants['1'].alunos[0].nome, 'Ana Silva');
    assert.strictEqual(reloaded.tenants['1'].alunos[0].estado, 'Ativo');

    console.log('db storage test passed');
  } finally {
    restoreExisting(backupDir);
  }
})();
