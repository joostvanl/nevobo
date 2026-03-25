const fetch = require('node-fetch');

(async () => {
  const login = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'joost@vtcwoerden.nl', password: 'test1234' }),
  });
  const loginData = await login.json();
  if (!loginData.token) { console.error('Login failed:', loginData); return; }
  const token = loginData.token;
  console.log('Logged in');

  console.log('\nFetching nevobo-venues...');
  const t0 = Date.now();
  const r = await fetch('http://localhost:3000/api/training/nevobo-venues', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await r.json();
  console.log(`Done in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(data, null, 2));
})();
