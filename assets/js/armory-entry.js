import { initTheme } from '../../theme.js?v=20260718-28';
import { createProductionRepositories } from './community-repositories.js?v=20260719-45';
import { initArmory } from './armory.js?v=20260719-45';

initTheme();
const root = document.querySelector('[data-armory]');
if (root) initArmory({ root, ...createProductionRepositories() });
