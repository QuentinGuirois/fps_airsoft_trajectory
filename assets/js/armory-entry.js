import { initTheme } from '../../theme.js?v=20260723-47';
import { createProductionRepositories } from './community-repositories.js?v=20260723-47';
import { initArmory } from './armory.js?v=20260723-47';

initTheme();
const root = document.querySelector('[data-armory]');
if (root) initArmory({ root, ...createProductionRepositories() });
