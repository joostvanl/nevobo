/**
 * Gedeelde UI om AI-systeemprompts (trainingsplanner) te beheren.
 * Gebruikt door de trainingsplanner (modal).
 */
import { api, showToast } from './app.js';
import { escHtml } from './escape-html.js';

const aiPromptUi = { config: null, meta: null };

function getAiPromptSlot(env, mode) {
  return aiPromptUi.config?.environments?.[env]?.[mode];
}

function paintTrainingAiPrompts(root, options) {
  const variant = options.variant || 'admin';
  const meta = aiPromptUi.meta;
  const resolved = meta?.resolvedEnvironment || '?';
  const source = meta?.activeFileSource || '?';
  const title =
    variant === 'modal'
      ? 'Systeemprompts AI-assistent'
      : 'AI trainingsplanner — systeemprompts';
  const wrapClass = variant === 'modal' ? 'tp-prompts-editor-wrap' : '';

  root.innerHTML = `
    <div class="${wrapClass}">
    <div class="section-header mb-2"><span class="section-title">${escHtml(title)}</span></div>
    <p class="text-muted text-small mb-2">
      Bestand nu in gebruik: <strong>${escHtml(source)}</strong>.
      Webhook gebruikt omgeving <strong>${escHtml(resolved)}</strong>
      (optioneel: <code>TRAINING_AI_PROMPT_ENV</code> in <code>.env</code>).
    </p>
    <div class="flex gap-2 flex-wrap mb-2" style="align-items:flex-end">
      <label class="text-small" style="display:flex;flex-direction:column;gap:0.25rem">Omgeving
        <select id="ai-p-env" class="form-input" style="min-width:9rem">
          <option value="development">Ontwikkeling</option>
          <option value="production">Productie</option>
        </select>
      </label>
      <label class="text-small" style="display:flex;flex-direction:column;gap:0.25rem">Modus
        <select id="ai-p-mode" class="form-input" style="min-width:11rem">
          <option value="new">Nieuwe planning</option>
          <option value="complete">Aanvullen</option>
          <option value="optimize">Optimaliseren</option>
        </select>
      </label>
    </div>
    <label class="text-small" style="display:block;margin-bottom:0.35rem">Revisies (nieuwste boven)</label>
    <select id="ai-p-rev" class="form-input mb-2" style="width:100%;max-width:100%"></select>
    <label class="text-small" style="display:block;margin-bottom:0.35rem">Prompttekst</label>
    <textarea id="ai-p-text" class="form-input" rows="${variant === 'modal' ? 12 : 14}" style="width:100%;font-family:ui-monospace,monospace;font-size:0.72rem;line-height:1.35"></textarea>
    <div class="flex gap-2 flex-wrap mt-2" style="align-items:center">
      <input type="text" id="ai-p-note" class="form-input" style="flex:1;min-width:12rem" placeholder="Notitie bij nieuwe versie…" />
      <button type="button" class="btn btn-primary btn-sm" id="ai-p-save">Nieuwe versie opslaan</button>
      <button type="button" class="btn btn-secondary btn-sm" id="ai-p-activate">Geselecteerde revisie actief maken</button>
    </div>
    <p class="text-muted text-small mt-2 mb-0">Elke modus heeft een eigen volledige system prompt. Oude revisies blijven bewaard; je kunt terugkeren via “actief maken”.</p>
    <div class="mt-3 pt-3" style="border-top:1px solid var(--border)">
      <button type="button" class="btn btn-ghost btn-sm" id="ai-p-refresh">Herladen van server</button>
      <button type="button" class="btn btn-ghost btn-sm" id="ai-p-import">Live overschrijven met release-bundel (git)</button>
    </div>
    </div>`;

  const envSel = root.querySelector('#ai-p-env');
  const modeSel = root.querySelector('#ai-p-mode');
  if (options.initialEnv === 'development' || options.initialEnv === 'production') {
    envSel.value = options.initialEnv;
  } else {
    envSel.value = resolved === 'development' ? 'development' : 'production';
  }
  const modes = ['new', 'complete', 'optimize'];
  modeSel.value = modes.includes(options.initialMode) ? options.initialMode : 'complete';

  const syncFromSlot = (pickVersion) => {
    const env = envSel.value;
    const mode = modeSel.value;
    const slot = getAiPromptSlot(env, mode);
    const revSel = root.querySelector('#ai-p-rev');
    const revs = (slot?.revisions || []).slice().sort((a, b) => b.version - a.version);
    revSel.innerHTML = revs.length
      ? revs.map((r) => {
          const tail = (r.note || '').slice(0, 48);
          return `<option value="${r.version}">v${r.version} — ${escHtml(r.savedAt || '')} — ${escHtml(tail)}</option>`;
        }).join('')
      : '<option value="">— geen revisies —</option>';
    const want = pickVersion != null ? pickVersion : slot?.activeVersion;
    if (want != null && revs.some((r) => r.version === want)) revSel.value = String(want);
    const v = parseInt(revSel.value, 10);
    const chosen = revs.find((r) => r.version === v);
    root.querySelector('#ai-p-text').value = chosen?.prompt || '';
  };

  syncFromSlot();

  envSel.addEventListener('change', () => syncFromSlot());
  modeSel.addEventListener('change', () => syncFromSlot());
  root.querySelector('#ai-p-rev').addEventListener('change', () => {
    const v = parseInt(root.querySelector('#ai-p-rev').value, 10);
    if (!v) return;
    const env = envSel.value;
    const mode = modeSel.value;
    const slot = getAiPromptSlot(env, mode);
    const r = slot?.revisions?.find((x) => x.version === v);
    if (r) root.querySelector('#ai-p-text').value = r.prompt;
  });

  root.querySelector('#ai-p-save').addEventListener('click', async () => {
    const env = envSel.value;
    const mode = modeSel.value;
    const prompt = root.querySelector('#ai-p-text').value;
    const note = root.querySelector('#ai-p-note').value;
    try {
      const data = await api('/api/training/ai-prompts-config', {
        method: 'PUT',
        body: { environment: env, mode, prompt, note },
      });
      showToast(`Opgeslagen als versie ${data.version}`, '');
      aiPromptUi.config = data.config;
      aiPromptUi.meta = { ...aiPromptUi.meta, ...data.meta };
      root.querySelector('#ai-p-note').value = '';
      syncFromSlot(data.version);
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  root.querySelector('#ai-p-activate').addEventListener('click', async () => {
    const env = envSel.value;
    const mode = modeSel.value;
    const version = parseInt(root.querySelector('#ai-p-rev').value, 10);
    if (!version) return showToast('Geen revisie geselecteerd', 'error');
    try {
      const data = await api('/api/training/ai-prompts-config/activate', {
        method: 'POST',
        body: { environment: env, mode, version },
      });
      showToast(`Actief: versie ${data.activeVersion}`, '');
      aiPromptUi.config = data.config;
      aiPromptUi.meta = { ...aiPromptUi.meta, ...data.meta };
      syncFromSlot(data.activeVersion);
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  root.querySelector('#ai-p-refresh').addEventListener('click', async () => {
    try {
      const data = await api('/api/training/ai-prompts-config');
      aiPromptUi.config = data.config;
      aiPromptUi.meta = data.meta;
      syncFromSlot();
      showToast('Herladen', '');
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  root.querySelector('#ai-p-import').addEventListener('click', async () => {
    if (!window.confirm('Alle live prompt-instellingen (data/training-planner-ai-prompts.json) worden vervangen door de release-bundel uit server/config. Doorgaan?')) return;
    try {
      const data = await api('/api/training/ai-prompts-config/import-bundled', {
        method: 'POST',
        body: { confirm: true },
      });
      aiPromptUi.config = data.config;
      aiPromptUi.meta = { ...aiPromptUi.meta, ...data.meta };
      syncFromSlot();
      showToast('Bundel geïmporteerd', '');
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

/**
 * @param {HTMLElement} rootElement
 * @param {{ variant?: 'admin'|'modal', initialMode?: string, initialEnv?: string }} [options]
 */
export async function mountTrainingAiPromptsEditor(rootElement, options = {}) {
  if (!rootElement) return;
  async function load() {
    const data = await api('/api/training/ai-prompts-config');
    aiPromptUi.config = data.config;
    aiPromptUi.meta = data.meta;
    paintTrainingAiPrompts(rootElement, options);
  }
  try {
    rootElement.innerHTML = '<div class="spinner" style="padding:1rem;text-align:center">AI-prompts laden…</div>';
    await load();
  } catch (e) {
    rootElement.innerHTML = `<p class="text-small text-muted" style="padding:0.5rem">${escHtml(e.message)}</p>`;
  }
}
