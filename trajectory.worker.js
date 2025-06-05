import { decimate } from './util.js';

/* ---------- Constantes Physiques ---------- */
const g = 9.81;
const diameter = 0.00595;
const radius = diameter / 2;
const area = Math.PI * radius * radius;
const airViscosity = 1.81e-5;
const defaultDt = 0.0001;
const R_specific = 287.058;

/* ---------- Conversions ---------- */
function fpsToMetersPerSecond(fps) { return fps * 0.3048; }
function metersPerSecondToFPS(mps) { return mps / 0.3048; }
function calculateEnergy(massKg, velocityMps) { return 0.5 * massKg * velocityMps * velocityMps; }
function calculateAirDensity(tempC, pHpa) {
  const T = tempC + 273.15;
  const p = pHpa * 100;
  return p / (R_specific * T);
}

/* ---------- Coefficients aerodynamiques ---------- */
function computeCl(omega, Vbb, rho_air) {
  if (Vbb === 0) return 0;
  const ratio = (omega * radius) / Vbb;
  let numerator = (
    -0.0020907
    - 0.208056226 * ratio
    + 0.768791456 * ratio ** 2
    - 0.84865215 * ratio ** 3
    + 0.75365982 * ratio ** 4
  );
  let denominator = (
    1
    - 4.82629033 * ratio
    + 9.95459464 * ratio ** 2
    - 7.85649742 * ratio ** 3
    + 3.273765328 * ratio ** 4
  );
  return numerator / denominator;
}

function computeCd(omega, Vbb, rho_air) {
  if (Vbb === 0) return 0;
  const ratio = (omega * radius) / Vbb;
  const reynolds = (2 * radius * rho_air * Vbb) / airViscosity;

  let num_o = (
    0.4274794
    + 0.000001146254 * reynolds
    - 7.559635e-12 * (reynolds ** 2)
    - 3.817309e-18 * (reynolds ** 3)
    + 2.389417e-23 * (reynolds ** 4)
  );
  let den_o = (
    1
    - 0.000002120623 * reynolds
    + 2.952772e-11 * (reynolds ** 2)
    - 1.914687e-16 * (reynolds ** 3)
    + 3.125996e-22 * (reynolds ** 4)
  );
  const C_drag_o = num_o / den_o;

  let numerator = (
    C_drag_o
    + 2.2132291 * ratio
    - 10.345178 * ratio ** 2
    + 16.157030 * ratio ** 3
    - 5.27306480 * ratio ** 4
  );
  let denominator = (
    1
    + 3.1077276 * ratio
    - 13.6598678 * ratio ** 2
    + 24.00539887 * ratio ** 3
    - 8.340493152 * ratio ** 4
    + 0.07910093 * ratio ** 5
  );
  return numerator / denominator;
}

function computeTorque(omega, radius, rho_air, mu) {
  const ReOmega = (rho_air * Math.abs(omega) * (radius ** 2)) / mu;
  if (ReOmega < 1) {
    return 8 * Math.PI * mu * (radius ** 3) * omega;
  } else {
    let CtVal = 6.45 / Math.sqrt(ReOmega) + 32.1 / ReOmega;
    return 0.5 * CtVal * rho_air * (radius ** 5) * omega * Math.abs(omega);
  }
}

/* ---------- Trajectoire ---------- */
function calculateTrajectory2D(fps, poidsGr, angleDeg, params) {
  const {
    hopUpPercentage = 49,
    pressureHpa = 1020,
    temperatureCelsius = 20,
    dt = defaultDt
  } = params || {};

  const initialSpeed = fpsToMetersPerSecond(fps);
  const mass = poidsGr / 1000;
  const angleRad = angleDeg * Math.PI / 180;

  let x = 0;
  let y = params.shootingHeight ?? 1.5;
  let velocityX = initialSpeed * Math.cos(angleRad);
  let velocityY = initialSpeed * Math.sin(angleRad);

  const rho_air = calculateAirDensity(temperatureCelsius, pressureHpa);

  const omegaBase = 25000;
  let omega = omegaBase * (hopUpPercentage / 100);
  const momentOfInertia = (2 / 5) * mass * (radius ** 2);

  let time = 0;
  const positions = [];

  for (let iter = 0; iter < 100000; iter++) {
    if (y < 0) break;

    const velocity = Math.hypot(velocityX, velocityY);
    if (!velocity) break;

    const Cl = computeCl(omega, velocity, rho_air);
    const Cd = computeCd(omega, velocity, rho_air);
    const dragForce = 0.5 * rho_air * Cd * area * velocity * velocity;
    let liftForce = 0.5 * rho_air * Cl * area * velocity * velocity;
    const weight = mass * g;

    const maxLift = 5 * weight;
    if (Math.abs(liftForce) > maxLift) liftForce = maxLift * Math.sign(liftForce);

    const v_unit_x = velocityX / velocity;
    const v_unit_y = velocityY / velocity;

    const F_dragX = -dragForce * v_unit_x;
    const F_dragY = -dragForce * v_unit_y;
    const ax = (F_dragX) / mass;
    const ay = (F_dragY + liftForce) / mass - g;

    velocityX += ax * dt;
    velocityY += ay * dt;
    x += velocityX * dt;
    y += velocityY * dt;

    const energy = calculateEnergy(mass, velocity);
    const fpsVal = metersPerSecondToFPS(velocity);
    const spinRPM = (omega / (2 * Math.PI)) * 60;
    positions.push({ x, y, energy, fps: fpsVal, time, spin: spinRPM });

    const torque = computeTorque(omega, radius, rho_air, airViscosity) * 10;
    const alpha = -torque / momentOfInertia;
    omega = Math.max(0, omega + alpha * dt);

    time += dt;
    if (y <= 0) {
      positions[positions.length - 1].y = 0;
      break;
    }
    if (time > 5 && velocity < 0.1) break;
  }

  return positions;
}

/* ---------- Worker API ---------- */
self.onmessage = (e) => {
  if (e.data?.type !== 'calcTraj') return;
  try {
    const { fps, poids, angleDeg, physParams } = e.data;
    const raw = calculateTrajectory2D(fps, poids, angleDeg, physParams);
    // Decimation avant return
    const positions = decimate(raw, 10);
    self.postMessage({ ok: true, positions });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};