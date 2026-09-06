function normalizeSearch(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function findAlunoBySearchText(alunos, text) {
  if (!Array.isArray(alunos) || !text) return null;
  const q = normalizeSearch(text);
  if (!q) return null;

  for (const a of alunos) {
    if (!a) continue;
    const nome = normalizeSearch(a.nome);
    const num = String(a.numeroAluno ?? a.id ?? '');
    const nif = String(a.nif ?? '');
    const email = normalizeSearch(a.email);

    if (nome === q || num === q || nif === q || email === q) {
      return a;
    }
    if (nome.includes(q) || num.includes(q) || (nif && nif.includes(q)) || (email && email.includes(q))) {
      return a;
    }
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findAlunoBySearchText, normalizeSearch };
}
if (typeof window !== 'undefined') {
  window.findAlunoBySearchText = findAlunoBySearchText;
  window.normalizeSearch = normalizeSearch;
}
