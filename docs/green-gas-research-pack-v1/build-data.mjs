import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED_AT = '2026-07-17';
const MIN_TEMPERATURE_C = -15;
const MAX_TEMPERATURE_C = 40;

const sources = [
  {
    id: 'nist-propane-antoine',
    publisher: 'NIST Chemistry WebBook',
    type: 'scientific_reference',
    url: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C74986&Mask=4&Type=ANTOINE&Plot=on',
    accessedAt: GENERATED_AT,
    supports: 'Équation d’Antoine du propane et coefficients valides de 230,6 à 320,7 K.',
  },
  {
    id: 'asg-ultrair-135-official',
    publisher: 'ActionSportGames',
    type: 'manufacturer',
    url: 'https://actionsportgames.com/ultrair-power-propellent-gas-with-silicone-570-ml-19893',
    accessedAt: GENERATED_AT,
    supports: 'ULTRAIR 135 PSI à 25 °C, 570 ml, silicone et tests de 5 à 30 °C.',
  },
  {
    id: 'asg-ultrair-164-official',
    publisher: 'ActionSportGames',
    type: 'manufacturer',
    url: 'https://actionsportgames.com/ultrair-medium-power-propellent-gas-570-ml-19894',
    accessedAt: GENERATED_AT,
    supports: 'ULTRAIR 164 PSI à 25 °C, 570 ml et tableau température-pression sur la bouteille.',
  },
  {
    id: 'asg-ultrair-178-official',
    publisher: 'ActionSportGames',
    type: 'manufacturer',
    url: 'https://actionsportgames.com/ultrair-high-power-propellent-gas-570-ml-19895',
    accessedAt: GENERATED_AT,
    supports: 'ULTRAIR 178 PSI à 25 °C, 570 ml et tests de 5 à 30 °C.',
  },
  {
    id: 'asg-ultrair-135-grid',
    publisher: 'Kotte & Zeller',
    type: 'retailer_transcription',
    url: 'https://www.kotte-zeller.de/ultrair-airsoft-power-gas-135-psi-power-green-gas-570ml-mit-silikon',
    accessedAt: GENERATED_AT,
    supports: 'Valeurs transcrites de la bouteille : 107/114/121/130/135/156 PSI à 5/10/15/20/25/30 °C.',
  },
  {
    id: 'asg-ultrair-164-grid',
    publisher: 'Kotte & Zeller',
    type: 'retailer_transcription',
    url: 'https://www.kotte-zeller.de/ultrair-airsoft-power-gas-164-psi-medium-power-orange-gas-570ml-ohne-silikon',
    accessedAt: GENERATED_AT,
    supports: 'Valeurs transcrites de la bouteille : 121/128/135/142/164/171 PSI à 5/10/15/20/25/30 °C.',
  },
  {
    id: 'asg-ultrair-178-grid',
    publisher: 'Kotte & Zeller',
    type: 'retailer_transcription',
    url: 'https://www.kotte-zeller.de/ultrair-airsoft-power-gas-178-psi-high-power-red-gas-570ml-ohne-silikon',
    accessedAt: GENERATED_AT,
    supports: 'Valeurs transcrites de la bouteille : 128/135/142/157/178/185 PSI à 5/10/15/20/25/30 °C.',
  },
  {
    id: 'nimrod-range-20c',
    publisher: 'Armasur Airsoft',
    type: 'distributor',
    url: 'https://www.armasairsoft.es/producto/botella-gas-nimrod-500ml/',
    accessedAt: GENERATED_AT,
    supports: 'Gamme Nimrod Blue 116, Green 145, Red 174 et Black 203 PSI à 20 °C.',
  },
  {
    id: 'nimrod-operating-ranges',
    publisher: 'Atom Airsoft',
    type: 'distributor',
    url: 'https://atom-airsoft.fi/en-fi/products/nimrod-black-gas-kaasu-203psi',
    accessedAt: GENERATED_AT,
    supports: 'Plages constructeur reportées : Blue 10–40, Green 10–35, Red 3–30, Black −15–20 °C.',
  },
  {
    id: 'powair-range-20c',
    publisher: 'AS-DF',
    type: 'retailer',
    url: 'https://as-df.fr/bouteille-de-gaz/32132-powair-gaz-500ml-2123456.html',
    accessedAt: GENERATED_AT,
    supports: 'Gamme Powair 116, 145, 175 et 203 PSI, chaque valeur mesurée à 20 °C.',
  },
  {
    id: 'specna-vapor-range-25c',
    publisher: 'Anareus',
    type: 'distributor',
    url: 'https://www.anareus.cz/gb/red-gas/19287-sa-vapor-red-airsoft-green-gas-188-psi-600-ml-red-5902543209962.html',
    accessedAt: GENERATED_AT,
    supports: 'Table VAPOR Blue 117, Green 145, Red 188, Black 217 PSI à 25 °C et minima d’utilisation.',
  },
  {
    id: 'swiss-arms-110-20c',
    publisher: 'EMG Arms',
    type: 'official_distributor',
    url: 'https://www.emgarms.com/110229/',
    accessedAt: GENERATED_AT,
    supports: 'Swiss Arms Light dry, 110 PSI à 20 °C.',
  },
  {
    id: 'swiss-arms-130-20c',
    publisher: 'EMG Arms',
    type: 'official_distributor',
    url: 'https://www.emgarms.com/110228/',
    accessedAt: GENERATED_AT,
    supports: 'Swiss Arms Green lubrifié, 130 PSI à 20 °C.',
  },
  {
    id: 'swiss-arms-130-dry-20c',
    publisher: 'EMG Arms',
    type: 'official_distributor',
    url: 'https://www.emgarms.com/110231/',
    accessedAt: GENERATED_AT,
    supports: 'Swiss Arms Green sec, 130 PSI à 20 °C.',
  },
  {
    id: 'swiss-arms-150-20c',
    publisher: 'EMG Arms',
    type: 'official_distributor',
    url: 'https://www.emgarms.com/110227/',
    accessedAt: GENERATED_AT,
    supports: 'Swiss Arms Heavy lubrifié, 150 PSI à 20 °C.',
  },
  {
    id: 'swiss-arms-150-dry-20c',
    publisher: 'EMG Arms',
    type: 'official_distributor',
    url: 'https://www.emgarms.com/96362/',
    accessedAt: GENERATED_AT,
    supports: 'Swiss Arms Heavy sec, 150 PSI à 20 °C.',
  },
  {
    id: 'atm-range-overview-20c',
    publisher: 'Ama Tsu Maru',
    type: 'brand',
    url: 'https://amatsumaru.com/it/gaz-atm/',
    accessedAt: GENERATED_AT,
    supports: 'Gamme ATM et ancres 135/203 PSI à 20 °C.',
  },
  {
    id: 'atm-dry-range-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi175-secco-atm-ama-tsu-maru?lang=en',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI175 sec : 175 PSI à 20 °C, 550 ml.',
  },
  {
    id: 'atm-110-dry-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi110-secco-atm-ama-tsu-maru',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI110 sec : valeur réelle annoncée 113 PSI à 20 °C.',
  },
  {
    id: 'atm-130-dry-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi130-secco-atm-ama-tsu-maru-2/',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI130 sec : valeur réelle annoncée 135 PSI à 20 °C.',
  },
  {
    id: 'atm-150-dry-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi130-secco-atm-ama-tsu-maru/',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI150 sec : valeur réelle annoncée 156 PSI à 20 °C.',
  },
  {
    id: 'atm-165-dry-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi165-secco-atm-ama-tsu-maru',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI165 sec : 165 PSI à 20 °C.',
  },
  {
    id: 'atm-203-dry-20c',
    publisher: 'Rabboshopsoftair',
    type: 'retailer',
    url: 'https://www.rabboshopsoftair.it/prodotto/green-gas-psi203-secco-atm-ama-tsu-maru',
    accessedAt: GENERATED_AT,
    supports: 'ATM PSI203 sec : 203 PSI à 20 °C.',
  },
  {
    id: 'nuprol-2-25c',
    publisher: 'Anareus',
    type: 'distributor',
    url: 'https://www.anareus.cz/gb/gas-co2/6126-green-gas-nuprol-20-700315573410.html',
    accessedAt: GENERATED_AT,
    supports: 'NUPROL Premium 2.0 : 145 PSI à 25 °C et plage conseillée 10–25 °C.',
  },
  {
    id: 'protech-official',
    publisher: 'ProTech Guns',
    type: 'manufacturer',
    url: 'https://protechguns.com/produkt/protechgas-green-gas-600-800ml/',
    accessedAt: GENERATED_AT,
    supports: 'Formule ProtechGas, silicone et formats disponibles ; aucune pression chiffrée sur la page officielle.',
  },
  {
    id: 'protech-1mpa-25c',
    publisher: 'Airsoft-gun.eu',
    type: 'distributor',
    url: 'https://www.airsoft-gun.eu/en/gas-co2/-protechguns-green-gas-bottle-800ml-5904730925167-5252.html',
    accessedAt: GENERATED_AT,
    supports: 'ProTechGuns Green Gas : environ 1 MPa à 25 °C.',
  },
  {
    id: 'abbey-144a-25c',
    publisher: 'MCL Interglobal',
    type: 'official_distributor',
    url: 'https://www.mclinterglobal.com/en/abbey-predator-gun-gas-144a-700ml',
    accessedAt: GENERATED_AT,
    supports: 'Abbey Predator 144a : 6,6 bar à 25 °C, 700 ml et lubrifiant UPL.',
  },
  {
    id: 'puff-dino-12kg-30c',
    publisher: 'KDK Airsoft',
    type: 'retailer',
    url: 'https://www.kdkairsoft.com/product-page/puff-dino-green-gas',
    accessedAt: GENERATED_AT,
    supports: 'Puff Dino 12 kg : 171 PSI à 30 °C, 600 ml et silicone.',
  },
  {
    id: 'puff-dino-14kg-30c',
    publisher: 'Airsoft Z One',
    type: 'retailer',
    url: 'https://airsoftzone.com.mx/productos-de-airsoft/green-gas-puff-dino14kg/',
    accessedAt: GENERATED_AT,
    supports: 'Puff Dino 14 kg : 199,12 PSI à 30 °C, 560 ml.',
  },
  {
    id: 'vorsk-range-no-ref',
    publisher: 'Patrol Base',
    type: 'retailer',
    url: 'https://www.patrolbase.co.uk/featured-airsoft-news/features-and-reviews/vorsk-green-gas-comparison-v6-v8-v12-how-do-they-stack-up',
    accessedAt: GENERATED_AT,
    supports: 'VORSK V6/V8/V12 et valeurs nominales, sans température de référence explicite exploitable.',
  },
  {
    id: 'novritsch-range-no-ref',
    publisher: 'Novritsch',
    type: 'manufacturer',
    url: 'https://eu.novritsch.com/fr/product/airsoft-gas/',
    accessedAt: GENERATED_AT,
    supports: 'Niveaux Low/Medium/High/Super High et conseils par réplique, sans référence thermique complète des pressions.',
  },
  {
    id: 'elite-force-range-no-ref',
    publisher: 'Softairwelt',
    type: 'retailer',
    url: 'https://www.softairwelt.de/Elite-Force-Airsoft-Green-Gas-130-PSI-mit-Silikon-600-ml',
    accessedAt: GENERATED_AT,
    supports: 'Elite Force 110/130/150 PSI et plages d’emploi, sans température de référence explicite.',
  },
];

const PRODUCTS = [];

function addProduct(product) {
  PRODUCTS.push({
    category: 'green_gas',
    status: 'publishable_estimate',
    confidence: 'high',
    silicone: 'unknown',
    containerMl: null,
    fillMl: null,
    operatingRangeC: null,
    notesFr: [],
    ...product,
  });
}

const asgPoints = {
  green135: { 5: 107, 10: 114, 15: 121, 20: 130, 25: 135, 30: 156 },
  orange164: { 5: 121, 10: 128, 15: 135, 20: 142, 25: 164, 30: 171 },
  red178: { 5: 128, 10: 135, 15: 142, 20: 157, 25: 178, 30: 185 },
};

addProduct({ id: 'asg-ultrair-green-135-silicone', brand: 'ASG Ultrair', model: 'Green Power Gas 135 PSI — siliconé', labelPsi: 135, referencePsi: 135, referenceTemperatureC: 25, containerMl: 570, silicone: 'yes', operatingRangeC: { min: 10, max: null }, measuredPoints: asgPoints.green135, modelId: 'manufacturer_grid_piecewise_linear', sourceIds: ['asg-ultrair-135-official', 'asg-ultrair-135-grid'], notesFr: ['Interpolation linéaire entre les points imprimés sur la bouteille ; extrapolation hors 5–30 °C.'] });
addProduct({ id: 'asg-ultrair-orange-164-dry', brand: 'ASG Ultrair', model: 'Orange Medium Power 164 PSI — sec', labelPsi: 164, referencePsi: 164, referenceTemperatureC: 25, containerMl: 570, silicone: 'no', operatingRangeC: { min: 7, max: null }, measuredPoints: asgPoints.orange164, modelId: 'manufacturer_grid_piecewise_linear', sourceIds: ['asg-ultrair-164-official', 'asg-ultrair-164-grid'], notesFr: ['Interpolation linéaire entre les points imprimés sur la bouteille ; extrapolation hors 5–30 °C.'] });
addProduct({ id: 'asg-ultrair-red-178-dry', brand: 'ASG Ultrair', model: 'Red High Power 178 PSI — sec', labelPsi: 178, referencePsi: 178, referenceTemperatureC: 25, containerMl: 570, silicone: 'no', operatingRangeC: { min: 4, max: null }, measuredPoints: asgPoints.red178, modelId: 'manufacturer_grid_piecewise_linear', sourceIds: ['asg-ultrair-178-official', 'asg-ultrair-178-grid'], notesFr: ['Interpolation linéaire entre les points imprimés sur la bouteille ; extrapolation hors 5–30 °C.'] });

for (const item of [
  ['nimrod-blue-116', 'Blue Light Performance 116 PSI', 116, { min: 10, max: 40 }],
  ['nimrod-green-145', 'Green Standard Performance 145 PSI', 145, { min: 10, max: 35 }],
  ['nimrod-red-174', 'Red Professional Performance 174 PSI', 174, { min: 3, max: 30 }],
  ['nimrod-black-203', 'Black Extreme Performance 203 PSI', 203, { min: -15, max: 20 }],
]) addProduct({ id: item[0], brand: 'Nimrod Tactical', model: item[1], labelPsi: item[2], referencePsi: item[2], referenceTemperatureC: 20, containerMl: 500, silicone: 'yes', operatingRangeC: item[3], modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['nimrod-range-20c', 'nimrod-operating-ranges'] });

for (const item of [
  ['powair-116', 'Premium Quality 116 PSI', 116],
  ['powair-145', 'Premium Quality 145 PSI', 145],
  ['powair-175', 'Premium Quality 175 PSI', 175],
  ['powair-203', 'Premium Quality 203 PSI', 203],
]) addProduct({ id: item[0], brand: 'Powair', model: item[1], labelPsi: item[2], referencePsi: item[2], referenceTemperatureC: 20, containerMl: 500, silicone: 'yes', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['powair-range-20c'] });

for (const item of [
  ['specna-vapor-blue-117', 'VAPOR Blue 117 PSI — sec', 117, 15],
  ['specna-vapor-green-145', 'VAPOR Green 145 PSI — sec', 145, 10],
  ['specna-vapor-red-188', 'VAPOR Red 188 PSI — sec', 188, 5],
  ['specna-vapor-black-217', 'VAPOR Black 217 PSI — sec', 217, 0],
]) addProduct({ id: item[0], brand: 'Specna Arms', model: item[1], labelPsi: item[2], referencePsi: item[2], referenceTemperatureC: 25, containerMl: 600, silicone: 'no', operatingRangeC: { min: item[3], max: null }, modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['specna-vapor-range-25c'] });

for (const item of [
  ['swiss-arms-light-110-dry', 'Light 110 PSI — sec', 110, 600, 'no', 'swiss-arms-110-20c'],
  ['swiss-arms-green-130-dry', 'Green 130 PSI — sec', 130, 760, 'no', 'swiss-arms-130-dry-20c'],
  ['swiss-arms-green-130-silicone', 'Green 130 PSI — siliconé', 130, 760, 'yes', 'swiss-arms-130-20c'],
  ['swiss-arms-heavy-150-dry', 'Heavy 150 PSI — sec', 150, 760, 'no', 'swiss-arms-150-dry-20c'],
  ['swiss-arms-heavy-150-silicone', 'Heavy 150 PSI — siliconé', 150, 760, 'yes', 'swiss-arms-150-20c'],
]) addProduct({ id: item[0], brand: 'Swiss Arms', model: item[1], labelPsi: item[2], referencePsi: item[2], referenceTemperatureC: 20, containerMl: item[3], fillMl: item[2] === 110 ? 450 : 600, silicone: item[4], modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: [item[5]] });

for (const item of [
  ['atm-psi110-dry', 'PSI110 — sec', 110, 113, 450, 'no', 'atm-110-dry-20c'],
  ['atm-psi130-dry', 'PSI130 — sec', 130, 135, 550, 'no', 'atm-130-dry-20c'],
  ['atm-psi130-silicone', 'PSI130 — lubrifié', 130, 135, 550, 'yes', 'atm-range-overview-20c'],
  ['atm-psi150-dry', 'PSI150 — sec', 150, 156, 550, 'no', 'atm-150-dry-20c'],
  ['atm-psi165-dry', 'PSI165 — sec', 165, 165, 550, 'no', 'atm-165-dry-20c'],
  ['atm-psi175-dry', 'PSI175 — sec', 175, 175, 550, 'no', 'atm-dry-range-20c'],
  ['atm-psi203-dry', 'PSI203 — sec', 203, 203, 550, 'no', 'atm-203-dry-20c'],
]) addProduct({ id: item[0], brand: 'ATM / Ama Tsu Maru', model: item[1], labelPsi: item[2], referencePsi: item[3], referenceTemperatureC: 20, containerMl: item[4], silicone: item[5], modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: [item[6]], notesFr: item[2] !== item[3] ? [`Le nom commercial ${item[2]} PSI diffère de la valeur annoncée à 20 °C : ${item[3]} PSI.`] : [] });

addProduct({ id: 'nuprol-premium-2-145', brand: 'NUPROL', model: 'Premium Green Gas 2.0 145 PSI', labelPsi: 145, referencePsi: 145, referenceTemperatureC: 25, containerMl: 650, fillMl: 500, silicone: 'yes', operatingRangeC: { min: 10, max: 25 }, confidence: 'medium', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['nuprol-2-25c'], notesFr: ['Les versions 1.0, 3.0 et 4.0 sont conservées en candidats : leur température de référence ou leur pression actuelle n’est pas assez stable entre sources.'] });
addProduct({ id: 'protechguns-green-gas', brand: 'ProTechGuns', model: 'ProtechGas Green Gas', labelPsi: 145, referencePsi: 145.04, referenceTemperatureC: 25, containerMl: 800, silicone: 'yes', operatingRangeC: { min: 3, max: 30 }, confidence: 'medium', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['protech-official', 'protech-1mpa-25c'], notesFr: ['La page fabricant ne chiffre pas la pression ; l’ancre de 1 MPa à 25 °C vient d’un distributeur. Formats 120, 520, 800 et 1000 ml selon marchés.'] });
addProduct({ id: 'abbey-predator-144a', brand: 'Abbey', model: 'Predator Gun Gas 144a', category: 'low_pressure_airsoft_gas', labelPsi: 96, referencePsi: 95.72, referenceTemperatureC: 25, containerMl: 700, silicone: 'yes', confidence: 'medium', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['abbey-144a-25c'], notesFr: ['Produit basse pression adjacent au Green Gas ; 6,6 bar convertis en 95,72 PSI. La composition n’étant pas du propane pur, le modèle relatif reste une approximation.'] });
addProduct({ id: 'puff-dino-12kg-171', brand: 'Puff Dino', model: '12 kg Classic 171 PSI — siliconé', labelPsi: 171, referencePsi: 171, referenceTemperatureC: 30, containerMl: 600, silicone: 'yes', confidence: 'medium', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['puff-dino-12kg-30c'] });
addProduct({ id: 'puff-dino-14kg-199-dry', brand: 'Puff Dino', model: '14 kg Power Up 199 PSI — sec', labelPsi: 199, referencePsi: 199.12, referenceTemperatureC: 30, containerMl: 560, silicone: 'no', confidence: 'medium', modelId: 'anchor_scaled_propane_antoine_nist', sourceIds: ['puff-dino-14kg-30c'] });

const excludedCandidates = [
  { brand: 'VORSK', models: ['V6 175 PSI', 'V8 190 PSI', 'V12 220 PSI'], reasonFr: 'Les valeurs nominales et plages d’usage sont trouvées, mais aucune température de référence explicite et fiable n’a été publiée dans les sources consultées.', sourceIds: ['vorsk-range-no-ref'] },
  { brand: 'Novritsch', models: ['Low ≈110 PSI', 'Medium ≈130 PSI', 'High', 'Super High'], reasonFr: 'La page fabricant donne des niveaux approximatifs et des tableaux par réplique, sans ancre pression/température complète pour chaque bouteille.', sourceIds: ['novritsch-range-no-ref'] },
  { brand: 'Elite Force / Umarex', models: ['Light 110', 'Green 130', 'Heavy 150'], reasonFr: 'Pressions et plages d’usage disponibles, mais la température de référence n’est pas explicitée dans les pages retenues. Ne pas supposer qu’elle est identique à Swiss Arms malgré la proximité de gamme.', sourceIds: ['elite-force-range-no-ref'] },
  { brand: 'NUPROL', models: ['1.0 115 PSI', '3.0 175 PSI', '4.0 200/210/215 PSI'], reasonFr: 'Les sources se contredisent sur la pression actuelle du 4.0 et ne donnent pas toutes une température de référence explicite. Seul le 2.0 est publié dans ce jeu.', sourceIds: ['nuprol-2-25c'] },
  { brand: 'Puff Dino', models: ['9 kg / 115 PSI'], reasonFr: 'La valeur nominale est trouvée, mais pas sa température de référence dans une source suffisamment explicite.', sourceIds: ['puff-dino-12kg-30c'] },
];

function propaneVaporPressureBar(temperatureC) {
  const temperatureK = temperatureC + 273.15;
  const A = 3.98292;
  const B = 819.296;
  const C = -24.417;
  return 10 ** (A - B / (temperatureK + C));
}

function scaledAnchorPressure(product, temperatureC) {
  const ratio = propaneVaporPressureBar(temperatureC)
    / propaneVaporPressureBar(product.referenceTemperatureC);
  return product.referencePsi * ratio;
}

function interpolateGrid(points, temperatureC) {
  const temperatures = Object.keys(points).map(Number).sort((a, b) => a - b);
  if (Object.hasOwn(points, temperatureC)) {
    return { psi: points[temperatureC], status: 'manufacturer_test_point' };
  }

  const min = temperatures[0];
  const max = temperatures.at(-1);
  if (temperatureC < min) {
    const psi = points[min] * propaneVaporPressureBar(temperatureC) / propaneVaporPressureBar(min);
    return { psi, status: 'extrapolated_propane_ratio' };
  }
  if (temperatureC > max) {
    const psi = points[max] * propaneVaporPressureBar(temperatureC) / propaneVaporPressureBar(max);
    return { psi, status: 'extrapolated_propane_ratio' };
  }

  let low = min;
  let high = max;
  for (const candidate of temperatures) {
    if (candidate < temperatureC) low = candidate;
    if (candidate > temperatureC) {
      high = candidate;
      break;
    }
  }
  const fraction = (temperatureC - low) / (high - low);
  return {
    psi: points[low] + (points[high] - points[low]) * fraction,
    status: 'interpolated_manufacturer_grid',
  };
}

function curveFor(product) {
  const curve = [];
  for (let temperatureC = MIN_TEMPERATURE_C; temperatureC <= MAX_TEMPERATURE_C; temperatureC += 1) {
    const result = product.measuredPoints
      ? interpolateGrid(product.measuredPoints, temperatureC)
      : {
          psi: scaledAnchorPressure(product, temperatureC),
          status: temperatureC === product.referenceTemperatureC
            ? 'manufacturer_or_distributor_anchor'
            : 'estimated_propane_ratio',
        };
    curve.push({
      temperatureC,
      estimatedPsi: Number(result.psi.toFixed(2)),
      pointStatus: result.status,
      insidePublishedOperatingRange: product.operatingRangeC
        ? (product.operatingRangeC.min == null || temperatureC >= product.operatingRangeC.min)
          && (product.operatingRangeC.max == null || temperatureC <= product.operatingRangeC.max)
        : null,
    });
  }
  return curve;
}

const products = PRODUCTS.map((product) => {
  const { measuredPoints, ...publicProduct } = product;
  return {
    ...publicProduct,
    pressureBasis: 'manufacturer_claimed_psi_basis_not_always_specified',
    measuredPoints: measuredPoints
      ? Object.entries(measuredPoints).map(([temperatureC, psi]) => ({ temperatureC: Number(temperatureC), psi }))
      : [],
    curve: curveFor(product),
  };
});

const brands = [...new Set(products.map((product) => product.brand))]
  .sort((a, b) => a.localeCompare(b, 'fr'))
  .map((brand) => ({ brand, productIds: products.filter((product) => product.brand === brand).map((product) => product.id) }));

const payload = {
  schemaVersion: '1.0.0',
  generatedAt: GENERATED_AT,
  language: 'fr-FR',
  temperatureGrid: { minC: MIN_TEMPERATURE_C, maxC: MAX_TEMPERATURE_C, stepC: 1 },
  scope: {
    publishableProductCount: products.length,
    brandCount: brands.length,
    statementFr: 'Normalisation exploratoire de bouteilles de gaz airsoft à partir de données fabricants et distributeurs.',
  },
  disclaimerFr: 'La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue. La température réelle du chargeur, le cooldown, la formulation du gaz, le taux de remplissage et l’état mécanique modifient le résultat.',
  calculation: {
    defaultModelId: 'anchor_scaled_propane_antoine_nist',
    formula: 'P_est(T) = P_source(T_ref) × P_sat_propane_NIST(T) / P_sat_propane_NIST(T_ref)',
    propaneAntoine: {
      formula: 'log10(P_bar) = A - B / (T_K + C)',
      A: 3.98292,
      B: 819.296,
      C: -24.417,
      validityK: [230.6, 320.7],
      sourceId: 'nist-propane-antoine',
    },
    gridModel: 'Pour ASG ULTRAIR, interpolation linéaire entre points publiés ; hors 5–30 °C, extrapolation par ratio de pression de vapeur du propane depuis le point limite.',
    limitationsFr: [
      'Les mélanges commerciaux sont propriétaires : le ratio propane sert de courbe relative, pas d’analyse de composition.',
      'Les PSI commerciaux ne précisent pas toujours s’il s’agit d’une pression absolue, manométrique ou d’un protocole interne.',
      'Une pression statique de bouteille n’est pas la pression dynamique disponible pendant une rafale.',
      'Le modèle ne simule ni cooldown, ni transfert thermique, ni niveau de remplissage, ni fuite.',
    ],
  },
  sources,
  brands,
  products,
  excludedCandidates,
};

writeFileSync(join(HERE, 'green-gas-pressure-curves.json'), `${JSON.stringify(payload, null, 2)}\n`);

const csvHeader = [
  'brand', 'model', 'product_id', 'temperature_c', 'estimated_psi', 'point_status',
  'reference_psi', 'reference_temperature_c', 'model_id', 'confidence', 'inside_published_operating_range',
];
const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csvRows = [csvHeader.map(escapeCsv).join(',')];
for (const product of products) {
  for (const point of product.curve) {
    csvRows.push([
      product.brand,
      product.model,
      product.id,
      point.temperatureC,
      point.estimatedPsi,
      point.pointStatus,
      product.referencePsi,
      product.referenceTemperatureC,
      product.modelId,
      product.confidence,
      point.insidePublishedOperatingRange,
    ].map(escapeCsv).join(','));
  }
}
writeFileSync(join(HERE, 'green-gas-pressure-curves.csv'), `${csvRows.join('\n')}\n`);

console.log(`Generated ${products.length} products, ${brands.length} brands and ${products.length * (MAX_TEMPERATURE_C - MIN_TEMPERATURE_C + 1)} curve points.`);
