# Boa Viagem — Portal do Aluno — Alterações

Resumo do que foi melhorado neste pacote, organizado pelas quatro áreas pedidas.
Os ficheiros `db.js`, `package.json`, `login.ejs` e `conta-corrente.ejs` mantêm a lógica
original (não foi necessário alterá-los para estes objetivos).

## 1. Exames teóricos e método de avaliação (`server.js`, `testes.ejs`, `admin-questoes.ejs`)

- **Simulado no formato oficial do IMT**: 30 perguntas sorteadas aleatoriamente do banco
  (antes eram sempre as mesmas 3), com aprovação exigindo **≥ 90% de acertos** (no máximo
  3 erros em 30), tal como no exame real — antes o critério era 80% sobre o total do banco,
  o que tornava o teste trivial com apenas 3 perguntas.
- **Cronómetro de 30 minutos** com submissão automática no fim do tempo.
- **Correção pergunta-a-pergunta**: depois de submeter, cada pergunta mostra a opção
  escolhida, a opção correta e a explicação — antes só se via a pontuação final.
- **Desempenho por categoria** (Sinalização, Prioridades, Velocidade, etc.) para o aluno
  perceber onde estudar mais.
- **Histórico de tentativas** persistente por aluno (`data/test-history/<aluno_id>.json`),
  visível na própria página, com as últimas 8 tentativas.
- **Banco de perguntas** expandido de 3 para **42 perguntas em 10 categorias**
  (`data/question-bank.json`). É conteúdo de treino redigido para este projeto — o
  back-office mostra um aviso a lembrar que deve ser revisto face à legislação e ao
  material oficial do IMT antes de ser usado com alunos reais.
- **Back-office**: agora suporta categoria por pergunta e **edição** (antes só permitia
  adicionar/eliminar), e mostra quantas perguntas existem face às 30 necessárias.
- **Método de "pronto para exame"** deixou de ser um valor fixo — combina:
  - a média das últimas 3 tentativas de simulado (≥ 90%), e
  - o cumprimento das horas mínimas de formação (32 práticas / 28 teóricas).
  Só quando ambas as condições são cumpridas é que o aluno aparece como "Pronto para exame".

## 2. Calendário e marcação de presenças (`server.js`, `calendario.ejs`, `dashboard.ejs`)

- **Correção de um bug**: os eventos do calendário eram comparados por objeto `Date`
  contra uma string `YYYY-MM-DD`, pelo que nunca apareciam nos dias certos. Agora as
  datas são normalizadas de forma consistente.
- **Resumo de assiduidade** (aulas práticas/teóricas vs. mínimos exigidos) passou a
  aparecer também no calendário, não só no dashboard.
- **Marcação de presença deixou de poder ser feita pelo próprio aluno.** Um aluno numa
  sessão normal nunca marca a sua própria presença — isso é atribuído apenas à equipa da
  escola (admin/superuser), incluindo através do modo "simular aluno" já existente, que é
  precisamente para isso. O aluno vê agora um estado "A confirmar pelo instrutor". Esta
  validação é feita tanto na vista como no servidor (rota `/aulas/marcar-presenca`).
- A marcação passou a ter dois botões (**Presente** / **Falta**) em vez de só "Marcar",
  tanto no calendário como no dashboard.

## 3. Estilo (`public/style.css`)

O sistema de design (cores da marca, tipografia, cartões, tabelas) já estava bem
estruturado, por isso a intervenção foi cirúrgica em vez de uma reformulação:
- Novos componentes visuais: cronómetro do exame, perguntas corrigidas (verde/vermelho),
  badges de categoria, barras de progresso por categoria, chips de estado "✔ / ○" na
  prontidão, e ações de presença lado-a-lado.
- Correção de uma inconsistência (`status-chip-warn` em falta) que fazia o chip de estado
  "a melhorar" perder a cor.

## 4. Outras notas técnicas

- Todos os `.ejs` foram validados por compilação e renderização com dados simulados.
- A lógica de aprovação (27/30) foi testada isoladamente.
- O simulado guarda os IDs exatos das perguntas mostradas na sessão do utilizador, para
  garantir que a submissão é avaliada sobre as mesmas perguntas que o aluno viu (e não
  sobre o banco inteiro, que pode ter mudado entretanto).

## Por rever antes de produção

- **Conteúdo das perguntas**: valide cada pergunta/resposta do `data/question-bank.json`
  com o Código da Estrada em vigor e o material do IMT.
- **`SESSION_SECRET`**: continua com um valor por omissão no código; defina-o em
  `config.env`.
- O `data/test-history/` é armazenamento local em ficheiro — se o portal correr em vários
  processos/servidores, considere mover este histórico para a base de dados SQL Server.
