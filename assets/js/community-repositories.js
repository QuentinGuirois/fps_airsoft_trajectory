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
  async getSession() { throw new Error('AccountRepository.getSession() doit être implémenté.'); }
  async login() { throw new Error('AccountRepository.login() doit être implémenté.'); }
  async register() { throw new Error('AccountRepository.register() doit être implémenté.'); }
  async logout() { throw new Error('AccountRepository.logout() doit être implémenté.'); }
}

export class ReplicaRepository {
  async list() { throw new Error('ReplicaRepository.list() doit être implémenté.'); }
  async archive() { throw new Error('ReplicaRepository.archive() doit être implémenté.'); }
  async retryBackgroundRemoval() { throw new Error('ReplicaRepository.retryBackgroundRemoval() doit être implémenté.'); }
}

export class HttpApiClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = '/api/v1' } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Une implémentation fetch est requise.');
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.csrfToken = '';
  }

  setCsrfToken(value) {
    this.csrfToken = typeof value === 'string' ? value : '';
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const headers = new Headers({ Accept: 'application/json' });
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (mutation && this.csrfToken) headers.set('X-CSRF-Token', this.csrfToken);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
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

  getSession({ signal } = {}) { return this.client.request('/session', { signal }); }
  login(credentials, { signal } = {}) {
    return this.client.request('/session', { method: 'POST', body: credentials, signal });
  }
  register(account, { signal } = {}) {
    return this.client.request('/accounts', { method: 'POST', body: account, signal });
  }
  logout({ signal } = {}) { return this.client.request('/session', { method: 'DELETE', signal }); }
}

export class HttpReplicaRepository extends ReplicaRepository {
  constructor({ client = new HttpApiClient() } = {}) {
    super();
    this.client = client;
  }

  list({ signal, includeArchived = true } = {}) {
    return this.client.request(`/replicas?include_archived=${includeArchived ? '1' : '0'}`, { signal });
  }
  archive(id, { signal } = {}) {
    return this.client.request(`/replicas/${encodeURIComponent(id)}/archive`, { method: 'POST', body: {}, signal });
  }
  retryBackgroundRemoval(id, { signal } = {}) {
    return this.client.request(`/replicas/${encodeURIComponent(id)}/background-removal`, { method: 'POST', body: {}, signal });
  }
}

export function createProductionRepositories(options = {}) {
  const client = new HttpApiClient(options);
  return {
    accountRepository: new HttpAccountRepository({ client }),
    replicaRepository: new HttpReplicaRepository({ client }),
  };
}
