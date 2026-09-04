module.exports = {
  apps: [
    {
      name: "gestao-escolas",
      script: "npm",
      args: "start",
      cwd: "./BoaViagemSoftware",
      watch: false
    },
    {
      name: "portal-aluno",
      script: "npm",
      args: "start",
      cwd: "./BoaViagemAluno",
      watch: false
    }
  ]
};