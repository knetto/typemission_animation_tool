// Freesound API v2 Search, Browse, Preview & Import UI + OAuth2 (http://localhost:3000/callback)
import { h, icon, toast } from '../util.js';
import { api, fileUrl } from '../api.js';
import { previewAudio } from '../preview.js';
import { decodeUrl, SR } from './engine.js';
import { sfxStore } from './sfxstore.js';

const QUICK_CATEGORIES = [
  { id: 'popular', label: '🔥 Populair', q: 'sound effect ui', sort: 'downloads_desc' },
  { id: 'sticker', label: '🏷️ Sticker & Tape', q: 'sticker peel tape adhesive' },
  { id: 'keyboard', label: '⌨️ Keyboard', q: 'mechanical keyboard key switch click' },
  { id: 'click', label: '🖱️ Click & Pop', q: 'button click pop ui' },
  { id: 'whoosh', label: '💨 Whoosh', q: 'whooshosh swipe transition' },
  { id: 'scifi', label: '🤖 Sci-Fi & Beep', q: 'scifi computer beep telemetry' },
  { id: 'glitch', label: '⚡ Glitch', q: 'glitch digital data static' },
  { id: 'chime', label: '🔔 Chime & Pling', q: 'chime ding bell positive' },
];
// Fix typo in whoosh query
QUICK_CATEGORIES[4].q = 'whoosh swipe transition';

export function createFreesoundBrowser({ onImported, getFolders, startExpanded = false } = {}) {
  let status = { configured: false, hasKey: false, hasClientId: false, oauthConnected: false, clientId: '', callbackUrl: 'http://localhost:3000/callback', authorizeUrl: null };
  let showConfig = false;
  let expanded = startExpanded;
  let activeCategory = '';
  let currentPage = 1;
  let totalCount = 0;
  let hasNext = false;
  let hasPrev = false;
  let loading = false;
  let results = [];
  const importedIds = new Set();

  const root = h('section', { class: 'fs-panel' });
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
      if (e.target.closest('button, a, input, select')) return;
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
          h('b', {}, 'Freesound.org Bibliotheek'),
          statusBadge
        ),
        h('span', {}, 'Zoek, beluister en importeer uit 600.000+ geluiden (OAuth2 & API v2)')
      )
    ),
    h('div', { class: 'fs-head-actions' }, configBtn, toggleBodyBtn)
  );

  // Config drawer
  const clientIdIn = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Bijv. a1b2c3d4e5f6… (Client ID)',
    autocomplete: 'off',
  });
  const apiKeyIn = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Plak je Freesound Client Secret / API Key…',
    autocomplete: 'off',
  });
  const configWrap = h('div', { class: 'fs-config-card' });

  // Search controls
  const searchIn = h('input', {
    class: 'input fs-search-input',
    type: 'search',
    placeholder: 'Zoek op Freesound (bijv. sticker peel, key press, whoosh, beep)…',
    'aria-label': 'Zoek op Freesound',
  });
  const sortSelect = h('select', {
    class: 'select fs-select',
    'aria-label': 'Sorteren op',
    onchange: () => doSearch(1),
  },
    h('option', { value: 'score' }, 'Sorteren: Relevantie'),
    h('option', { value: 'downloads_desc' }, 'Meest gedownload'),
    h('option', { value: 'rating_desc' }, 'Hoogst beoordeeld'),
    h('option', { value: 'duration_asc' }, 'Kortste eerst'),
    h('option', { value: 'created_desc' }, 'Nieuwste eerst')
  );
  const maxDurSelect = h('select', {
    class: 'select fs-select',
    'aria-label': 'Maximale lengte',
    onchange: () => doSearch(1),
  },
    h('option', { value: '0' }, 'Lengte: Alle'),
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
    h('button', { class: 'btn btn-primary', type: 'submit' }, icon('search'), 'Zoeken')
  );

  const catRow = h('div', { class: 'fs-cat-row' });
  const resultsWrap = h('div', { class: 'fs-results-wrap' });
  const bodyWrap = h('div', { class: 'fs-panel-body' }, configWrap, searchForm, catRow, resultsWrap);

  root.append(head, bodyWrap);

  function syncFolderOptions() {
    const currentVal = folderSelect.value || 'Freesound';
    const folders = typeof getFolders === 'function' ? getFolders() : sfxStore.getCustomFolders([]);
    const list = [...new Set(['Freesound', ...folders])];
    folderSelect.replaceChildren(
      ...list.map((f) => h('option', { value: f, selected: f === currentVal }, `📁 Map: ${f}`))
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
      if (status.clientId && !clientIdIn.value) clientIdIn.value = status.clientId;
      if (!status.configured) showConfig = true;
      render();
      if (expanded && status.configured && !results.length && !loading) {
        selectQuickCategory(QUICK_CATEGORIES[0]);
      }
    } catch (e) {
      statusBadge.textContent = 'Offline';
    }
  }

  async function doSearch(page = 1) {
    if (!status.configured) {
      showConfig = true;
      expanded = true;
      render();
      toast('Koppel eerst je Freesound API Key of OAuth2 bij API & OAuth2', 'info');
      apiKeyIn.focus();
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

  async function importSound(item, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const origChildren = [...btn.childNodes];
    btn.replaceChildren(h('span', { class: 'spinner' }), 'Opslaan…');
    const category = folderSelect.value || 'Freesound';
    try {
      const row = await api.freesoundImport({
        id: item.id,
        name: item.name,
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
      sfxStore.setCollapsed(category, false);
      importedIds.add(item.id);
      btn.classList.add('imported');
      btn.replaceChildren(icon('check'), 'Opgeslagen');
      toast(`"${item.name}" opgeslagen in "${category}"`, 'ok');
      if (typeof onImported === 'function') onImported(row);
    } catch (e) {
      btn.disabled = false;
      btn.replaceChildren(...origChildren);
      toast('Importeren mislukt: ' + e.message, 'err');
    }
  }

  function renderConfig() {
    configWrap.hidden = !showConfig;
    if (!showConfig) return;
    const callbackUrl = status.callbackUrl || 'http://localhost:3000/callback';
    configWrap.replaceChildren(
      h('div', { class: 'fs-config-header' },
        h('div', {},
          h('b', {}, 'Freesound API v2 & OAuth2 Koppeling'),
          h('p', {},
            'Maak een API-sleutel aan op ',
            h('a', { href: 'https://freesound.org/apiv2/apply/', target: '_blank', rel: 'noopener' }, 'freesound.org/apiv2/apply'),
            ' en stel onderstaande Callback URL in.'
          )
        ),
        status.configured ? h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => { showConfig = false; render(); }
        }, 'Sluiten') : null
      ),
      h('div', { class: 'fs-callback-row' },
        h('span', { class: 'fs-callback-label' }, 'OAuth2 Callback URL:'),
        h('code', { class: 'fs-callback-code' }, callbackUrl),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => {
            navigator.clipboard?.writeText(callbackUrl);
            toast('Callback URL gekopieerd: ' + callbackUrl, 'ok');
          }
        }, icon('copy'), 'Kopieer')
      ),
      h('div', { class: 'fs-config-grid' },
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'Client ID (voor OAuth2)'),
          clientIdIn
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'Client Secret / API Key ', status.hasKey ? h('small', { class: 'fs-saved-tag' }, '(opgeslagen)') : null),
          apiKeyIn
        )
      ),
      h('div', { class: 'fs-config-actions' },
        h('button', {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          onclick: async () => {
            const clientId = clientIdIn.value.trim();
            const apiKey = apiKeyIn.value.trim();
            if (!apiKey && !status.hasKey && !clientId) {
              return toast('Vul je Freesound API Key (Client Secret) in', 'err');
            }
            try {
              const payload = { clientId };
              if (apiKey) payload.apiKey = apiKey;
              status = await api.freesoundSaveConfig(payload);
              apiKeyIn.value = '';
              toast('Freesound API-instellingen opgeslagen!', 'ok');
              showConfig = false;
              render();
              if (!results.length) selectQuickCategory(QUICK_CATEGORIES[0]);
            } catch (e) {
              toast(e.message, 'err');
            }
          }
        }, 'Instellingen opslaan'),
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
            }
            if (!status.hasClientId || !status.hasKey) {
              return toast('Vul zowel Client ID als Client Secret / API Key in om OAuth2 te starten', 'info');
            }
            if (status.authorizeUrl) {
              window.open(status.authorizeUrl, 'freesound_oauth', 'width=620,height=720');
            }
          }
        }, icon('globe'), status.oauthConnected ? 'Opnieuw verbinden met OAuth2' : 'Verbind via OAuth2 (Callback)'),
        status.configured ? h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: async () => {
            status = await api.freesoundDisconnect(true);
            clientIdIn.value = '';
            apiKeyIn.value = '';
            results = [];
            toast('Freesound API ontkoppeld', 'info');
            render();
          }
        }, icon('trash'), 'Wissen') : null
      )
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
      ),
      folderSelect
    );
  }

  function renderResults() {
    resultsWrap.replaceChildren();
    if (loading) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('span', { class: 'spinner' }),
          h('span', {}, 'Geluiden zoeken op Freesound…')
        )
      );
      return;
    }

    if (!status.configured) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('p', {}, 'Voer hierboven je Freesound API Key (Client Secret) in om direct door 600.000+ geluiden te zoeken en bladeren.')
        )
      );
      return;
    }

    if (!results.length) {
      resultsWrap.append(
        h('div', { class: 'fs-empty' },
          h('p', {}, 'Geen geluiden gevonden. Kies een categorie of probeer een andere Engelse zoekterm (bijv. "pop", "whoosh", "click").')
        )
      );
      return;
    }

    const grid = h('div', { class: 'fs-results-grid' });
    for (const item of results) {
      const isImported = importedIds.has(item.id);
      const playBtn = h('button', {
        class: 'play',
        type: 'button',
        title: 'Voorbeluisteren',
        'aria-label': `${item.name} beluisteren`,
      }, icon('play'));
      playBtn.addEventListener('statechange', (e) => playBtn.replaceChildren(icon(e.detail ? 'pause' : 'play')));
      playBtn.onclick = () => previewAudio.playUrl(item.previewUrl, playBtn);

      const importBtn = h('button', {
        class: `btn btn-sm fs-import-btn${isImported ? ' imported' : ' btn-primary'}`,
        type: 'button',
        disabled: isImported,
        onclick: (e) => importSound(item, e.currentTarget),
      }, icon(isImported ? 'check' : 'download'), isImported ? 'Opgeslagen' : 'Opslaan');

      const tagsText = (item.tags || []).slice(0, 4).join(' · ');

      grid.append(
        h('div', { class: 'sfx-tile fs-tile' },
          playBtn,
          h('div', { class: 'info' },
            h('div', { class: 'name', title: item.name }, item.name),
            h('div', { class: 'sub' },
              h('span', { class: 'fs-dur-badge' }, `${item.duration.toFixed(1)}s`),
              `door ${item.username || 'onbekend'}`,
              item.license ? ` · ${item.license}` : ''
            ),
            tagsText ? h('div', { class: 'fs-tags' }, tagsText) : null
          ),
          h('div', { class: 'acts' }, importBtn)
        )
      );
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / 12));
    const pager = h('div', { class: 'fs-pager' },
      h('span', { class: 'fs-pager-info' }, `${totalCount.toLocaleString('nl-NL')} geluiden gevonden · Pagina ${currentPage} van ${totalPages}`),
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
      expanded ? 'Inklappen' : 'Zoeken & Bladeren'
    );

    if (status.oauthConnected) {
      statusBadge.className = 'fs-status-badge ok';
      statusBadge.textContent = '● OAuth2 Verbonden';
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
      toast('Freesound OAuth2 succesvol gekoppeld!', 'ok');
      showConfig = false;
      refreshStatus();
    }
  };
  window.addEventListener('message', onMessage);

  // Check if URL hash had freesound=connected
  if (location.hash.includes('freesound=connected')) {
    expanded = true;
    history.replaceState(null, '', '#/library');
    setTimeout(() => toast('Freesound OAuth2 succesvol verbonden!', 'ok'), 150);
  }

  render();
  refreshStatus();

  return {
    el: root,
    refreshFolders: syncFolderOptions,
    destroy: () => window.removeEventListener('message', onMessage),
  };
}

export function openFreesoundModal({ onImported, getFolders } = {}) {
  const browser = createFreesoundBrowser({
    onImported,
    getFolders,
    startExpanded: true,
  });

  const close = () => {
    previewAudio.stop();
    browser.destroy();
    dialog.close();
    dialog.remove();
  };

  const dialog = h('dialog', {
    class: 'fs-modal-dialog',
    'aria-label': 'Freesound.org geluiden zoeken',
    oncancel: (e) => { e.preventDefault(); close(); },
    onclick: (e) => { if (e.target === dialog) close(); },
  },
    h('div', { class: 'fs-modal-inner' },
      h('div', { class: 'fs-modal-top' },
        h('h3', {}, icon('globe'), 'Freesound.org — Geluiden zoeken & importeren'),
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', onclick: close }, '×')
      ),
      browser.el
    )
  );

  document.body.append(dialog);
  dialog.showModal();
}
