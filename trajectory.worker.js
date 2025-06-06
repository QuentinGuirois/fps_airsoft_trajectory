import { decimate } from './util.js';
import { computeCl, computeCd, computeTorque } from './physics.js';

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
// computeCl, computeCd et computeTorque sont importées depuis physics.js

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

  const omegaBase = 170000;
  let omega = omegaBase * (hopUpPercentage / 100) * (2 * Math.PI / 60);
  const momentOfInertia = (2 / 5) * mass * (radius ** 2);

  let time = 0;
  const positions = [];

  for (let iter = 0; iter < 100000; iter++) {
    if (y < 0) break;

    const velocity = Math.hypot(velocityX, velocityY);
    if (!velocity) break;

    const Cl = computeCl(omega, velocity, rho_air, radius);
    const Cd = computeCd(omega, velocity, rho_air, radius, airViscosity);
    const dragForce = 0.5 * rho_air * Cd * area * velocity * velocity;
    let liftForce = 0.5 * rho_air * Cl * area * velocity * velocity;
    const weight = mass * g;

    const maxLift = 100 * weight;
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

    const torque = computeTorque(omega, radius, rho_air, airViscosity);
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