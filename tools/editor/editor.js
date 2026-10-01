// Edit mode UI — only loaded by tools/edit.js, never on the published site.
(function () {
  const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/tiff';

  // ------------------------------------------------------------ status bar
  const bar = document.createElement('div');
  bar.className = 'sc-editbar';
  bar.innerHTML = `
    <span class="sc-editbar__label">Edit mode</span>
    <span class="sc-editbar__status" role="status" aria-live="polite">All changes saved</span>
    <button class="sc-editbar__publish" type="button">Publish</button>`;
  document.body.appendChild(bar);
  const status = bar.querySelector('.sc-editbar__status');
  const publishBtn = bar.querySelector('.sc-editbar__publish');

  let pending = 0;
  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || '';
  }
  function start(text) { pending++; setStatus(text, 'busy'); }
  function done(err) {
    pending = Math.max(0, pending - 1);
    if (err) setStatus(err, 'error');
    else if (!pending) setStatus('All changes saved', 'ok');
  }

  async function api(url, options) {
    const res = await fetch(url, { method: 'POST', ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Clicking an editable thing inside a link shouldn't follow the link
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-edit-text], [data-edit-media]');
    if (target && target.closest('a')) e.preventDefault();
  }, true);

  // ------------------------------------------------------------ text
  document.querySelectorAll('[data-edit-text]').forEach(el => {
    el.contentEditable = 'plaintext-only';
    el.spellcheck = true;
    let original = el.textContent;

    el.addEventListener('focus', () => { original = el.textContent; });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = original; el.blur(); }
    });
    el.addEventListener('blur', async () => {
      const value = el.textContent.replace(/\s+/g, ' ').trim();
      if (value === original.trim()) return;
      if (!value) { el.textContent = original; setStatus('Text can’t be empty', 'error'); return; }
      start('Saving…');
      try {
        const res = await api('/__api/text', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: el.dataset.editText, value }),
        });
        // Same field may appear more than once on a page (e.g. nav + title)
        document.querySelectorAll(`[data-edit-text="${CSS.escape(el.dataset.editText)}"]`)
          .forEach(other => { if (other !== el) other.textContent = res.value; });
        el.textContent = res.value;
        original = res.value;
        done();
      } catch (err) {
        el.textContent = original;
        done(err.message);
      }
    });
  });

  // ------------------------------------------------------------ images
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = ACCEPT;
  picker.hidden = true;
  document.body.appendChild(picker);
  let pickerSlot = null;

  picker.addEventListener('change', () => {
    if (picker.files[0] && pickerSlot) upload(pickerSlot, picker.files[0]);
    picker.value = '';
  });

  async function upload(slot, file) {
    if (!file.type.startsWith('image/')) { setStatus('That isn’t an image', 'error'); return; }
    slot.classList.add('is-uploading');
    start(`Uploading ${file.name}…`);
    try {
      const res = await api(`/__api/media?target=${encodeURIComponent(slot.dataset.editMedia)}`, {
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const prefix = location.pathname.startsWith('/projects/') ? '../' : '';
      const src = `${prefix}${res.src}`;
      // Update every slot bound to the same image (e.g. a cover shown twice)
      document.querySelectorAll(`[data-edit-media="${CSS.escape(slot.dataset.editMedia)}"]`).forEach(s => {
        const img = s.querySelector('img');
        if (img) { img.removeAttribute('loading'); img.src = src; }
        s.removeAttribute('data-empty');
      });
      done();
    } catch (err) {
      done(err.message);
    } finally {
      slot.classList.remove('is-uploading');
    }
  }

  document.querySelectorAll('[data-edit-media]').forEach(slot => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-slot__button';
    btn.innerHTML = '<span class="sc-slot__label"></span>';
    const label = btn.firstChild;
    const refreshLabel = () => {
      label.textContent = slot.hasAttribute('data-empty') ? 'Click or drop to upload' : 'Replace image';
    };
    refreshLabel();
    new MutationObserver(refreshLabel).observe(slot, { attributes: true, attributeFilter: ['data-empty'] });
    slot.appendChild(btn);

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      pickerSlot = slot;
      picker.click();
    });

    slot.addEventListener('dragover', e => {
      if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); slot.classList.add('is-dragover'); }
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('is-dragover'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('is-dragover');
      const file = e.dataTransfer.files[0];
      if (file) upload(slot, file);
    });
  });

  // Don't let a missed drop open the image in the tab
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  // ------------------------------------------------------------ sections
  // Project pages carry #sc-edit-data: { doc, library: [{ name, props }], sections: [{ component, variant }] }
  const dataEl = document.getElementById('sc-edit-data');
  if (dataEl) {
    const data = JSON.parse(dataEl.textContent);
    const libByName = Object.fromEntries(data.library.map(d => [d.name, d]));

    // Keep the scroll position across the reload that follows a structural change
    const saved = sessionStorage.getItem('sc-scroll');
    if (saved) { sessionStorage.removeItem('sc-scroll'); window.scrollTo(0, Number(saved)); }

    async function sectionAction(payload, label) {
      if (pending) { setStatus('Wait for saving to finish', 'error'); return; }
      start(label);
      try {
        await api('/__api/section', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc: data.doc, ...payload }),
        });
        sessionStorage.setItem('sc-scroll', String(window.scrollY));
        location.reload();
      } catch (err) {
        done(err.message);
      }
    }

    const icon = {
      up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3l5 5-1.1 1.1L8.8 6.1V13H7.2V6.1L4.1 9.1 3 8z"/></svg>',
      down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13l-5-5 1.1-1.1 3.1 3V3h1.6v6.9l3.1-3L13 8z"/></svg>',
      dup: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h8v9h-2V4H5zM3 5h7v9H3z"/></svg>',
      del: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l1 1h3v1.5H2V3h3zM3.5 6h9l-.7 8H4.2z"/></svg>',
    };

    const sections = [...document.querySelectorAll('section[data-edit-section]')];
    sections.forEach((el, i) => {
      const info = data.sections[i];
      const bar = document.createElement('div');
      bar.className = 'sc-sectionbar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', `Section ${i + 1}`);

      const def = info && libByName[info.component];
      if (def) {
        const name = document.createElement('span');
        name.className = 'sc-sectionbar__name';
        name.textContent = def.name;
        bar.appendChild(name);
        for (const [prop, values] of Object.entries(def.props || {})) {
          const select = document.createElement('select');
          select.className = 'sc-sectionbar__select';
          select.setAttribute('aria-label', `${def.name} ${prop}`);
          select.innerHTML = values.map(v => `<option${info.variant[prop] === v ? ' selected' : ''}>${v}</option>`).join('');
          select.addEventListener('change', () =>
            sectionAction({ action: 'variant', index: i, variant: { [prop]: select.value } }, 'Changing layout…'));
          bar.appendChild(select);
        }
      }

      const button = (html, label, onClick, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sc-sectionbar__btn';
        b.innerHTML = html;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.disabled = !!disabled;
        b.addEventListener('click', onClick);
        bar.appendChild(b);
      };
      button(icon.up, 'Move section up', () => sectionAction({ action: 'move', index: i, dir: -1 }, 'Moving…'), i === 0);
      button(icon.down, 'Move section down', () => sectionAction({ action: 'move', index: i, dir: 1 }, 'Moving…'), i === sections.length - 1);
      button(icon.dup, 'Duplicate section', () => sectionAction({ action: 'duplicate', index: i }, 'Duplicating…'));
      button(icon.del, 'Delete section', () => {
        if (confirm('Delete this section? Its images are removed too.')) sectionAction({ action: 'delete', index: i }, 'Deleting…');
      });

      el.appendChild(bar);
    });

    // "+ Add section" after the project header and after every section
    function adder(index) {
      const wrap = document.createElement('div');
      wrap.className = 'sc-adder';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-adder__btn';
      btn.textContent = '+ Add section';
      btn.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div');
      menu.className = 'sc-adder__menu';
      menu.hidden = true;
      for (const def of data.library) {
        const group = document.createElement('div');
        group.className = 'sc-adder__group';
        group.innerHTML = `<p class="sc-adder__title">${def.name}</p>`;
        const [prop, values] = Object.entries(def.props || {})[0] || [null, [null]];
        values.forEach(v => {
          const opt = document.createElement('button');
          opt.type = 'button';
          opt.className = 'sc-adder__option';
          opt.textContent = v || def.name;
          opt.addEventListener('click', () => sectionAction(
            { action: 'add', index, component: def.name, variant: prop ? { [prop]: v } : {} }, 'Adding section…'));
          group.appendChild(opt);
        });
        menu.appendChild(group);
      }
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = menu.hidden;
        document.querySelectorAll('.sc-adder__menu').forEach(m => { m.hidden = true; });
        document.querySelectorAll('.sc-adder__btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });
      wrap.append(btn, menu);
      return wrap;
    }
    document.addEventListener('click', e => {
      if (!e.target.closest('.sc-adder')) document.querySelectorAll('.sc-adder__menu').forEach(m => { m.hidden = true; });
    });

    const hero = document.querySelector('section[data-top]');
    if (hero) hero.after(adder(0));
    sections.forEach((el, i) => el.after(adder(i + 1)));
  }

  // ------------------------------------------------------------ publish
  publishBtn.addEventListener('click', async () => {
    if (pending) { setStatus('Wait for saving to finish', 'error'); return; }
    if (!confirm('Publish to philinge.com?\n\nThis commits your changes and pushes them to GitHub, which starts a Netlify deploy.')) return;
    publishBtn.disabled = true;
    start('Publishing…');
    try {
      const res = await api('/__api/publish');
      done();
      setStatus(res.message, 'ok');
    } catch (err) {
      done(err.message);
    } finally {
      publishBtn.disabled = false;
    }
  });
})();
