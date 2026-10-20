import { h, icon, uid } from '../util.js';
import { sfxStore } from './sfxstore.js';

// Both library views share visible state, keyboard controls and bulk actions.
export function createSfxFolders(bulkButton) {
  let folders = [], query = '';
  const searchCollapsed = new Map();

  function sync() {
    const anyOpen = folders.some((folder) => !folder.body.hidden);
    const label = anyOpen ? 'Alles invouwen' : 'Alles uitvouwen';
    if (bulkButton.classList.contains('btn-icon')) {
      bulkButton.replaceChildren(icon(anyOpen ? 'collapse' : 'expand'));
    } else {
      bulkButton.replaceChildren(icon(anyOpen ? 'collapse' : 'expand'), label);
    }
    bulkButton.title = label;
    bulkButton.setAttribute('aria-label', label);
    bulkButton.disabled = !folders.length;
  }

  bulkButton.onclick = () => {
    const collapse = folders.some((folder) => !folder.body.hidden);
    folders.forEach((folder) => folder.setCollapsed(collapse));
    sync();
  };

  return {
    reset(nextQuery) {
      if (query !== nextQuery) searchCollapsed.clear();
      query = nextQuery;
      folders = [];
    },
    sync,
    folder({ key, title, iconName = 'folder', count, isFavGroup = false, actions = [], children = [], bodyClass = '', emptyText = 'Geen geluiden in deze map' }) {
      const body = h('div', { class: `sfx-folder-body ${bodyClass}`, id: uid('sfx-folder') },
        ...(children.length ? children : [h('div', { class: 'sfx-folder-empty' }, emptyText)]));
      const toggle = h('button', { class: 'sfx-folder-toggle', type: 'button', 'aria-controls': body.id },
        h('span', { class: 'sfx-folder-chevron' }, icon('chevronDown')),
        h('span', { class: 'sfx-folder-icon' }, icon(iconName)),
        h('span', { class: 'sfx-folder-title' }, title),
        h('span', { class: 'sfx-folder-count' }, String(count)));
      const head = h('div', { class: 'sfx-folder-head' }, toggle,
        actions.length ? h('div', { class: 'sfx-folder-actions' }, ...actions) : null);
      const section = h('section', { class: `sfx-folder${isFavGroup ? ' fav-group' : ''}`, 'data-folder': key }, head, body);
      function display(collapsed) {
        body.hidden = collapsed;
        section.classList.toggle('collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = `${title} ${collapsed ? 'uitvouwen' : 'invouwen'}`;
      }
      function setCollapsed(collapsed) {
        // Search opens matches temporarily; clearing it restores saved folders.
        if (query) searchCollapsed.set(key, collapsed);
        else sfxStore.setCollapsed(key, collapsed);
        display(collapsed);
      }
      display(query ? (searchCollapsed.get(key) ?? false) : sfxStore.isCollapsed(key));
      toggle.onclick = () => { setCollapsed(!body.hidden); sync(); };
      folders.push({ body, setCollapsed });
      return section;
    }
  };
}
