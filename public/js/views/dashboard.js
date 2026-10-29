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

function newProjectDialog(folderLabel = '') {
  return new Promise((resolve) => {
    let type = 'audio', fileVariant = 'images', busy = false;
    const name = h('input', { class: 'input', id: 'new-project-name', placeholder: 'Bijv. Missie 3 – briefing', maxlength: 120, required: true });
    const choices = h('div', { class: 'project-type-choices project-type-choices-main', role: 'group', 'aria-label': 'Projecttype' });
    const variantSection = h('div', { class: 'file-variant-picker', hidden: true });
    const variantBtns = [
      ['images', 'Afbeeldingen', 'Inlog → File Explorer → Open afbeeldingen.', 'folder'],
      ['login_log', 'Inlog Log', 'Inlog → File Explorer → Open systeem-/inloglogboek.', 'log'],
      ['email', 'E-mail', 'Inlog → File Explorer → Open onderschept e-mailbericht.', 'mail'],
    ].map(([vKey, vLabel, vDesc, vIco]) => h('button', {
      type: 'button',
      class: `project-type-choice file-variant-choice${vKey === fileVariant ? ' on' : ''}`,
      'aria-pressed': String(vKey === fileVariant),
      'data-variant': vKey,
      onclick: () => {
        fileVariant = vKey;
        variantBtns.forEach((b) => {
          b.classList.toggle('on', b.dataset.variant === fileVariant);
          b.setAttribute('aria-pressed', String(b.dataset.variant === fileVariant));
        });
      }
    }, icon(vIco), h('b', {}, vLabel), h('span', {}, vDesc)));
    variantSection.append(
      h('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px' } }, 'Kies je File Terminal variant (begint altijd met een terminal-inlog → File Explorer):'),
      h('div', { class: 'project-type-choices', style: { margin: '0 0 18px' } }, ...variantBtns)
    );

    const buttons = [
      ['audio', 'Audio Terminal', 'Neem je stem op, bewerk audio en kies een videoscène.', 'wave'],
      ['file', 'File Terminal', 'Inlog + File Explorer met Afbeeldingen, Inlog Log of E-mail.', 'folder'],
      ['keyboard', 'Toetsenbord Stickers', 'Kies QWERTY, AZERTY of QWERTZ en exporteer een sticker-animatie per toets.', 'keyboard'],
      ['hack', 'Gehackt Scherm', 'Greenscreen, zwart of afbeelding → glitch → YOU ARE HACKED! met vliegende code.', 'alert'],
      ['airline', 'Airline Website & Ticket', 'Maak een airline-homepage en boardingpass naar Berlijn. Exporteer als afbeelding.', 'globe'],
    ].map(([key, label, desc, ico]) => h('button', {
      type: 'button', class: `project-type-choice${key === type ? ' on' : ''}`, 'aria-pressed': String(key === type), 'data-type': key,
      onclick: () => {
        type = key;
        buttons.forEach((b) => { b.classList.toggle('on', b.dataset.type === type); b.setAttribute('aria-pressed', String(b.dataset.type === type)); });
        variantSection.hidden = type !== 'file';
      }
    }, icon(ico), h('b', {}, label), h('span', {}, desc)));
    choices.append(...buttons);
    const close = (data) => { if (busy) return; busy = true; dialog.close(); dialog.remove(); resolve(data); };
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const payload = { name: name.value.trim() || 'Nieuw project', type };
        if (type === 'file') payload.file_opts = { variant: fileVariant };
        close(payload);
      }
    },
      h('h2', {}, 'Nieuw project'),
      folderLabel
        ? h('div', { class: 'new-project-folder-hint' }, icon('folder'), h('span', {}, `Map: ${folderLabel}`))
        : null,
      h('p', { class: 'muted' }, 'Wat wil je maken?'), choices, variantSection,
      h('label', { class: 'field' }, 'Projectnaam', name), h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Annuleren'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Aanmaken')));
    const dialog = h('dialog', { class: 'project-create-dialog', 'aria-label': 'Nieuw project', oncancel: (e) => { e.preventDefault(); close(null); }, onclick: (e) => { if (e.target === dialog) close(null); } }, form);
    document.body.append(dialog); dialog.showModal(); name.focus();
  });
}

export async function mount(root, { tab = 'projects' } = {}) {
  let current = tab;
  let currentFolderId = Number(sessionStorage.getItem('ts_current_folder')) || null;
  let projSearch = '';
  let allProjects = [];
  let allFolders = [];
  let dragPayload = null;
  let lastDragEndAt = 0;
  let dashContextMenu = null;
  let dashClipboard = null; // { mode: 'copy' | 'cut', kind: 'project' | 'folder', id: number, name: string }

  function clearAllDropHighlights() {
    document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
  }

  function startDragItem(e, el, payload) {
    e.stopPropagation();
    closeDashContextMenu();
    dragPayload = payload;
    el.classList.add('dragging-card');
    document.body.classList.add('is-dragging-item');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', `${payload.kind}:${payload.id}`); } catch {}
    }
  }

  function endDragItem(el) {
    lastDragEndAt = Date.now();
    dragPayload = null;
    el?.classList.remove('dragging-card');
    document.body.classList.remove('is-dragging-item');
    clearAllDropHighlights();
  }

  const setCurrentFolder = (id) => {
    currentFolderId = id ? Number(id) : null;
    if (currentFolderId) sessionStorage.setItem('ts_current_folder', String(currentFolderId));
    else sessionStorage.removeItem('ts_current_folder');
  };

  function closeDashContextMenu() {
    if (dashContextMenu) {
      dashContextMenu.remove();
      dashContextMenu = null;
    }
  }

  function openDashContextMenu(e, entries, title) {
    e.preventDefault();
    e.stopPropagation();
    closeDashContextMenu();

    const menu = h('div', {
      class: 'clip-context-menu dash-context-menu',
      role: 'menu',
      'aria-label': title,
      oncontextmenu: (ev) => ev.preventDefault(),
    }, h('div', { class: 'context-title' }, title));

    entries.forEach((entry) => {
      if (!entry) {
        menu.append(h('div', { class: 'context-separator', role: 'separator' }));
        return;
      }
      menu.append(
        h('button', {
          type: 'button',
          class: `context-action${entry.danger ? ' danger' : ''}`,
          role: 'menuitem',
          disabled: Boolean(entry.disabled),
          onclick: (ev) => {
            ev.stopPropagation();
            closeDashContextMenu();
            entry.action?.();
          },
        },
          icon(entry.icon || 'edit'),
          h('span', {}, entry.label),
          entry.key ? h('kbd', {}, entry.key) : null
        )
      );
    });

    menu.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeDashContextMenu();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      const next = ev.key === 'Home'
        ? 0
        : ev.key === 'End'
          ? buttons.length - 1
          : (index + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });

    document.body.append(menu);
    dashContextMenu = menu;

    const box = menu.getBoundingClientRect();
    const x = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : innerWidth / 2;
    const y = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : innerHeight / 2;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - box.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - box.height - 8)) + 'px';
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  const onDocPointerDown = (e) => {
    if (dashContextMenu && !dashContextMenu.contains(e.target)) closeDashContextMenu();
  };
  const onWinKeyDown = (e) => {
    if (e.key === 'Escape' && dashContextMenu) {
      e.preventDefault();
      closeDashContextMenu();
      return;
    }
    if (current !== 'projects') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('dialog[open], .modal-overlay')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && dashClipboard) {
      e.preventDefault();
      pasteIntoFolder(currentFolderId);
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('resize', closeDashContextMenu);
  window.addEventListener('scroll', closeDashContextMenu, true);
  window.addEventListener('keydown', onWinKeyDown);

  const body = h('div');
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const ink = h('span', { class: 'tab-ink' });
  const tabs = [
    ['projects', '🎬  Projecten'],
    ['sfx', '🔊  Sound effects'],
  ].map(([id, label]) => h('button', { class: 'tab', id: `tab-${id}`, role: 'tab', onclick: () => select(id) }, label));
  tabsEl.append(ink, ...tabs);

  const dashSection = h('section', { class: 'dash' },
    h('div', { class: 'hero' },
      h('div', {},
        h('h1', {}, 'Maak je ', h('span', { class: 'grad' }, 'transmissies'), '.'),
        h('p', {}, 'Maak een Audio Terminal met je stem, of een File Terminal met afbeeldingen. Exporteer je verhaal als video of alleen audio.'))),
    tabsEl, body);
  root.append(dashSection);

  dashSection.addEventListener('contextmenu', (e) => {
    if (current !== 'projects') return;
    if (e.target.closest('input, textarea, select, a')) return;
    if (e.target.closest('.folder-card, .card:not(.card-new)')) return;
    openEmptyAreaContextMenu(e);
  });

  function select(id) {
    closeDashContextMenu();
    current = id;
    tabs.forEach((t) => t.classList.toggle('active', t.id === `tab-${id}`));
    const act = tabs.find((t) => t.classList.contains('active'));
    requestAnimationFrame(() => { ink.style.left = act.offsetLeft + 'px'; ink.style.width = act.offsetWidth + 'px'; });
    history.replaceState(null, '', id === 'sfx' ? '#/library' : '#/');
    previewAudio.stop();
    (id === 'projects' ? renderProjects : renderSfx)();
  }

  function getFolderMap() {
    return new Map(allFolders.map((f) => [f.id, f]));
  }

  function getFolderPath(folderId, fmap = getFolderMap()) {
    const path = [];
    const seen = new Set();
    let cur = folderId ? fmap.get(Number(folderId)) : null;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur);
      cur = cur.parent_id ? fmap.get(Number(cur.parent_id)) : null;
    }
    return path;
  }

  function getFolderPathLabel(folderId, fmap = getFolderMap()) {
    return getFolderPath(folderId, fmap).map((f) => f.name).join(' › ');
  }

  function isFolderDescendant(candidateId, folderId, fmap = getFolderMap()) {
    if (!candidateId || !folderId) return false;
    if (Number(candidateId) === Number(folderId)) return true;
    const seen = new Set();
    let cur = fmap.get(Number(candidateId));
    while (cur && !seen.has(cur.id)) {
      if (Number(cur.id) === Number(folderId)) return true;
      seen.add(cur.id);
      cur = cur.parent_id ? fmap.get(Number(cur.parent_id)) : null;
    }
    return false;
  }

  function getFolderTreeOptions(excludeFolderId = null) {
    const fmap = getFolderMap();
    const opts = [{ value: '', label: '🏠 Hoofdmap (Alle projecten)' }];
    const walk = (parentId, depth) => {
      const children = allFolders
        .filter((f) => (f.parent_id ?? null) === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      for (const child of children) {
        if (excludeFolderId && isFolderDescendant(child.id, excludeFolderId, fmap)) continue;
        const pathLabel = getFolderPathLabel(child.id, fmap);
        opts.push({ value: String(child.id), label: `${'  '.repeat(depth)}📁 ${pathLabel}` });
        walk(child.id, depth + 1);
      }
    };
    walk(null, 0);
    return opts;
  }

  function getFolderStats(folderId) {
    const directFolders = allFolders.filter((f) => (f.parent_id ?? null) === folderId);
    const directProjects = allProjects.filter((p) => (p.folder_id ?? null) === folderId);
    let totalFolders = 0;
    let totalProjects = 0;
    const seen = new Set([folderId]);
    const walk = (pid) => {
      const subF = allFolders.filter((f) => (f.parent_id ?? null) === pid);
      const subP = allProjects.filter((p) => (p.folder_id ?? null) === pid);
      totalProjects += subP.length;
      for (const f of subF) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        totalFolders += 1;
        walk(f.id);
      }
    };
    walk(folderId);
    return {
      directFolders: directFolders.length,
      directProjects: directProjects.length,
      totalFolders,
      totalProjects,
      previewNames: [
        ...directFolders.slice(0, 2).map((f) => `📁 ${f.name}`),
        ...directProjects.slice(0, 2).map((p) => p.name),
      ].slice(0, 3),
    };
  }

  async function newProject(targetFolderId = currentFolderId) {
    const folderLabel = targetFolderId ? getFolderPathLabel(targetFolderId) : '';
    const data = await newProjectDialog(folderLabel);
    if (!data) return;
    if (targetFolderId) data.folder_id = targetFolderId;
    const p = await api.createProject(data);
    location.hash = `#/project/${p.id}`;
  }

  async function createFolder(parentId = currentFolderId) {
    const parentLabel = parentId ? getFolderPathLabel(parentId) : '';
    const name = await modal({
      title: parentId ? 'Nieuwe submap maken' : 'Nieuwe map maken',
      body: parentId ? `Wordt aangemaakt in: 📁 ${parentLabel}` : 'Maak een map om je projecten en submappen overzichtelijk in te delen.',
      confirm: 'Aanmaken',
      input: { placeholder: parentId ? 'Naam van submap…' : 'Bijv. Missie 1 of Seizoen 2…' },
    });
    if (!name?.trim()) return;
    try {
      await api.createProjectFolder({ name: name.trim(), parent_id: parentId ?? null });
      toast(`Map "${name.trim()}" aangemaakt`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function renameFolder(folder) {
    const name = await modal({ title: 'Map hernoemen', confirm: 'Opslaan', input: { value: folder.name } });
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      await api.updateProjectFolder(folder.id, { name: name.trim() });
      toast('Map hernoemd', 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function moveFolder(folder) {
    const options = getFolderTreeOptions(folder.id);
    const res = await modal({
      title: `Map "${folder.name}" verplaatsen`,
      body: 'Kies waar deze map (inclusief alle submappen en projecten erin) naartoe moet:',
      select: {
        options,
        value: folder.parent_id ? String(folder.parent_id) : '',
      },
      confirm: 'Verplaatsen',
    });
    if (res === null) return;
    const targetParentId = res ? Number(res) : null;
    if ((folder.parent_id ?? null) === targetParentId) return;
    try {
      await api.updateProjectFolder(folder.id, { parent_id: targetParentId });
      const destName = targetParentId ? `"${getFolderPathLabel(targetParentId)}"` : 'Hoofdmap';
      toast(`Map verplaatst naar ${destName}`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function removeFolder(folder) {
    const stats = getFolderStats(folder.id);
    const parentName = folder.parent_id ? `"${getFolderPathLabel(folder.parent_id)}"` : 'de hoofdmap';
    const hasContents = stats.directFolders > 0 || stats.directProjects > 0;
    const ok = await modal({
      title: `Map "${folder.name}" verwijderen?`,
      body: hasContents
        ? `Deze map bevat ${stats.totalFolders ? `${stats.totalFolders} submap(pen) en ` : ''}${stats.totalProjects} project(en). De inhoud gaat niet verloren en wordt verplaatst naar ${parentName}.`
        : 'Deze lege map wordt verwijderd.',
      confirm: 'Map verwijderen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProjectFolder(folder.id);
      if (currentFolderId === folder.id) setCurrentFolder(folder.parent_id ?? null);
      toast('Map verwijderd', 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function moveProject(p) {
    const options = getFolderTreeOptions(null);
    const res = await modal({
      title: `"${p.name}" verplaatsen`,
      body: 'Kies een bestaande map of submap, of typ hieronder een naam om direct een nieuwe (sub)map aan te maken:',
      select: {
        options,
        value: p.folder_id ? String(p.folder_id) : (currentFolderId ? String(currentFolderId) : ''),
      },
      input: { placeholder: 'Optioneel: nieuwe mapnaam in gekozen map…' },
      confirm: 'Verplaatsen',
    });
    if (res === null) return;
    try {
      let targetFolderId = res.select ? Number(res.select) : null;
      const newFolderName = (res.input || '').trim();
      if (newFolderName) {
        const created = await api.createProjectFolder({ name: newFolderName, parent_id: targetFolderId });
        targetFolderId = created.id;
      }
      await api.updateProject(p.id, { folder_id: targetFolderId });
      const destLabel = targetFolderId ? `"${getFolderPathLabel(targetFolderId)}"` : 'Hoofdmap';
      toast(`"${p.name}" verplaatst naar ${destLabel}`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function moveProjectToFolder(p, targetFolderId, customToast = null) {
    try {
      await api.updateProject(p.id, { folder_id: targetFolderId ?? null });
      const destLabel = targetFolderId ? `"${getFolderPathLabel(targetFolderId)}"` : 'Hoofdmap';
      toast(customToast || `"${p.name}" verplaatst naar ${destLabel}`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function wireDropTarget(el, targetFolderId, targetLabel) {
    const canAccept = () => {
      if (!dragPayload) return false;
      if (dragPayload.kind === 'project') {
        return (dragPayload.fromFolderId ?? null) !== (targetFolderId ?? null);
      }
      if (dragPayload.kind === 'folder') {
        if ((dragPayload.fromParentId ?? null) === (targetFolderId ?? null)) return false;
        if (targetFolderId !== null && isFolderDescendant(targetFolderId, dragPayload.id)) return false;
        return true;
      }
      return false;
    };

    el.addEventListener('dragenter', (e) => {
      if (!canAccept()) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll('.drop-over').forEach((other) => {
        if (other !== el) other.classList.remove('drop-over');
      });
      el.classList.add('drop-over');
    });
    el.addEventListener('dragover', (e) => {
      if (!canAccept()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (!el.classList.contains('drop-over')) {
        document.querySelectorAll('.drop-over').forEach((other) => {
          if (other !== el) other.classList.remove('drop-over');
        });
        el.classList.add('drop-over');
      }
    });
    el.addEventListener('dragleave', (e) => {
      const r = el.getBoundingClientRect();
      if (
        e.clientX <= r.left ||
        e.clientX >= r.right ||
        e.clientY <= r.top ||
        e.clientY >= r.bottom
      ) {
        el.classList.remove('drop-over');
      }
    });
    el.addEventListener('drop', async (e) => {
      clearAllDropHighlights();
      document.body.classList.remove('is-dragging-item');
      if (!canAccept()) return;
      e.preventDefault();
      e.stopPropagation();
      const item = dragPayload;
      dragPayload = null;
      lastDragEndAt = Date.now();
      try {
        if (item.kind === 'project') {
          await api.updateProject(item.id, { folder_id: targetFolderId });
          toast(`"${item.name}" verplaatst naar ${targetLabel}`, 'ok');
        } else if (item.kind === 'folder') {
          await api.updateProjectFolder(item.id, { parent_id: targetFolderId });
          toast(`Map "${item.name}" verplaatst naar ${targetLabel}`, 'ok');
        }
        await renderProjects();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  async function renderProjects() {
    if (!body.children.length) {
      body.replaceChildren(h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    }
    try {
      [allProjects, allFolders] = await Promise.all([api.projects(), api.projectFolders().catch(() => [])]);
    } catch (e) {
      body.replaceChildren(h('div', { class: 'empty' }, 'Server niet bereikbaar: ' + e.message));
      return;
    }
    if (current !== 'projects') return;

    const fmap = getFolderMap();
    if (currentFolderId !== null && !fmap.has(currentFolderId)) {
      setCurrentFolder(null);
    }

    paintProjects();
  }

  function paintProjects() {
    const fmap = getFolderMap();
    const activeFolder = currentFolderId !== null ? fmap.get(currentFolderId) : null;
    const breadcrumbs = getFolderPath(currentFolderId, fmap);
    const q = projSearch.trim().toLowerCase();
    const isSearching = Boolean(q);

    // Breadcrumb trail (each item is clickable AND a drag-and-drop target)
    const crumbTrail = h('nav', { class: 'folder-breadcrumbs', 'aria-label': 'Mapnavigatie' });

    if (activeFolder) {
      const parentId = activeFolder.parent_id ?? null;
      const parentLabel = parentId ? `"${fmap.get(parentId)?.name || 'Bovenliggende map'}"` : 'Hoofdmap';
      const upBtn = h('button', {
        type: 'button',
        class: 'btn btn-sm folder-up-btn',
        title: `Naar bovenliggende map (${parentLabel})`,
        onclick: () => { setCurrentFolder(parentId); paintProjects(); },
      }, icon('back'), 'Omhoog');
      wireDropTarget(upBtn, parentId, parentLabel);
      crumbTrail.append(upBtn);
    }

    const rootCrumb = h('button', {
      type: 'button',
      class: `folder-crumb${currentFolderId === null && !isSearching ? ' active' : ''}`,
      onclick: () => { projSearch = ''; setCurrentFolder(null); paintProjects(); },
    }, icon('folder'), h('span', {}, 'Alle projecten'));
    wireDropTarget(rootCrumb, null, 'Hoofdmap');
    crumbTrail.append(rootCrumb);

    breadcrumbs.forEach((folder, idx) => {
      const isLast = idx === breadcrumbs.length - 1;
      crumbTrail.append(h('span', { class: 'folder-crumb-sep', 'aria-hidden': 'true' }, icon('chevronRight')));
      const btn = h('button', {
        type: 'button',
        class: `folder-crumb${isLast && !isSearching ? ' active' : ''}`,
        onclick: () => { projSearch = ''; setCurrentFolder(folder.id); paintProjects(); },
      }, h('span', {}, folder.name));
      wireDropTarget(btn, folder.id, `"${folder.name}"`);
      crumbTrail.append(btn);
    });

    const searchInput = h('input', {
      class: 'input proj-search-input',
      type: 'search',
      placeholder: 'Zoek project of map…',
      value: projSearch,
      'aria-label': 'Zoek project of map',
      oninput: (e) => {
        projSearch = e.target.value;
        paintProjectsBody(contentWrap);
      },
    });

    const newFolderBtn = h('button', {
      type: 'button',
      class: 'btn btn-sm folder-create-btn',
      id: 'new-folder-btn',
      onclick: () => createFolder(currentFolderId),
    }, icon('folderPlus'), activeFolder ? 'Nieuwe submap' : 'Nieuwe map');

    const newProjBtn = h('button', {
      type: 'button',
      class: 'btn btn-sm btn-primary',
      onclick: () => newProject(currentFolderId),
    }, icon('plus'), 'Nieuw project');

    const toolbar = h('div', { class: 'proj-toolbar glass' },
      crumbTrail,
      h('div', { class: 'proj-toolbar-actions' }, searchInput, newFolderBtn, newProjBtn)
    );

    const contentWrap = h('div', { class: 'proj-content-wrap' });
    paintProjectsBody(contentWrap);

    body.replaceChildren(toolbar, contentWrap);
  }

  function parentFolderDropCard(targetFolderId, title, subtitle, isRootCard = false) {
    const destLabel = targetFolderId ? `"${title}"` : 'Hoofdmap';
    const card = h('article', {
      class: `folder-card folder-up-card glass${isRootCard ? ' folder-root-card' : ''}`,
      onclick: () => {
        if (Date.now() - lastDragEndAt < 180) return;
        projSearch = '';
        setCurrentFolder(targetFolderId);
        paintProjects();
      },
    },
      h('div', { class: 'folder-card-icon folder-up-icon' }, icon('back')),
      h('div', { class: 'folder-card-info' },
        h('h3', {}, title),
        h('div', { class: 'folder-card-meta' }, subtitle)
      )
    );
    wireDropTarget(card, targetFolderId, destLabel);
    return card;
  }

  function paintProjectsBody(container) {
    const fmap = getFolderMap();
    const activeFolder = currentFolderId !== null ? fmap.get(currentFolderId) : null;
    const q = projSearch.trim().toLowerCase();
    const isSearching = Boolean(q);

    const visibleFolders = isSearching
      ? allFolders.filter((f) => f.name.toLowerCase().includes(q) || getFolderPathLabel(f.id, fmap).toLowerCase().includes(q))
      : allFolders.filter((f) => (f.parent_id ?? null) === currentFolderId);

    const visibleProjects = isSearching
      ? allProjects.filter((p) => p.name.toLowerCase().includes(q) || (p.folder_id && getFolderPathLabel(p.folder_id, fmap).toLowerCase().includes(q)))
      : allProjects.filter((p) => (p.folder_id ?? null) === currentFolderId);

    container.replaceChildren();

    // Folders section (shown when there are subfolders OR when inside a folder so you can drag items out!)
    if (visibleFolders.length > 0 || (activeFolder && !isSearching)) {
      const folderCards = [];
      if (activeFolder && !isSearching) {
        const parentId = activeFolder.parent_id ?? null;
        const parentFolder = parentId ? fmap.get(parentId) : null;
        folderCards.push(
          parentFolderDropCard(
            parentId,
            parentFolder ? `↩ Naar "${parentFolder.name}"` : '↩ Naar Hoofdmap (Alle projecten)',
            `Klik om terug te gaan, of sleep een project hierheen om uit "${activeFolder.name}" te halen`
          )
        );
        if (parentId !== null) {
          folderCards.push(
            parentFolderDropCard(
              null,
              '🏠 Naar Hoofdmap (Alle projecten)',
              'Sleep een project of map hierheen om helemaal naar het hoofdscherm te verplaatsen',
              true
            )
          );
        }
      }
      visibleFolders.forEach((f, i) => folderCards.push(folderCard(f, i, isSearching, fmap)));

      const folderSection = h('div', { class: 'folder-section' },
        h('div', { class: 'folder-section-head' },
          h('h4', {}, isSearching ? `Gevonden mappen (${visibleFolders.length})` : (activeFolder ? `Mapnavigatie & Submappen (${visibleFolders.length})` : `Mappen (${visibleFolders.length})`)),
          !isSearching ? h('span', { class: 'folder-drag-tip' }, 'Tip: sleep projecten in een mapkaart, of sleep ze uit een map terug naar het overzicht') : null
        ),
        h('div', { class: 'folder-grid' }, ...folderCards)
      );
      container.append(folderSection);
    }

    // Projects section (also acts as a drop zone to pull projects OUT of a subfolder into the current view!)
    const projSection = h('div', { class: 'proj-drop-zone' });
    const currentViewLabel = activeFolder ? `"${activeFolder.name}"` : 'Hoofdmap';
    wireDropTarget(projSection, currentFolderId, currentViewLabel);

    const grid = h('div', { class: 'grid' });
    if (!isSearching) {
      const activeFolderName = activeFolder?.name || null;
      grid.append(
        h('div', { class: 'card card-new glass', id: 'card-new', onclick: () => newProject(currentFolderId), style: { '--i': 0 } },
          h('div', {},
            h('div', { class: 'plus' }, icon('plus')),
            h('div', { style: { marginTop: '12px', fontWeight: 600 } }, activeFolderName ? `Nieuw project in "${activeFolderName}"` : 'Nieuw project'),
            h('div', { class: 'hint' }, 'Audio, File Terminal, Toetsenbord, Gehackt Scherm of Airline')
          )
        ),
        h('div', { class: 'card card-new card-new-folder glass', id: 'card-new-folder', onclick: () => createFolder(currentFolderId), style: { '--i': 1 } },
          h('div', {},
            h('div', { class: 'plus folder-plus-badge' }, icon('folderPlus')),
            h('div', { style: { marginTop: '12px', fontWeight: 600 } }, activeFolderName ? `Nieuwe submap in "${activeFolderName}"` : 'Nieuwe map'),
            h('div', { class: 'hint' }, 'Maak mappen en submappen om je projecten te organiseren')
          )
        )
      );
    }

    visibleProjects.forEach((p, i) => grid.append(projectCard(p, i + (isSearching ? 0 : 2), isSearching, fmap)));
    if ((visibleFolders.length > 0 || activeFolder) && visibleProjects.length > 0) {
      projSection.append(h('div', { class: 'folder-section-head proj-grid-head' },
        h('h4', {}, isSearching ? `Gevonden projecten (${visibleProjects.length})` : `Projecten in ${activeFolder ? `"${activeFolder.name}"` : 'hoofdmap'} (${visibleProjects.length})`),
        h('span', { class: 'proj-drop-hint' }, `📤 Sleep hierheen om in ${activeFolder ? `"${activeFolder.name}"` : 'de hoofdmap'} te plaatsen`)
      ));
    }
    projSection.append(grid);
    container.append(projSection);

    if (!visibleFolders.length && !visibleProjects.length) {
      if (isSearching) {
        container.append(h('p', { class: 'empty' }, `Geen mappen of projecten gevonden voor "${projSearch}".`));
      } else if (currentFolderId) {
        container.append(h('p', { class: 'empty' }, 'Deze map is nog leeg — maak hier een nieuw project of een submap aan, of sleep een bestaand project hierheen! 📁'));
      } else {
        container.append(h('p', { class: 'empty' }, 'Nog geen projecten — maak je eerste transmissie of maak een map aan! 🕵️'));
      }
    }
  }

  function folderCard(folder, i, showFullPath, fmap) {
    const stats = getFolderStats(folder.id);
    const directSubfolders = allFolders.filter((f) => (f.parent_id ?? null) === folder.id);
    const directProjects = allProjects.filter((p) => (p.folder_id ?? null) === folder.id);

    const subParts = [];
    if (stats.directFolders > 0) subParts.push(`${stats.directFolders} ${stats.directFolders === 1 ? 'submap' : 'submappen'}`);
    if (stats.directProjects > 0) subParts.push(`${stats.directProjects} ${stats.directProjects === 1 ? 'project' : 'projecten'}`);
    if (!subParts.length && stats.totalProjects > 0) subParts.push(`${stats.totalProjects} ${stats.totalProjects === 1 ? 'project' : 'projecten'} in submappen`);
    const summaryText = subParts.length ? subParts.join(' · ') : 'Lege map — sleep projecten hierheen';

    const parentPath = showFullPath && folder.parent_id ? getFolderPathLabel(folder.parent_id, fmap) : '';

    // Interactive draggable chips for subfolders & projects inside this folder so user can drag them straight OUT of the folder!
    const chipsWrap = (directSubfolders.length > 0 || directProjects.length > 0)
      ? h('div', { class: 'folder-card-chips' })
      : null;

    if (chipsWrap) {
      directSubfolders.slice(0, 4).forEach((sub) => {
        const chip = h('span', {
          class: 'folder-item-chip folder-sub-chip',
          draggable: 'true',
          title: `Submap "${sub.name}" — klik om te openen, of sleep uit deze map`,
          onclick: (e) => {
            e.stopPropagation();
            if (Date.now() - lastDragEndAt < 180) return;
            projSearch = '';
            setCurrentFolder(sub.id);
            paintProjects();
          },
        }, icon('folder'), h('span', { class: 'chip-name' }, sub.name));
        chip.addEventListener('dragstart', (e) => {
          startDragItem(e, chip, { kind: 'folder', id: sub.id, name: sub.name, fromParentId: sub.parent_id ?? null });
        });
        chip.addEventListener('dragend', () => endDragItem(chip));
        chipsWrap.append(chip);
      });

      directProjects.slice(0, 6).forEach((p) => {
        const outTargetId = folder.parent_id ?? null;
        const outTargetName = outTargetId ? `"${getFolderPathLabel(outTargetId, fmap)}"` : 'Hoofdmap';
        const chip = h('span', {
          class: 'folder-item-chip folder-proj-chip',
          draggable: 'true',
          title: `Project "${p.name}" — sleep uit deze map naar het overzicht, of klik × om uit map te halen`,
          onclick: (e) => {
            e.stopPropagation();
            if (Date.now() - lastDragEndAt < 180) return;
            location.hash = `#/project/${p.id}`;
          },
        },
          h('span', { class: 'chip-name' }, `🎬 ${p.name}`),
          h('button', {
            type: 'button',
            class: 'chip-eject-btn',
            title: `Uit "${folder.name}" halen (naar ${outTargetName})`,
            onclick: (e) => {
              e.stopPropagation();
              moveProjectToFolder(p, outTargetId, `"${p.name}" uit "${folder.name}" gehaald`);
            },
          }, '×')
        );
        chip.addEventListener('dragstart', (e) => {
          startDragItem(e, chip, { kind: 'project', id: p.id, name: p.name, fromFolderId: p.folder_id ?? null });
        });
        chip.addEventListener('dragend', () => endDragItem(chip));
        chipsWrap.append(chip);
      });

      const remaining = (directSubfolders.length - Math.min(4, directSubfolders.length)) + (directProjects.length - Math.min(6, directProjects.length));
      if (remaining > 0) {
        chipsWrap.append(h('span', { class: 'folder-item-more' }, `+${remaining} meer`));
      }
    }

    const card = h('article', {
      class: 'folder-card glass',
      id: `folder-${folder.id}`,
      draggable: 'true',
      style: { '--i': i },
      onclick: () => {
        if (Date.now() - lastDragEndAt < 180) return;
        projSearch = '';
        setCurrentFolder(folder.id);
        paintProjects();
      },
      oncontextmenu: (e) => openFolderContextMenu(e, folder),
    },
      h('div', { class: 'folder-card-top' },
        h('div', { class: 'folder-card-icon' },
          icon('folder'),
          stats.totalFolders > 0 ? h('span', { class: 'folder-nested-dot', title: `Bevat ${stats.totalFolders} submap(pen)` }, `+${stats.totalFolders}`) : null
        ),
        h('div', { class: 'folder-card-info' },
          h('h3', { title: folder.name }, folder.name),
          h('div', { class: 'folder-card-meta' }, summaryText),
          parentPath ? h('div', { class: 'folder-card-path' }, `In: ${parentPath}`) : null
        )
      ),
      chipsWrap,
      h('div', { class: 'card-actions folder-card-actions' },
        h('button', { class: 'btn btn-sm btn-icon', title: 'Submap maken in deze map', onclick: (e) => { e.stopPropagation(); createFolder(folder.id); } }, icon('folderPlus')),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Map verplaatsen…', onclick: (e) => { e.stopPropagation(); moveFolder(folder); } }, icon('folderMove')),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Map hernoemen', onclick: (e) => { e.stopPropagation(); renameFolder(folder); } }, icon('edit')),
        h('button', { class: 'btn btn-sm btn-icon btn-danger', title: 'Map verwijderen', onclick: (e) => { e.stopPropagation(); removeFolder(folder); } }, icon('trash'))
      )
    );

    card.addEventListener('dragstart', (e) => {
      startDragItem(e, card, { kind: 'folder', id: folder.id, name: folder.name, fromParentId: folder.parent_id ?? null });
    });
    card.addEventListener('dragend', () => endDragItem(card));

    wireDropTarget(card, folder.id, `"${folder.name}"`);
    return card;
  }

  function projectCard(p, i, showFolderBadge = false, fmap = getFolderMap()) {
    const color = SCENE_COLOR[p.scene] || SCENE_COLOR.transmission;
    const thumb = h('div', { class: `card-thumb ${p.scene}`, style: { color }, html: logoSvg('currentColor') });
    const bars = h('div', { class: 'bars' }, ...Array.from({ length: 13 }, (_, k) => h('i', { style: { '--k': k } })));
    thumb.append(bars);
    const fileVariant = p.file_opts?.variant || 'images';
    if (p.type === 'file') {
      const fIco = fileVariant === 'login_log' ? 'log' : fileVariant === 'email' ? 'mail' : 'folder';
      const fLabel = fileVariant === 'login_log' ? '> LOGIN LOG' : fileVariant === 'email' ? '> EMAIL TERMINAL' : '> FILE TERMINAL';
      thumb.replaceChildren(icon(fIco), h('span', { class: 'file-project-label' }, fLabel));
      thumb.classList.add('file-project-thumb');
    }
    if (p.type === 'keyboard') {
      const sw = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map((c) => h('i', { style: { background: c } }));
      thumb.replaceChildren(icon('keyboard'), h('div', { class: 'kb-thumb-dots' }, ...sw), h('span', { class: 'file-project-label' }, '⌨ KEYBOARD STICKERS'));
      thumb.classList.add('keyboard-project-thumb');
    }
    if (p.type === 'hack') {
      thumb.replaceChildren(icon('alert'), h('span', { class: 'file-project-label' }, '⚠ YOU ARE HACKED'));
      thumb.classList.add('hack-project-thumb');
    }
    if (p.type === 'airline') {
      thumb.replaceChildren(icon('globe'), h('strong', {}, !p.airline_opts?.airline || p.airline_opts.airline === 'AEROVIA' ? 'Airline' : p.airline_opts.airline), h('span', { class: 'file-project-label' }, `${p.airline_opts?.originCode || 'LHR'} → ${p.airline_opts?.destinationCode || 'BER'}`));
      thumb.classList.add('airline-project-thumb');
    }
    const hackBg = { green: 'Greenscreen', blue: 'Bluescreen', black: 'Zwart', image: 'Afbeelding' }[p.hack_opts?.bgMode || 'green'] || 'Greenscreen';
    const kbLayout = (p.keyboard_opts?.layout || 'qwerty').toUpperCase();
    const kbCount = Array.isArray(p.keyboard_opts?.selectedKeys) ? p.keyboard_opts.selectedKeys.length : 26;
    const fileSub = fileVariant === 'login_log'
      ? `Inlog Log (${Array.isArray(p.file_opts?.logs) ? p.file_opts.logs.length : 1})`
      : fileVariant === 'email'
        ? `E-mail (${Array.isArray(p.file_opts?.emails) ? p.file_opts.emails.length : 1})`
        : `${p.image_count} afbeeldingen`;
    const folderPath = showFolderBadge && p.folder_id ? getFolderPathLabel(p.folder_id, fmap) : '';
    const currentFolderObj = p.folder_id ? fmap.get(p.folder_id) : null;
    const parentTargetId = currentFolderObj ? (currentFolderObj.parent_id ?? null) : null;
    const parentTargetLabel = parentTargetId ? `"${fmap.get(parentTargetId)?.name || 'Bovenliggende map'}"` : 'Hoofdmap';

    const card = h('article', {
      class: 'card glass',
      id: `project-${p.id}`,
      draggable: 'true',
      style: { '--i': i },
      onclick: () => {
        if (Date.now() - lastDragEndAt < 180) return;
        location.hash = `#/project/${p.id}`;
      },
      oncontextmenu: (e) => openProjectContextMenu(e, p),
    },
      h('div', { class: 'card-actions' },
        p.folder_id ? h('button', {
          class: 'btn btn-sm btn-icon',
          title: `Uit map halen (naar ${parentTargetLabel})`,
          onclick: (e) => {
            e.stopPropagation();
            moveProjectToFolder(p, parentTargetId, `"${p.name}" uit map gehaald (naar ${parentTargetLabel})`);
          },
        }, icon('back')) : null,
        h('button', { class: 'btn btn-sm btn-icon', title: 'Verplaatsen naar map…', onclick: (e) => { e.stopPropagation(); moveProject(p); } }, icon('folderMove')),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Hernoemen', onclick: (e) => { e.stopPropagation(); rename(p); } }, icon('edit')),
        h('button', { class: 'btn btn-sm btn-icon', title: 'Dupliceren', onclick: (e) => { e.stopPropagation(); duplicate(p); } }, icon('copy')),
        h('button', { class: 'btn btn-sm btn-icon btn-danger', title: 'Verwijderen', onclick: (e) => { e.stopPropagation(); remove(p); } }, icon('trash'))),
      thumb,
      h('h3', {}, p.name),
      folderPath ? h('button', {
        type: 'button',
        class: 'project-folder-badge',
        title: `Open map: ${folderPath}`,
        onclick: (e) => { e.stopPropagation(); projSearch = ''; setCurrentFolder(p.folder_id); paintProjects(); },
      }, icon('folder'), h('span', {}, folderPath)) : null,
      h('div', { class: 'card-meta' },
        h('span', {}, p.type === 'airline' ? 'Airline Website & Ticket' : p.type === 'hack' ? 'Gehackt Scherm' : p.type === 'keyboard' ? 'Toetsenbord Stickers' : p.type === 'file' ? 'File Terminal' : 'Audio Terminal'),
        h('span', {}, p.type === 'airline' ? `${p.airline_opts?.origin || 'London'} → ${p.airline_opts?.destination || 'Berlin'}` : p.type === 'hack' ? `Start: ${hackBg}` : p.type === 'keyboard' ? `${kbLayout} · ${kbCount} toetsen` : p.type === 'file' ? fileSub : `${p.asset_count} audio`),
        p.export_count ? h('span', {}, `🎞 ${p.export_count}`) : null,
        p.duration ? h('span', {}, fmtTime(p.duration)) : null),
      h('div', { class: 'card-meta', style: { marginTop: '6px', fontSize: '12px' } }, h('span', {}, 'Bewerkt ' + fmtDate(p.updated_at))));

    card.addEventListener('dragstart', (e) => {
      startDragItem(e, card, { kind: 'project', id: p.id, name: p.name, fromFolderId: p.folder_id ?? null });
    });
    card.addEventListener('dragend', () => endDragItem(card));

    return card;
  }

  async function rename(p) {
    const name = await modal({ title: 'Project hernoemen', confirm: 'Opslaan', input: { value: p.name } });
    if (!name?.trim()) return;
    await api.updateProject(p.id, { name: name.trim() });
    toast('Hernoemd', 'ok'); renderProjects();
  }

  async function duplicate(p, targetFolderId = p.folder_id ?? null) {
    const full = await api.project(p.id);
    const copy = await api.createProject({ name: `${p.name} (kopie)`, scene: p.scene, type: p.type, folder_id: targetFolderId });
    await api.updateProject(copy.id, { scene_opts: full.scene_opts, file_opts: full.file_opts, keyboard_opts: full.keyboard_opts, hack_opts: full.hack_opts, airline_opts: full.airline_opts });
    toast('Project gedupliceerd', 'ok'); renderProjects();
  }

  async function duplicateFolder(folder, targetParentId = folder.parent_id ?? null) {
    try {
      const seen = new Set();
      const copyTree = async (srcFolder, destParentId, isRootCopy = false) => {
        if (seen.has(srcFolder.id)) return;
        seen.add(srcFolder.id);
        const createdFolder = await api.createProjectFolder({
          name: isRootCopy ? `${srcFolder.name} (kopie)` : srcFolder.name,
          parent_id: destParentId,
        });
        const folderProjs = allProjects.filter((p) => (p.folder_id ?? null) === srcFolder.id);
        for (const p of folderProjs) {
          const full = await api.project(p.id);
          const copy = await api.createProject({ name: p.name, scene: p.scene, type: p.type, folder_id: createdFolder.id });
          await api.updateProject(copy.id, {
            scene_opts: full.scene_opts,
            file_opts: full.file_opts,
            keyboard_opts: full.keyboard_opts,
            hack_opts: full.hack_opts,
            airline_opts: full.airline_opts,
          });
        }
        const childFolders = allFolders.filter((f) => (f.parent_id ?? null) === srcFolder.id);
        for (const child of childFolders) {
          await copyTree(child, createdFolder.id, false);
        }
      };
      await copyTree(folder, targetParentId, true);
      toast(`Map "${folder.name}" gedupliceerd`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function createFolderWithProject(p) {
    const parentId = p.folder_id ?? currentFolderId ?? null;
    const name = await modal({
      title: 'Nieuwe map met dit project',
      body: `Maak een nieuwe map aan en verplaats "${p.name}" daar direct naartoe:`,
      confirm: 'Maken & verplaatsen',
      input: { placeholder: 'Naam van de nieuwe map…' },
    });
    if (!name?.trim()) return;
    try {
      const created = await api.createProjectFolder({ name: name.trim(), parent_id: parentId });
      await api.updateProject(p.id, { folder_id: created.id });
      toast(`"${p.name}" in nieuwe map "${created.name}" geplaatst`, 'ok');
      await renderProjects();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function pasteIntoFolder(targetFolderId = currentFolderId) {
    if (!dashClipboard) return;
    const clip = dashClipboard;
    const destLabel = targetFolderId ? `"${getFolderPathLabel(targetFolderId)}"` : 'Hoofdmap';
    try {
      if (clip.kind === 'project') {
        const srcProj = allProjects.find((x) => x.id === clip.id);
        if (!srcProj) {
          dashClipboard = null;
          return toast('Project bestaat niet meer', 'err');
        }
        if (clip.mode === 'cut') {
          await api.updateProject(srcProj.id, { folder_id: targetFolderId });
          dashClipboard = null;
          toast(`"${srcProj.name}" verplaatst naar ${destLabel}`, 'ok');
          await renderProjects();
        } else {
          await duplicate(srcProj, targetFolderId);
        }
      } else if (clip.kind === 'folder') {
        const srcFolder = allFolders.find((x) => x.id === clip.id);
        if (!srcFolder) {
          dashClipboard = null;
          return toast('Map bestaat niet meer', 'err');
        }
        if (clip.mode === 'cut') {
          if (targetFolderId !== null && isFolderDescendant(targetFolderId, srcFolder.id)) {
            return toast('Een map kan niet in zichzelf of een eigen submap worden geplakt', 'err');
          }
          await api.updateProjectFolder(srcFolder.id, { parent_id: targetFolderId });
          dashClipboard = null;
          toast(`Map "${srcFolder.name}" verplaatst naar ${destLabel}`, 'ok');
          await renderProjects();
        } else {
          if (targetFolderId !== null && isFolderDescendant(targetFolderId, srcFolder.id)) {
            return toast('Kies een map buiten de map die je kopieert', 'err');
          }
          await duplicateFolder(srcFolder, targetFolderId);
        }
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function openProjectContextMenu(e, p) {
    const parentFolder = p.folder_id != null ? getFolder(p.folder_id) : null;
    const upFolderId = parentFolder ? (parentFolder.parent_id ?? null) : null;
    const upFolder = upFolderId != null ? getFolder(upFolderId) : null;
    const moveOutItems = parentFolder ? [
      {
        label: upFolder
          ? `Uit "${parentFolder.name}" halen (naar "${upFolder.name}")`
          : `Uit "${parentFolder.name}" halen (naar Hoofdmap)`,
        icon: 'folderMove',
        action: () => moveProjectToFolder(p.id, upFolderId),
      },
      ...(upFolderId !== null ? [{
        label: 'Direct naar Hoofdmap verplaatsen',
        icon: 'folderMove',
        action: () => moveProjectToFolder(p.id, null),
      }] : []),
    ] : [];

    openDashContextMenu(e, [
      { label: 'Project openen', icon: 'play', action: () => { location.hash = `#/project/${p.id}`; } },
      null,
      { label: 'Hernoemen…', icon: 'edit', action: () => rename(p) },
      { label: 'Dupliceren', icon: 'copy', action: () => duplicate(p) },
      {
        label: 'Kopiëren',
        icon: 'copy',
        action: () => {
          dashClipboard = { mode: 'copy', kind: 'project', id: p.id, name: p.name };
          toast(`"${p.name}" gekopieerd — klik rechts in een map om te plakken`, 'info');
        },
      },
      {
        label: 'Knippen (om te verplaatsen)',
        icon: 'split',
        action: () => {
          dashClipboard = { mode: 'cut', kind: 'project', id: p.id, name: p.name };
          toast(`"${p.name}" geknipt — klik rechts in een map om te plakken`, 'info');
        },
      },
      null,
      ...moveOutItems,
      { label: 'Verplaatsen naar map…', icon: 'folderMove', action: () => moveProject(p) },
      { label: 'Nieuwe map maken met dit project…', icon: 'folderPlus', action: () => createFolderWithProject(p) },
      null,
      { label: 'Verwijderen…', icon: 'trash', danger: true, action: () => remove(p) },
    ], `🎬 ${p.name}`);
  }

  function openFolderContextMenu(e, folder) {
    const canPaste = Boolean(
      dashClipboard &&
      !(dashClipboard.kind === 'folder' && isFolderDescendant(folder.id, dashClipboard.id))
    );
    openDashContextMenu(e, [
      {
        label: 'Map openen',
        icon: 'folder',
        action: () => {
          projSearch = '';
          setCurrentFolder(folder.id);
          paintProjects();
        },
      },
      { label: `Nieuw project in "${folder.name}"…`, icon: 'plus', action: () => newProject(folder.id) },
      { label: `Nieuwe submap in "${folder.name}"…`, icon: 'folderPlus', action: () => createFolder(folder.id) },
      null,
      {
        label: dashClipboard ? `Plakken in "${folder.name}" (${dashClipboard.name})` : `Plakken in "${folder.name}"`,
        icon: 'copy',
        disabled: !canPaste,
        action: () => pasteIntoFolder(folder.id),
      },
      null,
      { label: 'Map hernoemen…', icon: 'edit', action: () => renameFolder(folder) },
      { label: 'Map dupliceren (incl. inhoud)', icon: 'copy', action: () => duplicateFolder(folder, folder.parent_id ?? null) },
      {
        label: 'Map kopiëren',
        icon: 'copy',
        action: () => {
          dashClipboard = { mode: 'copy', kind: 'folder', id: folder.id, name: folder.name };
          toast(`Map "${folder.name}" gekopieerd — klik rechts om te plakken`, 'info');
        },
      },
      {
        label: 'Map knippen (om te verplaatsen)',
        icon: 'split',
        action: () => {
          dashClipboard = { mode: 'cut', kind: 'folder', id: folder.id, name: folder.name };
          toast(`Map "${folder.name}" geknipt — klik rechts in een map om te plakken`, 'info');
        },
      },
      { label: 'Map verplaatsen naar…', icon: 'folderMove', action: () => moveFolder(folder) },
      null,
      { label: 'Map verwijderen…', icon: 'trash', danger: true, action: () => removeFolder(folder) },
    ], `📁 ${folder.name}`);
  }

  function openEmptyAreaContextMenu(e) {
    const fmap = getFolderMap();
    const activeFolder = currentFolderId !== null ? fmap.get(currentFolderId) : null;
    const canPaste = Boolean(
      dashClipboard &&
      !(dashClipboard.kind === 'folder' && currentFolderId !== null && isFolderDescendant(currentFolderId, dashClipboard.id))
    );
    const entries = [
      { label: 'Nieuw project maken…', icon: 'plus', action: () => newProject(currentFolderId) },
      { label: activeFolder ? 'Nieuwe submap maken…' : 'Nieuwe map maken…', icon: 'folderPlus', action: () => createFolder(currentFolderId) },
      null,
      {
        label: dashClipboard ? `Plakken hier ("${dashClipboard.name}")` : 'Plakken',
        icon: 'copy',
        key: 'Ctrl+V',
        disabled: !canPaste,
        action: () => pasteIntoFolder(currentFolderId),
      },
    ];
    if (activeFolder) {
      entries.push(
        null,
        {
          label: 'Naar bovenliggende map',
          icon: 'back',
          action: () => { setCurrentFolder(activeFolder.parent_id ?? null); paintProjects(); },
        },
        {
          label: 'Naar hoofdmap (Alle projecten)',
          icon: 'folder',
          action: () => { projSearch = ''; setCurrentFolder(null); paintProjects(); },
        },
        { label: `Map "${activeFolder.name}" hernoemen…`, icon: 'edit', action: () => renameFolder(activeFolder) },
        { label: `Map "${activeFolder.name}" verplaatsen…`, icon: 'folderMove', action: () => moveFolder(activeFolder) }
      );
    }
    openDashContextMenu(e, entries, activeFolder ? `📁 ${activeFolder.name}` : '🏠 Hoofdmap (Alle projecten)');
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
      isModal: true,
      getCustomSfx: () => custom,
      getFolders: () => sfxStore.getCustomFolders(custom),
      onImported: () => draw(),
    });

    const filterBar = h('div', { class: 'sfx-filter-bar', role: 'group', 'aria-label': 'Effecten filteren' });
    const localSearchRow = h('div', { class: 'lib-head' }, search, newFolderBtn, toggleAllBtn);
    const list = h('div', { class: 'sfx-library-list' });
    body.replaceChildren(
      h('div', { class: 'sfx-library-heading' }, h('h2', {}, 'Geluidenbibliotheek'), h('p', {}, 'Beluister effecten, zoek op Freesound.org en bewaar je favorieten voor je volgende transmissie.')),
      h('div', { class: 'sfx-controls' },
        h('div', { class: 'sfx-filter-row' }, filterBar),
        localSearchRow
      ),
      fsBrowser.el,
      drop,
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
        }, icon('starFilled'), `Favorieten (${totalFavCount})`),
        h('button', {
          class: `sfx-filter-chip fs-chip${sfxFilter === 'freesound' ? ' active' : ''}`,
          'aria-pressed': String(sfxFilter === 'freesound'),
          onclick: () => { sfxFilter = 'freesound'; paint(); }
        }, icon('globe'), 'Freesound')
      );

      const isFs = sfxFilter === 'freesound';
      fsBrowser.el.hidden = !isFs;
      localSearchRow.hidden = isFs;
      drop.hidden = isFs;
      list.hidden = isFs;
      if (isFs) return;

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
        h('div', { class: 'fs-wave-meta' },
          h('div', { class: 'info' },
            h('div', { class: 'name', title: displayName }, displayName),
            h('div', { class: 'sub' }, hasAlias ? h('span', { class: 'badge', style: { fontSize: '9px', padding: '1px 4px', marginRight: '4px' } }, 'aangepast') : null, `${s.category || 'Eigen'}${s.duration ? ' · ' + s.duration.toFixed(1) + 's' : ''}`)),
          acts
        ),
        waveBox
      );
    };

    search.oninput = paint;
    draw();
  }

  select(current);
  return () => {
    closeDashContextMenu();
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener('resize', closeDashContextMenu);
    window.removeEventListener('scroll', closeDashContextMenu, true);
    window.removeEventListener('keydown', onWinKeyDown);
    fsBrowser?.destroy();
    previewAudio.stop();
  };
}
