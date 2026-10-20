// Thin API client
async function req(method, url, body, isForm = false) {
  const opts = { method };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers = { 'content-type': 'application/json' }; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(url, opts);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export const api = {
  projects: () => req('GET', '/api/projects'),
  project: (id) => req('GET', `/api/projects/${id}`),
  createProject: (data) => req('POST', '/api/projects', data),
  updateProject: (id, data) => req('PUT', `/api/projects/${id}`, data),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),

  uploadAssets: (projectId, files, extra = {}) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name || 'opname.webm');
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return req('POST', `/api/projects/${projectId}/assets`, fd, true);
  },
  updateAsset: (id, data) => req('PATCH', `/api/assets/${id}`, data),
  deleteAsset: (id) => req('DELETE', `/api/assets/${id}`),

  uploadImages: (id, files, folder = 'Files') => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    fd.append('folder', folder);
    return req('POST', `/api/projects/${id}/images`, fd, true);
  },
  updateImage: (id, data) => req('PATCH', `/api/images/${id}`, data),
  deleteImage: (id) => req('DELETE', `/api/images/${id}`),
  orderImages: (id, ids) => req('PUT', `/api/projects/${id}/image-order`, { ids }),

  sfx: () => req('GET', '/api/sfx'),
  uploadSfx: (files, category = 'Eigen') => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    fd.append('category', category);
    return req('POST', '/api/sfx', fd, true);
  },
  updateSfx: (id, data) => req('PATCH', `/api/sfx/${id}`, data),
  deleteSfx: (id) => req('DELETE', `/api/sfx/${id}`),

  freesoundStatus: () => req('GET', '/api/freesound/status'),
  freesoundSaveConfig: (data) => req('PUT', '/api/freesound/config', data),
  freesoundDisconnect: (clearAll = false) => req('POST', '/api/freesound/disconnect', { clearAll }),
  freesoundSearch: ({ q = '', sort = 'score', maxDuration = 0, page = 1, pageSize = 16 } = {}) => {
    const p = new URLSearchParams({ q, sort, page: String(page), pageSize: String(pageSize) });
    if (maxDuration > 0) p.set('maxDuration', String(maxDuration));
    return req('GET', `/api/freesound/search?${p.toString()}`);
  },
  freesoundImport: (data) => req('POST', '/api/freesound/import', data),

  createExport: (projectId, fd) => req('POST', `/api/projects/${projectId}/exports`, fd, true),
  deleteExport: (id) => req('DELETE', `/api/exports/${id}`),
};

export const fileUrl = {
  asset: (a) => `/files/audio/${a.filename}`,
  image: (a) => `/files/images/${a.filename}`,
  sfx: (s) => `/files/sfx/${s.filename}`,
  export: (e) => `/files/exports/${e.filename}`,
};
