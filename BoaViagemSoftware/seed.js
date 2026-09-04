const bcrypt = require('bcryptjs');
const { load, save, nextId, nextEscolaId, defaultTenantData, defaultPrimaveraConfig } = require('./db');

/* ==========================================================
   Base de dados de demonstração — UMA única escola ("Boa Viagem"),
   com dois espaços/locais físicos ("Boa Viagem" e "Estrela da Manhã").
   Os alunos, instrutores, veículos, aulas e turmas ficam associados
   a um espaço (espacoId), mas pertencem sempre à mesma escola/tenant
   e partilham os mesmos acessos (super/admin/instrutor/aluno).
   ========================================================== */

const data = { escolas: [], tenants: {}, _escolaSeq: 0 };

function criarEscola({ nome, username, password, email, telefone, nipc, morada, numeroLicencaIMT, nomeDiretor }) {
  const id = nextEscolaId(data);
  data.escolas.push({
    id,
    nome, username,
    passwordHash: bcrypt.hashSync(password, 10),
    email, telefone, nipc, morada, numeroLicencaIMT, nomeDiretor,
    primavera: { ...defaultPrimaveraConfig() }, // por preencher — a escola configura a sua própria ligação
    dataCriacao: new Date().toISOString()
  });
  data.tenants[id] = defaultTenantData();
  return id;
}

// numeroAluno é gerado automaticamente com o mesmo valor do id sequencial,
// tal como o servidor faz em /api/alunos ao criar um aluno pela interface.
function addAluno(t, a) { const id = nextId(t, 'alunos'); t.alunos.push({ id, numeroAluno: id, ...a }); return id; }
function addInstrutor(t, i) { const id = nextId(t, 'instrutores'); t.instrutores.push({ id, ...i }); return id; }
function addVeiculo(t, v) { const id = nextId(t, 'veiculos'); t.veiculos.push({ id, ...v }); return id; }
function addAula(t, a) { const id = nextId(t, 'aulas'); t.aulas.push({ id, ...a }); return id; }
function addPagamento(t, p) { const id = nextId(t, 'pagamentos'); t.pagamentos.push({ id, ...p }); return id; }
function addItemConta(t, i) { const id = nextId(t, 'itensConta'); t.itensConta.push({ id, ...i }); return id; }
function addUser(t, u) { const id = nextId(t, 'users'); t.users.push({ id, ...u }); return id; }
function espacoPorNome(t, nome) { return t.espacos.find(e => e.nome === nome); }

/* ---------- Escola única: Boa Viagem ---------- */
const idBoaViagem = criarEscola({
  nome: 'Pereira da Silva e Oliveira, Lda.',
  username: 'boaviagem',
  password: 'boaviagemsuper',
  email: 'info@escolasboaviagem.pt',
  telefone: '296 285 878',
  nipc: '512000620',
  morada: 'Rua Ernesto do Canto, no51, São Miguel - Açores, 9500-312 - Ponta Delgada',
  numeroLicencaIMT: 'EC-6601/IMT',
  nomeDiretor: 'Bruno Filipe Rocha Pereira'
});
const t = data.tenants[idBoaViagem];

// A escola nasce com os dois espaços por omissão: "Boa Viagem" e "Estrela da Manhã".
const espBoaViagem = espacoPorNome(t, 'Boa Viagem');
const espEstrela = espacoPorNome(t, 'Estrela da Manhã');

addUser(t, { nome: 'Boa Viagem Super', username: 'boaviagem', passwordHash: bcrypt.hashSync('boaviagemsuper', 10), role: 'super' });
addUser(t, { nome: 'Boa Viagem Admin', username: 'boaviagem_admin', passwordHash: bcrypt.hashSync('boaviagemadmin', 10), role: 'admin' });
addUser(t, { nome: 'Boa Viagem Instrutor', username: 'boaviagem_instrutor', passwordHash: bcrypt.hashSync('boaviageminstrutor', 10), role: 'instrutor' });
addUser(t, { nome: 'Boa Viagem Aluno', username: 'boaviagem_aluno', passwordHash: bcrypt.hashSync('boaviagemaluno', 10), role: 'aluno' });
addUser(t, { nome: 'Ricardo Freitas', username: 'ricardo.freitas', passwordHash: bcrypt.hashSync('marketingboaviagem', 10), role: 'admin' });
addUser(t, { nome: 'Bruno Pereira', username: 'bruno.pereira', passwordHash: bcrypt.hashSync('adminboaviagem', 10), role: 'super' });
/* Aluno atribuído ao espaço "Boa Viagem" */
const a1 = addAluno(t, {
  nome: 'Rita Fernandes', email: 'rita.fernandes@mail.pt', telefone: '912345678',
  categoria: 'B', estado: 'Ativo', dataInscricao: '2026-03-10', aulasTeoricas: 12, aulasPraticas: 8,
  notas: 'Exame teórico marcado.',
  dataNascimento: '2005-04-12', nif: '234567891',
  tipoDocumento: 'CC', numeroDocumento: '15678901 2 ZZ4', validadeDocumento: '2029-04-12',
  morada: 'Rua das Flores, 45, 2.º Dto', codigoPostal: '1200-192', localidade: 'Lisboa',
  dispensaModulos: '',
  atestadoMedico: { dataEmissao: '2026-02-15', dataValidade: '2028-02-15', apto: true },
  examePsicotecnico: { aplicavel: false, dataEmissao: '', dataValidade: '' },
  processoIMT: { numero: 'LA-2026-004521', dataEmissao: '2026-03-12', dataValidade: '2027-03-12' },
  espacoId: espBoaViagem.id
});
/* Aluno atribuído ao espaço "Estrela da Manhã" — mesma escola, local diferente */
const a2 = addAluno(t, {
  nome: 'Miguel Costa', email: 'miguel.costa@mail.pt', telefone: '913456789',
  categoria: 'A2', estado: 'Ativo', dataInscricao: '2026-04-02', aulasTeoricas: 12, aulasPraticas: 3, notas: '',
  dataNascimento: '2003-11-02', nif: '245678912',
  tipoDocumento: 'CC', numeroDocumento: '16789012 3 ZZ5', validadeDocumento: '2030-11-02',
  morada: 'Rua do Comércio, 12', codigoPostal: '4000-153', localidade: 'Porto',
  dispensaModulos: '',
  atestadoMedico: { dataEmissao: '2026-03-20', dataValidade: '2028-03-20', apto: true },
  examePsicotecnico: { aplicavel: false, dataEmissao: '', dataValidade: '' },
  processoIMT: { numero: 'LA-2026-005102', dataEmissao: '2026-04-05', dataValidade: '2027-04-05' },
  espacoId: espEstrela.id
});

const i1 = addInstrutor(t, {
  nome: 'João Pereira', email: 'joao.pereira@boaviagem.pt', telefone: '917000001',
  categorias: ['B', 'A2'], estado: 'Ativo', cargo: 'Instrutor',
  nif: '187654321', tituloProfissionalNumero: 'TIC-2014-3321', tituloProfissionalValidade: '2027-09-01'
});
// Liga o utilizador do tipo 'instrutor' ao registo de instrutor criado
const userInstr = t.users.find(u => u.role === 'instrutor');
if (userInstr) userInstr.instrutorId = i1;

const v1 = addVeiculo(t, {
  matricula: 'AA-11-BB', marca: 'Volkswagen', modelo: 'Polo', categoria: 'B', estado: 'Disponível',
  inspecaoValida: '2027-02-10', seguroInstrucaoValidade: '2026-12-31', dataAfetacaoEscola: '2023-01-15'
});

addAula(t, { alunoId: a1, instrutorId: i1, veiculoId: v1, data: '2026-07-16', hora: '09:00', horaFim: '09:50', duracao: 50, km: null, tipo: 'Prática', modulo: 'Estacionamento e via rápida', estado: 'Agendada', notas: '', espacoId: espBoaViagem.id });
addAula(t, { alunoId: a2, instrutorId: i1, veiculoId: v1, data: '2026-07-16', hora: '10:30', horaFim: '11:20', duracao: 50, km: null, tipo: 'Prática', modulo: 'Curvas e travagem', estado: 'Agendada', notas: '', espacoId: espEstrela.id });

/* Itens de conta corrente do aluno a1 (Rita), replicando o exemplo
   da ficha "Conta Corrente" com Inscrição + módulos + taxas.       */
addItemConta(t, { alunoId: a1, descricao: 'Inscrição', categoria: 'Diversos', valor: 100, ordem: 1 });
addItemConta(t, { alunoId: a1, descricao: 'Módulo de Teórico de condução B', categoria: 'Exames teóricos', valor: 80, ordem: 2 });
addItemConta(t, { alunoId: a1, descricao: 'Taxa de exame 1ª vez ligeiros', categoria: 'Diversos', valor: 180, ordem: 3 });
addItemConta(t, { alunoId: a1, descricao: 'Viatura de exame 1ª vez B e A', categoria: 'Exames práticos', valor: 30, ordem: 4 });
addItemConta(t, { alunoId: a1, descricao: 'Pack 32 aulas práticas', categoria: 'Lições práticas', valor: 300, ordem: 5 });
addItemConta(t, { alunoId: a1, descricao: 'Taxa de emissão de carta', categoria: 'Diversos', valor: 50, ordem: 6 });

/* Um depósito de 250€ é aplicado automaticamente: paga 100% da
   Inscrição (100€) e o restante (150€) fica a pagar parte da
   Taxa de exame (que fica com 30€ de saldo, ~83% paga).          */
addPagamento(t, { alunoId: a1, valor: 250, data: '2026-07-10', descricao: 'Depósito inicial', taxaIva: 23, estado: 'Pago' });
addPagamento(t, { alunoId: a2, valor: 380, data: '2026-04-02', descricao: 'Inscrição categoria A2', taxaIva: 23, estado: 'Pendente' });

save(data);
console.log('Base de dados de demonstração criada em data/db.json');
console.log('');
console.log(`Escola: ${data.escolas[0].nome}`);
console.log(`  super: boaviagem / boaviagemsuper`);
console.log(`  admin: boaviagem_admin / boaviagemadmin`);
console.log(`  instrutor: boaviagem_instrutor / boaviageminstrutor`);
console.log(`  aluno: boaviagem_aluno / boaviagemaluno`);
console.log('');
console.log('Espaços configurados (Configurações > Espaços da escola):');
t.espacos.forEach(e => console.log(`  - ${e.nome} (id ${e.id})`));
console.log('');
console.log(`Rita Fernandes está atribuída ao espaço "${espBoaViagem.nome}".`);
console.log(`Miguel Costa está atribuído ao espaço "${espEstrela.nome}".`);
console.log('');
console.log('Nota: a integração com a Cegid Primavera não vem pré-configurada.');
console.log('Autentica-te e configura-a em Pagamentos > Faturação.');
