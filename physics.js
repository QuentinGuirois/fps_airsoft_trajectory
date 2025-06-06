export function computeCl(omega, Vbb, rho_air, radius) {
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

export function computeCd(omega, Vbb, rho_air, radius, mu) {
  if (Vbb === 0) return 0;
  const ratio = (omega * radius) / Vbb;
  const reynolds = (2 * radius * rho_air * Vbb) / mu;

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

export function computeTorque(omega, radius, rho_air, airViscosity) {
  // Calcul du nombre de Reynolds rotationnel
  const ReOmega = (rho_air * Math.abs(omega) * Math.pow(radius, 2)) / airViscosity;

  let torque;
  if (ReOmega < 1) {
    // Régime Stokes (laminaire)
    torque = 8 * Math.PI * airViscosity * Math.pow(radius, 3) * omega;
  } else {
    // Régime turbulent (Mackila/empirique)
    const CtVal = 6.45 / Math.sqrt(ReOmega) + 32.1 / ReOmega;
    torque = 0.5 * rho_air * CtVal * Math.pow(radius, 5) * omega * Math.abs(omega);
  }
  return torque;
}
