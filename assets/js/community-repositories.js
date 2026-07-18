export class RepositoryError extends Error {
  constructor(message, { status = 0, code = 'repository_error', details = null } = {}) {
    super(message);
    this.name = 'RepositoryError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AccountRepository {
  async getTurnstileConfig() { throw new Error('AccountRepository.getTurnstileConfig() doit être implémenté.'); }
  async getSession() { throw new Error('AccountRepository.getSession() doit être implémenté.'); }
  async login() { throw new Error('AccountRepository.login() doit être implémenté.'); }
  async register() { throw new Error('AccountRepository.register() doit être implémenté.'); }
  async logout() { throw new Error('AccountRepository.logout() doit être implémenté.'); }
  async verifyEmail() { throw new Error('AccountRepository.verifyEmail() doit être implémenté.'); }
  async forgotPassword() { throw new Error('AccountRepository.forgotPassword() doit être implémenté.'); }
  async resetPassword() { throw new Error('AccountRepository.resetPassword() doit être implémenté.'); }
}

export class ReplicaRepository {
  async list() { throw new Error('ReplicaRepository.list() doit être implémenté.'); }
  async create() { throw new Error('ReplicaRepository.create() doit être implémenté.'); }
  async update() { throw new Error('ReplicaRepository.update() doit être implémenté.'); }
  async uploadPhoto() { throw new Error('ReplicaRepository.uploadPhoto() doit être implémenté.'); }
  async processingStatus() { throw new Error('ReplicaRepository.processingStatus() doit être implémenté.'); }
  async submit() { throw new Error('ReplicaRepository.submit() doit être implémenté.'); }
  async archive() { throw new Error('ReplicaRepository.archive() doit être implémenté.'); }
  async listPublishedAdmin() { throw new Error('ReplicaRepository.listPublishedAdmin() doit être implémenté.'); }
  async listPendingAdmin() { throw new Error('ReplicaRepository.listPendingAdmin() doit être implémenté.'); }
  async updateAdmin() { throw new Error('ReplicaRepository.updateAdmin() doit être implémenté.'); }
  async archiveAdmin() { throw new Error('ReplicaRepository.archiveAdmin() doit être implémenté.'); }
  async restoreAdmin() { throw new Error('ReplicaRepository.restoreAdmin() doit être implémenté.'); }
  async publishAdmin() { throw new Error('ReplicaRepository.publishAdmin() doit être implémenté.'); }
  async rejectAdmin() { throw new Error('ReplicaRepository.rejectAdmin() doit être implémenté.'); }
}

export class HttpApiClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = '/api/v1' } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Une implémentation fetch est requise.');
    // window.fetch exige son receveur Window dans les navigateurs. Sans ce
    // binding, l'appel via this.fetchImpl(...) échoue avec "Illegal invocation".
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.csrfToken = '';
  }

  setCsrfToken(value) {
    this.csrfToken = typeof value === 'string' ? value : '';
  }

  async request(path, { method = 'GET', body, form, signal } = {}) {
    const headers = new Headers({ Accept: 'application/json' });
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (body !== undefined && form === undefined) headers.set('Content-Type', 'application/json');
    if (mutation && this.csrfToken) headers.set('X-CSRF-Token', this.csrfToken);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
    } catch (error) {
      throw new RepositoryError('Le service de compte est indisponible.', {
        code: 'network_error', details: error?.message || null,
      });
    }

    const contentType = response.headers?.get?.('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok) {
      throw new RepositoryError(payload?.message || 'La requête n’a pas abouti.', {
        status: response.status,
        code: payload?.code || `http_${response.status}`,
        details: payload?.errors || null,
      });
    }
    if (payload?.csrfToken) this.setCsrfToken(payload.csrfToken);
    return payload;
  }
}

export class HttpAccountRepository extends AccountRepository {
  constructor({ client = new HttpApiClient() } = {}) {
    super();
    this.client = client;
  }

  getTurnstileConfig({ signal } = {}) { return this.client.request('/auth/turnstile-config', { signal }); }
  getSession({ signal } = {}) { return this.client.request('/me', { signal }); }
  login(credentials, { signal } = {}) {
    return this.client.request('/auth/login', { method: 'POST', body: credentials, signal });
  }
  register(account, { signal } = {}) {
    return this.client.request('/auth/register', { method: 'POST', body: account, signal });
  }
  logout({ signal } = {}) { return this.client.request('/auth/logout', { method: 'POST', body: {}, signal }); }
  verifyEmail(token, { signal } = {}) { return this.client.request('/auth/verify-email', { method: 'POST', body: { token }, signal }); }
  forgotPassword(email, { signal, turnstileToken } = {}) {
    return this.client.request('/auth/forgot-password', { method: 'POST', body: { email, turnstileToken }, signal });
  }
  resetPassword(token, password, { signal } = {}) { return this.client.request('/auth/reset-password', { method: 'POST', body: { token, password }, signal }); }
}

export class HttpReplicaRepository extends ReplicaRepository {
  constructor({ client = new HttpApiClient() } = {}) {
    super();
    this.client = client;
  }

  list({ signal, includeArchived = true } = {}) {
    return this.client.request(`/replicas?include_archived=${includeArchived ? '1' : '0'}`, { signal });
  }
  create(data, { signal } = {}) { return this.client.request('/replicas', { method: 'POST', body: data, signal }); }
  update(id, data, { signal } = {}) { return this.client.request(`/replicas/${encodeURIComponent(id)}`, { method: 'PATCH', body: data, signal }); }
  uploadPhoto(id, photo, { signal } = {}) {
    const form = new FormData();
    form.set('photo', photo);
    return this.client.request(`/replicas/${encodeURIComponent(id)}/photo`, { method: 'POST', form, signal });
  }
  processingStatus(id, { signal } = {}) { return this.client.request(`/replicas/${encodeURIComponent(id)}/processing-status`, { signal }); }
  submit(id, version, { signal } = {}) { return this.client.request(`/replicas/${encodeURIComponent(id)}/submit`, { method: 'POST', body: { version }, signal }); }
  archive(id, version, { signal } = {}) {
    return this.client.request(`/replicas/${encodeURIComponent(id)}`, { method: 'DELETE', body: { version }, signal });
  }
  listPublishedAdmin({ signal } = {}) { return this.client.request('/admin/replicas/published', { signal }); }
  listPendingAdmin({ signal } = {}) { return this.client.request('/admin/replicas', { signal }); }
  updateAdmin(id, data, { signal } = {}) {
    return this.client.request(`/admin/replicas/${encodeURIComponent(id)}`, { method: 'PATCH', body: data, signal });
  }
  archiveAdmin(id, version, { signal } = {}) {
    return this.client.request(`/admin/replicas/${encodeURIComponent(id)}`, { method: 'DELETE', body: { version }, signal });
  }
  restoreAdmin(id, version, { signal } = {}) {
    return this.client.request(`/admin/replicas/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { version }, signal });
  }
  publishAdmin(id, version, { signal } = {}) {
    return this.client.request(`/admin/replicas/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { version }, signal });
  }
  rejectAdmin(id, version, note, { signal } = {}) {
    return this.client.request(`/admin/replicas/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { version, note }, signal });
  }
}

export function createProductionRepositories(options = {}) {
  const client = new HttpApiClient(options);
  return {
    accountRepository: new HttpAccountRepository({ client }),
    replicaRepository: new HttpReplicaRepository({ client }),
  };
}
