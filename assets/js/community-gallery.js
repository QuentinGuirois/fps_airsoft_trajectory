import './replica-card.js?v=20260718-43';
import { createProductionRepositories, RepositoryError } from './community-repositories.js?v=20260718-43';

export function initCommunityGallery({ root, accountRepository, replicaRepository } = {}) {
  if (!root || !accountRepository || !replicaRepository) return null;
  const grid = root.querySelector('[data-community-grid]');
  const status = root.querySelector('[data-community-status]');
  const addLink = root.querySelector('[data-add-replica-link]');
  const controller = new AbortController();

  function announce(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function resolveAddLink() {
    try {
      const session = await accountRepository.getSession({ signal: controller.signal });
      if (session?.authenticated) addLink.href = '/compte/armurerie.html?action=add';
    } catch (error) {
      if (!(error instanceof RepositoryError) || error.status !== 401) return;
      addLink.href = '/compte/?return=%2Fcompte%2Farmurerie.html%3Faction%3Dadd';
    }
  }

  async function load() {
    root.setAttribute('aria-busy', 'true');
    announce('Chargement des répliques publiées…');
    try {
      const payload = await replicaRepository.listPublishedPublic({ signal: controller.signal });
      const replicas = Array.isArray(payload?.replicas) ? payload.replicas : [];
      grid.replaceChildren();
      if (!replicas.length) {
        const empty = document.createElement('div');
        empty.className = 'community-empty';
        empty.innerHTML = '<strong>LE RÂTELIER PUBLIC EST EN PRÉPARATION</strong><p>Les premières cards apparaîtront ici dès leur validation.</p>';
        grid.append(empty);
      } else {
        for (const replica of replicas) {
          const card = document.createElement('replica-card');
          card.data = replica;
          grid.append(card);
        }
      }
      announce(`${replicas.length} card${replicas.length > 1 ? 's' : ''} publiée${replicas.length > 1 ? 's' : ''}.`, 'success');
    } catch (error) {
      grid.replaceChildren();
      announce('Impossible de charger le râtelier public pour le moment.', 'error');
    } finally {
      root.removeAttribute('aria-busy');
    }
  }

  resolveAddLink();
  load();
  return { reload: load, destroy: () => controller.abort() };
}

const root = document.querySelector('[data-community-gallery]');
if (root) initCommunityGallery({ root, ...createProductionRepositories() });
