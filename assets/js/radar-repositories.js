import {
  HttpAccountRepository,
  HttpApiClient,
} from './community-repositories.js?v=20260723-47';

export class RadarPublicRepository {
  constructor({ client = new HttpApiClient() } = {}) {
    this.client = client;
  }

  list({ signal } = {}) {
    return this.client.request('/radar/events', { signal });
  }

  get(slug, { signal } = {}) {
    return this.client.request(`/radar/events/${encodeURIComponent(slug)}`, { signal });
  }

  report(slug, data, { signal } = {}) {
    return this.client.request(`/radar/events/${encodeURIComponent(slug)}/report`, {
      method: 'POST', body: data, signal,
    });
  }
}

export class RadarOwnerRepository {
  constructor({ client = new HttpApiClient() } = {}) {
    this.client = client;
  }

  list({ signal } = {}) {
    return this.client.request('/me/radar-events', { signal });
  }

  get(id, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}`, { signal });
  }

  create(data = {}, { signal } = {}) {
    return this.client.request('/me/radar-events', { method: 'POST', body: data, signal });
  }

  update(id, data, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: data, signal,
    });
  }

  publish(id, version, turnstileToken, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}/publish`, {
      method: 'POST', body: { version, turnstileToken }, signal,
    });
  }

  cancel(id, version, turnstileToken, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', body: { version, turnstileToken }, signal,
    });
  }

  duplicate(id, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST', body: {}, signal,
    });
  }

  delete(id, version, turnstileToken, { signal } = {}) {
    return this.client.request(`/me/radar-events/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { version, turnstileToken }, signal,
    });
  }

  geocode(query, { signal } = {}) {
    return this.client.request(`/me/radar-geocode?q=${encodeURIComponent(query)}`, { signal });
  }
}

export function createRadarRepositories(options = {}) {
  const client = new HttpApiClient(options);
  return {
    client,
    accountRepository: new HttpAccountRepository({ client }),
    publicRepository: new RadarPublicRepository({ client }),
    ownerRepository: new RadarOwnerRepository({ client }),
  };
}
