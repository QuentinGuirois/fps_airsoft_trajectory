import { initTheme } from '../../theme.js';
import { createProductionRepositories } from './community-repositories.js';
import { initAccountLogin } from './account-login.js';

initTheme();
const root = document.querySelector('[data-account-login]');
if (root) {
  const { accountRepository } = createProductionRepositories();
  initAccountLogin({ root, accountRepository });
}
