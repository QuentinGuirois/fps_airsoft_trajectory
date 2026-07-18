import { sanitizedCurveSvg } from './replica-card.js?v=20260719-45';
import { RepositoryError } from './community-repositories.js?v=20260719-45';

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

export function initArmory({ root, accountRepository, replicaRepository, trajectoryRepository } = {}) {
  if (!root || !accountRepository || !replicaRepository || !trajectoryRepository) return null;
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
  const moderationButton = root.querySelector('[data-admin-moderation]');
  const trajectoriesButton = root.querySelector('[data-saved-trajectories]');
  const trajectoryCount = root.querySelector('[data-trajectory-count]');
  const rejectDialog = root.querySelector('[data-reject-dialog]');
  const rejectForm = root.querySelector('[data-reject-form]');
  const rejectName = root.querySelector('[data-reject-name]');
  const personalLink = root.querySelector('.armory-rail a[href="/compte/armurerie.html"]');
  const titleNode = root.querySelector('.armory-title-row h1');
  const addButton = root.querySelector('.armory-title-row [data-add-replica]');
  let replicas = [];
  let savedTrajectories = [];
  let pendingArchiveId = null;
  let pendingModerationId = null;
  let editingReplica = null;
  let mode = 'personal';

  function announce(message, tone = '') {
    statePanel.hidden = !message;
    statePanel.textContent = message;
    statePanel.dataset.tone = tone;
  }

  function updateSummary() {
    if (mode === 'curves') {
      countNode.textContent = String(replicas.length);
      trajectoryCount.textContent = String(savedTrajectories.length);
      summaryNode.textContent = `${savedTrajectories.length} COURBE${savedTrajectories.length > 1 ? 'S' : ''} ENREGISTRÉE${savedTrajectories.length > 1 ? 'S' : ''}`;
      return;
    }
    const summary = summarizeReplicas(replicas);
    countNode.textContent = String(summary.total);
    summaryNode.textContent = mode === 'moderation'
      ? `${summary.pending} CARD${summary.pending > 1 ? 'S' : ''} À VALIDER`
      : mode === 'admin'
        ? `${summary.published} CARD${summary.published > 1 ? 'S' : ''} PUBLIÉE${summary.published > 1 ? 'S' : ''} · TOUS LES JOUEURS`
        : `${summary.total} RÉPLIQUE${summary.total > 1 ? 'S' : ''} · ${summary.published} PUBLIÉE${summary.published > 1 ? 'S' : ''} · ${summary.drafts} BROUILLON${summary.drafts > 1 ? 'S' : ''}`;
  }

  function render() {
    grid.replaceChildren();
    updateSummary();
    if (mode === 'curves') {
      renderTrajectories();
      return;
    }
    if (!replicas.length) {
      const empty = document.createElement('div');
      empty.className = 'armory-empty';
      empty.innerHTML = mode === 'moderation'
        ? '<span aria-hidden="true">✓</span><strong>Modération à jour</strong><p>Aucune card n’attend actuellement ta validation.</p>'
        : mode === 'admin'
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
      if (mode === 'moderation') card.setAttribute('moderation', '');
      card.data = replica;
      grid.append(card);
    }
    if (mode !== 'personal') return;
    const addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.className = 'armory-add-tile';
    addTile.dataset.addReplica = '';
    addTile.innerHTML = '<span aria-hidden="true">＋</span><strong>UNE RÉPLIQUE DE PLUS AU RÂTELIER ?</strong><span>Ajoute-la, règle-la au banc, puis publie sa card.</span>';
    grid.append(addTile);
  }

  function renderTrajectories() {
    if (!savedTrajectories.length) {
      const empty = document.createElement('div');
      empty.className = 'armory-empty';
      empty.innerHTML = '<span aria-hidden="true">⌁</span><strong>AUCUNE COURBE ENREGISTRÉE</strong><p>Lance un calcul, puis utilise « Enregistrer » pour le retrouver ici.</p><a class="button button-primary" href="/#tutoriel-calculateur">VOIR LE TUTORIEL</a>';
      grid.append(empty);
      return;
    }
    for (const trajectory of savedTrajectories) {
      const article = document.createElement('article');
      article.className = 'saved-trajectory-card';
      const media = document.createElement('div');
      media.className = 'saved-trajectory-media';
      const curve = sanitizedCurveSvg(trajectory.curveThumbSvg, document);
      if (curve) media.append(curve);
      const body = document.createElement('div');
      body.className = 'saved-trajectory-body';
      const title = document.createElement('h2');
      title.textContent = trajectory.name;
      const metrics = document.createElement('p');
      metrics.textContent = `${trajectory.massG.toLocaleString('fr-FR')} g · ${trajectory.energyJ.toLocaleString('fr-FR')} J · utile ${trajectory.usefulRangeM == null ? '—' : Math.round(trajectory.usefulRangeM) + ' m'}`;
      const actions = document.createElement('div');
      actions.className = 'saved-trajectory-actions';
      const open = document.createElement('a');
      open.className = 'button button-primary button-small';
      open.href = trajectory.simUrl;
      open.textContent = 'OUVRIR';
      const remove = document.createElement('button');
      remove.className = 'button button-small';
      remove.type = 'button';
      remove.dataset.deleteTrajectory = trajectory.id;
      remove.textContent = 'SUPPRIMER';
      actions.append(open, remove);
      body.append(title, metrics, actions);
      article.append(media, body);
      grid.append(article);
    }
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

  root.addEventListener('replica:publish', async (event) => {
    if (mode !== 'moderation') return;
    const replica = replicas.find((item) => item.id === event.detail.id);
    if (!replica) return;
    const publishButton = event.target.querySelector('.replica-publish');
    if (publishButton) publishButton.disabled = true;
    try {
      await replicaRepository.publishAdmin(replica.id, replica.version, { signal: controller.signal });
      replicas = replicas.filter((item) => item.id !== replica.id);
      render();
      announce(`La card « ${replica.name} » est publiée.`, 'success');
    } catch (error) {
      if (publishButton) publishButton.disabled = false;
      announce(error.message, 'error');
    }
  }, { signal: controller.signal });

  root.addEventListener('replica:reject', (event) => {
    if (mode !== 'moderation') return;
    const replica = replicas.find((item) => item.id === event.detail.id);
    if (!replica) return;
    pendingModerationId = replica.id;
    rejectForm.reset();
    rejectName.textContent = replica.name;
    rejectDialog.showModal();
    rejectForm.note.focus();
  }, { signal: controller.signal });

  root.addEventListener('click', (event) => {
    if (mode === 'personal' && event.target.closest('[data-add-replica]')) {
      if (!savedTrajectories.length) {
        location.href = '/#tutoriel-calculateur';
        return;
      }
      openReplicaEditor(null, false);
    }
    if (mode === 'curves' && event.target.closest('[data-add-replica]')) location.href = '/#calculateur';
    const trajectoryId = event.target.closest('[data-delete-trajectory]')?.dataset.deleteTrajectory;
    if (mode === 'curves' && trajectoryId) deleteTrajectory(trajectoryId);
  }, { signal: controller.signal });

  function switchAdminMode(nextMode) {
    mode = nextMode;
    for (const button of [adminButton, moderationButton, trajectoriesButton]) {
      const active = button === (mode === 'moderation' ? moderationButton : adminButton);
      button?.classList.toggle('is-active', active);
      if (active) button?.setAttribute('aria-current', 'page');
      else button?.removeAttribute('aria-current');
    }
    personalLink?.classList.remove('is-active');
    personalLink?.removeAttribute('aria-current');
    if (titleNode) titleNode.textContent = mode === 'moderation' ? 'Modération' : 'Cards publiées';
    if (addButton) addButton.hidden = true;
    load();
  }

  function switchPersonalMode(nextMode) {
    mode = nextMode;
    const curvesActive = mode === 'curves';
    trajectoriesButton?.classList.toggle('is-active', curvesActive);
    if (curvesActive) trajectoriesButton?.setAttribute('aria-current', 'page');
    else trajectoriesButton?.removeAttribute('aria-current');
    personalLink?.classList.toggle('is-active', !curvesActive);
    if (curvesActive) personalLink?.removeAttribute('aria-current');
    else personalLink?.setAttribute('aria-current', 'page');
    for (const button of [adminButton, moderationButton]) {
      button?.classList.remove('is-active');
      button?.removeAttribute('aria-current');
    }
    if (titleNode) titleNode.textContent = curvesActive ? 'Mes courbes' : 'L’Armurerie';
    if (addButton) {
      addButton.hidden = false;
      addButton.textContent = curvesActive ? '+ ENREGISTRER UNE COURBE' : '+ AJOUTER UNE RÉPLIQUE';
    }
    load();
  }

  adminButton?.addEventListener('click', () => switchAdminMode('admin'), { signal: controller.signal });
  moderationButton?.addEventListener('click', () => switchAdminMode('moderation'), { signal: controller.signal });
  trajectoriesButton?.addEventListener('click', () => switchPersonalMode('curves'), { signal: controller.signal });
  personalLink?.addEventListener('click', (event) => {
    if (location.pathname !== '/compte/armurerie.html') return;
    event.preventDefault();
    switchPersonalMode('personal');
  }, { signal: controller.signal });

  async function deleteTrajectory(id) {
    const trajectory = savedTrajectories.find((item) => item.id === id);
    if (!trajectory || !confirm(`Supprimer la courbe « ${trajectory.name} » ? Les cards déjà créées conserveront leur copie.`)) return;
    try {
      await trajectoryRepository.delete(id, { signal: controller.signal });
      savedTrajectories = savedTrajectories.filter((item) => item.id !== id);
      render();
      announce('Courbe supprimée de ton espace privé. Les cards existantes sont intactes.', 'success');
    } catch (error) { announce(error.message, 'error'); }
  }

  function openReplicaEditor(replica = null, photoOnly = false) {
    editingReplica = replica;
    replicaForm.reset();
    replicaForm.dataset.photoOnly = String(photoOnly);
    replicaForm.modelName.value = replica?.name || '';
    replicaForm.type.value = replica?.type || 'AEG';
    const trajectoryChoice = replicaForm.querySelector('[data-trajectory-choice]');
    const trajectorySelect = replicaForm.trajectoryId;
    trajectoryChoice.hidden = mode === 'admin' || photoOnly;
    trajectorySelect.replaceChildren();
    if (mode !== 'admin' && !photoOnly) {
      if (replica && !replica.trajectoryId) {
        const historical = new Option('Courbe historique de cette card — inchangée', '', true, true);
        trajectorySelect.add(historical);
      } else {
        trajectorySelect.add(new Option('Choisir une courbe…', '', true, false));
      }
      for (const trajectory of savedTrajectories) {
        const option = new Option(`${trajectory.name} — ${trajectory.massG.toLocaleString('fr-FR')} g / ${trajectory.energyJ.toLocaleString('fr-FR')} J`, trajectory.id);
        option.selected = trajectory.id === replica?.trajectoryId;
        trajectorySelect.add(option);
      }
      trajectorySelect.required = !replica?.trajectoryId && !replica?.simUrl;
    } else trajectorySelect.required = false;
    replicaForm.querySelector('[data-trajectory-empty]').hidden = savedTrajectories.length > 0 || mode === 'admin' || photoOnly;
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
        const payload = {
          modelName: replicaForm.modelName.value.trim(), type: replicaForm.type.value,
          youtubeUrl: replicaForm.youtubeUrl.value.trim(),
        };
        if (mode !== 'admin' && replicaForm.trajectoryId.value) payload.trajectoryId = replicaForm.trajectoryId.value;
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

  rejectDialog?.querySelector('[data-cancel-reject]')?.addEventListener('click', () => {
    pendingModerationId = null;
    rejectDialog.close();
  }, { signal: controller.signal });
  rejectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const replica = replicas.find((item) => item.id === pendingModerationId);
    const submit = rejectForm.querySelector('button[type="submit"]');
    if (!replica) return;
    submit.disabled = true;
    try {
      await replicaRepository.rejectAdmin(replica.id, replica.version, rejectForm.note.value.trim(), { signal: controller.signal });
      replicas = replicas.filter((item) => item.id !== replica.id);
      pendingModerationId = null;
      rejectDialog.close();
      render();
      announce(`La card « ${replica.name} » est rejetée. Le motif sera visible par le joueur.`, 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally {
      submit.disabled = false;
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
      if (session.user.role === 'admin') {
        adminButton?.removeAttribute('hidden');
        moderationButton?.removeAttribute('hidden');
      }
      if (mode !== 'personal' && session.user.role !== 'admin') {
        if (mode !== 'curves') {
          mode = 'personal';
          throw new RepositoryError('Cette vue est réservée au compte administrateur.', { status: 403, code: 'forbidden' });
        }
      }
      if (mode === 'curves') {
        const trajectoryPayload = await trajectoryRepository.list({ signal: controller.signal });
        savedTrajectories = Array.isArray(trajectoryPayload?.trajectories) ? trajectoryPayload.trajectories : [];
        announce('');
        render();
        return;
      }
      const payload = mode === 'moderation'
        ? await replicaRepository.listPendingAdmin({ signal: controller.signal })
        : mode === 'admin'
          ? await replicaRepository.listPublishedAdmin({ signal: controller.signal })
          : await replicaRepository.list({ signal: controller.signal, includeArchived: true });
      replicas = Array.isArray(payload?.replicas) ? payload.replicas : [];
      if (mode === 'personal') {
        const trajectoryPayload = await trajectoryRepository.list({ signal: controller.signal });
        savedTrajectories = Array.isArray(trajectoryPayload?.trajectories) ? trajectoryPayload.trajectories : [];
        trajectoryCount.textContent = String(savedTrajectories.length);
      }
      announce('');
      render();
      if (mode === 'personal' && new URLSearchParams(location.search).get('action') === 'add') {
        history.replaceState(history.state, '', location.pathname);
        if (!savedTrajectories.length) location.href = '/#tutoriel-calculateur';
        else openReplicaEditor(null, false);
      }
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
  return {
    reload: load,
    destroy: () => controller.abort(),
    get replicas() { return replicas; },
    get trajectories() { return savedTrajectories; },
  };
}
