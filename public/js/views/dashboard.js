// Dashboard: projects + sound effects library
import { $, h, fmtDate, fmtTime, toast, modal, icon, uid } from '../util.js';
import { api, fileUrl } from '../api.js';
import { logoSvg, SCENES } from '../scenes/renderer.js';
import { BUILTIN_SFX, renderBuiltin } from '../audio/sfxlib.js';
import { decodeUrl, SR } from '../audio/engine.js';
import { previewAudio, createWaveBox } from '../preview.js';
import { sfxStore } from '../audio/sfxstore.js';
import { createSfxFolders } from '../audio/sfxui.js';
import { createFreesoundBrowser } from '../audio/freesound.js';

const SCENE_COLOR = { transmission: '#3b8fe0', urgent: '#ff3b3b', ai: '#8b5cf6' };

function newProjectDialog() {
  return new Promise((resolve) => {
    let type = 'audio', busy = false;
    const name = h('input', { class: 'input', id: 'new-project-name', placeholder: 'Bijv. Missie 3 – briefing', maxlength: 120, required: true });
    const choices = h('div', { class: 'project-type-choices', role: 'group', 'aria-label': 'Projecttype' });
    const buttons = [
      ['audio', 'Audio Terminal', 'Neem je stem op, bewerk audio en kies een videoscène.', 'wave'],
      ['file', 'File Terminal', 'Open afbeeldingen in een geanimeerde bestandsverkenner.', 'folder'],
      ['keyboard', 'Toetsenbord Stickers', 'Kies QWERTY, AZERTY of QWERTZ en exporteer een sticker-animatie per toets.', 'keyboard'],
    ].map(([key, label, desc, ico]) => h('button', {
      type: 'button', class: `project-type-choice${key === type ? ' on' : ''}`, 'aria-pressed': String(key === type), 'data-type': key,
      onclick: () => { type = key; buttons.forEach((b) => { b.classList.toggle('on', b.dataset.type === type); b.setAttribute('aria-pressed', String(b.dataset.type === type)); }); }
    }, icon(ico), h('b', {}, label), h('span', {}, desc)));
    choices.append(...buttons);
    const close = (data) => { if (busy) return; busy = true; dialog.close(); dialog.remove(); resolve(data); };
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); close({ name: name.value.trim() || 'Nieuw project', type }); } },
      h('h2', {}, 'Nieuw project'), h('p', { class: 'muted' }, 'Wat wil je maken?'), choices,
      h('label', { class: 'field' }, 'Projectnaam', name), h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Annuleren'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Aanmaken')));
    const dialog = h('dialog', { class: 'project-create-dialog', 'aria-label': 'Nieuw project', oncancel: (e) => { e.preventDefault(); close(null); }, onclick: (e) => { if (e.target === dialog) close(null); } }, form);
    document.body.append(dialog); dialog.showModal(); name.focus();
  });
}

export async function mount(root, { tab = 'projects' } = {}) {
  let current = tab;
  const body = h('div');
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const ink = h('span', { class: 'tab-ink' });
  const tabs = [
    ['projects', '🎬  Projecten'],
    ['sfx', '🔊  Sound effects'],
  ].map(([id, label]) => h('button', { class: 'tab', id: `tab-${id}`, role: 'tab', onclick: () => select(id) }, label));
  tabsEl.append(ink, ...tabs);

  root.append(h('section', { class: 'dash' },
    h('div', { class: 'hero' },
      h('div', {},
        h('h1', {}, 'Maak je ', h('span', { class: 'grad' }, 'transmissies'), '.'),
        h('p', {}, 'Maak een Audio Terminal met je stem, of een File Terminal met afbeeldingen. Exporteer je verhaal als video of alleen audio.'))),
    tabsEl, body));

  function select(id) {
    current = id;
    tabs.forEach((t) => t.classList.toggle('active', t.id === `tab-${id}`));
    const act = tabs.find((t) => t.classList.contains('active'));
    requestAnimationFrame(() => { ink.style.left = act.offsetLeft + 'px'; ink.style.width = act.offsetWidth + 'px'; });
    history.replaceState(null, '', id === 'sfx' ? '#/library' : '#/');
    previewAudio.stop();
    (id === 'projects' ? renderProjects : renderSfx)();
  }

  async function newProject() {
    const data = await newProjectDialog();
    if (!data) return;
    const p = await api.createProject(data);
    location.hash = `#/project/${p.id}`;
  }

  async function renderProjects() {
    body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    let list;
    try { list = await api.projects(); } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, 'Server niet bereikbaar: ' + e.message)); return; }
    if (current !== 'projects') return;
    const grid = h('div', { class: 'grid' });
    grid.append(h('div', { class: 'card card-new glass', id: 'card-new', onclick: newProject, style: { '--i': 0 } },
      h('div', {}, h('div', { class: 'plus' }, icon('plus')), h('div', { style: { marginTop: '12px', fontWeight: 600 } }, 'Nieuw project'), h('div', { class: 'hint' }, 'Audio Terminal, File Terminal of Toetsenbord'))));
    list.forEach((p, i) => grid.append(projectCard(p, i + 1)));
    body.replaceChildren(grid);
    if (!list.length) body.append(h('p', { class: 'empty' }, 'Nog geen projecten — maak je eerste transmissie! 🕵️'));
  }

  function projectCard(p, i) {
    const color = SCENE_COLOR[p.scene] || SCENE_COLOR.transmission;
    const thumb = h('div', { class: `card-thumb ${p.scene}`, style: { color }, html: logoSvg('currentColor') });
    const bars = h('div', { class: 'bars' }, ...Array.from({ length: 13 }, (_, k) => h('i', { style: { '--k': k } })));
    thumb.append(bars);
    if (p.type === 'file') { thumb.replaceChildren(icon('folder'), h('span', { class: 'file-project-label' }, '> FILE TERMINAL')); thumb.classList.add('file-project-thumb'); }
    if (p.type === 'keyboard') {
      const sw = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map((c) => h('i', { style: { background: c } }));
      thumb.replaceChildren(icon('keyboard'), h('div', { class: 'kb-thumb-dots' }, ...sw), h('span', { class: 'file-project-label' }, '⌨ KEYBOARD STICKERS'));
      thumb.classList.add('keyboard-project-thumb');
    }
    const kbLayout = (p.keyboard_opts?.layout || 'qwerty').toUpperCase();
    const kbCount = Array.isArray(p.keyboard_opts?.selectedKeys) ? p.keyboard_opts.selectedKeys.length : 26;
    const card = h('article', { class: 'card glass', id: `project-${p.id}`, style: { '--i': i }, onclick: () => (location.hash = `#/project/${p.id}`) },
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-sm btn-icon', title: 'Hernoemen', onclick: (e) => { e.stopPropagation(); rename(p); } }, icon('edit')),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Dupliceren', onclick: (e) => { e.stopPropagation(); duplicate(p); } }, icon('copy')),
        h('button', { class: 'btn btn-sm btn-icon btn-danger', title: 'Verwijderen', onclick: (e) => { e.stopPropagation(); remove(p); } }, icon('trash'))),
      thumb,
      h('h3', {}, p.name),
      h('div', { class: 'card-meta' },
        h('span', {}, p.type === 'keyboard' ? 'Toetsenbord Stickers' : p.type === 'file' ? 'File Terminal' : 'Audio Terminal'),
        h('span', {}, p.type === 'keyboard' ? `${kbLayout} · ${kbCount} toetsen` : p.type === 'file' ? `${p.image_count} afbeeldingen` : `${p.asset_count} audio`),
        p.export_count ? h('span', {}, `🎞 ${p.export_count}`) : null,
        p.duration ? h('span', {}, fmtTime(p.duration)) : null),
      h('div', { class: 'card-meta', style: { marginTop: '6px', fontSize: '12px' } }, h('span', {}, 'Bewerkt ' + fmtDate(p.updated_at))));
    return card;
  }

  async function rename(p) {
    const name = await modal({ title: 'Project hernoemen', confirm: 'Opslaan', input: { value: p.name } });
    if (!name?.trim()) return;
    await api.updateProject(p.id, { name: name.trim() });
    toast('Hernoemd', 'ok'); renderProjects();
  }

  async function duplicate(p) {
    const full = await api.project(p.id);
    const copy = await api.createProject({ name: `${p.name} (kopie)`, scene: p.scene, type: p.type });
    await api.updateProject(copy.id, { scene_opts: full.scene_opts, file_opts: full.file_opts, keyboard_opts: full.keyboard_opts });
    toast('Instellingen gedupliceerd (zonder bestanden)', 'ok'); renderProjects();
  }

  async function remove(p) {
    const ok = await modal({ title: `"${p.name}" verwijderen?`, body: 'Alle bestanden en exports van dit project worden definitief verwijderd.', confirm: 'Verwijderen', danger: true });
    if (!ok) return;
    await api.deleteProject(p.id);
    toast('Project verwijderd', 'ok'); renderProjects();
  }

  // ---------- SFX library ----------
  let fsBrowser = null;
  async function renderSfx() {
    fsBrowser?.destroy();
    let sfxFilter = 'all';
    let custom = [];
    const search = h('input', { class: 'input', id: 'sfx-search', placeholder: 'Zoek op naam of categorie…', type: 'search', 'aria-label': 'Sound effects zoeken' });
    const fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, id: 'sfx-file' });
    let targetCategory = 'Eigen';

    const newFolderBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      title: 'Nieuwe map maken',
      onclick: async () => {
        const n = await modal({ title: 'Nieuwe map maken', confirm: 'Maken', input: { placeholder: 'Mapnaam…' } });
        if (n?.trim()) {
          sfxStore.addCustomFolder(n.trim());
          sfxStore.setCollapsed(n.trim(), false);
          search.value = '';
          sfxFilter = 'all';
          toast(`Map "${n.trim()}" gemaakt`, 'ok');
          fsBrowser?.refreshFolders();
          paint();
        }
      }
    }, icon('folderPlus'), 'Nieuwe map');

    const toggleAllBtn = h('button', { class: 'btn btn-sm btn-ghost', id: 'sfx-collapse-all-btn', type: 'button' });
    const folders = createSfxFolders(toggleAllBtn);

    const drop = h('button', {
      class: 'dropzone sfx-upload-zone', type: 'button',
      id: 'sfx-drop',
      onclick: () => { targetCategory = 'Eigen'; fileIn.click(); }
    }, icon('upload'), h('span', {}, h('b', {}, 'Eigen geluiden uploaden'), h('span', {}, 'Kies audiobestanden of sleep ze hierheen. Beschikbaar in elk project.')));

    fsBrowser = createFreesoundBrowser({
      getCustomSfx: () => custom,
      getFolders: () => sfxStore.getCustomFolders(custom),
      onImported: () => draw(),
    });

    const filterBar = h('div', { class: 'sfx-filter-bar', role: 'group', 'aria-label': 'Effecten filteren' });
    const list = h('div', { class: 'sfx-library-list' });
    body.replaceChildren(
      h('div', { class: 'sfx-library-heading' }, h('h2', {}, 'Geluidenbibliotheek'), h('p', {}, 'Beluister effecten, zoek op Freesound.org en bewaar je favorieten voor je volgende transmissie.')),
      fsBrowser.el,
      drop,
      h('div', { class: 'sfx-controls' },
        h('div', { class: 'lib-head' }, search, newFolderBtn),
        h('div', { class: 'sfx-filter-row' }, filterBar, toggleAllBtn)),
      fileIn,
      list
    );

    const upload = async (files) => {
      files = [...files].filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(f.name));
      if (!files.length) return toast('Geen audiobestanden gevonden', 'err');
      const allFolders = sfxStore.getCustomFolders(custom);
      const catRes = await modal({
        title: `${files.length} effect(en) uploaden`,
        body: 'Kies een map of typ een nieuwe:',
        select: {
          options: allFolders.map((f) => ({ value: f, label: `📁 ${f}` })),
          value: targetCategory || 'Eigen'
        },
        input: { placeholder: 'Of nieuwe mapnaam…' },
        confirm: 'Uploaden'
      });
      if (catRes === null) return;
      const cat = (typeof catRes === 'object' ? (catRes.input?.trim() || catRes.select) : catRes).trim() || 'Eigen';
      try {
        const rows = await api.uploadSfx(files, cat);
        await Promise.all(rows.map(async (r) => { try { const pcm = await decodeUrl(fileUrl.sfx(r)); await api.updateSfx(r.id, { duration: pcm.length / SR }); } catch {} }));
        sfxStore.addCustomFolder(cat);
        toast(`${rows.length} effect(en) toegevoegd aan "${cat}"`, 'ok'); draw();
      } catch (e) { toast(e.message, 'err'); }
    };
    fileIn.onchange = () => { upload(fileIn.files); fileIn.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => upload(e.dataTransfer.files));

    const draw = async () => {
      custom = await api.sfx().catch(() => []);
      fsBrowser?.refreshFolders();
      paint();
    };

    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const isSearching = Boolean(q);
      folders.reset(q);
      const match = (s) => {
        if (!q) return true;
        const dn = sfxStore.getName(s).toLowerCase();
        const orig = (s.name || '').toLowerCase();
        const cat = (s.category || '').toLowerCase();
        return dn.includes(q) || orig.includes(q) || cat.includes(q);
      };

      list.replaceChildren();

      const allSounds = [
        ...custom.map((s) => ({ ...s, src: { type: 'sfx', id: s.id } })),
        ...BUILTIN_SFX.map((s) => ({ ...s, src: { type: 'builtin', key: s.key } }))
      ];
      const totalFavCount = allSounds.filter((s) => sfxStore.isFavorite(s)).length;

      filterBar.replaceChildren(
        h('button', {
          class: `sfx-filter-chip${sfxFilter === 'all' ? ' active' : ''}`,
          'aria-pressed': String(sfxFilter === 'all'),
          onclick: () => { sfxFilter = 'all'; paint(); }
        }, 'Alles'),
        h('button', {
          class: `sfx-filter-chip fav-chip${sfxFilter === 'fav' ? ' active' : ''}`,
          'aria-pressed': String(sfxFilter === 'fav'),
          onclick: () => { sfxFilter = 'fav'; paint(); }
        }, icon('starFilled'), `Favorieten (${totalFavCount})`)
      );

      const buildSection = (key, title, iconName, count, isFavGroup, items, isCustom) => {
        return folders.folder({ key, title, iconName, count, isFavGroup, bodyClass: 'sfx-grid',
          children: items.map((s, i) => tile(s, i, s.src?.type === 'sfx' || isCustom)),
          emptyText: isFavGroup ? (q ? 'Geen favorieten gevonden met deze zoekterm.' : 'Klik op een ster bij een geluid om het hier te bewaren.') : 'Nog geen eigen geluiden. Upload je eerste audiobestand.' });
      };

      // 1. Favorites
      const matchingFavs = allSounds.filter((s) => sfxStore.isFavorite(s) && match(s));
      if (sfxFilter === 'fav' || matchingFavs.length > 0) {
        list.append(buildSection('⭐ Favorieten', 'Favorieten', 'starFilled', matchingFavs.length, true, matchingFavs, false));
      }

      if (sfxFilter !== 'fav') {
        // 2. Custom Folders
        const customFolders = sfxStore.getCustomFolders(custom);
        customFolders.forEach((folderName) => {
          const inFolder = custom.filter((s) => (s.category || 'Eigen') === folderName && match(s));
          if (isSearching && !inFolder.length) return;
          if (inFolder.length || !isSearching) {
            list.append(buildSection(folderName, folderName, 'folder', inFolder.length, false, inFolder, true));
          }
        });

        // 3. Built-in
        const groups = {};
        BUILTIN_SFX.filter(match).forEach((s) => (groups[s.category] ||= []).push(s));
        for (const [cat, items] of Object.entries(groups)) {
          list.append(buildSection(cat, cat, 'wave', items.length, false, items, false));
        }
      }

      if (!list.children.length) list.append(h('p', { class: 'empty' }, 'Niets gevonden.'));
      folders.sync();
    };

    const tile = (s, i, isCustom) => {
      const isFav = sfxStore.isFavorite(s);
      const displayName = sfxStore.getName(s);
      const hasAlias = sfxStore.hasAlias(s);

      const playBtn = h('button', { class: 'play', title: 'Voorbeluisteren', 'aria-label': `${displayName} beluisteren` }, icon('play'));
      playBtn.addEventListener('statechange', (e) => playBtn.replaceChildren(icon(e.detail ? 'pause' : 'play')));
      playBtn.onclick = async () => {
        if (isCustom) previewAudio.playUrl(fileUrl.sfx(s), playBtn);
        else previewAudio.playPcm(await renderBuiltin(s.key), playBtn);
      };

      const favBtn = h('button', {
        class: `btn btn-ghost btn-sm btn-icon btn-fav${isFav ? ' active' : ''}`,
        title: isFav ? 'Verwijder uit favorieten' : 'Als favoriet markeren',
        'aria-pressed': String(isFav),
        'aria-label': `${displayName} ${isFav ? 'uit favorieten verwijderen' : 'als favoriet markeren'}`,
        onclick: (e) => { e.stopPropagation(); sfxStore.toggleFavorite(s); fsBrowser?.refreshFolders(); paint(); }
      }, icon(isFav ? 'starFilled' : 'star'));

      const options = h('div', { class: 'sfx-options', id: uid('sfx-options'), popover: 'auto', 'aria-label': `Opties voor ${displayName}` });
      const optionsBtn = h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Meer opties', 'aria-label': `Opties voor ${displayName}`, popovertarget: options.id }, icon('more'));
      options.addEventListener('beforetoggle', (e) => {
        if (e.newState !== 'open') return;
        const rect = optionsBtn.getBoundingClientRect();
        options.style.left = Math.max(8, Math.min(rect.right - 210, innerWidth - 218)) + 'px';
        options.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 160)) + 'px';
      });
      options.addEventListener('click', (e) => { if (e.target.closest('button')) options.hidePopover(); });
      const acts = h('div', { class: 'acts' }, favBtn, optionsBtn, options);

      if (isCustom) {
        options.append(
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Hernoemen', onclick: async () => {
            const name = await modal({ title: 'Effect hernoemen', confirm: 'Opslaan', input: { value: displayName } });
            if (name?.trim() && name.trim() !== displayName) {
              await api.updateSfx(s.id, { name: name.trim() });
              s.name = name.trim();
              sfxStore.setAlias(s, name.trim());
              draw();
            }
          } }, icon('edit')),
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Verplaatsen naar map…', onclick: async () => {
            const allFolders = sfxStore.getCustomFolders(custom);
            const res = await modal({
              title: 'Verplaatsen naar map',
              body: 'Kies een map of typ een nieuwe:',
              select: { options: allFolders.map((f) => ({ value: f, label: `📁 ${f}` })), value: s.category || 'Eigen' },
              input: { placeholder: 'Of nieuwe mapnaam…' },
              confirm: 'Verplaatsen'
            });
            if (res) {
              const target = (typeof res === 'object' ? (res.input?.trim() || res.select) : res).trim();
              if (target && target !== s.category) {
                await api.updateSfx(s.id, { category: target });
                s.category = target;
                sfxStore.addCustomFolder(target);
                draw();
              }
            }
          } }, icon('folderMove')),
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Verwijderen', onclick: async () => {
            if (await modal({ title: `"${displayName}" verwijderen?`, confirm: 'Verwijderen', danger: true })) {
              await api.deleteSfx(s.id);
              if (isFav) sfxStore.toggleFavorite(s);
              sfxStore.resetAlias(s);
              toast('Verwijderd', 'ok');
              draw();
            }
          } }, icon('trash'))
        );
      } else {
        options.append(
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Hernoemen', onclick: async () => {
            const name = await modal({ title: 'Geluid hernoemen', confirm: 'Opslaan', input: { value: displayName } });
            if (name?.trim()) { sfxStore.setAlias(s, name.trim()); paint(); }
          } }, icon('edit'))
        );
      }

      [...options.children].forEach((button) => {
        button.className = 'sfx-option-action';
        button.append(h('span', {}, button.title));
      });

      const waveBox = createWaveBox({
        key: isCustom ? `sfx:${s.id}` : `builtin:${s.key}`,
        audioUrl: isCustom ? fileUrl.sfx(s) : null,
        loadPcm: isCustom ? null : () => renderBuiltin(s.key),
        duration: s.duration || 0,
        playBtn,
      });

      return h('div', { class: 'fs-wave-card', style: { '--i': i } },
        waveBox,
        h('div', { class: 'fs-wave-meta' },
          h('div', { class: 'info' },
            h('div', { class: 'name', title: displayName }, displayName),
            h('div', { class: 'sub' }, hasAlias ? h('span', { class: 'badge', style: { fontSize: '9px', padding: '1px 4px', marginRight: '4px' } }, 'aangepast') : null, `${s.category || 'Eigen'}${s.duration ? ' · ' + s.duration.toFixed(1) + 's' : ''}`)),
          acts
        )
      );
    };

    search.oninput = paint;
    draw();
  }

  select(current);
  return () => { fsBrowser?.destroy(); previewAudio.stop(); };
}
