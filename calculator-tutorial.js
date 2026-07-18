export const TUTORIAL_STORAGE_KEY = 'fat-tutorial-v1';

export const TUTORIAL_STEPS = Object.freeze([
  {
    anchor: 'masse',
    title: 'LE GRAMMAGE',
    body: 'Le poids de ta bille change tout : une 0,20 g part vite et s’essouffle, une 0,30 g garde son énergie et encaisse mieux le vent. Renseigne celle que tu joues VRAIMENT.',
  },
  {
    anchor: 'energie',
    title: 'JOULES OU VITESSE',
    body: 'Donne l’un OU l’autre : F.A.T. calcule le second avec le grammage. Astuce : ta mesure chrony est en fps — saisis-la telle quelle, avec la bille utilisée au chrony.',
  },
  {
    anchor: 'hopup',
    title: 'LE HOP-UP',
    body: 'AUTO cherche le réglage qui maximise la portée utile sans cloche. Les boutons − / + simulent ton réglage réel : regarde la courbe s’aplatir ou gonfler en direct.',
  },
  {
    anchor: 'angle',
    title: 'L’ANGLE DE TIR',
    body: 'Le secret le moins connu : beaucoup tirent légèrement vers le bas (fenêtre, poste surélevé) avec plus de hop-up sans s’en rendre compte — la bille remonte sur la ligne de visée et la portée utile augmente. Simule un angle négatif et observe.',
  },
  {
    anchor: 'avance',
    title: 'JOUE AVEC TOUT LE RESTE',
    body: 'Vent, température, altitude, hauteur d’optique, zéro… Chaque paramètre est recalculé en direct. Ouvre l’accordéon et pousse les curseurs : casser la simulation ne casse rien.',
  },
  {
    anchor: 'comparer',
    title: 'COMPARER',
    body: 'Fige ta courbe actuelle et changes-en un paramètre : les deux trajectoires s’affichent ensemble. C’est LE moyen de trancher un débat de grammage en 10 secondes.',
  },
  {
    anchor: 'enregistrer',
    title: 'ENREGISTRER TA COURBE',
    body: 'Enregistre la trajectoire dans ton espace privé. Tu la retrouveras dans « Mes courbes » et tu pourras ensuite la sélectionner pour créer la card de ta réplique. Le calculateur reste utilisable sans compte.',
  },
]);

export function tutorialPreference(storage) {
  try {
    const value = storage?.getItem(TUTORIAL_STORAGE_KEY);
    return ['completed', 'dismissed'].includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function shouldOfferTutorial(storage) {
  return tutorialPreference(storage) === null;
}

export function unionRects(rects) {
  const usable = rects.filter((rect) => rect && rect.width > 0 && rect.height > 0);
  if (!usable.length) return null;
  const left = Math.min(...usable.map((rect) => rect.left));
  const top = Math.min(...usable.map((rect) => rect.top));
  const right = Math.max(...usable.map((rect) => rect.right));
  const bottom = Math.max(...usable.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function findAvailableStep(steps, start, direction, resolveTarget) {
  if (!steps.length) return -1;
  const increment = direction < 0 ? -1 : 1;
  for (let index = start; index >= 0 && index < steps.length; index += increment) {
    if (resolveTarget(steps[index])) return index;
  }
  return -1;
}

function writePreference(storage, value) {
  try { storage?.setItem(TUTORIAL_STORAGE_KEY, value); } catch { /* stockage optionnel */ }
}

function focusableIn(element) {
  return [...element.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((item) => !item.hidden && item.getClientRects().length > 0);
}

function targetElements(root, anchor) {
  return [...root.querySelectorAll(`[data-tuto="${anchor}"], [data-tuto-include="${anchor}"]`)]
    .filter((element) => {
      const style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
}

function targetRect(root, anchor) {
  return unionRects(targetElements(root, anchor).map((element) => element.getBoundingClientRect()));
}

function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'calculator-tutorial';
  overlay.dataset.calculatorTutorial = '';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="tutorial-veil tutorial-veil-top" aria-hidden="true"></div>
    <div class="tutorial-veil tutorial-veil-left" aria-hidden="true"></div>
    <div class="tutorial-veil tutorial-veil-right" aria-hidden="true"></div>
    <div class="tutorial-veil tutorial-veil-bottom" aria-hidden="true"></div>
    <div class="tutorial-spotlight" aria-hidden="true"></div>
    <section class="tutorial-tip" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-body">
      <span class="tutorial-arrow" aria-hidden="true"></span>
      <div class="tutorial-tip-topline">
        <span class="tutorial-patch" data-tutorial-patch>BRIEFING 1/7</span>
        <button class="tutorial-skip" type="button" data-tutorial-skip>PASSER <span aria-hidden="true">×</span></button>
      </div>
      <div class="tutorial-copy" aria-live="polite" aria-atomic="true">
        <h2 id="tutorial-title" data-tutorial-title></h2>
        <p id="tutorial-body" data-tutorial-body></p>
      </div>
      <div class="tutorial-footer">
        <div class="tutorial-dots" data-tutorial-dots aria-hidden="true"></div>
        <button class="tutorial-previous" type="button" data-tutorial-previous aria-label="Étape précédente">←</button>
        <button class="tutorial-next" type="button" data-tutorial-next>SUIVANT →</button>
      </div>
    </section>`;
  document.body.append(overlay);
  return overlay;
}

function createFirstVisitOffer(launch) {
  const offer = document.createElement('aside');
  offer.className = 'tutorial-offer';
  offer.dataset.tutorialOffer = '';
  offer.setAttribute('aria-labelledby', 'tutorial-offer-title');
  offer.innerHTML = `<div><span class="tutorial-offer-kicker">// PREMIER PASSAGE AU BANC</span><strong id="tutorial-offer-title">Besoin d’un briefing rapide ?</strong><p>Sept repères, aucune valeur modifiée.</p></div><div class="tutorial-offer-actions"><button class="button button-primary button-small" type="button" data-tutorial-offer-start>Commencer</button><button class="button button-ghost button-small" type="button" data-tutorial-offer-close>Plus tard</button></div>`;
  document.body.append(offer);
  offer.querySelector('[data-tutorial-offer-start]').addEventListener('click', () => {
    const trigger = document.querySelector('[data-tutorial-launch]');
    offer.remove();
    launch(trigger);
  });
  offer.querySelector('[data-tutorial-offer-close]').addEventListener('click', () => offer.remove());
  return offer;
}

export function createCalculatorTutorial({
  root,
  storage = globalThis.localStorage,
  steps = TUTORIAL_STEPS,
} = {}) {
  if (!root) return null;
  const overlay = createOverlay();
  const tip = overlay.querySelector('.tutorial-tip');
  const title = overlay.querySelector('[data-tutorial-title]');
  const body = overlay.querySelector('[data-tutorial-body]');
  const patch = overlay.querySelector('[data-tutorial-patch]');
  const dots = overlay.querySelector('[data-tutorial-dots]');
  const previous = overlay.querySelector('[data-tutorial-previous]');
  const next = overlay.querySelector('[data-tutorial-next]');
  const skip = overlay.querySelector('[data-tutorial-skip]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let index = 0;
  let priorFocus = null;
  let resizeObserver = null;
  let updateFrame = 0;
  let renderToken = 0;

  const resolve = (step) => targetRect(root, step.anchor);

  function setSpotlight(rect) {
    const padding = 8;
    const left = Math.max(6, rect.left - padding);
    const top = Math.max(6, rect.top - padding);
    const right = Math.min(innerWidth - 6, rect.right + padding);
    const bottom = Math.min(innerHeight - 6, rect.bottom + padding);
    overlay.style.setProperty('--tutorial-left', `${left}px`);
    overlay.style.setProperty('--tutorial-top', `${top}px`);
    overlay.style.setProperty('--tutorial-width', `${Math.max(1, right - left)}px`);
    overlay.style.setProperty('--tutorial-height', `${Math.max(1, bottom - top)}px`);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function placeTip(hole) {
    const gap = 18;
    const margin = 12;
    const tipRect = tip.getBoundingClientRect();
    const placeAbove = hole.bottom + gap + tipRect.height > innerHeight - margin
      && hole.top - gap - tipRect.height >= margin;
    const top = placeAbove ? hole.top - gap - tipRect.height : hole.bottom + gap;
    const preferredLeft = hole.left + hole.width / 2 - tipRect.width / 2;
    const left = Math.min(innerWidth - tipRect.width - margin, Math.max(margin, preferredLeft));
    const arrowLeft = Math.min(tipRect.width - 22, Math.max(14, hole.left + hole.width / 2 - left - 6));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(margin, top)}px`;
    tip.style.setProperty('--tutorial-arrow-left', `${arrowLeft}px`);
    tip.dataset.placement = placeAbove ? 'above' : 'below';
  }

  async function scrollTargetIntoSafeView(step, token) {
    let rect = resolve(step);
    if (!rect) return null;
    const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    const safeTop = Math.max(12, headerBottom + 12);
    const safeBottom = innerHeight - 18;
    if (rect.top < safeTop || rect.bottom > safeBottom) {
      const desired = Math.max(0, scrollY + rect.top - safeTop - Math.max(0, (safeBottom - safeTop - rect.height) / 2));
      scrollTo({ top: desired, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      await new Promise((resolveWait) => setTimeout(resolveWait, reducedMotion.matches ? 0 : 460));
      if (token !== renderToken || !active) return null;
      rect = resolve(step);
    }
    return rect;
  }

  function observeTargets(step) {
    resizeObserver?.disconnect();
    if (!('ResizeObserver' in globalThis)) return;
    resizeObserver = new ResizeObserver(() => schedulePosition());
    targetElements(root, step.anchor).forEach((element) => resizeObserver.observe(element));
  }

  function renderDots() {
    dots.replaceChildren(...steps.map((_, dotIndex) => {
      const dot = document.createElement('span');
      if (dotIndex === index) dot.dataset.active = '';
      return dot;
    }));
  }

  async function renderStep(direction = 1, focusButton = true) {
    if (!active) return;
    const available = findAvailableStep(steps, index, direction, resolve);
    if (available < 0) {
      close('dismissed');
      return;
    }
    index = available;
    const step = steps[index];
    const token = ++renderToken;
    title.textContent = step.title;
    body.textContent = step.body;
    patch.textContent = `BRIEFING ${index + 1}/${steps.length}`;
    previous.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'TERMINER ✓' : 'SUIVANT →';
    renderDots();
    observeTargets(step);
    tip.classList.remove('is-entering');
    void tip.offsetWidth;
    tip.classList.add('is-entering');
    const rect = await scrollTargetIntoSafeView(step, token);
    // Une ancienne étape peut terminer son scroll après que l’utilisateur a
    // déjà avancé. Elle ne doit jamais déplacer l’index courant.
    if (token !== renderToken || !active) return;
    if (!rect) {
      index += direction;
      renderStep(direction, focusButton);
      return;
    }
    const hole = setSpotlight(rect);
    requestAnimationFrame(() => {
      if (!active || token !== renderToken) return;
      placeTip(hole);
      if (focusButton) next.focus({ preventScroll: true });
    });
  }

  function schedulePosition() {
    if (!active) return;
    cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(() => {
      const rect = resolve(steps[index]);
      if (!rect) {
        renderStep(1, false);
        return;
      }
      placeTip(setSpotlight(rect));
    });
  }

  function open(trigger = document.activeElement) {
    if (active) return;
    active = true;
    priorFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    index = 0;
    overlay.hidden = false;
    overlay.dataset.open = '';
    document.body.classList.add('has-calculator-tutorial');
    renderStep(1);
  }

  function close(status = 'dismissed') {
    if (!active) return;
    active = false;
    renderToken += 1;
    writePreference(storage, status);
    resizeObserver?.disconnect();
    cancelAnimationFrame(updateFrame);
    overlay.hidden = true;
    overlay.removeAttribute('data-open');
    document.body.classList.remove('has-calculator-tutorial');
    if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true });
    priorFocus = null;
  }

  function goNext() {
    if (index >= steps.length - 1) close('completed');
    else { index += 1; renderStep(1); }
  }

  function goPrevious() {
    if (index <= 0) return;
    index -= 1;
    renderStep(-1);
  }

  previous.addEventListener('click', goPrevious);
  next.addEventListener('click', goNext);
  skip.addEventListener('click', () => close('dismissed'));
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, { passive: true });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close('dismissed');
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrevious();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(tip);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const launch = (trigger) => window.setTimeout(() => open(trigger), 0);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tutorial-launch]');
    if (!button) return;
    if (button.matches('a[href]')) event.preventDefault();
    document.querySelector('[data-tutorial-offer]')?.remove();
    launch(button);
  });
  window.addEventListener('fat:tutorial-open', (event) => launch(event.detail?.trigger));
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#tutoriel-calculateur') return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}#calculateur`);
    launch(document.querySelector('[data-tutorial-launch]'));
  });

  if (location.hash === '#tutoriel-calculateur') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}#calculateur`);
    launch(document.querySelector('[data-tutorial-launch]'));
  } else if (shouldOfferTutorial(storage)) {
    writePreference(storage, 'dismissed');
    window.setTimeout(() => {
      if (!active && !document.querySelector('[data-tutorial-offer]')) createFirstVisitOffer(launch);
    }, 900);
  }

  return {
    open,
    close,
    next: goNext,
    previous: goPrevious,
    getState: () => ({ active, index, step: active ? steps[index] : null }),
    destroy() {
      active = false;
      resizeObserver?.disconnect();
      cancelAnimationFrame(updateFrame);
      overlay.remove();
      document.querySelector('[data-tutorial-offer]')?.remove();
    },
  };
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-trajectory-app]');
  if (root) globalThis.fatCalculatorTutorial = createCalculatorTutorial({ root });
}
