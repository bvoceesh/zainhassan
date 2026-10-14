(() => {
  const API_BASE = (() => {
    const origin = window.location && window.location.origin ? window.location.origin : '';
    const localOrigins = ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://127.0.0.1', 'http://localhost'];
    if (localOrigins.includes(origin)) {
      return '';
    }
    return 'http://127.0.0.1:8787';
  })();

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      mode: 'cors',
      credentials: 'include',
      headers,
      body: options.body === undefined || options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)
    });
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }

  async function upload(file, category, patientId) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return request('/api/files', {
      method: 'POST',
      body: {
        name: file.name,
        category,
        patientId,
        contentBase64: btoa(binary)
      }
    });
  }

  window.hearthApi = {
    health: () => request('/api/health'),
    me: () => request('/api/me'),
    register: body => request('/api/register', { method: 'POST', body }),
    login: body => request('/api/login', { method: 'POST', body }),
    logout: () => request('/api/logout', { method: 'POST', body: {} }),
    dashboard: () => request('/api/dashboard'),
    patients: () => request('/api/patients'),
    medications: () => request('/api/medications'),
    addMedication: (patientId, body) => request(`/api/patients/${patientId}/medications`, { method: 'POST', body }),
    appointments: () => request('/api/appointments'),
    requestAppointment: body => request('/api/appointments', { method: 'POST', body }),
    respondAppointment: (id, response) => request(`/api/appointments/${id}/${response}`, { method: 'POST', body: {} }),
    availability: () => request('/api/availability'),
    saveAvailability: body => request('/api/availability', { method: 'POST', body }),
    volunteerRequests: () => request('/api/volunteer-requests'),
    createVolunteerRequest: body => request('/api/volunteer-requests', { method: 'POST', body }),
    acceptVolunteerRequest: id => request(`/api/volunteer-requests/${id}/accept`, { method: 'POST', body: {} }),
    files: () => request('/api/files'),
    uploadFile: upload,
    dietPlan: () => request('/api/diet-plan'),
    saveDietPlan: body => request('/api/diet-plan', { method: 'PUT', body }),
    askAssistant: question => request('/api/assistant', { method: 'POST', body: { question } })
  };
})();
