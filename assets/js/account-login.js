import { RepositoryError } from './community-repositories.js?v=20260719-44';

export function safeAccountReturn(search = globalThis.location?.search || '') {
  try {
    const value = new URLSearchParams(search).get('return') || '';
    return value.startsWith('/') && !value.startsWith('//') && !/[\r\n]/.test(value) ? value : '';
  } catch { return ''; }
}

export function consumeAccountTokenHash({
  locationRef = globalThis.location,
  historyRef = globalThis.history,
} = {}) {
  const hash = String(locationRef?.hash || '').replace(/^#/, '');
  const parameters = new URLSearchParams(hash);
  const verify = parameters.get('verify') || '';
  const reset = parameters.get('reset') || '';
  if (verify || reset) {
    historyRef?.replaceState?.(null, '', `${locationRef.pathname || '/'}${locationRef.search || ''}`);
  }
  return { verify, reset };
}

const fieldValue = (form, name) => String(new FormData(form).get(name) || '').trim();

export function initAccountLogin({
  root,
  accountRepository,
  turnstileController = null,
  registrationEnabled = true,
  tokenState = null,
  redirect = (url) => { globalThis.location.href = url; },
} = {}) {
  if (!root || !accountRepository) return null;
  const accountTokens = tokenState || consumeAccountTokenHash();
  const tabs = [...root.querySelectorAll('[data-account-tab]')];
  const forms = [...root.querySelectorAll('[data-account-form]')];
  const status = root.querySelector('[data-account-status]');
  const forgotForm = root.querySelector('[data-account-forgot-form]');
  const resetForm = root.querySelector('[data-account-reset-form]');
  const controller = new AbortController();
  const returnTarget = safeAccountReturn();
  let mode = 'login';

  const registerTab = root.querySelector('[data-account-tab="register"]');
  const registerForm = root.querySelector('[data-account-form="register"]');
  const registrationClosed = root.querySelector('[data-registration-closed]');
  if (registerTab) registerTab.hidden = !registrationEnabled;
  if (registerForm) registerForm.hidden = true;
  if (registrationClosed) registrationClosed.hidden = registrationEnabled;

  function announce(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function selectMode(nextMode) {
    mode = nextMode === 'register' && registrationEnabled ? 'register' : 'login';
    tabs.forEach((tab) => {
      const active = tab.dataset.accountTab === mode;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    forms.forEach((form) => { form.hidden = form.dataset.accountForm !== mode; });
    announce('');
    root.querySelector(`[data-account-form="${mode}"] input`)?.focus();
    turnstileController?.activate(mode).catch((error) => announce(error.message, 'error'));
  }

  async function protectedPayload(action) {
    if (!turnstileController) return {};
    return { turnstileToken: await turnstileController.token(action) };
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => selectMode(tab.dataset.accountTab), { signal: controller.signal }));
  tabs.forEach((tab, index) => tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    selectMode(tabs[next].dataset.accountTab);
  }, { signal: controller.signal }));

  forms.forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = form.dataset.accountForm === 'register' ? 'register' : 'login';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    root.setAttribute('aria-busy', 'true');
    announce(action === 'login' ? 'Connexion en cours…' : 'Création du compte en cours…');
    try {
      if (action === 'login') {
        await accountRepository.login({
          identity: fieldValue(form, 'identity'),
          password: fieldValue(form, 'password'),
          ...await protectedPayload('login'),
        }, { signal: controller.signal });
        announce('Connexion réussie.', 'success');
        redirect(returnTarget || '/compte/armurerie.html');
      } else {
        const registration = await accountRepository.register({
          pseudo: fieldValue(form, 'pseudo'),
          email: fieldValue(form, 'email'),
          password: fieldValue(form, 'password'),
          legalAccepted: form.elements.legalAccepted?.checked === true,
          ...await protectedPayload('register'),
        }, { signal: controller.signal });
        announce(registration?.message || 'Si la demande est valide, un email de vérification a été envoyé.', 'success');
        redirect('/compte/verifier-email.html');
      }
    } catch (error) {
      const message = error instanceof RepositoryError || error instanceof Error
        ? error.message
        : 'Le service de compte est indisponible pour le moment.';
      announce(message, 'error');
    } finally {
      turnstileController?.reset(action);
      submit.disabled = false;
      root.removeAttribute('aria-busy');
    }
  }, { signal: controller.signal }));

  root.querySelector('[data-forgot-password]')?.addEventListener('click', () => {
    forms.forEach((form) => { form.hidden = true; });
    forgotForm.hidden = false;
    forgotForm.querySelector('input')?.focus();
    turnstileController?.activate('forgot_password').catch((error) => announce(error.message, 'error'));
  }, { signal: controller.signal });

  root.querySelector('[data-account-cancel-recovery]')?.addEventListener('click', () => {
    forgotForm.hidden = true;
    selectMode('login');
  }, { signal: controller.signal });

  forgotForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = forgotForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await accountRepository.forgotPassword(fieldValue(forgotForm, 'email'), {
        signal: controller.signal,
        ...await protectedPayload('forgot_password'),
      });
      announce('Si ce compte existe, le lien vient d’être envoyé.', 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { turnstileController?.reset('forgot_password'); submit.disabled = false; }
  }, { signal: controller.signal });

  resetForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = accountTokens.reset;
    const submit = resetForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await accountRepository.resetPassword(token, fieldValue(resetForm, 'password'), { signal: controller.signal });
      history.replaceState(null, '', '/compte/');
      resetForm.hidden = true;
      selectMode('login');
      announce('Mot de passe réinitialisé. Tu peux te connecter.', 'success');
    } catch (error) { announce(error.message, 'error'); }
    finally { submit.disabled = false; }
  }, { signal: controller.signal });

  selectMode('login');
  if (accountTokens.reset) {
    forms.forEach((form) => { form.hidden = true; });
    resetForm.hidden = false;
  }
  const verification = accountTokens.verify;
  if (verification) {
    accountRepository.verifyEmail(verification, { signal: controller.signal })
      .then(() => {
        redirect('/compte/compte-active.html');
      })
      .catch((error) => announce(error.message, 'error'));
  }
  const ready = accountRepository.getSession({ signal: controller.signal })
    .then((session) => {
      if (session?.authenticated) redirect(returnTarget || '/compte/armurerie.html');
      return session;
    })
    .catch((error) => {
      if (error?.name !== 'AbortError') announce('Le service de compte est indisponible pour le moment.', 'notice');
      return null;
    });
  return { selectMode, ready, destroy: () => { controller.abort(); turnstileController?.destroy(); } };
}
