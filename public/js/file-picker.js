/**
 * FilePicker — reusable custom file picker with drag-and-drop and thumbnail previews.
 *
 * Usage:
 *   const picker = new FilePicker(containerEl, { accept, multiple, maxFiles });
 *   picker.getFiles()  → FileList-like array
 *   picker.reset()
 */
export class FilePicker {
  /**
   * @param {HTMLElement} container  - element to render into
   * @param {object} opts
   *   accept   {string}  - MIME accept string, e.g. "image/*,video/*"
   *   multiple {boolean} - allow multiple files
   *   maxFiles {number}  - cap, default 10
   *   label    {string}  - zone label, default "Foto's of video's kiezen"
   *   hint     {string}  - small sub-hint
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.accept   = opts.accept   ?? 'image/*,video/*';
    this.multiple = opts.multiple ?? true;
    this.maxFiles = opts.maxFiles ?? 10;
    this.label    = opts.label    ?? "Foto's of video's kiezen";
    this.hint     = opts.hint     ?? 'JPG, PNG, GIF, MP4 · max 50 MB per bestand';
    this._files   = [];
    this._render();
  }

  getFiles() { return this._files; }
  reset() { this._files = []; this._updateUI(); }

  _render() {
    this.container.innerHTML = `
      <div class="file-picker" id="fp-root">
        <input type="file"
               id="fp-input"
               accept="${this.accept}"
               ${this.multiple ? 'multiple' : ''}
               tabindex="0"
               aria-label="${this.label}" />
        <div class="file-picker-zone" id="fp-zone">
          <div class="pick-icon">📎</div>
          <div class="pick-label">${this.label}</div>
          <div class="pick-hint">${this.hint}</div>
        </div>
        <div class="file-picker-previews" id="fp-previews"></div>
      </div>`;

    this._input   = this.container.querySelector('#fp-input');
    this._zone    = this.container.querySelector('#fp-zone');
    this._previews = this.container.querySelector('#fp-previews');

    // Native input change
    this._input.addEventListener('change', () => {
      this._addFiles(Array.from(this._input.files));
      this._input.value = ''; // reset so same file can be re-added
    });

    // Drag-and-drop
    this._zone.addEventListener('dragover', e => {
      e.preventDefault();
      this._zone.classList.add('drag-over');
    });
    this._zone.addEventListener('dragleave', () => {
      this._zone.classList.remove('drag-over');
    });
    this._zone.addEventListener('drop', e => {
      e.preventDefault();
      this._zone.classList.remove('drag-over');
      this._addFiles(Array.from(e.dataTransfer.files));
    });
  }

  _addFiles(incoming) {
    for (const f of incoming) {
      if (this._files.length >= this.maxFiles) break;
      // Deduplicate by name+size
      if (!this._files.some(x => x.name === f.name && x.size === f.size)) {
        this._files.push(f);
      }
    }
    this._updateUI();
  }

  _removeFile(idx) {
    this._files.splice(idx, 1);
    this._updateUI();
  }

  _updateUI() {
    const hasFiles = this._files.length > 0;
    this._zone.classList.toggle('has-files', hasFiles);

    if (hasFiles) {
      this._zone.innerHTML = `
        <div class="pick-icon">✅</div>
        <div class="pick-label">${this._files.length} bestand${this._files.length !== 1 ? 'en' : ''} geselecteerd</div>
        <div class="pick-hint">Klik of sleep om meer toe te voegen (max ${this.maxFiles})</div>`;
    } else {
      this._zone.innerHTML = `
        <div class="pick-icon">📎</div>
        <div class="pick-label">${this.label}</div>
        <div class="pick-hint">${this.hint}</div>`;
    }

    // Render thumbnails
    this._previews.innerHTML = '';
    this._files.forEach((file, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'file-picker-thumb';

      const isVideo = file.type.startsWith('video/');
      const url = URL.createObjectURL(file);

      if (isVideo) {
        thumb.innerHTML = `
          <video src="${url}" muted playsinline style="pointer-events:none"></video>
          <span class="thumb-type">VIDEO</span>`;
      } else {
        thumb.innerHTML = `<img src="${url}" alt="${file.name}" />`;
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'thumb-remove';
      removeBtn.type = 'button';
      removeBtn.innerHTML = '✕';
      removeBtn.setAttribute('aria-label', 'Verwijder bestand');
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        URL.revokeObjectURL(url);
        this._removeFile(idx);
      });
      thumb.appendChild(removeBtn);
      this._previews.appendChild(thumb);
    });
  }
}
