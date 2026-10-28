// Edit mode UI — only loaded by tools/edit.js, never on the published site.
(function () {
  // Images and video. The server converts as needed (video → MP4/H.264).
  const ACCEPT = 'image/*,video/*,.heic,.heif,.avif,.webp,.svg,.mov,.m4v,.mkv,.webm';
  const MEDIA_EXT = /\.(jpe?g|png|webp|avif|gif|heic|heif|tiff?|bmp|svg|mp4|m4v|mov|webm|mkv|avi|3gp|ogv)$/i;

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
  let quietTimer = null;
  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || '';
    // The bar is a dot until there's news; it shows briefly, then tucks away
    clearTimeout(quietTimer);
    bar.classList.add('is-active');
    if (kind !== 'busy' && kind !== 'error') quietTimer = setTimeout(() => bar.classList.remove('is-active'), 2500);
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
    const isMedia = /^(image|video)\//.test(file.type) || MEDIA_EXT.test(file.name);
    if (!isMedia) { setStatus('That isn’t an image or video', 'error'); return; }
    const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|3gp|ogv)$/i.test(file.name) || file.type === 'image/gif';
    slot.classList.add('is-uploading');
    start(isVideo ? `Uploading and converting ${file.name}… (videos can take a minute)` : `Uploading ${file.name}…`);
    try {
      const res = await api(`/__api/media?target=${encodeURIComponent(slot.dataset.editMedia)}`, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const prefix = location.pathname.startsWith('/projects/') ? '../' : '';
      // Update every slot bound to the same media (e.g. a cover shown twice)
      document.querySelectorAll(`[data-edit-media="${CSS.escape(slot.dataset.editMedia)}"]`).forEach(s => {
        const old = s.querySelector('img, video');
        let el;
        if (res.type === 'video') {
          el = document.createElement('video');
          Object.assign(el, { autoplay: true, muted: true, loop: true, playsInline: true });
          el.setAttribute('playsinline', '');
          if (res.poster) el.poster = prefix + res.poster;
          el.setAttribute('aria-hidden', 'true');
        } else {
          el = document.createElement('img');
          el.alt = (old && old.getAttribute('alt')) || '';
        }
        if (res.type === 'video') el.setAttribute('muted', '');
        el.src = prefix + res.src;
        if (old) old.replaceWith(el); else s.prepend(el);
        if (res.type === 'video') { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
        syncPosterButton(s);
        s.removeAttribute('data-empty');
      });
      done();
    } catch (err) {
      done(err.message);
    } finally {
      slot.classList.remove('is-uploading');
    }
  }

  // ------------------------------------------------------------ poster picker
  // Video slots get a "Poster" pill: scrub to a frame and use it, or upload an image.
  const posterDialog = document.createElement('dialog');
  posterDialog.className = 'sc-poster';
  posterDialog.innerHTML = `
    <p class="sc-poster__title">Choose poster frame</p>
    <video class="sc-poster__video" muted playsinline preload="auto"></video>
    <div class="sc-poster__scrub">
      <input class="sc-poster__range" type="range" min="0" max="1" step="0.01" value="0" aria-label="Frame">
      <output class="sc-poster__time">0.00s</output>
    </div>
    <div class="sc-poster__actions">
      <button type="button" class="sc-poster__btn" data-act="upload">Upload image…</button>
      <span class="sc-poster__spacer"></span>
      <button type="button" class="sc-poster__btn" data-act="cancel">Cancel</button>
      <button type="button" class="sc-poster__btn sc-poster__btn--primary" data-act="use">Use this frame</button>
    </div>`;
  document.body.appendChild(posterDialog);
  const pv = posterDialog.querySelector('video');
  const range = posterDialog.querySelector('.sc-poster__range');
  const timeOut = posterDialog.querySelector('.sc-poster__time');
  const posterFile = document.createElement('input');
  posterFile.type = 'file';
  posterFile.accept = 'image/*,.heic,.avif,.webp';
  posterFile.hidden = true;
  document.body.appendChild(posterFile);
  let posterSlot = null;

  const showTime = () => { timeOut.textContent = `${Number(range.value).toFixed(2)}s`; };
  pv.addEventListener('loadedmetadata', () => { range.max = pv.duration.toFixed(2); showTime(); });
  range.addEventListener('input', () => { pv.currentTime = Number(range.value); showTime(); });

  function openPoster(slot) {
    const v = slot.querySelector('video');
    if (!v) return;
    posterSlot = slot;
    pv.src = v.getAttribute('src');
    range.value = 0; showTime();
    posterDialog.showModal();
  }

  async function savePoster(body, headers, query) {
    const slot = posterSlot;
    posterDialog.close();
    start('Saving poster…');
    try {
      const res = await api(`/__api/poster?target=${encodeURIComponent(slot.dataset.editMedia)}${query || ''}`, { headers, body });
      const prefix = location.pathname.startsWith('/projects/') ? '../' : '';
      document.querySelectorAll(`[data-edit-media="${CSS.escape(slot.dataset.editMedia)}"] video`)
        .forEach(v => { v.poster = prefix + res.poster; });
      done();
    } catch (err) { done(err.message); }
  }

  posterDialog.addEventListener('click', e => {
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    if (act === 'cancel') posterDialog.close();
    if (act === 'use') savePoster(null, {}, `&t=${encodeURIComponent(range.value)}`);
    if (act === 'upload') posterFile.click();
  });
  posterFile.addEventListener('change', () => {
    const f = posterFile.files[0];
    posterFile.value = '';
    if (f) savePoster(f, { 'Content-Type': f.type || 'application/octet-stream' });
  });
  posterDialog.addEventListener('close', () => { pv.removeAttribute('src'); pv.load(); });

  function syncPosterButton(slot) {
    let btn = slot.querySelector('.sc-slot__poster');
    const hasVideo = !!slot.querySelector('video');
    if (hasVideo && !btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-slot__poster';
      btn.textContent = 'Poster';
      btn.title = 'Choose the frame shown before the video plays';
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPoster(slot); });
      slot.appendChild(btn);
    } else if (!hasVideo && btn) {
      btn.remove();
    }
  }

  document.querySelectorAll('[data-edit-media]').forEach(slot => {
    syncPosterButton(slot);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-slot__button';
    btn.innerHTML = '<span class="sc-slot__label"></span>';
    const label = btn.firstChild;
    const refreshLabel = () => {
      label.textContent = slot.hasAttribute('data-empty') ? 'Click or drop image or video' : 'Replace media';
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

  // ------------------------------------------------------------ structure
  // Nothing here shows until it's relevant. Invisible strips sit between
  // sections, components and columns; hovering one opens it up (the content
  // on either side is pushed apart) to reveal a single action.
  const dataEl = document.getElementById('sc-edit-data');
  if (dataEl) {
    const data = JSON.parse(dataEl.textContent);
    const saved = sessionStorage.getItem('sc-scroll');
    if (saved) { sessionStorage.removeItem('sc-scroll'); window.scrollTo(0, Number(saved)); }

    async function nodeAction(payload, label) {
      if (pending) { setStatus('Wait for saving to finish', 'error'); return; }
      start(label);
      try {
        await api('/__api/node', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc: data.doc, ...payload }),
        });
        sessionStorage.setItem('sc-scroll', String(window.scrollY));
        location.reload();
      } catch (err) { done(err.message); }
    }

    const ICON = {
      up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3l5 5-1.1 1.1L8.8 6.1V13H7.2V6.1L4.1 9.1 3 8z"/></svg>',
      down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13l-5-5 1.1-1.1 3.1 3V3h1.6v6.9l3.1-3L13 8z"/></svg>',
      left: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8l5-5 1.1 1.1-3 3.1H13v1.6H6.1l3 3.1L8 13z"/></svg>',
      right: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8l-5 5-1.1-1.1 3-3.1H3V7.2h6.9l-3-3.1L8 3z"/></svg>',
      dup: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h8v9h-2V4H5zM3 5h7v9H3z"/></svg>',
      del: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l1 1h3v1.5H2V3h3zM3.5 6h9l-.7 8H4.2z"/></svg>',
    };
    // 12px chip icons (Figma: Doc · Structural Rule control chips)
    const ci = d => `<svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">${d}</svg>`;
    const CHIP = {
      'padding.y': ci('<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><path d="M1.5 4h9M1.5 8h9"/>'),
      minHeight: ci('<path d="M6 1.5v9M4 3.5l2-2 2 2M4 8.5l2 2 2-2"/>'),
      bleed: ci('<path d="M1 6h10M3 4L1 6l2 2M9 4l2 2-2 2"/>'),
      padding: ci('<rect x="1.5" y="1.5" width="9" height="9" rx="1"/><rect x="4" y="4" width="4" height="4"/>'),
      max: ci('<path d="M1.5 2v8M10.5 2v8M3.5 6h5"/>'),
      gap: ci('<path d="M2 2v8M10 2v8M4.5 6h3"/>'),
      width: ci('<path d="M1.5 6h9M3.5 4l-2 2 2 2M8.5 4l2 2-2 2"/>'),
      variant: ci('<rect x="1.5" y="1.5" width="4" height="4"/><rect x="6.5" y="1.5" width="4" height="4"/><rect x="1.5" y="6.5" width="4" height="4"/><rect x="6.5" y="6.5" width="4" height="4"/>'),
    };
    const nodes = el => [...el.children].filter(c => c.dataset && c.dataset.node);
    const gapOf = el => parseFloat(getComputedStyle(el)[getComputedStyle(el).flexDirection.startsWith('row') ? 'columnGap' : 'rowGap']) || 0;

    // ---- component picker
    const pickerEl = document.createElement('div');
    pickerEl.className = 'sc-picker';
    pickerEl.hidden = true;
    pickerEl.setAttribute('role', 'dialog');
    pickerEl.setAttribute('aria-label', 'Add component');
    pickerEl.innerHTML = data.library.map(def => {
      const [prop, values] = Object.entries(def.props || {})[0] || [null, [null]];
      return `<div class="sc-picker__group"><p class="sc-picker__name">${def.name}</p>${values.map(v =>
        `<button type="button" class="sc-picker__opt" data-component="${def.name}" data-prop="${prop || ''}" data-value="${v || ''}">${v || def.name}</button>`).join('')}</div>`;
    }).join('');
    document.body.appendChild(pickerEl);
    let pickTarget = null;
    function openPicker(anchor, target) {
      pickTarget = target;
      pickerEl.hidden = false;
      const r = anchor.getBoundingClientRect();
      const left = Math.max(16, Math.min(r.left + r.width / 2 - pickerEl.offsetWidth / 2, innerWidth - pickerEl.offsetWidth - 16));
      pickerEl.style.left = `${left + scrollX}px`;
      pickerEl.style.top = `${r.bottom + scrollY + 8}px`;
      pickerEl.querySelector('button').focus();
    }
    pickerEl.addEventListener('click', e => {
      const b = e.target.closest('.sc-picker__opt');
      if (!b) return;
      nodeAction({ action: 'add-component', path: pickTarget.path, index: pickTarget.index, component: b.dataset.component,
        variant: b.dataset.prop ? { [b.dataset.prop]: b.dataset.value } : {} }, 'Adding component…');
    });
    document.addEventListener('click', e => {
      if (!pickerEl.hidden && !e.target.closest('.sc-picker, .sc-ins__btn, .sc-canvas__btn')) pickerEl.hidden = true;
      if (!menuEl.hidden && !e.target.closest('.sc-menu, .sc-chip')) closeMenu();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { pickerEl.hidden = true; closeMenu(); } });

    // ---- option menu: opens from a control chip; picking an option saves straight away
    const menuEl = document.createElement('div');
    menuEl.className = 'sc-menu';
    menuEl.hidden = true;
    menuEl.setAttribute('role', 'menu');
    document.body.appendChild(menuEl);
    let menuOwner = null;
    function closeMenu() {
      menuEl.hidden = true;
      if (menuOwner) menuOwner.closest('[data-kind]').classList.remove('is-editing');
      menuOwner = null;
    }
    function openMenu(chip, title, options, picked, onPick) {
      if (menuOwner === chip) { closeMenu(); return; }
      closeMenu();
      menuOwner = chip;
      chip.closest('[data-kind]').classList.add('is-editing');
      menuEl.innerHTML = `<p class="sc-menu__name">${title}</p>` + options.map((label, i) =>
        `<button type="button" role="menuitemradio" aria-checked="${i === picked}" class="sc-menu__opt" data-i="${i}">${label}</button>`).join('');
      menuEl.querySelectorAll('.sc-menu__opt').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        closeMenu();
        if (i !== picked) onPick(i);
      }));
      menuEl.hidden = false;
      const r = chip.getBoundingClientRect();
      const left = Math.max(16, Math.min(r.right - menuEl.offsetWidth, innerWidth - menuEl.offsetWidth - 16));
      menuEl.style.left = `${left + scrollX}px`;
      menuEl.style.top = `${r.bottom + scrollY + 6}px`;
      (menuEl.querySelector('[aria-checked="true"]') || menuEl.querySelector('.sc-menu__opt')).focus();
    }

    // ---- insertion strip: zero-size, in the flow; opens on hover.
    // `cancel` offsets the parent's flex gap so nothing moves until hover.
    function strip(axis, label, onClick, cancel) {
      const z = document.createElement('div');
      z.className = `sc-ins sc-ins--${axis}`;
      if (cancel) z.style.setProperty(cancel.prop, `-${cancel.px}px`);
      z.innerHTML = `<span class="sc-ins__hit"></span><button type="button" class="sc-ins__btn"><span>${label}</span></button>`;
      z.querySelector('button').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(e.currentTarget); });
      return z;
    }
    const cancelFor = (parent, index, count, axis) => {
      const px = gapOf(parent);
      if (!px || !count) return null;
      const start = axis === 'x' ? 'margin-left' : 'margin-top';
      const end = axis === 'x' ? 'margin-right' : 'margin-bottom';
      return { prop: index === 0 ? end : start, px };
    };

    // ---- hover chrome (Figma: Doc · Structural Rule): a dashed outline, the
    // level's name on the top-left edge and its control chips on the top-right edge.
    // Outlines and names show for every hovered level; chips only for the innermost.
    function chrome(el, name, items) {
      const tag = document.createElement('span');
      tag.className = 'sc-name';
      tag.textContent = name;
      el.appendChild(tag);
      const tb = document.createElement('div');
      tb.className = 'sc-tb';
      tb.setAttribute('role', 'toolbar');
      tb.setAttribute('aria-label', `${name} controls`);
      for (const it of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `sc-chip${it.text ? '' : ' sc-chip--icon'}`;
        b.innerHTML = it.icon + (it.text ? `<span>${it.text}</span>` : '');
        b.title = it.title || it.text;
        if (!it.text) b.setAttribute('aria-label', it.title);
        b.disabled = !!it.disabled;
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); it.run(b); });
        tb.appendChild(b);
      }
      el.appendChild(tb);
    }
    // Which levels are "hovered": the node under the pointer and its ancestors.
    // Tracked here rather than with :hover so the chrome holds still while the
    // pointer is on a chip (moving onto an outer level's chip would otherwise
    // drop the inner level and shift everything) or while a menu is open.
    let lit = [];
    function light(target) {
      const chain = [];
      for (let n = target && target.closest('[data-kind]'); n; n = n.parentElement && n.parentElement.closest('[data-kind]')) chain.unshift(n);
      if (chain.length === lit.length && chain.every((n, i) => n === lit[i])) return;
      lit.forEach(n => n.classList.remove('is-lit'));
      chain.forEach(n => n.classList.add('is-lit'));
      lit = chain;
      untangle();
    }
    document.addEventListener('pointerover', e => {
      if (menuEl.hidden && !e.target.closest('.sc-tb, .sc-name')) light(e.target);
    });
    document.documentElement.addEventListener('pointerleave', () => { if (menuEl.hidden) light(null); });

    // Nested levels often share an edge (a container that exactly wraps its
    // component), so inner name tags move right and inner chip rows move left
    // until nothing covers the outer level's.
    function untangle() {
      const placed = [];
      for (const el of lit) {
        for (const part of el.querySelectorAll(':scope > .sc-name, :scope > .sc-tb')) {
          part.style.translate = '';
          const r = part.getBoundingClientRect();
          const isTag = part.classList.contains('sc-name');
          let dx = 0;
          for (let n = 0; n < 20; n++) {
            const hit = placed.find(p => r.left + dx < p.right && r.right + dx > p.left && r.top < p.bottom && r.bottom > p.top);
            if (!hit) break;
            dx = isTag ? hit.right + 10 - r.left : hit.left - 10 - r.right;
          }
          if (dx) part.style.translate = `${dx}px 0`;
          placed.push({ left: r.left + dx, right: r.right + dx, top: r.top, bottom: r.bottom });
        }
      }
    }

    // Chips for this level's builder controls (data.controls, from render.js)
    function controlChips(el) {
      const current = JSON.parse(el.dataset.settings || '{}');
      return (data.controls[el.dataset.kind] || []).map(control => {
        const now = current[control.key] ?? null;
        const picked = Math.max(0, control.options.findIndex(o => o.value === now || (o.also || []).includes(now)));
        return { icon: CHIP[control.key] || CHIP.variant, text: control.chip || control.label, title: control.label,
          run: chip => openMenu(chip, control.label, control.options.map(o => o.label), picked, i =>
            nodeAction({ action: 'settings', path: el.dataset.node, key: control.key, value: control.options[i].value },
              `Changing ${control.label.toLowerCase()}…`)) };
      });
    }
    const siblings = el => nodes(el.parentElement);
    const confirmDelete = (what, path) => { if (confirm(`Delete this ${what}? Any media in it is removed too.`)) nodeAction({ action: 'delete', path }, 'Deleting…'); };

    // ---- sections: strips between them, toolbar on hover
    const sections = [...document.querySelectorAll('main > section[data-kind="section"]')];
    const top = document.querySelector('main > section[data-top]');
    const addSectionStrip = index => strip('y', 'Add section', () => nodeAction({ action: 'add-section', index }, 'Adding section…'));
    if (top) top.after(addSectionStrip(0));
    sections.forEach((sec, i) => {
      sec.after(addSectionStrip(i + 1));
      const path = sec.dataset.node;
      chrome(sec, 'Section', [
        ...controlChips(sec),
        { icon: ICON.up, title: 'Move section up', disabled: i === 0, run: () => nodeAction({ action: 'move', path, dir: -1 }, 'Moving…') },
        { icon: ICON.down, title: 'Move section down', disabled: i === sections.length - 1, run: () => nodeAction({ action: 'move', path, dir: 1 }, 'Moving…') },
        { icon: ICON.dup, title: 'Duplicate section', run: () => nodeAction({ action: 'duplicate', path }, 'Duplicating…') },
        { icon: ICON.del, title: 'Delete section', run: () => confirmDelete('section', path) },
      ]);
    });

    // ---- containers & columns
    document.querySelectorAll('[data-kind="container"], [data-kind="column"]').forEach(holder => {
      const path = holder.dataset.node;
      const kids = nodes(holder);
      const isRow = kids.some(k => k.dataset.kind === 'column');

      if (holder.dataset.kind === 'container') chrome(holder, 'Container', controlChips(holder));
      if (holder.dataset.kind === 'column') {
        const sib = siblings(holder), i = sib.indexOf(holder);
        chrome(holder, 'Column', [
          ...controlChips(holder),
          { icon: ICON.left, title: 'Move column left', disabled: i === 0, run: () => nodeAction({ action: 'move', path, dir: -1 }, 'Moving…') },
          { icon: ICON.right, title: 'Move column right', disabled: i === sib.length - 1, run: () => nodeAction({ action: 'move', path, dir: 1 }, 'Moving…') },
          { icon: ICON.del, title: 'Delete column', run: () => confirmDelete('column', path) },
        ]);
      }

      if (isRow) {
        // Between and around columns: "Add column", opening sideways
        for (let i = 0; i <= kids.length; i++) {
          const z = strip('x', 'Add column', () => nodeAction({ action: 'add-column', path, index: i }, 'Adding column…'), cancelFor(holder, i, kids.length, 'x'));
          if (i < kids.length) holder.insertBefore(z, kids[i]); else holder.appendChild(z);
        }
        return;
      }

      // A stack: "Add component" between components, "Add column" at the edges
      if (!kids.length) {
        const canvas = document.createElement('div');
        canvas.className = 'sc-canvas';
        canvas.innerHTML = '<button type="button" class="sc-canvas__btn">Add component</button>';
        canvas.querySelector('button').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPicker(e.currentTarget, { path, index: 0 }); });
        holder.appendChild(canvas);
      } else {
        for (let i = 0; i <= kids.length; i++) {
          const z = strip('y', 'Add component', btn => openPicker(btn, { path, index: i }), cancelFor(holder, i, kids.length, 'y'));
          if (i < kids.length) holder.insertBefore(z, kids[i]); else holder.appendChild(z);
        }
      }
      for (const side of ['start', 'end']) {
        const edge = document.createElement('div');
        edge.className = `sc-edge sc-edge--${side}`;
        edge.innerHTML = '<button type="button" class="sc-edge__btn"><span>Add column</span></button>';
        edge.querySelector('button').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); nodeAction({ action: 'add-column', path, side }, 'Adding column…'); });
        holder.appendChild(edge);
      }
    });

    // ---- components: variant + move / duplicate / delete
    document.querySelectorAll('[data-kind="instance"]').forEach(inst => {
      const path = inst.dataset.node;
      const def = data.library.find(d => d.name === inst.dataset.component);
      const variant = JSON.parse(inst.dataset.variant || '{}');
      const sib = siblings(inst), i = sib.indexOf(inst);
      const items = Object.entries((def && def.props) || {}).map(([prop, values]) => ({
        icon: CHIP.variant, text: prop, title: `${inst.dataset.component} ${prop}`,
        run: chip => openMenu(chip, prop, values, Math.max(0, values.indexOf(variant[prop])), i =>
          nodeAction({ action: 'variant', path, variant: { [prop]: values[i] } }, 'Changing layout…')),
      }));
      items.push(
        { icon: ICON.up, title: 'Move up', disabled: i === 0, run: () => nodeAction({ action: 'move', path, dir: -1 }, 'Moving…') },
        { icon: ICON.down, title: 'Move down', disabled: i === sib.length - 1, run: () => nodeAction({ action: 'move', path, dir: 1 }, 'Moving…') },
        { icon: ICON.dup, title: 'Duplicate', run: () => nodeAction({ action: 'duplicate', path }, 'Duplicating…') },
        { icon: ICON.del, title: 'Delete', run: () => confirmDelete('component', path) },
      );
      chrome(inst, inst.dataset.component, items);
    });
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
