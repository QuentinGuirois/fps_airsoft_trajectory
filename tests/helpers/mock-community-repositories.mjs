import { AccountRepository, ReplicaRepository } from '../../assets/js/community-repositories.js';

export class MockAccountRepository extends AccountRepository {
  constructor(session) { super(); this.session = structuredClone(session); }
  async getSession() { return structuredClone(this.session); }
  async login() { return structuredClone(this.session); }
  async register(account) { return { created: true, account: structuredClone(account) }; }
  async logout() { this.session = { authenticated: false }; return { ok: true }; }
}

export class MockReplicaRepository extends ReplicaRepository {
  constructor(replicas = []) { super(); this.replicas = structuredClone(replicas); }
  async list() { return { replicas: structuredClone(this.replicas) }; }
  async archive(id) {
    this.replicas = this.replicas.map((replica) => replica.id === id ? { ...replica, state: 'archived' } : replica);
    return { replica: structuredClone(this.replicas.find((replica) => replica.id === id)) };
  }
  async retryBackgroundRemoval(id) {
    this.replicas = this.replicas.map((replica) => replica.id === id ? { ...replica, imageStatus: 'queued' } : replica);
    return { replica: structuredClone(this.replicas.find((replica) => replica.id === id)) };
  }
}
