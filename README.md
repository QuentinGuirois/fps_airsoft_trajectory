# FPS Airsoft Trajectory Calculator

This project provides a web-based tool to simulate the trajectory of an airsoft BB. The calculation is performed in `trajectory.worker.js` using a simplified model of drag, lift and spin decay.

## Physics Model

The motion of the BB is updated every `dt` seconds (default `0.0001`). A BB of mass `m` and radius `r` experiences gravity, aerodynamic drag, lift due to the hop-up induced backspin, and gradual decay of that spin.

### Drag
The drag force is computed using the standard quadratic form

```
F_drag = 0.5 * rho * C_d * A * V^2
```
where `rho` is the air density, `A = πr^2` the cross-sectional area and `V` the speed of the BB. The drag coefficient `C_d` depends on the Reynolds number and the spin ratio:

```
ratio = (ω * r) / V
Re = (2 * r * rho * V) / μ
```
`computeCd` in `trajectory.worker.js` evaluates a rational polynomial in `ratio` and `Re` to approximate experimental values【F:trajectory.worker.js†L43-L79】.

### Lift
Lift due to backspin uses an analogous formula

```
F_lift = 0.5 * rho * C_l * A * V^2
```
with `C_l` obtained from another rational polynomial in the spin ratio【F:trajectory.worker.js†L23-L41】. To prevent unrealistic behaviour, the code caps the magnitude of the lift force to five times the BB weight【F:trajectory.worker.js†L129-L133】.

### Spin Decay
Backspin decreases over time due to air friction. The torque applied to the spinning BB is

```
T = computeTorque(ω, r, rho, μ) * 10
```
`computeTorque` switches between laminar and turbulent regimes based on the rotational Reynolds number and returns an empirical expression derived from mackila.com's studies【F:trajectory.worker.js†L82-L89】. The factor of `10` is an empirical scaling used to match observed spin decay rates. Angular acceleration is then `α = -T/I` where `I = (2/5) m r^2`.

### Motion Update
The velocities are updated each step via

```
ax = F_drag_x / m
ay = (F_drag_y + F_lift) / m - g
```
The spin `ω` is updated using `α` and never allowed to drop below zero【F:trajectory.worker.js†L137-L155】.

## Reference Sources
- [mackila.com - Airsoft Trajectory Project](https://mackila.com/airsoft/ATP/)
- Standard fluid dynamics relations for drag and lift.
- The following acknowledgement appears in `index.html`:

> pour avoir contribué directement, et indirectement à ce projet. Mention spéciale à mackila.com,
> un passionné resté longtemps dans l'ombre mais qui a révolutionné notre univers. Merci à lui, au nom de tous.tes.【F:index.html†L483-L495】

## Empirical Constants
Several parameters can be tuned by editing `trajectory.worker.js`:
- `omegaBase = 25000`: initial spin in rad/s applied when hop‑up is at 100 %. Lower `hopUpPercentage` scales this value linearly.
- `maxLift = 5 * weight`: cap on lift force to avoid unrealistic curves.
- `torque * 10`: scaling factor controlling how quickly spin decays; reduce to make spin last longer or increase for faster decay.
- `defaultDt`: integration time step.

Adjusting these values allows experimenting with different behaviours without touching the rest of the code.
