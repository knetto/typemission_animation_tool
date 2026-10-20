// Freesound API v2 Search, Browse, Preview, Favorite & Import UI + OAuth2 (http://localhost:3000/callback)
import { h, icon, toast, modal, uid } from '../util.js';
import { api, fileUrl } from '../api.js';
import { previewAudio, createWaveBox } from '../preview.js';
import { decodeUrl, SR } from './engine.js';
import { sfxStore } from './sfxstore.js';

export const QUICK_CATEGORIES = [
  { id: 'popular', label: '🔥 Populair', q: 'sound effect ui', sort: 'downloads_desc' },
  { id: 'sticker', label: '🏷️ Sticker', q: 'sticker peel tape adhesive' },
  { id: 'keyboard', label: '⌨️ Keyboard', q: 'mechanical keyboard key switch click' },
  { id: 'click', label: '🖱️ Click & Pop', q: 'button click pop ui' },
  { id: 'whoosh', label: '💨 Whoosh', q: 'whoosh swipe transition' },
  { id: 'scifi', label: '🤖 Sci-Fi', q: 'scifi computer beep telemetry' },
  { id: 'glitch', label: '⚡ Glitch', q: 'glitch digital data static' },
  { id: 'chime', label: '🔔 Chime', q: 'chime ding bell positive' },
];

export function cleanFreesoundName(raw = '') {
  return String(raw || '')
    .replace(/\.(wav|mp3|ogg|flac|aiff?|m4a|webm)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Geluid';
}

export function shortFreesoundLicense(lic = '') {
  const s = String(lic || '').toLowerCase();
  if (!s) return '';
  if (s.includes('zero') || s.includes('publicdomain') || s.includes('cc0')) return 'CC0';
  if (s.includes('by-nc')) return 'CC BY-NC';
  if (s.includes('by')) return 'CC BY';
  if (s.includes('sampling')) return 'Sampling+';
  if (s.startsWith('http')) return '';
  return lic;
}

export async function ensureFreesoundImported(item, { category = 'Freesound', existingSfx = [], onImported = null } = {}) {
  const existing = sfxStore.getFreesoundLocal(item.id, existingSfx);
  if (existing && existing.filename) return existing;

  const cleanName = cleanFreesoundName(item.name);
  const row = await api.freesoundImport({
    id: item.id,
    name: cleanName,
    previewUrl: item.previewUrl,
    duration: item.duration,
    category,
    username: item.username,
  });
  try {
    const pcm = await decodeUrl(fileUrl.sfx(row));
    row.duration = pcm.length / SR;
    await api.updateSfx(row.id, { duration: row.duration });
  } catch {}
  sfxStore.addCustomFolder(category);
  sfxStore.setFreesoundLocal(item.id, row.id);
  if (typeof onImported === 'function') await onImported(row);
  return row;
}

export function buildFreesoundConfigCard({ status, onStatusChange, onClose } = {}) {
  let showSecret = false;
  const callbackUrl = status?.callbackUrl || 'http://localhost:3000/callback';

  const clientIdIn = h('input', {
    class: 'input',
    id: 'fs-client-id',
    type: 'text',
    value: status?.clientId || '',
    placeholder: 'Plak je Freesound Client ID…',
    autocomplete: 'off',
  });
  const apiKeyIn = h('input', {
    class: 'input',
    id: 'fs-api-key',
    type: 'password',
    placeholder: status?.hasKey ? '•••••••••••••••••••••••• (Opgeslagen)' : 'Plak je Freesound Client Secret / API Key…',
    autocomplete: 'off',
  });
  const toggleSecretBtn = h('button', {
    class: 'btn btn-sm btn-ghost fs-secret-toggle',
    type: 'button',
    onclick: () => {
      showSecret = !showSecret;
      apiKeyIn.type = showSecret ? 'text' : 'password';
      toggleSecretBtn.textContent = showSecret ? 'Verberg' : 'Toon';
    }
  }, 'Toon');

  const saveConfig = async () => {
    const clientId = clientIdIn.value.trim();
    const apiKey = apiKeyIn.value.trim();
    if (!apiKey && !status?.hasKey && !clientId) {
      return toast('Vul je Freesound Client ID en/of Client Secret (API Key) in', 'err');
    }
    try {
      const payload = { clientId };
      if (apiKey) payload.apiKey = apiKey;
      const next = await api.freesoundSaveConfig(payload);
      status = next;
      apiKeyIn.value = '';
      apiKeyIn.placeholder = next.hasKey ? '•••••••••••••••••••••••• (Opgeslagen)' : 'Plak je Freesound Client Secret / API Key…';
      toast('Freesound API-instellingen opgeslagen', 'ok');
      if (typeof onStatusChange === 'function') onStatusChange(next, { closed: true });
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  return h('form', {
    class: 'fs-config-card',
    onsubmit: (e) => {
      e.preventDefault();
      saveConfig();
    }
  },
    h('div', { class: 'fs-config-header' },
      h('div', {},
        h('b', {}, 'Freesound API v2 & OAuth2'),
        h('p', {},
          'Maak een API-sleutel aan op ',
          h('a', { href: 'https://freesound.org/apiv2/apply/', target: '_blank', rel: 'noopener' }, 'freesound.org/apiv2/apply'),
          ' met Callback URL ',
          h('code', { class: 'fs-callback-inline' }, callbackUrl),
          ' ',
          h('button', {
            class: 'fs-copy-inline',
            type: 'button',
            title: 'Kopieer Callback URL',
            onclick: () => {
              navigator.clipboard?.writeText(callbackUrl);
              toast('Callback URL gekopieerd', 'ok');
            }
          }, 'Kopieer')
        )
      ),
      onClose ? h('button', {
        class: 'btn btn-sm btn-ghost',
        type: 'button',
        onclick: onClose,
      }, 'Sluiten') : null
    ),
    h('div', { class: 'fs-config-grid' },
      h('label', { class: 'field' },
        h('span', { class: 'fs-field-head' }, h('span', {}, 'Client ID')),
        clientIdIn
      ),
      h('label', { class: 'field' },
        h('span', { class: 'fs-field-head' },
          h('span', {}, 'Client Secret / API Key'),
          status?.hasKey ? h('small', { class: 'fs-saved-tag' }, '✓ Opgeslagen') : null
        ),
        h('div', { class: 'fs-secret-input-wrap' }, apiKeyIn, toggleSecretBtn)
      )
    ),
    h('div', { class: 'fs-config-actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Opslaan'),
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        onclick: async () => {
          const clientId = clientIdIn.value.trim();
          const apiKey = apiKeyIn.value.trim();
          if (clientId || apiKey) {
            const payload = {};
            if (clientId) payload.clientId = clientId;
            if (apiKey) payload.apiKey = apiKey;
            status = await api.freesoundSaveConfig(payload);
            apiKeyIn.value = '';
            if (typeof onStatusChange === 'function') onStatusChange(status, { closed: false });
          }
          if (!status?.hasClientId || !status?.hasKey) {
            return toast('Vul zowel Client ID als Client Secret / API Key in om OAuth2 te starten', 'info');
          }
          if (status.authorizeUrl) {
            window.open(status.authorizeUrl, 'freesound_oauth', 'width=620,height=720');
          }
        }
      }, icon('globe'), status?.oauthConnected ? 'Opnieuw verbinden (OAuth2)' : 'Verbind via OAuth2'),
      status?.configured ? h('button', {
        class: 'btn btn-sm btn-ghost',
        type: 'button',
        onclick: async () => {
          status = await api.freesoundDisconnect(true);
          clientIdIn.value = '';
          apiKeyIn.value = '';
          toast('Freesound API ontkoppeld', 'info');
          if (typeof onStatusChange === 'function') onStatusChange(status, { closed: false });
        }
      }, icon('trash'), 'Ontkoppelen') : null
    )
  );
}

export async function openFreesoundConfigModal({ onSaved } = {}) {
  let status = await api.freesoundStatus().catch(() => ({
    configured: false, hasKey: false, hasClientId: false, oauthConnected: false, clientId: '', callbackUrl: 'http://localhost:3000/callback'
  }));
  const close = () => {
    window.removeEventListener('message', onMsg);
    dialog.close();
    dialog.remove();
  };
  const onMsg = async (e) => {
    if (e.data?.type === 'freesound-oauth-done') {
      toast('Freesound OAuth2 gekoppeld!', 'ok');
      status = await api.freesoundStatus().catch(() => status);
      if (typeof onSaved === 'function') onSaved(status);
      close();
    }
  };
  window.addEventListener('message', onMsg);

  const card = buildFreesoundConfigCard({
    status,
    onStatusChange: (next, { closed } = {}) => {
      status = next;
      if (typeof onSaved === 'function') onSaved(next);
      if (closed) close();
    },
    onClose: close,
  });

  const dialog = h('dialog', {
    class: 'fs-config-dialog',
    'aria-label': 'Freesound API instellingen',
    oncancel: (e) => { e.preventDefault(); close(); },
    onclick: (e) => { if (e.target === dialog) close(); },
  }, card);

  document.body.append(dialog);
  dialog.showModal();
}

export function createFreesoundBrowser({ onImported, getCustomSfx, getFolders, startExpanded = true, isModal = false } = {}) {
  let status = { configured: false, hasKey: false, hasClientId: false, oauthConnected: false, clientId: '', callbackUrl: 'http://localhost:3000/callback', authorizeUrl: null };
  let showConfig = false;
  let expanded = startExpanded;
  let activeCategory = 'popular';
  let currentPage = 1;
  let totalCount = 0;
  let hasNext = false;
  let hasPrev = false;
  let loading = false;
  let results = [];

  const root = h('section', { class: `fs-panel${isModal ? ' in-modal' : ''}` });
  const statusBadge = h('span', { class: 'fs-status-badge' }, 'Laden…');
  const configBtn = h('button', {
    class: 'btn btn-sm btn-ghost',
    type: 'button',
    onclick: (e) => {
      e.stopPropagation();
      expanded = true;
      showConfig = !showConfig;
      render();
    }
  }, icon('key'), 'API & OAuth2');

  const toggleBodyBtn = h('button', {
    class: 'btn btn-sm btn-ghost',
    type: 'button',
    onclick: () => {
      expanded = !expanded;
      render();
      if (expanded && status.configured && !results.length && !loading) {
        selectQuickCategory(QUICK_CATEGORIES[0]);
      }
    }
  });

  const head = h('div', {
    class: 'fs-panel-head',
    onclick: (e) => {
      if (isModal || e.target.closest('button, a, input, select')) return;
      expanded = !expanded;
      render();
      if (expanded && status.configured && !results.length && !loading) {
        selectQuickCategory(QUICK_CATEGORIES[0]);
      }
    }
  },
    h('div', { class: 'fs-brand' },
      h('span', { class: 'fs-logo-ico' }, icon('globe')),
      h('div', { class: 'fs-brand-text' },
        h('div', { class: 'fs-brand-title-row' },
          h('b', {}, 'Freesound.org'),
          statusBadge
        ),
        h('span', {}, 'Zoek, beluister, markeer als favoriet en bewaar geluiden in je bibliotheek')
      )
    ),
    h('div', { class: 'fs-head-actions' }, configBtn, isModal ? null : toggleBodyBtn)
  );

  const configSlot = h('div');

  const searchIn = h('input', {
    class: 'input fs-search-input',
    type: 'search',
    placeholder: 'Zoek op Freesound (bijv. sticker, keyboard, click, whoosh, beep)…',
    'aria-label': 'Zoek op Freesound',
  });
  const sortSelect = h('select', {
    class: 'select fs-select',
    'aria-label': 'Sorteren op',
    onchange: () => doSearch(1),
  },
    h('option', { value: 'downloads_desc' }, 'Populairste'),
    h('option', { value: 'score' }, 'Relevantie'),
    h('option', { value: 'rating_desc' }, 'Hoogst beoordeeld'),
    h('option', { value: 'duration_asc' }, 'Kortste eerst'),
    h('option', { value: 'created_desc' }, 'Nieuwste')
  );
  const maxDurSelect = h('select', {
    class: 'select fs-select',
    'aria-label': 'Maximale lengte',
    onchange: () => doSearch(1),
  },
    h('option', { value: '0' }, 'Alle lengtes'),
    h('option', { value: '2' }, 'Max 2 sec'),
    h('option', { value: '5', selected: true }, 'Max 5 sec'),
    h('option', { value: '10' }, 'Max 10 sec'),
    h('option', { value: '30' }, 'Max 30 sec')
  );
  const folderSelect = h('select', {
    class: 'select fs-select',
    'aria-label': 'Opslaan in map',
  });

  const searchForm = h('form', {
    class: 'fs-search-bar',
    onsubmit: (e) => {
      e.preventDefault();
      activeCategory = '';
      doSearch(1);
    }
  },
    searchIn,
    sortSelect,
    maxDurSelect,
    folderSelect,
    h('button', { class: 'btn btn-primary btn-sm fs-search-submit', type: 'submit' }, icon('search'), 'Zoeken')
  );

  const catRow = h('div', { class: 'fs-cat-row' });
  const resultsWrap = h('div', { class: 'fs-results-wrap' });
  const bodyWrap = h('div', { class: 'fs-panel-body' }, configSlot, searchForm, catRow, resultsWrap);

  root.append(head, bodyWrap);

  function syncFolderOptions() {
    const currentVal = folderSelect.value || 'Freesound';
    const customList = typeof getCustomSfx === 'function' ? getCustomSfx() : [];
    const folders = typeof getFolders === 'function' ? getFolders() : sfxStore.getCustomFolders(customList);
    const list = [...new Set(['Freesound', ...folders])];
    folderSelect.replaceChildren(
      ...list.map((f) => h('option', { value: f, selected: f === currentVal }, `📁 ${f}`))
    );
  }

  function selectQuickCategory(cat) {
    activeCategory = cat.id;
    searchIn.value = cat.q;
    if (cat.sort) sortSelect.value = cat.sort;
    doSearch(1);
  }

  async function refreshStatus() {
    try {
      status = await api.freesoundStatus();
      showConfig = !status.configured;
      if (!status.configured) expanded = true;
      render();
      if (expanded && status.configured && !results.length && !loading) {
        selectQuickCategory(QUICK_CATEGORIES[0]);
      }
    } catch {
      statusBadge.textContent = 'Offline';
    }
  }

  async function doSearch(page = 1) {
    if (!status.configured) {
      showConfig = true;
      expanded = true;
      render();
      toast('Koppel eerst je Freesound API Key bij API & OAuth2', 'info');
      return;
    }
    const q = searchIn.value.trim();
    loading = true;
    currentPage = page;
    renderResults();
    try {
      const data = await api.freesoundSearch({
        q,
        sort: sortSelect.value,
        maxDuration: maxDurSelect.value,
        page,
        pageSize: 12,
      });
      results = data.results || [];
      totalCount = data.count || 0;
      hasNext = Boolean(data.next);
      hasPrev = Boolean(data.previous);
    } catch (e) {
      toast(e.message, 'err');
      results = [];
    } finally {
      loading = false;
      render();
    }
  }

  function renderConfig() {
    configSlot.replaceChildren();
    configSlot.hidden = !showConfig;
    if (!showConfig) return;
    configSlot.append(
      buildFreesoundConfigCard({
        status,
        onStatusChange: (next, { closed } = {}) => {
          status = next;
          if (closed && next.configured) showConfig = false;
          render();
          if (next.configured && !results.length) selectQuickCategory(QUICK_CATEGORIES[0]);
        },
        onClose: status.configured ? () => { showConfig = false; render(); } : null,
      })
    );
  }

  function renderCategories() {
    syncFolderOptions();
    catRow.replaceChildren(
      h('div', { class: 'fs-chips' },
        ...QUICK_CATEGORIES.map((cat) => h('button', {
          class: `sfx-filter-chip${activeCategory === cat.id ? ' active' : ''}`,
          type: 'button',
          onclick: () => selectQuickCategory(cat),
        }, cat.label))
      )
    );
  }

  function renderResults() {
    resultsWrap.replaceChildren();
    if (loading) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('span', { class: 'spinner' }),
          h('span', {}, 'Geluiden laden van Freesound…')
        )
      );
      return;
    }

    if (!status.configured) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('p', {}, 'Vul hierboven je Freesound API Key in om direct te zoeken en bladeren.')
        )
      );
      return;
    }

    if (!results.length) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('p', {}, 'Geen geluiden gevonden. Kies een categorie of probeer een andere Engelse zoekterm.')
        )
      );
      return;
    }

    const customList = typeof getCustomSfx === 'function' ? getCustomSfx() : [];
    const grid = h('div', { class: 'sfx-grid fs-results-grid' });

    results.forEach((item, idx) => {
      const displayName = cleanFreesoundName(item.name);
      const localItem = sfxStore.getFreesoundLocal(item.id, customList);
      const isSaved = Boolean(localItem && localItem.id);
      const isFav = isSaved && sfxStore.isFavorite({ id: localItem.id });
      const lic = shortFreesoundLicense(item.license);
      const subParts = [`${item.duration.toFixed(1)}s`, item.username || 'Freesound', lic].filter(Boolean);

      const playBtn = h('button', {
        class: 'play',
        type: 'button',
        title: 'Voorbeluisteren',
        'aria-label': `${displayName} beluisteren`,
      }, icon('play'));
      playBtn.addEventListener('statechange', (e) => playBtn.replaceChildren(icon(e.detail ? 'pause' : 'play')));
      playBtn.onclick = () => previewAudio.playUrl(item.previewUrl, playBtn);

      const favBtn = h('button', {
        class: `btn btn-ghost btn-sm btn-icon btn-fav${isFav ? ' active' : ''}`,
        type: 'button',
        title: isFav ? 'Verwijder uit favorieten' : 'Als favoriet bewaren',
        'aria-pressed': String(isFav),
        onclick: async (e) => {
          e.stopPropagation();
          favBtn.disabled = true;
          try {
            const category = folderSelect.value || 'Freesound';
            const row = await ensureFreesoundImported(item, {
              category,
              existingSfx: typeof getCustomSfx === 'function' ? getCustomSfx() : [],
              onImported,
            });
            const nowFav = sfxStore.toggleFavorite({ id: row.id });
            toast(nowFav ? `"${displayName}" toegevoegd aan favorieten` : `"${displayName}" uit favorieten verwijderd`, 'ok');
            if (typeof onImported === 'function') await onImported(row);
            renderResults();
          } catch (err) {
            toast(err.message, 'err');
          } finally {
            favBtn.disabled = false;
          }
        }
      }, icon(isFav ? 'starFilled' : 'star'));

      const saveBtn = h('button', {
        class: `btn btn-ghost btn-sm btn-icon fs-save-icon-btn${isSaved ? ' saved' : ''}`,
        type: 'button',
        title: isSaved ? 'Al opgeslagen in bibliotheek' : `Opslaan in "${folderSelect.value || 'Freesound'}"`,
        disabled: isSaved,
        onclick: async (e) => {
          e.stopPropagation();
          saveBtn.disabled = true;
          saveBtn.replaceChildren(h('span', { class: 'spinner' }));
          try {
            const category = folderSelect.value || 'Freesound';
            const row = await ensureFreesoundImported(item, {
              category,
              existingSfx: typeof getCustomSfx === 'function' ? getCustomSfx() : [],
              onImported,
            });
            toast(`"${displayName}" opgeslagen in "${category}"`, 'ok');
            renderResults();
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.replaceChildren(icon('plus'));
            toast(err.message, 'err');
          }
        }
      }, icon(isSaved ? 'check' : 'plus'));

      const options = h('div', { class: 'sfx-options', id: uid('fs-options'), popover: 'auto', 'aria-label': `Opties voor ${displayName}` });
      const optionsBtn = h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', title: 'Meer opties', popovertarget: options.id }, icon('more'));
      options.addEventListener('beforetoggle', (e) => {
        if (e.newState !== 'open') return;
        const rect = optionsBtn.getBoundingClientRect();
        options.style.left = Math.max(8, Math.min(rect.right - 210, innerWidth - 218)) + 'px';
        options.style.top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 160)) + 'px';
      });
      options.addEventListener('click', (e) => { if (e.target.closest('button')) options.hidePopover(); });

      const saveToMapBtn = h('button', {
        class: 'sfx-option-action',
        type: 'button',
        onclick: async () => {
          const allFolders = [...new Set(['Freesound', ...(typeof getFolders === 'function' ? getFolders() : sfxStore.getCustomFolders())])];
          const res = await modal({
            title: `"${displayName}" opslaan in map`,
            body: 'Kies een map of typ een nieuwe:',
            select: { options: allFolders.map((f) => ({ value: f, label: `📁 ${f}` })), value: folderSelect.value || 'Freesound' },
            input: { placeholder: 'Of nieuwe mapnaam…' },
            confirm: 'Opslaan',
          });
          if (!res) return;
          const target = (typeof res === 'object' ? (res.input?.trim() || res.select) : res).trim() || 'Freesound';
          try {
            const row = await ensureFreesoundImported(item, {
              category: target,
              existingSfx: [],
              onImported,
            });
            if (row.category !== target) {
              await api.updateSfx(row.id, { category: target });
              row.category = target;
              sfxStore.addCustomFolder(target);
              if (typeof onImported === 'function') await onImported(row);
            }
            toast(`"${displayName}" opgeslagen in "${target}"`, 'ok');
            renderResults();
          } catch (err) {
            toast(err.message, 'err');
          }
        }
      }, icon('folderMove'), h('span', {}, 'Opslaan in map…'));

      options.append(saveToMapBtn);

      const waveBox = createWaveBox({
        key: `fs:${item.id}`,
        waveformUrl: item.waveformUrl,
        audioUrl: item.previewUrl,
        duration: item.duration,
        playBtn,
      });

      grid.append(
        h('div', { class: 'fs-wave-card', style: { '--i': idx } },
          h('div', { class: 'fs-wave-meta' },
            h('div', { class: 'info' },
              h('div', { class: 'name', title: displayName }, displayName),
              h('div', { class: 'sub' },
                h('span', { class: 'fs-author' }, item.username || 'Freesound'),
                lic ? ` · ${lic}` : '',
                item.downloads ? ` · ↓ ${item.downloads}` : ''
              )
            ),
            h('div', { class: 'acts' }, favBtn, saveBtn, optionsBtn, options)
          ),
          waveBox
        )
      );
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / 12));
    const pager = h('div', { class: 'fs-pager' },
      h('span', { class: 'fs-pager-info' }, `${totalCount.toLocaleString('nl-NL')} resultaten · Pagina ${currentPage} van ${totalPages}`),
      h('div', { class: 'fs-pager-btns' },
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          disabled: !hasPrev || currentPage <= 1,
          onclick: () => doSearch(currentPage - 1),
        }, '← Vorige'),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          disabled: !hasNext,
          onclick: () => doSearch(currentPage + 1),
        }, 'Volgende →')
      )
    );

    resultsWrap.append(grid, pager);
  }

  function render() {
    root.classList.toggle('collapsed', !expanded);
    bodyWrap.hidden = !expanded;
    toggleBodyBtn.replaceChildren(
      icon(expanded ? 'chevronDown' : 'chevronRight'),
      expanded ? 'Inklappen' : 'Uitklappen'
    );

    if (status.oauthConnected) {
      statusBadge.className = 'fs-status-badge ok';
      statusBadge.textContent = '● OAuth2 Actief';
    } else if (status.hasKey) {
      statusBadge.className = 'fs-status-badge ok';
      statusBadge.textContent = '● API Key Actief';
    } else {
      statusBadge.className = 'fs-status-badge warn';
      statusBadge.textContent = '● Niet gekoppeld';
    }

    renderConfig();
    renderCategories();
    renderResults();
  }

  const onMessage = (e) => {
    if (e.data?.type === 'freesound-oauth-done') {
      toast('Freesound OAuth2 gekoppeld!', 'ok');
      showConfig = false;
      refreshStatus();
    }
  };
  window.addEventListener('message', onMessage);

  render();
  refreshStatus();

  return {
    el: root,
    refreshFolders: () => { syncFolderOptions(); renderResults(); },
    destroy: () => window.removeEventListener('message', onMessage),
  };
}

export function openFreesoundModal({ onImported, getCustomSfx, getFolders } = {}) {
  const browser = createFreesoundBrowser({
    onImported,
    getCustomSfx,
    getFolders,
    startExpanded: true,
    isModal: true,
  });

  const close = () => {
    previewAudio.stop();
    browser.destroy();
    dialog.close();
    dialog.remove();
  };

  // Add close button directly into the single clean header
  const headActions = browser.el.querySelector('.fs-head-actions');
  headActions?.append(
    h('button', { class: 'btn btn-ghost btn-sm btn-icon', type: 'button', title: 'Sluiten', onclick: close }, '×')
  );

  const dialog = h('dialog', {
    class: 'fs-modal-dialog',
    'aria-label': 'Freesound.org geluiden zoeken',
    oncancel: (e) => { e.preventDefault(); close(); },
    onclick: (e) => { if (e.target === dialog) close(); },
  }, browser.el);

  document.body.append(dialog);
  dialog.showModal();
}
