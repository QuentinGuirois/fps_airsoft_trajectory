import { initTheme } from '../../theme.js?v=20260718-28';
import { createProductionRepositories } from './community-repositories.js?v=20260718-42';
import { consumeAccountTokenHash, initAccountLogin } from './account-login.js?v=20260718-42';
import { createTurnstileController } from './turnstile-client.js?v=20260718-30';

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
