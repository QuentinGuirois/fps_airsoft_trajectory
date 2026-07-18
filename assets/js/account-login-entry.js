import { initTheme } from '../../theme.js?v=20260718-28';
import { createProductionRepositories } from './community-repositories.js?v=20260718-28';
import { initAccountLogin } from './account-login.js?v=20260718-28';

initTheme();
const root = document.querySelector('[data-account-login]');
if (root) {
  const { accountRepository } = createProductionRepositories();
  initAccountLogin({ root, accountRepository });
}
