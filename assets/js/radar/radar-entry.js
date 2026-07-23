import { createTurnstileController } from '../turnstile-client.js?v=20260723-47';
import { createRadarRepositories } from '../radar-repositories.js?v=20260723-47';
import { initRadarMap } from './radar-map.js?v=20260723-47';

const root = document.querySelector('[data-radar-app]');
if (root) {
  const repositories = createRadarRepositories();
  const turnstileController = createTurnstileController({
    root: document.body,
    accountRepository: repositories.accountRepository,
  });
  initRadarMap({ root, ...repositories, turnstileController });
}
