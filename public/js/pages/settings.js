import { api, state, navigate, showToast } from '../app.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function render(container) {
  if (!state.user) {
    navigate('profile');
    return;
  }
  const isSuper = state.user.roles?.some(r => r.role === 'super_admin');
  if (!isSuper) {
    showToast('Alleen opperbeheerders hebben toegang tot platform-instellingen.', 'error');
    navigate('profile');
    return;
  }

  container.innerHTML = '<div class="spinner"></div>';

  let list = [];
  try {
    const data = await api('/api/platform/settings');
    list = data.settings || [];
  } catch (err) {
    container.innerHTML = `
      <div class="container mt-4">
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <p>${esc(err.message)}</p>
          <button class="btn btn-primary mt-3" onclick="navigate('profile')">Terug</button>
        </div>
      </div>`;
    return;
  }

  function renderForm() {
    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem"
            onclick="navigate('profile')">← Terug</button>
          <h1 style="color:#fff;font-size:1.35rem;margin:0">Platform-instellingen</h1>
          <p style="color:rgba(255,255,255,0.85);font-size:0.88rem;margin:0.35rem 0 0">
            Functies aan of uit — geldt voor alle gebruikers. Waarden in de database overschrijven <code style="opacity:0.9">.env</code> zolang ze hier staan.
          </p>
        </div>
      </div>
      <div class="container" style="padding-bottom:5rem;margin-top:1rem">
        <div class="card">
          <div class="card-body" style="display:flex;flex-direction:column;gap:1.25rem">
            ${list.map(s => `
              <div class="flex justify-between items-start" style="gap:1rem;border-bottom:1px solid var(--border);padding-bottom:1rem;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                  <div style="font-weight:700">${esc(s.label)}</div>
                  <p class="text-muted text-small" style="margin:0.35rem 0 0">${esc(s.description)}</p>
                  <span class="text-small" style="opacity:0.75">Bron: ${esc(s.source)}</span>
                </div>
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;flex-shrink:0">
                  <input type="checkbox" data-setting-key="${esc(s.key)}" ${s.value ? 'checked' : ''} />
                  <span class="text-small">${s.value ? 'Aan' : 'Uit'}</span>
                </label>
              </div>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" id="settings-save" style="width:100%;margin-top:1rem">Opslaan</button>
      </div>`;

    container.querySelector('#settings-save').addEventListener('click', async () => {
      const patch = {};
      container.querySelectorAll('input[data-setting-key]').forEach(inp => {
        patch[inp.dataset.settingKey] = inp.checked;
      });
      const btn = container.querySelector('#settings-save');
      btn.disabled = true;
      btn.textContent = 'Opslaan…';
      try {
        const out = await api('/api/platform/settings', { method: 'PATCH', body: patch });
        if (out.features) state.features = out.features;
        list = out.settings || list;
        showToast('Instellingen opgeslagen', 'success');
        renderForm();
      } catch (e) {
        showToast(e.message || 'Opslaan mislukt', 'error');
        btn.disabled = false;
        btn.textContent = 'Opslaan';
      }
    });
  }

  renderForm();
}
