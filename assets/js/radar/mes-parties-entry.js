import { initTheme } from '../../../theme.js?v=20260723-47';
import { createTurnstileController } from '../turnstile-client.js?v=20260723-47';
import { createRadarRepositories } from '../radar-repositories.js?v=20260723-47';
import { initMyRadarEvents } from './my-radar-events.js?v=20260723-47';

initTheme();
const root = document.querySelector('[data-my-radar]');
if (root) {
  const repositories = createRadarRepositories();
  const turnstileController = createTurnstileController({
    root,
    accountRepository: repositories.accountRepository,
  });
  initMyRadarEvents({ root, ...repositories, turnstileController });
}
