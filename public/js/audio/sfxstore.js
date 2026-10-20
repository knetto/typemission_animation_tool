// SFX library store: favorites, folders, collapsed state, sound renaming
const KEY_FAVORITES = 'ts_sfx_favorites';
const KEY_COLLAPSED = 'ts_sfx_collapsed';
const KEY_FOLDERS = 'ts_sfx_folders';
const KEY_ALIASES = 'ts_sfx_aliases';
const KEY_FS_MAP = 'ts_sfx_freesound_map';

function readJson(key, def) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : def;
  } catch {
    return def;
  }
}

function writeJson(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export function sfxId(item) {
  if (!item) return '';
  if (item.key) return `builtin:${item.key}`;
  if (item.src?.key) return `builtin:${item.src.key}`;
  if (item.id !== undefined) return `sfx:${item.id}`;
  if (item.src?.id !== undefined) return `sfx:${item.src.id}`;
  return '';
}

export const sfxStore = {
  // Favorites
  getFavorites() {
    return new Set(readJson(KEY_FAVORITES, []));
  },
  isFavorite(item) {
    const id = typeof item === 'string' ? item : sfxId(item);
    return sfxStore.getFavorites().has(id);
  },
  toggleFavorite(item) {
    const id = typeof item === 'string' ? item : sfxId(item);
    const favs = sfxStore.getFavorites();
    let isFav = false;
    if (favs.has(id)) {
      favs.delete(id);
    } else {
      favs.add(id);
      isFav = true;
    }
    writeJson(KEY_FAVORITES, [...favs]);
    return isFav;
  },

  // Collapsed state
  getCollapsed() {
    return new Set(readJson(KEY_COLLAPSED, []));
  },
  isCollapsed(folderKey) {
    return sfxStore.getCollapsed().has(folderKey);
  },
  setCollapsed(folderKey, collapsed) {
    const set = sfxStore.getCollapsed();
    if (collapsed) set.add(folderKey);
    else set.delete(folderKey);
    writeJson(KEY_COLLAPSED, [...set]);
  },
  toggleCollapsed(folderKey) {
    const set = sfxStore.getCollapsed();
    const isCol = !set.has(folderKey);
    if (isCol) set.add(folderKey);
    else set.delete(folderKey);
    writeJson(KEY_COLLAPSED, [...set]);
    return isCol;
  },
  setAllCollapsed(folderKeys, collapsed) {
    const set = sfxStore.getCollapsed();
    folderKeys.forEach((k) => (collapsed ? set.add(k) : set.delete(k)));
    writeJson(KEY_COLLAPSED, [...set]);
  },

  // Custom Folders
  getCustomFolders(existingSfx = []) {
    const saved = readJson(KEY_FOLDERS, ['Eigen']);
    const set = new Set(saved);
    set.add('Eigen');
    existingSfx.forEach((s) => {
      if (s.category && s.category.trim()) set.add(s.category.trim());
    });
    return [...set];
  },
  addCustomFolder(name) {
    name = (name || '').trim();
    if (!name) return false;
    const folders = sfxStore.getCustomFolders();
    if (!folders.includes(name)) {
      folders.push(name);
      writeJson(KEY_FOLDERS, folders);
    }
    return true;
  },
  renameCustomFolder(oldName, newName) {
    oldName = (oldName || '').trim();
    newName = (newName || '').trim();
    if (!oldName || !newName || oldName === newName) return false;
    const folders = sfxStore.getCustomFolders().map((f) => (f === oldName ? newName : f));
    writeJson(KEY_FOLDERS, [...new Set(folders)]);
    return true;
  },
  removeCustomFolder(name) {
    name = (name || '').trim();
    const folders = sfxStore.getCustomFolders().filter((f) => f !== name);
    writeJson(KEY_FOLDERS, folders.length ? folders : ['Eigen']);
  },

  // Aliases / Renaming
  getAliases() {
    return readJson(KEY_ALIASES, {});
  },
  getName(item) {
    const id = sfxId(item);
    const aliases = sfxStore.getAliases();
    return aliases[id] || item.name;
  },
  setAlias(item, newName) {
    const id = sfxId(item);
    const aliases = sfxStore.getAliases();
    const raw = item.rawName || item.name;
    if (newName && newName.trim() && newName.trim() !== raw) {
      aliases[id] = newName.trim();
    } else {
      delete aliases[id];
    }
    writeJson(KEY_ALIASES, aliases);
  },
  hasAlias(item) {
    const id = sfxId(item);
    const aliases = sfxStore.getAliases();
    return Boolean(aliases[id]);
  },
  resetAlias(item) {
    const id = sfxId(item);
    const aliases = sfxStore.getAliases();
    delete aliases[id];
    writeJson(KEY_ALIASES, aliases);
  },

  // Freesound ID -> Local SFX ID mapping
  getFreesoundMap() {
    return readJson(KEY_FS_MAP, {});
  },
  getFreesoundLocal(fsId, existingSfx = []) {
    const map = sfxStore.getFreesoundMap();
    const localId = map[String(fsId)];
    if (!localId) return null;
    if (existingSfx.length) {
      return existingSfx.find((s) => Number(s.id) === Number(localId)) || null;
    }
    return { id: localId };
  },
  setFreesoundLocal(fsId, localId) {
    const map = sfxStore.getFreesoundMap();
    map[String(fsId)] = localId;
    writeJson(KEY_FS_MAP, map);
  },
};
