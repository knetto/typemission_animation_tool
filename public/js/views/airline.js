import { h, icon, toast, fmtSize } from '../util.js';
import { api, fileUrl } from '../api.js';
import { COPY_FIELDS, DEPARTURES, LANGUAGES, normalizeAirlineOpts, imageDimensions, setAirlineLanguage } from '../airline/model.js';
import { renderAirline } from '../airline/renderer.js';

export async function mount(root, { id, project }) {
  project ||= await api.project(id);
  let opts = normalizeAirlineOpts(project.airline_opts);
  let exports = project.exports || [], destroyed = false, exporting = false;
  let timer = 0, revision = 0, savedRevision = 0, saveQueue = Promise.resolve();
  const inputs = new Map();
  const status = h('span', { class: 'save-state', role: 'status', id: 'airline-save-state' }, 'Opgeslagen');
  const title = h('input', { class: 'ed-title', value: project.name, maxlength: 120, 'aria-label': 'Projectnaam', oninput: changed });
  const canvas = h('canvas', { id: 'airline-canvas', role: 'img', 'aria-label': 'Voorbeeld van de airline-homepage' });
  const stage = h('div', { class: 'airline-stage' }, canvas);
  const dimensions = h('span', { class: 'hint mono', id: 'airline-dimensions' });
  const exportStatus = h('p', { class: 'hint', role: 'status', id: 'airline-export-status' });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'airline-export-btn', onclick: exportImage }, icon('download'), 'Afbeelding exporteren');
  const previewTitle = h('b');
  const history = h('div', { class: 'airline-export-list', id: 'airline-export-list' });
  const designButtons = [['website', 'Airline-homepage', 'globe'], ['ticket', 'Boardingpass', 'film']].map(([design, label, ico]) => h('button', {
    type: 'button', class: 'btn', id: `airline-design-${design}`, 'aria-pressed': String(opts.design === design),
    onclick: () => { opts.design = design; changed(); draw(); },
  }, icon(ico), label));

  function changeLanguage(language) {
    opts = setAirlineLanguage(opts, language);
    for (const [key, input] of inputs) if (key in opts) input.value = opts[key];
  }
  function flagAt(event) {
    if (opts.design !== 'website') return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * 1920 / rect.width;
    const y = (event.clientY - rect.top) * 1080 / rect.height;
    return LANGUAGES.find((_, i) => x >= 1340 + i * 99 && x <= 1428 + i * 99 && y >= 24 && y <= 86);
  }
  canvas.addEventListener('click', event => {
    const language = flagAt(event);
    if (language) { changeLanguage(language); changed(); draw(); }
  });
  canvas.addEventListener('pointermove', event => { canvas.style.cursor = flagAt(event) ? 'pointer' : 'default'; });

  function changed() {
    revision++; clearTimeout(timer);
    status.textContent = 'Wijzigingen opslaan…'; status.classList.add('saving');
    timer = setTimeout(() => { persist().catch(() => {}); }, 350);
  }
  function persist() {
    clearTimeout(timer); timer = 0;
    const version = revision;
    const payload = { name: title.value.trim() || 'Airline project', airline_opts: structuredClone(opts) };
    const task = saveQueue.catch(() => {}).then(() => api.updateProject(id, payload));
    saveQueue = task;
    task.then(() => {
      savedRevision = version;
      if (!destroyed && revision === version) { status.textContent = 'Opgeslagen'; status.classList.remove('saving'); }
    }, error => {
      if (!destroyed) { status.textContent = 'Opslaan mislukt'; status.classList.add('saving'); toast(error.message, 'err'); }
    });
    return task;
  }
  function draw() {
    // Preview stays at native 1x; export uses the selected 1x or 2x resolution.
    const base = imageDimensions({ ...opts, scale: 1 });
    canvas.width = base.width; canvas.height = base.height;
    stage.style.setProperty('--airline-preview-ratio', String(base.width / base.height));
    canvas.setAttribute('aria-label', opts.design === 'ticket' ? 'Voorbeeld van de boardingpass' : 'Voorbeeld van de airline-homepage');
    renderAirline(canvas, opts);
    const size = imageDimensions(opts);
    dimensions.textContent = `${size.width} × ${size.height} px · ${opts.format.toUpperCase()}`;
    previewTitle.textContent = opts.design === 'ticket' ? 'Boardingpass' : 'Airline-homepage';
    designButtons.forEach((btn, i) => {
      const on = (i === 0 ? 'website' : 'ticket') === opts.design;
      btn.classList.toggle('btn-primary', on); btn.classList.toggle('btn-ghost', !on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  function field(key, label, max = 80, type = 'text') {
    const input = h('input', { class: 'input', type, id: `airline-${key}`, value: opts[key], maxlength: max,
      oninput: () => { opts[key] = input.value; changed(); draw(); } });
    inputs.set(key, input);
    return h('label', { class: 'field', for: `airline-${key}` }, label, input);
  }
  function select(key, label, options, onChange) {
    const input = h('select', { class: 'input', id: `airline-${key}`, onchange: () => {
      if (key === 'language') changeLanguage(input.value);
      else opts[key] = key === 'scale' ? Number(input.value) : input.value;
      onChange?.(input.value); changed(); draw();
    } }, ...options.map(([value, name]) => h('option', { value, selected: String(opts[key]) === String(value) }, name)));
    inputs.set(key, input);
    return h('label', { class: 'field', for: `airline-${key}` }, label, input);
  }
  function section(title, ...children) {
    return h('section', { class: 'airline-settings-section' }, h('h3', {}, title), ...children);
  }
  const preset = h('select', { class: 'input', id: 'airline-departure-preset', onchange: () => {
    if (preset.value === '') return;
    const selected = DEPARTURES[Number(preset.value)];
    if (!selected) return;
    opts.origin = selected.origin; opts.originCode = selected.originCode;
    inputs.get('origin').value = opts.origin; inputs.get('originCode').value = opts.originCode;
    // A manual departure can override the language's suggested airport.
    changed(); draw(); preset.value = '';
  } }, h('option', { value: '', selected: true }, 'Kies een vertrekpunt…'), ...DEPARTURES.map((item, i) => h('option', { value: i }, item.label)));

  const settings = h('div', { class: 'airline-settings' },
    h('p', { class: 'hint' }, 'Engels als standaard. Pas de gegevens en alle zichtbare teksten aan voor jouw taalgebied. Beide ontwerpen delen dezelfde vlucht.'),
    section('Airline & uitstraling',
      field('airline', 'Airlinenaam', 50), field('accent', 'Accentkleur', 7, 'color'),
      select('language', 'Actieve taalvlag', LANGUAGES.map(l => [l, l])),
      h('p', { class: 'hint' }, 'De vlag vertaalt de homepage en boardingpass en kiest een passend vertrekpunt. Klik ook rechtstreeks op een vlag in het voorbeeld. Eigen teksten worden per taal onthouden.')),
    section('Route',
      h('label', { class: 'field', for: 'airline-departure-preset' }, 'Vertrekpreset', preset),
      h('div', { class: 'airline-field-pair' }, field('origin', 'Vertrekplaats'), field('originCode', 'Luchthavencode vertrek', 8)),
      h('div', { class: 'airline-field-pair' }, field('destination', 'Bestemming'), field('destinationCode', 'Luchthavencode aankomst', 8))),
    section('Reiziger & ticket',
      select('ticketType', 'Ticket voor', [['adult', 'Volwassene'], ['child', 'Kind']])),
    section('Vlucht 1 · ook op de boardingpass',
      h('div', { class: 'airline-field-pair' }, field('date', 'Datum (vrije tekst)', 40), field('flight', 'Vluchtnummer', 24)),
      h('div', { class: 'airline-field-pair' }, field('departure', 'Vertrektijd', 24), field('arrival', 'Aankomsttijd', 24)),
      h('div', { class: 'airline-field-pair' }, field('duration', 'Vluchtduur', 30), field('fare', 'Prijs (incl. valuta)', 30))),
    ...opts.otherFlights.map((_, i) => section(`Vlucht ${i + 2}`,
      ...[['flight', 'Vluchtnummer'], ['departure', 'Vertrektijd'], ['arrival', 'Aankomsttijd'], ['duration', 'Vluchtduur'], ['fare', 'Prijs (incl. valuta)']].map(([key, label]) => {
        const input = h('input', { class: 'input', id: `airline-flight-${i + 2}-${key}`, value: opts.otherFlights[i][key], maxlength: 40,
          oninput: () => { opts.otherFlights[i][key] = input.value; changed(); draw(); } });
        return h('label', { class: 'field' }, label, input);
      }))),
    section('Boardingpass',
      h('div', { class: 'airline-field-pair' }, field('boarding', 'Instaptijd', 24), field('gate', 'Gate', 20)),
      h('div', { class: 'airline-field-pair' }, field('seat', 'Stoel', 20), field('cabin', 'Reisklasse', 40)),
      field('reference', 'Boekingsreferentie', 30)),
    h('details', { class: 'airline-copy-settings' }, h('summary', {}, 'Alle teksten aanpassen'),
      h('p', { class: 'hint' }, 'Deze teksten verschijnen in de afbeelding. Je kunt ze vertalen of leegmaken.'),
      ...COPY_FIELDS.map(([key, label, , max]) => field(key, label, max))));

  const formatSelect = select('format', 'Bestandstype', [['png', 'PNG · verliesvrij'], ['jpg', 'JPG · kleiner bestand']]);
  const scaleSelect = select('scale', 'Resolutie', [['1', 'Standaard (1×)'], ['2', 'Extra scherp (2×)']]);
  const exportPanel = h('section', { class: 'airline-export-panel glass' },
    h('div', {}, h('h3', {}, 'Exporteer je ontwerp'), h('p', { class: 'hint' }, 'Alleen het ontwerp wordt geëxporteerd. De afbeelding blijft ook in dit project beschikbaar.')),
    h('div', { class: 'airline-export-options' }, formatSelect, scaleSelect),
    dimensions, exportBtn, exportStatus);

  root.append(h('div', { class: 'airline-editor' },
    h('div', { class: 'ed-head' }, h('a', { href: '#/', class: 'btn btn-ghost btn-icon', title: 'Terug naar projecten' }, icon('back')), title, status,
      h('div', { class: 'spacer' }), h('span', { class: 'airline-project-kind' }, icon('globe'), 'Airline Website & Ticket'),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'airline-show-export', onclick: () => {
        exportPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } }, icon('download'), 'Export')),
    h('div', { class: 'airline-workspace' },
      h('section', { class: 'airline-preview-column' },
        h('div', { class: 'airline-design-tabs', role: 'group', 'aria-label': 'Ontwerp kiezen' }, ...designButtons),
        h('div', { class: 'airline-preview-heading' }, previewTitle, h('span', { class: 'hint' }, 'Live voorbeeld')),
        stage, exportPanel,
        h('section', { class: 'airline-history' }, h('h3', {}, 'Geëxporteerde afbeeldingen'), history)),
      h('aside', { class: 'airline-settings-column panel', 'aria-label': 'Airline instellingen' },
        h('div', { class: 'panel-heading' }, icon('edit'), 'Ontwerp aanpassen'), settings))));

  function renderHistory() {
    history.replaceChildren(...exports.map(item => h('div', { class: 'airline-export-row' },
      h('div', {}, h('b', {}, item.scene === 'airline-ticket' ? 'Boardingpass' : 'Airline-homepage'),
        h('span', { class: 'hint' }, `${item.width} × ${item.height} · ${item.filename.split('.').pop().toUpperCase()} · ${fmtSize(item.size)}`)),
      h('a', { class: 'btn btn-sm btn-ghost', href: fileUrl.export(item), download: item.filename, title: 'Afbeelding downloaden' }, icon('download'), 'Download'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost btn-icon', title: 'Export verwijderen', onclick: async () => {
        try { await api.deleteExport(item.id); exports = exports.filter(e => e.id !== item.id); renderHistory(); }
        catch (error) { toast(error.message, 'err'); }
      } }, icon('trash')))));
    if (!exports.length) history.append(h('p', { class: 'hint' }, 'Nog geen afbeeldingen geëxporteerd.'));
  }
  async function exportImage() {
    if (exporting) return;
    exporting = true; exportBtn.disabled = true; exportStatus.textContent = 'Afbeelding maken…';
    // Freeze the selected design and data while editing can continue.
    const snapshot = structuredClone(opts);
    try {
      await persist();
      const output = document.createElement('canvas');
      const size = imageDimensions(snapshot); output.width = size.width; output.height = size.height;
      renderAirline(output, snapshot);
      const blob = await new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('Kon geen afbeelding maken')), 'image/png'));
      const body = new FormData(); body.append('image', blob, 'design.png');
      body.append('format', snapshot.format); body.append('design', snapshot.design);
      const item = await api.createImageExport(id, body);
      if (destroyed) return;
      exports.unshift(item); renderHistory();
      const link = h('a', { href: fileUrl.export(item), download: item.filename });
      document.body.append(link); link.click(); link.remove();
      exportStatus.textContent = `Klaar · ${item.width} × ${item.height} px · ${fmtSize(item.size)}`;
      toast('Afbeelding geëxporteerd', 'ok');
    } catch (error) {
      if (!destroyed) { exportStatus.textContent = error.message; toast(error.message, 'err'); }
    } finally { exporting = false; exportBtn.disabled = false; }
  }
  const beforeUnload = event => {
    if (revision !== savedRevision) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);
  draw(); renderHistory();
  return () => {
    clearTimeout(timer);
    if (revision !== savedRevision) persist().catch(() => {});
    destroyed = true; window.removeEventListener('beforeunload', beforeUnload);
  };
}
