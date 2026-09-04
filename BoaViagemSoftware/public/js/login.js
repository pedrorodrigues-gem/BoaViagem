async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || 'Erro no pedido');
  return json.data;
}

const tabLogin = document.getElementById('tabLogin');
const tabRegisto = document.getElementById('tabRegisto');
const loginForm = document.getElementById('loginForm');
const registoForm = document.getElementById('registoForm');

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active'); tabRegisto.classList.remove('active');
  loginForm.style.display = ''; registoForm.style.display = 'none';
});
tabRegisto.addEventListener('click', () => {
  tabRegisto.classList.add('active'); tabLogin.classList.remove('active');
  registoForm.style.display = ''; loginForm.style.display = 'none';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(loginForm);
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  try {
    await api('POST', '/api/auth/login', { username: fd.get('username'), password: fd.get('password') });
    window.location.href = '/';
  } catch (err) {
    errBox.textContent = err.message;
    errBox.style.display = '';
  }
});

registoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(registoForm);
  const errBox = document.getElementById('registoError');
  errBox.style.display = 'none';
  try {
    await api('POST', '/api/auth/registar', {
      nomeEscola: fd.get('nomeEscola'),
      username: fd.get('username'),
      password: fd.get('password'),
      email: fd.get('email')
    });
    window.location.href = '/';
  } catch (err) {
    errBox.textContent = err.message;
    errBox.style.display = '';
  }
});

// Se já existir sessão válida, avança logo para a app.
api('GET', '/api/auth/me').then(() => { window.location.href = '/'; }).catch(() => {});