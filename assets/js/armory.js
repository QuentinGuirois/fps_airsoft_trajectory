import './replica-card.js?v=20260718-35';
import { RepositoryError } from './community-repositories.js?v=20260718-35';
import { createSimulationSnapshot, simulationUrlsMatch } from './simulation-link-snapshot.js?v=20260718-35';

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
  const replicaDialog = root.querySelector('[data-replica-dialog]');
  const replicaForm = replicaDialog?.querySelector('[data-replica-form]');
  const adminButton = root.querySelector('[data-admin-armory]');
  const personalLink = root.querySelector('.armory-rail a[href="/compte/armurerie.html"]');
  const titleNode = root.querySelector('.armory-title-row h1');
  const addButton = root.querySelector('.armory-title-row [data-add-replica]');
  let replicas = [];
  let pendingArchiveId = null;
  let editingReplica = null;
  let mode = 'personal';

  function announce(message, tone = '') {
    statePanel.hidden = !message;
    statePanel.textContent = message;
    statePanel.dataset.tone = tone;
  }

  function updateSummary() {
    const summary = summarizeReplicas(replicas);
    countNode.textContent = String(summary.total);
    summaryNode.textContent = mode === 'admin'
      ? `${summary.published} CARD${summary.published > 1 ? 'S' : ''} PUBLIÉE${summary.published > 1 ? 'S' : ''} · TOUS LES JOUEURS`
      : `${summary.total} RÉPLIQUE${summary.total > 1 ? 'S' : ''} · ${summary.published} PUBLIÉE${summary.published > 1 ? 'S' : ''} · ${summary.drafts} BROUILLON${summary.drafts > 1 ? 'S' : ''}`;
  }

  function render() {
    grid.replaceChildren();
    updateSummary();
    if (!replicas.length) {
      const empty = document.createElement('div');
      empty.className = 'armory-empty';
      empty.innerHTML = mode === 'admin'
        ? '<span aria-hidden="true">◇</span><strong>Aucune card publiée</strong><p>Les cards publiées par les joueurs apparaîtront ici.</p>'
        : '<span aria-hidden="true">＋</span><strong>Râtelier vide</strong><p>Ta première card apparaîtra ici après création et traitement de sa photo.</p>';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'button button-primary';
      if (mode === 'personal') {
        add.textContent = 'AJOUTER UNE RÉPLIQUE';
        add.dataset.addReplica = '';
        empty.append(add);
      }
      grid.append(empty);
      return;
    }
    for (const replica of replicas) {
      const card = document.createElement('replica-card');
      card.setAttribute('mode', 'management');
      if (mode === 'admin') card.setAttribute('admin', '');
      card.data = replica;
      grid.append(card);
    }
    if (mode === 'admin') return;
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
    const replica = replicas.find((item) => item.id === event.detail.id);
    if (replica) openReplicaEditor(replica, true);
  }, { signal: controller.signal });

  root.addEventListener('replica:edit', async (event) => {
    const replica = replicas.find((item) => item.id === event.detail.id);
    if (!replica) return;
    if (replica.state === 'draft' && replica.imageStatus === 'ready') {
      try {
        await replicaRepository.submit(replica.id, replica.version, { signal: controller.signal });
        await load();
        announce('Card envoyée en modération.', 'success');
      } catch (error) { announce(error.message, 'error'); }
      return;
    }
    openReplicaEditor(replica, false);
  }, { signal: controller.signal });

  root.addEventListener('click', (event) => {
    if (mode === 'personal' && event.target.closest('[data-add-replica]')) openReplicaEditor(null, false);
  }, { signal: controller.signal });

  adminButton?.addEventListener('click', () => {
    mode = 'admin';
    adminButton.classList.add('is-active');
    adminButton.setAttribute('aria-current', 'page');
    personalLink?.classList.remove('is-active');
    personalLink?.removeAttribute('aria-current');
    if (titleNode) titleNode.textContent = 'Cards publiées';
    if (addButton) addButton.hidden = true;
    load();
  }, { signal: controller.signal });

  function snapshot() {
    try { return JSON.parse(sessionStorage.getItem('fat.pending-replica.v1') || 'null'); }
    catch { return null; }
  }

  async function snapshotForUrl(simulationUrl, replica = null) {
    const saved = snapshot();
    if (saved?.curveThumbnailSvg && saved?.simulationUrl
      && simulationUrlsMatch(saved.simulationUrl, simulationUrl, location.origin)) return saved;
    if (replica?.curveThumbSvg && replica?.simUrl
      && simulationUrlsMatch(replica.simUrl, simulationUrl, location.origin)) {
      return {
        simulationUrl,
        curveThumbnailSvg: replica.curveThumbSvg,
        usefulRangeM: replica.usefulRangeM,
        maximumRangeM: replica.maximumRangeM,
        massG: replica.massG,
        energyJ: replica.energyJ,
      };
    }
    announce('Lecture du lien et génération de la miniature ATP…');
    return createSimulationSnapshot(simulationUrl, { origin: location.origin, signal: controller.signal });
  }

  function openReplicaEditor(replica = null, photoOnly = false) {
    editingReplica = replica;
    const saved = snapshot();
    replicaForm.reset();
    replicaForm.dataset.photoOnly = String(photoOnly);
    replicaForm.modelName.value = replica?.name || '';
    replicaForm.type.value = replica?.type || 'AEG';
    replicaForm.simulationUrl.value = replica?.simUrl ? new URL(replica.simUrl, location.origin).href : (saved?.simulationUrl || '');
    replicaForm.youtubeUrl.value = replica?.user?.youtubeUrl || '';
    replicaForm.rightsConfirmed.checked = Boolean(replica);
    replicaForm.photo.required = mode === 'personal' && (!replica || photoOnly);
    replicaForm.photo.disabled = mode === 'admin';
    replicaDialog.querySelector('h2').textContent = photoOnly ? 'Fournir une nouvelle photo' : (replica ? 'Modifier la card' : 'Ajouter une réplique');
    replicaDialog.showModal();
    (photoOnly ? replicaForm.photo : replicaForm.modelName).focus();
  }

  async function pollImage(id) {
    for (let attempt = 0; attempt < 90 && !controller.signal.aborted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const status = await replicaRepository.processingStatus(id, { signal: controller.signal });
      if (status.imageStatus === 'ready') {
        await load();
        announce('Photo détourée et validée. Clique sur « Terminer » pour envoyer la card en modération.', 'success');
        return;
      }
      if (status.imageStatus === 'rejected') {
        await load();
        announce('La photo a été rejetée automatiquement. Fournis une autre prise plus nette et dégagée.', 'error');
        return;
      }
    }
    announce('Le traitement continue en arrière-plan. Recharge L’Armurerie dans quelques instants.', 'notice');
  }

  replicaDialog?.querySelector('[data-cancel-replica]')?.addEventListener('click', () => replicaDialog.close(), { signal: controller.signal });
  replicaForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = replicaForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      let replica = editingReplica;
      if (replicaForm.dataset.photoOnly !== 'true') {
        const formUrl = new URL(replicaForm.simulationUrl.value, location.origin);
        const saved = await snapshotForUrl(formUrl.href, replica);
        const payload = {
          modelName: replicaForm.modelName.value.trim(), type: replicaForm.type.value,
          simulationUrl: formUrl.href, massG: saved.massG, energyJ: saved.energyJ,
          usefulRangeM: saved.usefulRangeM, maximumRangeM: saved.maximumRangeM,
          youtubeUrl: replicaForm.youtubeUrl.value.trim(), curveThumbnailSvg: saved.curveThumbnailSvg,
        };
        const response = replica
          ? await (mode === 'admin' ? replicaRepository.updateAdmin : replicaRepository.update).call(
            replicaRepository, replica.id, { ...payload, version: replica.version }, { signal: controller.signal },
          )
          : await replicaRepository.create({ ...payload, rightsConfirmed: replicaForm.rightsConfirmed.checked }, { signal: controller.signal });
        replica = response.replica;
      }
      const photo = replicaForm.photo.files?.[0];
      if (photo) await replicaRepository.uploadPhoto(replica.id, photo, { signal: controller.signal });
      replicaDialog.close();
      await load();
      if (photo) {
        announce('Photo reçue dans la file privée. Détourage automatique en cours…');
        pollImage(replica.id).catch((error) => announce(error.message, 'error'));
      } else announce('Card enregistrée.', 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { submit.disabled = false; }
  }, { signal: controller.signal });

  dialog?.querySelector('[data-cancel-archive]')?.addEventListener('click', () => dialog.close(), { signal: controller.signal });
  confirmArchive?.addEventListener('click', async () => {
    if (!pendingArchiveId) return;
    confirmArchive.disabled = true;
    try {
      const replica = replicas.find((item) => item.id === pendingArchiveId);
      const archive = mode === 'admin' ? replicaRepository.archiveAdmin : replicaRepository.archive;
      const payload = await archive.call(replicaRepository, pendingArchiveId, replica?.version, { signal: controller.signal });
      replicas = replicas.map((item) => item.id === pendingArchiveId ? (payload.replica || { ...item, state: 'archived' }) : item);
      dialog.close();
      render();
      announce(mode === 'admin'
        ? 'Card retirée de la publication et archivée sans suppression physique.'
        : 'Réplique archivée. Cette action reste réversible depuis ton compte.', 'success');
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
      if (session.user.role === 'admin') adminButton?.removeAttribute('hidden');
      if (mode === 'admin' && session.user.role !== 'admin') {
        mode = 'personal';
        throw new RepositoryError('Cette vue est réservée au compte administrateur.', { status: 403, code: 'forbidden' });
      }
      const payload = mode === 'admin'
        ? await replicaRepository.listPublishedAdmin({ signal: controller.signal })
        : await replicaRepository.list({ signal: controller.signal, includeArchived: true });
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
