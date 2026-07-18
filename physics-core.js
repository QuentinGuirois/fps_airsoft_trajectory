/**
 * F.A.T. — moteur balistique inspiré de l'Airsoft Trajectory Project (ATP).
 *
 * Repère : x = direction du tir, y = verticale, z = dérive latérale.
 * Unités internes : SI (m, s, kg, rad).
 */

export const ATP = Object.freeze({
  gravityEquator: 9.7803185,
  bbDiameterM: 0.006,
  // Compatibilite des anciens liens : ATP utilise des RPM, pas un pourcentage de hop-up.
  referenceSpinRatio: 0.41,
  // La courbe III-A-04 est le polynome imprime decale de +0,00934 sur V/U.
  // Sa racine est donc proche des 0,37 indiques par Mackila dans le texte.
  liftRatioOffset: 0.00934,
  publishedReverseMagnusLimit: 0.3856125112,
  reverseMagnusLimit: 0.3762725112,
  // Ajustement de la figure III-A-03 par une logistique sur le ratio V/U.
  spinRatioEquilibrium: 0.42104,
  spinRatioRatePerSecond: 3.929,
  dynamicViscosity: 17.4e-6,
  gasConstantDryAir: 287.058,
  usefulEnvelopeM: 0.1524,
  maxTimeS: 8,
  maxRangeM: 250,
  integrationStepS: 0.001,
  sampleEvery: 5,
});

export const DEFAULT_SHOT = Object.freeze({
  massG: 0.28,
  energyJ: 1.5,
  angleDeg: 0,
  shootingHeightM: 1.5,
  scopeHeightM: 0.05,
  zeroDistanceM: 35,
  initialRpm: 88000,
  temperatureC: 20,
  pressureHpa: 1013.25,
  latitudeDeg: 47,
  windSpeedKmh: 0,
  windAngleDeg: 0,
  cantDeg: 0,
  diameterMm: 6,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (value) => value * Math.PI / 180;

export function fpsToMps(fps) {
  return Number(fps) * 0.3048;
}

export function mpsToFps(mps) {
  return Number(mps) / 0.3048;
}

export function energyFromVelocity(massKg, velocityMps) {
  return 0.5 * massKg * velocityMps ** 2;
}

export function velocityFromEnergy(massKg, energyJ) {
  if (!(massKg > 0) || !(energyJ >= 0)) return 0;
  return Math.sqrt((2 * energyJ) / massKg);
}

export function airDensity(temperatureC = 20, pressureHpa = 1013.25) {
  const temperatureK = clamp(Number(temperatureC), -50, 70) + 273.15;
  const pressurePa = clamp(Number(pressureHpa), 700, 1100) * 100;
  return pressurePa / (ATP.gasConstantDryAir * temperatureK);
}

export function gravityAtLatitude(latitudeDeg = 47) {
  const latitude = degToRad(clamp(Number(latitudeDeg), -90, 90));
  return ATP.gravityEquator * (
    1
    + 0.005278895 * Math.sin(latitude) ** 2
    - 0.0000589 * Math.sin(2 * latitude) ** 2
  );
}

/** Davies/Dyrkacz polynomial reproduced by ATP for a smooth spinning sphere. */
export function dragCoefficient(spinRatio, reynolds) {
  const ratio = Math.abs(Number(spinRatio) || 0);
  const re = Math.abs(Number(reynolds) || 0);

  const baseNumerator = 0.4274794
    + 0.000001146254 * re
    - 7.559635e-12 * re ** 2
    - 3.817309e-18 * re ** 3
    + 2.389417e-23 * re ** 4;
  const baseDenominator = 1
    - 0.000002120623 * re
    + 2.952772e-11 * re ** 2
    - 1.914687e-16 * re ** 3
    + 3.125996e-22 * re ** 4;
  const baseCd = baseNumerator / baseDenominator;

  const numerator = baseCd
    + 2.2132291 * ratio
    - 10.345178 * ratio ** 2
    + 16.157030 * ratio ** 3
    - 5.2730648 * ratio ** 4;
  const denominator = 1
    + 3.1077276 * ratio
    - 13.6598678 * ratio ** 2
    + 24.00539887 * ratio ** 3
    - 8.340493152 * ratio ** 4
    + 0.07910093 * ratio ** 5;
  return numerator / denominator;
}

/**
 * Coefficient de portance ATP. La petite zone négative correspond au
 * Reverse Magnus décrit par Mackila. Sans rotation, la portance vaut zéro.
 */
export function publishedLiftCoefficient(spinRatio) {
  const ratio = Math.abs(Number(spinRatio) || 0);
  if (ratio < 1e-8) return 0;

  const numerator = -0.0020907
    - 0.208056226 * ratio
    + 0.768791456 * ratio ** 2
    - 0.84865215 * ratio ** 3
    + 0.75365982 * ratio ** 4;
  const denominator = 1
    - 4.82629033 * ratio
    + 9.95459464 * ratio ** 2
    - 7.85649742 * ratio ** 3
    + 3.273765328 * ratio ** 4;
  return numerator / denominator;
}

/** Coefficient effectivement trace dans les figures III-A-01 et III-A-04. */
export function liftCoefficient(spinRatio) {
  const ratio = Math.abs(Number(spinRatio) || 0);
  if (ratio < 1e-8) return 0;
  return publishedLiftCoefficient(ratio + ATP.liftRatioOffset);
}

export function dragForceMagnitude(cd, rho, areaM2, speedMps) {
  return 0.5 * rho * cd * areaM2 * speedMps ** 2;
}

export function magnusForceMagnitude(cl, rho, areaM2, speedMps) {
  return rho * cl * areaM2 * speedMps ** 2;
}

/** Relation de couple imprimee par ATP, conservee pour audit mais incomplete. */
export function publishedRotationalTorque(omega, radiusM, rho, viscosity = ATP.dynamicViscosity) {
  if (!(Math.abs(omega) > 1e-9)) return 0;
  const rotationalReynolds = rho * Math.abs(omega) * radiusM ** 2 / viscosity;
  if (!(rotationalReynolds > 0)) return 0;
  const torqueCoefficient = 6.45 / Math.sqrt(rotationalReynolds) + 32.1 / rotationalReynolds;
  return 0.5 * rho * torqueCoefficient * radiusM ** 5 * omega * Math.abs(omega);
}

/** Loi de spin reconstruite sur la courbe III-A-03; zero rotation reste zero. */
export function plottedSpinRatioDerivative(spinRatio) {
  const ratio = Math.max(0, Number(spinRatio) || 0);
  return ATP.spinRatioRatePerSecond * ratio
    * (1 - ratio / ATP.spinRatioEquilibrium);
}

export function normalizeShot(input = {}) {
  const massG = clamp(Number(input.massG ?? DEFAULT_SHOT.massG), 0.12, 0.88);
  const massKg = massG / 1000;
  const energyJ = clamp(Number(input.energyJ ?? DEFAULT_SHOT.energyJ), 0.01, 10);
  const velocityMps = input.velocityMps != null
    ? clamp(Number(input.velocityMps), 1, 300)
    : velocityFromEnergy(massKg, energyJ);
  const diameterM = clamp(Number(input.diameterMm ?? DEFAULT_SHOT.diameterMm), 5.85, 6.1) / 1000;
  const radiusM = diameterM / 2;
  const legacyHopPercent = input.hopPercent == null ? null : Math.max(0, Number(input.hopPercent) || 0);
  const requestedRpm = input.initialRpm == null
    ? (legacyHopPercent == null
      ? DEFAULT_SHOT.initialRpm
      : ATP.referenceSpinRatio * legacyHopPercent / 100 * velocityMps / radiusM * 60 / (2 * Math.PI))
    : Number(input.initialRpm);
  const initialRpm = Math.max(0, Number.isFinite(requestedRpm) ? requestedRpm : DEFAULT_SHOT.initialRpm);
  const initialOmega = initialRpm * 2 * Math.PI / 60;
  const initialSpinRatio = initialOmega * radiusM / velocityMps;
  const hopPercent = initialSpinRatio / ATP.referenceSpinRatio * 100;

  return {
    massG,
    massKg,
    energyJ: energyFromVelocity(massKg, velocityMps),
    velocityMps,
    diameterMm: diameterM * 1000,
    diameterM,
    radiusM,
    areaM2: Math.PI * radiusM ** 2,
    // Angle du canon par rapport à l'horizontale, appliqué directement au tir.
    angleDeg: clamp(Number(input.angleDeg ?? DEFAULT_SHOT.angleDeg), -10, 35),
    shootingHeightM: clamp(Number(input.shootingHeightM ?? DEFAULT_SHOT.shootingHeightM), 0.1, 3),
    scopeHeightM: clamp(Number(input.scopeHeightM ?? DEFAULT_SHOT.scopeHeightM), 0, 0.2),
    zeroDistanceM: clamp(Number(input.zeroDistanceM ?? DEFAULT_SHOT.zeroDistanceM), 5, 150),
    hopPercent,
    initialSpinRatio,
    initialOmega,
    initialRpm,
    temperatureC: clamp(Number(input.temperatureC ?? DEFAULT_SHOT.temperatureC), -30, 55),
    pressureHpa: clamp(Number(input.pressureHpa ?? DEFAULT_SHOT.pressureHpa), 700, 1100),
    latitudeDeg: clamp(Number(input.latitudeDeg ?? DEFAULT_SHOT.latitudeDeg), -90, 90),
    windSpeedKmh: clamp(Number(input.windSpeedKmh ?? DEFAULT_SHOT.windSpeedKmh), 0, 100),
    windAngleDeg: ((Number(input.windAngleDeg ?? DEFAULT_SHOT.windAngleDeg) % 360) + 360) % 360,
    cantDeg: clamp(Number(input.cantDeg ?? DEFAULT_SHOT.cantDeg), -90, 90),
    dt: clamp(Number(input.dt ?? ATP.integrationStepS), 0.00025, 0.005),
  };
}

function windVector(config) {
  const speed = config.windSpeedKmh / 3.6;
  const angle = degToRad(config.windAngleDeg);
  // Convention UI : 0° = vent de face, 90° = vent venant de droite.
  return {
    x: -Math.cos(angle) * speed,
    y: 0,
    z: -Math.sin(angle) * speed,
  };
}

function cross(ax, ay, az, bx, by, bz) {
  return {
    x: ay * bz - az * by,
    y: az * bx - ax * bz,
    z: ax * by - ay * bx,
  };
}

function derivatives(state, context) {
  const { config, rho, gravity, wind } = context;
  const relX = state.vx - wind.x;
  const relY = state.vy - wind.y;
  const relZ = state.vz - wind.z;
  const relativeSpeed = Math.hypot(relX, relY, relZ);

  if (!(relativeSpeed > 1e-8)) {
    return { x: state.vx, y: state.vy, z: state.vz, vx: 0, vy: -gravity, vz: 0, omega: 0 };
  }

  const reynolds = config.diameterM * rho * relativeSpeed / ATP.dynamicViscosity;
  const spinRatio = Math.abs(state.omega) * config.radiusM / relativeSpeed;
  const cd = dragCoefficient(spinRatio, reynolds);
  const cl = liftCoefficient(spinRatio);
  const dragForce = dragForceMagnitude(cd, rho, config.areaM2, relativeSpeed);
  // ATP emploie Cl × rho × A × V² pour Magnus, sans le facteur 1/2 de la traînée.
  const liftForce = magnusForceMagnitude(cl, rho, config.areaM2, relativeSpeed);

  const dragScale = -dragForce / (config.massKg * relativeSpeed);
  const dragX = dragScale * relX;
  const dragY = dragScale * relY;
  const dragZ = dragScale * relZ;

  const cant = degToRad(config.cantDeg);
  const spinY = -Math.sin(cant) * state.omega;
  const spinZ = Math.cos(cant) * state.omega;
  const liftVector = cross(0, spinY, spinZ, relX, relY, relZ);
  const liftNorm = Math.hypot(liftVector.x, liftVector.y, liftVector.z);
  const liftScale = liftNorm > 1e-10
    ? liftForce / (config.massKg * liftNorm)
    : 0;

  const accelerationX = dragX + liftVector.x * liftScale;
  const accelerationY = dragY + liftVector.y * liftScale - gravity;
  const accelerationZ = dragZ + liftVector.z * liftScale;
  const relativeSpeedDerivative = (
    relX * accelerationX + relY * accelerationY + relZ * accelerationZ
  ) / relativeSpeed;
  const spinRatioDerivative = plottedSpinRatioDerivative(spinRatio);
  const omegaDerivative = (
    spinRatioDerivative * relativeSpeed + spinRatio * relativeSpeedDerivative
  ) / config.radiusM;

  return {
    x: state.vx,
    y: state.vy,
    z: state.vz,
    vx: accelerationX,
    vy: accelerationY,
    vz: accelerationZ,
    omega: state.omega > 0 ? omegaDerivative : 0,
  };
}

function combine(state, derivative, scale) {
  return {
    x: state.x + derivative.x * scale,
    y: state.y + derivative.y * scale,
    z: state.z + derivative.z * scale,
    vx: state.vx + derivative.vx * scale,
    vy: state.vy + derivative.vy * scale,
    vz: state.vz + derivative.vz * scale,
    omega: Math.max(0, state.omega + derivative.omega * scale),
  };
}

function rk4Step(state, dt, context) {
  const k1 = derivatives(state, context);
  const k2 = derivatives(combine(state, k1, dt / 2), context);
  const k3 = derivatives(combine(state, k2, dt / 2), context);
  const k4 = derivatives(combine(state, k3, dt), context);
  return {
    x: state.x + dt * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
    y: state.y + dt * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6,
    z: state.z + dt * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6,
    vx: state.vx + dt * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx) / 6,
    vy: state.vy + dt * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy) / 6,
    vz: state.vz + dt * (k1.vz + 2 * k2.vz + 2 * k3.vz + k4.vz) / 6,
    omega: Math.max(0, state.omega + dt * (k1.omega + 2 * k2.omega + 2 * k3.omega + k4.omega) / 6),
  };
}

function outputPoint(state, time, config, rho, wind) {
  const speed = Math.hypot(state.vx, state.vy, state.vz);
  const relativeSpeed = Math.hypot(
    state.vx - wind.x,
    state.vy - wind.y,
    state.vz - wind.z,
  );
  const spinRatio = relativeSpeed > 0 ? state.omega * config.radiusM / relativeSpeed : 0;
  const reynolds = config.diameterM * rho * Math.max(relativeSpeed, 0.01) / ATP.dynamicViscosity;
  return {
    x: state.x,
    // L'intégrateur interpole exactement l'impact : aucun point n'est produit sous le sol.
    y: state.y,
    z: state.z,
    time,
    speedMps: speed,
    fps: mpsToFps(speed),
    energyJ: energyFromVelocity(config.massKg, speed),
    rpm: state.omega * 60 / (2 * Math.PI),
    spinRatio,
    cd: dragCoefficient(spinRatio, reynolds),
    cl: liftCoefficient(spinRatio),
  };
}

function integrateTrajectory(config, sampleEvery = ATP.sampleEvery) {
  const angle = degToRad(config.angleDeg);
  const rho = airDensity(config.temperatureC, config.pressureHpa);
  const gravity = gravityAtLatitude(config.latitudeDeg);
  const context = { config, rho, gravity, wind: windVector(config) };
  const dt = config.dt;
  const maxIterations = Math.ceil(ATP.maxTimeS / dt);

  let state = {
    x: 0,
    y: config.shootingHeightM,
    z: 0,
    vx: config.velocityMps * Math.cos(angle),
    vy: config.velocityMps * Math.sin(angle),
    vz: 0,
    omega: config.initialOmega,
  };
  let time = 0;
  const points = [outputPoint(state, time, config, rho, context.wind)];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const previous = state;
    state = rk4Step(state, dt, context);
    time += dt;

    const hitGround = state.y <= 0 && time > dt;
    if (hitGround) {
      const fraction = previous.y / Math.max(previous.y - state.y, 1e-12);
      state = {
        ...state,
        x: previous.x + (state.x - previous.x) * fraction,
        y: 0,
        z: previous.z + (state.z - previous.z) * fraction,
        vx: previous.vx + (state.vx - previous.vx) * fraction,
        vy: previous.vy + (state.vy - previous.vy) * fraction,
        vz: previous.vz + (state.vz - previous.vz) * fraction,
        omega: previous.omega + (state.omega - previous.omega) * fraction,
      };
      time -= dt * (1 - fraction);
    }

    if (iteration % sampleEvery === 0 || hitGround) {
      points.push(outputPoint(state, time, config, rho, context.wind));
    }

    if (
      hitGround
      || state.x >= ATP.maxRangeM
      || state.x < -1
      || !Number.isFinite(state.x + state.y + state.z + state.omega)
    ) break;
  }

  return {
    config,
    atmosphere: { densityKgM3: rho, gravityMps2: gravity },
    points,
  };
}

export function simulateTrajectory(input = {}) {
  const config = normalizeShot(input);
  return integrateTrajectory(config);
}

function flatShotAtRpm(input, initialRpm, envelopeM) {
  const simulation = simulateTrajectory({
    ...input,
    initialRpm,
    angleDeg: 0,
    shootingHeightM: 3,
    windSpeedKmh: 0,
    cantDeg: 0,
  });
  const muzzleHeight = simulation.points[0].y;
  let flatRangeM = 0;
  let exitDirection = -1;

  for (const point of simulation.points) {
    const deviationM = point.y - muzzleHeight;
    if (Math.abs(deviationM) <= envelopeM) {
      flatRangeM = point.x;
      continue;
    }
    if (point.x > 1) {
      exitDirection = Math.sign(deviationM) || -1;
      break;
    }
  }

  return { initialRpm, flatRangeM, exitDirection };
}

/**
 * Cherche le spin qui maximise le tir tendu ATP autour de la hauteur de bouche.
 * La dichotomie localise la frontiere entre une sortie basse et une sortie haute,
 * puis compare les valeurs voisines au pas affiche par l'interface.
 */
export function findFlatSpin(input = {}, options = {}) {
  const envelopeM = Math.max(0.01, Number(options.envelopeM) || ATP.usefulEnvelopeM);
  const incrementRpm = Math.max(1, Math.round(Number(options.incrementRpm) || 250));
  const config = normalizeShot(input);
  const rpmForRatio = (ratio) => ratio * config.velocityMps / config.radiusM * 60 / (2 * Math.PI);

  let lowerRpm = 0;
  let upperRpm = rpmForRatio(0.75);
  let upperShot = flatShotAtRpm(config, upperRpm, envelopeM);
  for (let attempt = 0; attempt < 4 && upperShot.exitDirection <= 0; attempt += 1) {
    upperRpm *= 1.5;
    upperShot = flatShotAtRpm(config, upperRpm, envelopeM);
  }

  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middleRpm = (lowerRpm + upperRpm) / 2;
    const middleShot = flatShotAtRpm(config, middleRpm, envelopeM);
    if (middleShot.exitDirection > 0) upperRpm = middleRpm;
    else lowerRpm = middleRpm;
  }

  const centerRpm = Math.round(((lowerRpm + upperRpm) / 2) / incrementRpm) * incrementRpm;
  const candidates = [-2, -1, 0, 1, 2]
    .map((offset) => Math.max(0, centerRpm + offset * incrementRpm))
    .map((initialRpm) => flatShotAtRpm(config, initialRpm, envelopeM));
  candidates.sort((left, right) => (
    right.flatRangeM - left.flatRangeM || left.initialRpm - right.initialRpm
  ));

  return {
    ...candidates[0],
    incrementRpm,
    envelopeM,
  };
}

export function pointAtDistance(points, distanceM) {
  if (!points?.length) return null;
  const distance = Number(distanceM);
  if (distance <= points[0].x) return { ...points[0] };
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    if (current.x >= distance) {
      const previous = points[index - 1];
      const ratio = (distance - previous.x) / Math.max(current.x - previous.x, 1e-9);
      const result = {};
      for (const key of Object.keys(current)) {
        result[key] = typeof current[key] === 'number'
          ? previous[key] + (current[key] - previous[key]) * ratio
          : current[key];
      }
      return result;
    }
  }
  return null;
}

export function sightModel(simulation) {
  const { config, points } = simulation;
  const originY = config.shootingHeightM + config.scopeHeightM;
  const zeroPoint = pointAtDistance(points, config.zeroDistanceM);
  // Le zérotage incline la ligne de visée, jamais le canon ni la trajectoire.
  const angleRad = zeroPoint
    ? Math.atan2(zeroPoint.y - originY, config.zeroDistanceM)
    : degToRad(config.angleDeg);
  return {
    originY,
    angleRad,
    angleDeg: angleRad * 180 / Math.PI,
    zeroDistanceM: config.zeroDistanceM,
    zeroResolved: Boolean(zeroPoint),
    yAt(distanceM) {
      return originY + Math.tan(angleRad) * distanceM;
    },
  };
}

export function analyzeTrajectory(simulation) {
  const { points, config } = simulation;
  if (!points.length) return null;
  const sight = sightModel(simulation);
  let apex = points[0];
  let usefulRangeM = 0;
  let envelopeBroken = false;
  let oneJouleDistanceM = config.energyJ <= 1 ? 0 : null;

  for (const point of points) {
    if (point.y > apex.y) apex = point;
    const deviation = point.y - sight.yAt(point.x);
    if (!envelopeBroken && Math.abs(deviation) <= ATP.usefulEnvelopeM) {
      usefulRangeM = point.x;
    } else if (point.x > 1) {
      envelopeBroken = true;
    }
    if (oneJouleDistanceM == null && point.energyJ <= 1) oneJouleDistanceM = point.x;
  }

  const last = points[points.length - 1];
  const at30 = pointAtDistance(points, 30);
  const at50 = pointAtDistance(points, 50);
  const at60 = pointAtDistance(points, 60);
  return {
    maximumRangeM: last.x,
    usefulRangeM,
    flightTimeS: last.time,
    apexHeightM: apex.y,
    apexDistanceM: apex.x,
    oneJouleDistanceM,
    time30S: at30?.time ?? null,
    time50S: at50?.time ?? null,
    energy30J: at30?.energyJ ?? null,
    energy50J: at50?.energyJ ?? null,
    energy60J: at60?.energyJ ?? null,
    drift50M: at50?.z ?? null,
    remainingFps50: at50?.fps ?? null,
    sight: {
      originY: sight.originY,
      angleRad: sight.angleRad,
      angleDeg: sight.angleDeg,
      zeroDistanceM: sight.zeroDistanceM,
      zeroResolved: sight.zeroResolved,
    },
  };
}

export function holdoverTable(simulation, distances = [10, 20, 30, 40, 50, 60, 70, 80]) {
  const sight = sightModel(simulation);
  return distances.map((distanceM) => {
    const point = pointAtDistance(simulation.points, distanceM);
    if (!point) return null;
    const deviationM = point.y - sight.yAt(distanceM);
    return {
      distanceM,
      deviationCm: deviationM * 100,
      correctionMrad: distanceM > 0 ? -deviationM / distanceM * 1000 : 0,
      energyJ: point.energyJ,
      timeS: point.time,
      driftCm: point.z * 100,
      rpm: point.rpm,
    };
  }).filter(Boolean);
}
