import { initTheme } from '../../theme.js?v=20260723-47';
import { createProductionRepositories } from './community-repositories.js?v=20260723-47';
import { consumeAccountTokenHash, initAccountLogin } from './account-login.js?v=20260723-47';
import { createTurnstileController } from './turnstile-client.js?v=20260723-47';

initTheme();
const root = document.querySelector('[data-account-login]');
if (root) {
  const { accountRepository } = createProductionRepositories();
  const tokenState = consumeAccountTokenHash();
  const publicConfig = await accountRepository.getTurnstileConfig().catch(() => null);
  const registrationEnabled = publicConfig?.turnstile?.registrationEnabled !== false;
  const turnstileController = createTurnstileController({ root, accountRepository });
  initAccountLogin({ root, accountRepository, turnstileController, registrationEnabled, tokenState });
}
