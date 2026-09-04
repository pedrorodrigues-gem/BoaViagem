/* ==========================================================
   Script de migração ÚNICA para dados reais (data/db.json).

   Cenário: existem hoje duas "escolas" (dois tenants/logins
   separados) quando na realidade é a MESMA empresa com dois
   espaços físicos diferentes. Este script funde a escola a
   remover na escola a manter, criando (ou reaproveitando) um
   espaço com o nome da escola removida, e apaga a escola a mais.

   USO:
     node merge-escolas.js --keep=<username_ou_id> --remove=<username_ou_id> [--dry-run]

   Exemplo (empresa "Boa Viagem" a manter, "Estrela da Manhã" a remover
   e a passar a ser apenas um espaço dentro de "Boa Viagem"):
     node merge-escolas.js --keep=boaviagem --remove=estreladamanha

   Por omissão faz uma cópia de segurança de data/db.json antes de gravar
   (data/db.json.bak-<timestamp>). Usa --dry-run para veres o resumo sem
   gravar nada.
   ========================================================== */

const fs = require('fs');
const path = require('path');
const { load, save, DB_PATH, mergeEscolas } = require('./db');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

function findEscola(data, ref) {
  if (ref === undefined) return null;
  const asId = Number(ref);
  if (!Number.isNaN(asId)) {
    const byId = data.escolas.find(e => e.id === asId);
    if (byId) return byId;
  }
  const u = String(ref).trim().toLowerCase();
  return data.escolas.find(e => String(e.username || '').toLowerCase() === u) || null;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.keep || !args.remove) {
    console.error('Uso: node merge-escolas.js --keep=<username_ou_id> --remove=<username_ou_id> [--dry-run] [--nome-espaco="Nome"]');
    process.exit(1);
  }

  const data = load();
  console.log('Escolas atualmente na base de dados:');
  data.escolas.forEach(e => console.log(`  - id ${e.id} · username "${e.username}" · ${e.nome}`));
  console.log('');

  const keepEscola = findEscola(data, args.keep);
  const removeEscola = findEscola(data, args.remove);
  if (!keepEscola) { console.error(`Não encontrei nenhuma escola para --keep="${args.keep}".`); process.exit(1); }
  if (!removeEscola) { console.error(`Não encontrei nenhuma escola para --remove="${args.remove}".`); process.exit(1); }

  console.log(`Vou manter:  id ${keepEscola.id} · ${keepEscola.nome}`);
  console.log(`Vou remover: id ${removeEscola.id} · ${removeEscola.nome} (passa a ser o espaço "${args['nome-espaco'] || removeEscola.nome}" dentro da escola mantida)`);
  console.log('');

  const resumo = mergeEscolas(data, keepEscola.id, removeEscola.id, {
    nomeEspaco: args['nome-espaco']
  });

  console.log('Resumo da fusão:');
  console.log(`  Espaço de destino: "${resumo.espacoDestino.nome}" (id ${resumo.espacoDestino.id})`);
  console.log(`  Alunos migrados: ${resumo.alunosMigrados}`);
  console.log(`  Instrutores migrados: ${resumo.instrutoresMigrados}`);
  console.log(`  Veículos migrados: ${resumo.veiculosMigrados}`);
  console.log(`  Aulas migradas: ${resumo.aulasMigradas}`);
  console.log(`  Turmas teóricas migradas: ${resumo.turmasMigradas}`);
  console.log('  Nota: os logins (users) da escola removida foram descartados —');
  console.log('  a escola fundida usa apenas os acessos da escola mantida.');
  console.log('');

  if (args['dry-run']) {
    console.log('--dry-run ativo: nada foi gravado em disco.');
    return;
  }

  if (fs.existsSync(DB_PATH)) {
    const backupPath = `${DB_PATH}.bak-${Date.now()}`;
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`Cópia de segurança criada em: ${backupPath}`);
  }

  save(data);
  console.log(`Guardado em: ${DB_PATH}`);
  console.log('Concluído.');
}

main();
