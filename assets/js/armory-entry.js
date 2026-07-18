import { initTheme } from '../../theme.js';
import { createProductionRepositories } from './community-repositories.js';
import { initArmory } from './armory.js';

initTheme();
const root = document.querySelector('[data-armory]');
if (root) initArmory({ root, ...createProductionRepositories() });
