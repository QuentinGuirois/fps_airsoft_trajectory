import './replica-card.js';
import { RepositoryError } from './community-repositories.js';

export function summarizeReplicas(replicas = []) {
  return replicas.reduce((summary, replica) => {
    summary.total += 1;
    if (replica.state === 'published') summary.published += 1;
    if (replica.state === 'draft') summary.drafts += 1;
    if (replica.state === 'pending') summary.pending += 1;
    if (replica.state === 'archived') summary.archived += 1;
    return summary;
  }, { total: 0, published: 0, drafts: 0, pending: 0, archived: 0 });
}

export function initArmory({ root, accountRepository, replicaRepository } = {}) {
  if (!root || !accountRepository || !replicaRepository) return null;
  const controller = new AbortController();
  const grid = root.querySelector('[data-armory-grid]');
  const statePanel = root.querySelector('[data-armory-state]');
  const summaryNode = root.querySelector('[data-armory-summary]');
  const countNode = root.querySelector('[data-armory-count]');
  const userNodes = root.querySelectorAll('[data-account-pseudo]');
  const dialog = root.querySelector('[data-archive-dialog]');
  const archiveName = dialog?.querySelector('[data-archive-name]');
  const confirmArchive = dialog?.querySelector('[data-confirm-archive]');
  let replicas = [];
  let pendingArchiveId = null;

  function announce(message, tone = '') {
    statePanel.hidden = !message;
    statePanel.textContent = message;
    statePanel.dataset.tone = tone;
  }

  function updateSummary() {
    const summary = summarizeReplicas(replicas);
    countNode.textContent = String(summary.total);
    summaryNode.textContent = `${summary.total} RÉPLIQUE${summary.total > 1 ? 'S' : ''} · ${summary.published} PUBLIÉE${summary.published > 1 ? 'S' : ''} · ${summary.drafts} BROUILLON${summary.drafts > 1 ? 'S' : ''}`;
  }

  function render() {
    grid.replaceChildren();
    updateSummary();
    if (!replicas.length) {
      const empty = document.createElement('div');
      empty.className = 'armory-empty';
      empty.innerHTML = '<span aria-hidden="true">＋</span><strong>Râtelier vide</strong><p>Ta première card apparaîtra ici après création et traitement de sa photo.</p>';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'button button-primary';
      add.textContent = 'AJOUTER UNE RÉPLIQUE';
      add.dataset.addReplica = '';
      empty.append(add);
      grid.append(empty);
      return;
    }
    for (const replica of replicas) {
      const card = document.createElement('replica-card');
      card.setAttribute('mode', 'management');
      card.data = replica;
      grid.append(card);
    }
    const addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.className = 'armory-add-tile';
    addTile.dataset.addReplica = '';
    addTile.innerHTML = '<span aria-hidden="true">＋</span><strong>UNE RÉPLIQUE DE PLUS AU RÂTELIER ?</strong><span>Ajoute-la, règle-la au banc, puis publie sa card.</span>';
    grid.append(addTile);
  }

  function openArchive(replica) {
    pendingArchiveId = replica.id;
    archiveName.textContent = replica.name;
    dialog.showModal();
    dialog.querySelector('[data-cancel-archive]')?.focus();
  }

  root.addEventListener('replica:archive', (event) => {
    const replica = replicas.find((item) => item.id === event.detail.id);
    if (replica) openArchive(replica);
  }, { signal: controller.signal });

  root.addEventListener('replica:retry', async (event) => {
    try {
      const payload = await replicaRepository.retryBackgroundRemoval(event.detail.id, { signal: controller.signal });
      replicas = replicas.map((item) => item.id === event.detail.id ? (payload.replica || { ...item, imageStatus: 'queued' }) : item);
      render();
      announce('La nouvelle tentative de détourage a rejoint la file privée.', 'success');
    } catch (error) { announce(error.message, 'error'); }
  }, { signal: controller.signal });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-add-replica]')) announce('La création sera activée après branchement de l’API cards sécurisée.', 'notice');
  }, { signal: controller.signal });

  dialog?.querySelector('[data-cancel-archive]')?.addEventListener('click', () => dialog.close(), { signal: controller.signal });
  confirmArchive?.addEventListener('click', async () => {
    if (!pendingArchiveId) return;
    confirmArchive.disabled = true;
    try {
      const payload = await replicaRepository.archive(pendingArchiveId, { signal: controller.signal });
      replicas = replicas.map((item) => item.id === pendingArchiveId ? (payload.replica || { ...item, state: 'archived' }) : item);
      dialog.close();
      render();
      announce('Réplique archivée. Cette action reste réversible depuis ton compte.', 'success');
    } catch (error) {
      announce(error.message, 'error');
      dialog.close();
    } finally {
      confirmArchive.disabled = false;
      pendingArchiveId = null;
    }
  }, { signal: controller.signal });

  root.querySelector('[data-account-logout]')?.addEventListener('click', async () => {
    try { await accountRepository.logout({ signal: controller.signal }); } catch { /* Session déjà absente. */ }
    location.href = '/compte/';
  }, { signal: controller.signal });

  async function load() {
    root.setAttribute('aria-busy', 'true');
    announce('Chargement de ton râtelier…');
    try {
      const session = await accountRepository.getSession({ signal: controller.signal });
      if (!session?.authenticated || !session.user) {
        replicas = [];
        grid.replaceChildren();
        announce('Connexion requise pour ouvrir L’Armurerie.', 'auth');
        root.querySelector('[data-armory-login]')?.removeAttribute('hidden');
        return;
      }
      userNodes.forEach((node) => { node.textContent = session.user.pseudo; });
      const payload = await replicaRepository.list({ signal: controller.signal, includeArchived: true });
      replicas = Array.isArray(payload?.replicas) ? payload.replicas : [];
      announce('');
      render();
    } catch (error) {
      replicas = [];
      grid.replaceChildren();
      const message = error instanceof RepositoryError && error.status === 401
        ? 'Connexion requise pour ouvrir L’Armurerie.'
        : 'Impossible de charger les données privées. Réessaie lorsque la connexion est disponible.';
      announce(message, error.status === 401 ? 'auth' : 'error');
      if (error.status === 401) root.querySelector('[data-armory-login]')?.removeAttribute('hidden');
    } finally {
      root.removeAttribute('aria-busy');
    }
  }

  load();
  return { reload: load, destroy: () => controller.abort(), get replicas() { return replicas; } };
}
