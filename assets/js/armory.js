import './replica-card.js?v=20260718-28';
import { RepositoryError } from './community-repositories.js?v=20260718-30';

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
  let replicas = [];
  let pendingArchiveId = null;
  let editingReplica = null;

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
    if (event.target.closest('[data-add-replica]')) openReplicaEditor(null, false);
  }, { signal: controller.signal });

  function snapshot() {
    try { return JSON.parse(sessionStorage.getItem('fat.pending-replica.v1') || 'null'); }
    catch { return null; }
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
    replicaForm.photo.required = !replica || photoOnly;
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
    const saved = snapshot();
    try {
      let replica = editingReplica;
      if (replicaForm.dataset.photoOnly !== 'true') {
        if (!saved?.curveThumbnailSvg || !saved?.simulationUrl) {
          throw new RepositoryError('Lance d’abord un calcul dans le simulateur, puis reviens enregistrer sa card.', { code: 'missing_atp_result' });
        }
        const formUrl = new URL(replicaForm.simulationUrl.value, location.origin);
        const savedUrl = new URL(saved.simulationUrl, location.origin);
        formUrl.hash = ''; savedUrl.hash = '';
        if (formUrl.href !== savedUrl.href) {
          throw new RepositoryError('Le lien ne correspond pas au dernier résultat ATP de cet onglet.', { code: 'simulation_mismatch' });
        }
        const payload = {
          modelName: replicaForm.modelName.value.trim(), type: replicaForm.type.value,
          simulationUrl: formUrl.href, massG: saved.massG, energyJ: saved.energyJ,
          usefulRangeM: saved.usefulRangeM, maximumRangeM: saved.maximumRangeM,
          youtubeUrl: replicaForm.youtubeUrl.value.trim(), curveThumbnailSvg: saved.curveThumbnailSvg,
        };
        const response = replica
          ? await replicaRepository.update(replica.id, { ...payload, version: replica.version }, { signal: controller.signal })
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
      const payload = await replicaRepository.archive(pendingArchiveId, replica?.version, { signal: controller.signal });
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
