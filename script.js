
import { decimate, debounce } from './util.js';
import { computeCl, computeCd, computeTorque } from './physics.js';
const Plotly = window.Plotly; 
const trajWorker = new Worker('./trajectory.worker.js', { type: 'module' });
let workerBusy = false;


function FAT_init(){
  
    // ---------------------------------------------------------------------
    // Constantes, variables globales
    // ---------------------------------------------------------------------
    const g = 9.81;
    const diameter = 0.00595;
    const radius = diameter / 2;
    const area = Math.PI * (radius ** 2);
    const airViscosity = 1.81e-5;
    const dt = 0.0001;
    const R_specific = 287.058;
  
    let shootingAngle = 0;
    let scopeAngleDelta = 0;
    let pressureHpa = 1020;
    let temperatureCelsius = 20;
    let hopUpPercentage = 60;
    let shootingHeight = 1.5;
    let scopeOffset = 0.05; // 5 cm
  
    let savedCurves = [];
    let isUpdating = false;
  
    // ---------------------------------------------------------------------
    // Sélection des éléments du DOM
    // ---------------------------------------------------------------------
    const bbWeightInput = document.getElementById('bbWeight');
    const bbVelocityInput = document.getElementById('bbVelocity');
    const bbEnergyInput = document.getElementById('bbEnergy');
    const shootingHeightInput = document.getElementById('shootingHeight');
    const scopeOffsetInput = document.getElementById('scopeOffset');
  
    // Angle de tir
    const anglePlusButton = document.getElementById('anglePlus');
    const angleMinusButton = document.getElementById('angleMinus');
    const angleDisplay = document.getElementById('angleDisplay');
  
    // Angle lunette
    const scopeAnglePlusButton = document.getElementById('scopeAnglePlus');
    const scopeAngleMinusButton = document.getElementById('scopeAngleMinus');
    const scopeAngleDisplay = document.getElementById('scopeAngleDisplay');
  
    // Hop-up
    const hopupPlusButton = document.getElementById('hopupPlus');
    const hopupMinusButton = document.getElementById('hopupMinus');
    const hopupDisplay = document.getElementById('hopupDisplay');
    const hopupBar = document.getElementById('hopupBar');
  
    // Pression / Température
    const pressurePlusButton = document.getElementById('pressurePlus');
    const pressureMinusButton = document.getElementById('pressureMinus');
    const pressureDisplay = document.getElementById('pressureDisplay');
  
    const temperaturePlusButton = document.getElementById('temperaturePlus');
    const temperatureMinusButton = document.getElementById('temperatureMinus');
    const temperatureDisplay = document.getElementById('temperatureDisplay');
  
    // Affichage canon / lunette
    const showCanonLineCheckbox = document.getElementById('showCanonLine');
    const showScopeLineCheckbox = document.getElementById('showScopeLine');
  
    // Boutons action
    const saveCurveButton = document.getElementById('saveCurve');
    const resetCurvesButton = document.getElementById('resetCurves');
    const shareButton = document.getElementById('shareButton');
    const shareLinkContainer = document.getElementById('shareLinkContainer');
  
    // Zones de résultat
    const resultInfoDiv = document.getElementById('resultInfo');
    const engagementInfoDiv = document.getElementById('engagementInfo');
  
    // Tableaux
    const timeComparisonTableContainer = document.getElementById('timeComparisonTableContainer');
    const energyComparisonTableContainer = document.getElementById('energyComparisonTableContainer');
    const holdoverTableBody = document.getElementById('holdoverTableBody');
  
    // Conteneurs Plotly + onglets
    const trajectory2D = document.getElementById('trajectory2D');
    const timeChart = document.getElementById('timeChart');
    const impactChart = document.getElementById('impactChart');
    const spinChart = document.getElementById('spinChart');
  
    const trajectoryTab = document.getElementById('trajectoryTab');
    const timeTab = document.getElementById('timeTab');
    const energyTab = document.getElementById('energyTab');
    const spinTab = document.getElementById('spinTab');
  
    const trajectoryChartContainer = document.getElementById('trajectoryChartContainer');
    const timeChartContainer = document.getElementById('timeChartContainer');
    const impactChartContainer = document.getElementById('impactChartContainer');
    const spinChartContainer = document.getElementById('spinChartContainer');
  
    // ────────────────────────────────────────────────────────────────────
  // Config et layouts Plotly pour renderSavedCurvesOnly
  // ────────────────────────────────────────────────────────────────────
  const plotConfig = {
    displayModeBar: false,
    scrollZoom: false,
    responsive: true
  };
  const trajectoryLayout = {
    dragmode: false,
    hovermode: 'closest',
    paper_bgcolor: '#1F2937',
    plot_bgcolor: '#1F2937',
    legend: {
      orientation: 'h',
      xanchor: 'center',
      x: 0.5,
      y: -0.2,
      font: { color: 'white', size: 9 }
    },
    margin: { l: 40, r: 20, b: 60, t: 40 },
    xaxis: { title: 'Distance X (m)', color: 'white', gridcolor: '#444' },
    yaxis: {
      title: 'Hauteur Y (m)',
      color: 'white',
      gridcolor: '#444',
      scaleanchor: 'x',
      scaleratio: 2
    }
  };
  const timeLayout = {
    dragmode: false,
    hovermode: 'closest',
    paper_bgcolor: '#1F2937',
    plot_bgcolor: '#1F2937',
    legend: {
      orientation: 'h',
      xanchor: 'center',
      x: 0.5,
      y: -0.2,
      font: { color: 'white', size: 9 }
    },
    margin: { l: 40, r: 20, b: 60, t: 40 },
    xaxis: { title: 'Distance (m)', color: 'white', gridcolor: '#444' },
    yaxis: { title: 'Temps (s)', color: 'white', gridcolor: '#444' }
  };
  const impactLayout = {
    dragmode: false,
    hovermode: 'closest',
    paper_bgcolor: '#1F2937',
    plot_bgcolor: '#1F2937',
    legend: {
      orientation: 'h',
      xanchor: 'center',
      x: 0.5,
      y: -0.2,
      font: { color: 'white', size: 9 }
    },
    margin: { l: 40, r: 20, b: 60, t: 40 },
    xaxis: { title: 'Distance (m)', color: 'white', gridcolor: '#444' },
    yaxis: { title: 'Énergie (J)', color: 'white', gridcolor: '#444' }
  };
  const spinLayout = {
    dragmode: false,
    hovermode: 'closest',
    paper_bgcolor: '#1F2937',
    plot_bgcolor: '#1F2937',
    legend: {
      orientation: 'h',
      xanchor: 'center',
      x: 0.5,
      y: -0.2,
      font: { color: 'white', size: 9 }
    },
    margin: { l: 40, r: 20, b: 60, t: 40 },
    xaxis: { title: 'Distance (m)', color: 'white', gridcolor: '#444' },
    yaxis: { title: 'Rotation (rpm)', color: 'white', gridcolor: '#444' }
  };
  
    // ---------------------------------------------------------------------
    // Fonctions utilitaires / conversions
    // ---------------------------------------------------------------------
    function fpsToMetersPerSecond(fps) {
      return fps * 0.3048;
    }
    function metersPerSecondToFPS(mps) {
      return mps / 0.3048;
    }
    function calculateEnergy(massKg, velocityMps) {
      return 0.5 * massKg * velocityMps * velocityMps;
    }
    function calculateVelocityFromEnergy(energyJ, massKg) {
      return Math.sqrt((2 * energyJ) / massKg);
    }
    function calculateAirDensity(tempC, pHpa) {
      const T = tempC + 273.15;
      const p = pHpa * 100;
      return p / (R_specific * T);
    }
  
    function getScopeAngleDeg() {
      return shootingAngle + scopeAngleDelta;
    }
  
    // ---------------------------------------------------------------------
    // Affichages
    // ---------------------------------------------------------------------
    function updateAngleDisplay() {
      angleDisplay.textContent = shootingAngle.toFixed(1) + '°';
    }
    function updateScopeAngleDisplay() {
      scopeAngleDisplay.textContent = scopeAngleDelta.toFixed(1) + '°';
    }
    function updateHopupDisplay() {
      hopupDisplay.textContent = hopUpPercentage.toFixed(2) + '%';
      if (hopupBar) {
        hopupBar.style.width = hopUpPercentage + '%';
      }
    }
    function updatePressureDisplay() {
      pressureDisplay.textContent = pressureHpa + ' hPa';
    }
    function updateTemperatureDisplay() {
      temperatureDisplay.textContent = temperatureCelsius + ' °C';
    }
  
    // ---------------------------------------------------------------------
    // Fonctions de calcul (Magnus, drag, etc.) - importées depuis physics.js
    // ---------------------------------------------------------------------
  
    // ---------------------------------------------------------------------
    // Trajectoire
    // ---------------------------------------------------------------------
    function calculateTrajectory2D(fps, poidsGr, angleDeg) {
      const initialSpeed = fpsToMetersPerSecond(fps);
      const mass = poidsGr / 1000;
      const angleRad = angleDeg * Math.PI / 180;
  
      let x = 0;
      let y = shootingHeight;
      let velocityX = initialSpeed * Math.cos(angleRad);
      let velocityY = initialSpeed * Math.sin(angleRad);
  
      const rho_air = calculateAirDensity(temperatureCelsius, pressureHpa);
  
      const omegaBase = 170000; // RPM
      let omega = omegaBase * (hopUpPercentage / 100) * (2 * Math.PI / 60); // rad/s
      const momentOfInertia = (2 / 5) * mass * (radius ** 2);
  
      let time = 0;
      let positions = [];
  
      for (let iter = 0; iter < 100000; iter++) {
        if (y < 0) break;
  
        const velocity = Math.sqrt(velocityX ** 2 + velocityY ** 2);
        if (velocity === 0) break;
  
        let Cl = computeCl(omega, velocity, rho_air, radius);
        let Cd = computeCd(omega, velocity, rho_air, radius, airViscosity);
        const dragForce = 0.5 * rho_air * Cd * area * velocity * velocity;
        let liftForce = 0.5 * rho_air * Cl * area * velocity * velocity;
        const weight = mass * g;
  
        // On limite la portance à 5x le poids
        const maxLift = 5 * weight;
        if (Math.abs(liftForce) > maxLift) {
          liftForce = maxLift * Math.sign(liftForce);
        }
  
        const v_unit_x = velocityX / velocity;
        const v_unit_y = velocityY / velocity;
  
        const F_dragX = -dragForce * v_unit_x;
        const F_dragY = -dragForce * v_unit_y;
        const F_liftX = 0;
        const F_liftY = liftForce;
  
        const ax = (F_dragX + F_liftX) / mass;
        const ay = ((F_dragY + F_liftY) / mass) - g;
  
        velocityX += ax * dt;
        velocityY += ay * dt;
        x += velocityX * dt;
        y += velocityY * dt;
  
        const energy = calculateEnergy(mass, velocity);
        const fpsVal = metersPerSecondToFPS(velocity);
        const spinRPM = (omega / (2 * Math.PI)) * 60;
        positions.push({ x, y, energy, fps: fpsVal, time, spin: spinRPM });
  
        let torqueScale = 10;
        let torque = computeTorque(omega, radius, rho_air, airViscosity) * torqueScale;
        let alpha = -torque / momentOfInertia;
        omega += alpha * dt;
        if (omega < 0) omega = 0;
  
        time += dt;
        if (y <= 0) {
          y = 0;
          positions[positions.length - 1].y = 0;
          break;
        }
        if (time > 5 && velocity < 0.1) {
          break;
        }
      }
      return positions;
    }
  
    function calculateRange(fps, poidsGr, angleDeg) {
      const pos = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const last = pos[pos.length - 1] || { x: 0 };
      return Math.round(Math.abs(last.x));
    }
  
    // ---------------------------------------------------------------------
    // Calculs temps / énergie
    // ---------------------------------------------------------------------
    function calculateTimesAtDistances(fps, poidsGr, angleDeg) {
      const positions = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const targetDistances = Array.from({ length: 17 }, (_, i) => i * 5); // 0..80
  
      let results = [];
      let idx = 0;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const dist = Math.abs(p.x);
        while (idx < targetDistances.length && dist >= targetDistances[idx]) {
          results.push({
            distance: targetDistances[idx],
            time: p.time,
            energy: p.energy
          });
          idx++;
        }
        if (idx >= targetDistances.length) break;
      }
      return results;
    }
  
    function calculateEnergyAtDistances(fps, poidsGr, angleDeg) {
      const positions = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const targets = Array.from({ length: 17 }, (_, i) => i * 5);
  
      let results = [];
      let idx = 0;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        while (idx < targets.length && p.x >= targets[idx]) {
          results.push({ distance: targets[idx], energy: p.energy });
          idx++;
        }
        if (idx >= targets.length) break;
      }
      return results;
    }
  
    function calculateEnergiesAtDistances(fps, poidsGr, angleDeg) {
      const pos = calculateTrajectory2D(fps, poidsGr, angleDeg);
      let engagementDistance = 0, foundEngagement = false;
      let ressentiDistance = 0, foundRessenti = false;
  
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        const dist = Math.abs(p.x);
        if (!foundEngagement && p.energy <= 1) {
          engagementDistance = dist;
          foundEngagement = true;
        }
        if (!foundRessenti && p.energy <= 0.15 && dist > 0) {
          ressentiDistance = dist;
          foundRessenti = true;
        }
      }
      return { engagementDistance, foundEngagement, ressentiDistance, foundRessenti };
    }
  
    // ---------------------------------------------------------------------
    // Traces Plotly (sans titre + couleurs “flashy”)
    // ---------------------------------------------------------------------
    const brightColors = [
      '#FF0000', '#00FF00', '#00FFFF', '#FFFF00', '#FF00FF', '#FFA500',
      '#FF1493', '#40E0D0', '#00BFFF', '#7CFC00'
    ];
    function getRandomColor() {
      return brightColors[Math.floor(Math.random() * brightColors.length)];
    }
  
    function build2DTraceSplit(dataPoints, mainColor, label) {
      let above = [], below = [];
      dataPoints.forEach(pt => {
        if (pt.energy >= 0.15) above.push(pt);
        else below.push(pt);
      });
  
      // Évite la discontinuité
      if (above.length && below.length) {
        const la = above[above.length - 1];
        const fb = below[0];
        if (Math.abs(la.x - fb.x) < 1e-9 && Math.abs(la.y - fb.y) < 1e-9) {
          below.shift();
        }
      }
  
      function makeText(p, isBelow) {
        let txt = `<b>${label}</b><br>`;
        if (isBelow) txt += `Impact <0.15J<br>`;
        txt += `Distance: ${p.x.toFixed(2)} m<br>`
          + `Hauteur: ${p.y.toFixed(2)} m<br>`
          + `Énergie: ${p.energy.toFixed(2)} J<br>`
          + `Spin: ${p.spin.toFixed(0)} rpm`;
        return txt;
      }
      function makeTrace(arr, color, showLegend) {
        if (!arr.length) return null;
        return {
          x: arr.map(p => p.x),
          y: arr.map(p => p.y),
          mode: 'lines',
          type: 'scattergl',
          showlegend: showLegend,
          name: label,
          line: { width: 1, color },
          text: arr.map(p => makeText(p, color === 'red')),
          hoverinfo: 'text'
        };
      }
  
      const tAbove = makeTrace(above, mainColor, true);
      const tBelow = makeTrace(below, 'red', false);
  
      let out = [];
      if (tAbove) out.push(tAbove);
      if (tBelow) out.push(tBelow);
      return out;
    }
  
    function buildCanonLineTrace(angleDeg, maxRange, label = 'Axe du canon') {
      const rad = angleDeg * Math.PI / 180;
      const N = 50, step = maxRange / (N - 1);
      let xArr = [], yArr = [];
      for (let i = 0; i < N; i++) {
        const d = i * step;
        xArr.push(d);
        yArr.push(shootingHeight + d * Math.tan(rad));
      }
      return {
        x: xArr,
        y: yArr,
        mode: 'lines',
        type: 'scattergl',
        name: label,
        line: { width: 1, dash: 'dash', color: 'grey' },
        hoverinfo: 'none'
      };
    }
    function buildScopeLineTrace(scopeOffsetM, scopeAngleDeg, maxRange, label = 'Axe de visée') {
      const rad = scopeAngleDeg * Math.PI / 180;
      const N = 50, step = maxRange / (N - 1);
      let xArr = [], yArr = [];
      for (let i = 0; i < N; i++) {
        const d = i * step;
        const yVal = (shootingHeight + scopeOffsetM) + d * Math.tan(rad);
        xArr.push(d);
        yArr.push(yVal);
      }
      return {
        x: xArr,
        y: yArr,
        mode: 'lines',
        type: 'scattergl',
        name: label,
        line: { width: 1, dash: 'dot', color: 'white' },
        hoverinfo: 'none'
      };
    }
  
    function findZeroingDistanceWithScopeLine(positions, scopeOffsetM, scopeAngleDeg) {
      let zeroDist = null;
      const rad = scopeAngleDeg * Math.PI / 180;
      function scopeLineY(x) {
        return (shootingHeight + scopeOffsetM) + x * Math.tan(rad);
      }
      for (let i = 1; i < positions.length; i++) {
        const p1 = positions[i - 1], p2 = positions[i];
        const ly1 = scopeLineY(p1.x), ly2 = scopeLineY(p2.x);
        const s1 = p1.y - ly1, s2 = p2.y - ly2;
        if (s1 * s2 < 0) {
          const ratio = Math.abs(s1) / (Math.abs(s1) + Math.abs(s2));
          zeroDist = p1.x + ratio * (p2.x - p1.x);
        }
      }
      return zeroDist;
    }
  
    function findUsefulRange(positions, minH = 1) {
      let maxX = 0;
      for (let i = 0; i < positions.length - 1; i++) {
        const p1 = positions[i], p2 = positions[i + 1];
        if (p1.y >= minH && p1.x > maxX) maxX = p1.x;
        if ((p1.y - minH) * (p2.y - minH) < 0) {
          const ratio = (minH - p1.y) / (p2.y - p1.y);
          const crossX = p1.x + ratio * (p2.x - p1.x);
          if (crossX > maxX) maxX = crossX;
        }
      }
      const last = positions[positions.length - 1];
      if (last.y >= minH && last.x > maxX) {
        maxX = last.x;
      }
      return maxX;
    }
    function findApex(positions) {
      let maxY = positions[0].y;
      let apexIndex = 0;
      for (let i = 1; i < positions.length; i++) {
        if (positions[i].y > maxY) {
          maxY = positions[i].y;
          apexIndex = i;
        }
      }
      return {
        apexY: maxY,
        apexX: positions[apexIndex].x
      };
    }
  
    // ---------------------------------------------------------------------
    // Graphiques temps, impact, spin (sans titre)
    // ---------------------------------------------------------------------
    function buildTimeChartTrace(points, color, label) {
      return {
        x: points.map(p => p.distance),
        y: points.map(p => p.time),
        mode: 'lines+markers',
        type: 'scattergl',
        name: label,
        line: { width: 2, color },
        text: points.map(p =>
          `<b>${label}</b><br>Distance: ${p.distance} m<br>Temps: ${p.time.toFixed(2)} s<br>Énergie: ${p.energy.toFixed(2)} J`
        ),
        hoverinfo: 'text'
      };
    }
    function updateTimeChart(fps, poidsGr, angleDeg) {
      const currentTimes = calculateTimesAtDistances(fps, poidsGr, angleDeg);
      let data = [];
  
      savedCurves.forEach(curve => {
        data.push(buildTimeChartTrace(curve.timeData, curve.color, curve.label));
      });
      data.push(buildTimeChartTrace(currentTimes, 'magenta', getCurrentLabel(fps, poidsGr)));
  
      const layout = {
        dragmode: false,
        hovermode: 'closest',
        paper_bgcolor: '#1F2937',
        plot_bgcolor: '#1F2937',
        legend: {
          orientation: 'h',
          xanchor: 'center',
          x: 0.5,
          y: -0.2,
          font: { color: 'white', size: 9 }
        },
        margin: { l: 40, r: 20, b: 60, t: 40 },
        xaxis: {
          title: 'Distance (m)',
          color: 'white',
          gridcolor: '#444'
        },
        yaxis: {
          title: 'Temps (s)',
          color: 'white',
          gridcolor: '#444'
        }
      };
      Plotly.react(timeChart, data, layout, {
        displayModeBar: false,
        scrollZoom: false,
        responsive: true
      });
    }
  
    function buildImpactChartTrace(points, color, label) {
      return {
        x: points.map(p => p.distance),
        y: points.map(p => p.energy),
        mode: 'lines+markers',
        type: 'scattergl',
        name: label,
        line: { width: 2, color },
        text: points.map(p =>
          `<b>${label}</b><br>Distance: ${p.distance} m<br>Énergie: ${p.energy.toFixed(2)} J`
        ),
        hoverinfo: 'text'
      };
    }
    function updateImpactChart(fps, poidsGr, angleDeg) {
      const currentEnergies = calculateEnergyAtDistances(fps, poidsGr, angleDeg);
      let data = [];
  
      savedCurves.forEach(curve => {
        data.push(buildImpactChartTrace(curve.energyData, curve.color, curve.label));
      });
      data.push(buildImpactChartTrace(currentEnergies, 'lime', getCurrentLabel(fps, poidsGr)));
  
      const layout = {
        dragmode: false,
        hovermode: 'closest',
        paper_bgcolor: '#1F2937',
        plot_bgcolor: '#1F2937',
        legend: {
          orientation: 'h',
          xanchor: 'center',
          x: 0.5,
          y: -0.2,
          font: { color: 'white', size: 9 }
        },
        margin: { l: 40, r: 20, b: 60, t: 40 },
        xaxis: {
          title: 'Distance (m)',
          color: 'white',
          gridcolor: '#444'
        },
        yaxis: {
          title: 'Énergie (J)',
          color: 'white',
          gridcolor: '#444'
        }
      };
      Plotly.react(impactChart, data, layout, {
        displayModeBar: false,
        scrollZoom: false,
        responsive: true
      });
    }
  
    function extractSpinAtDistances(positions) {
      const dists = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
      let results = [], idx = 0;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const dist = Math.abs(p.x);
        while (idx < dists.length && dist >= dists[idx]) {
          results.push({ distance: dists[idx], spin: p.spin });
          idx++;
        }
        if (idx >= dists.length) break;
      }
      return results;
    }
    function buildSpinChartTrace(spinPoints, color, label) {
      return {
        x: spinPoints.map(p => p.distance),
        y: spinPoints.map(p => p.spin),
        mode: 'lines+markers',
        type: 'scattergl',
        name: label,
        line: { width: 2, color },
        text: spinPoints.map(p =>
          `<b>${label}</b><br>Distance: ${p.distance} m<br>Spin: ${p.spin.toFixed(0)} rpm`
        ),
        hoverinfo: 'text'
      };
    }
    function updateSpinChart(fps, poidsGr, angleDeg) {
      const positions = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const spinDataCurrent = extractSpinAtDistances(positions);
      let data = [];
  
      savedCurves.forEach(curve => {
        const spinData = extractSpinAtDistances(curve.data);
        data.push(buildSpinChartTrace(spinData, curve.color, curve.label));
      });
      data.push(buildSpinChartTrace(spinDataCurrent, 'yellow', getCurrentLabel(fps, poidsGr)));
  
      const layout = {
        dragmode: false,
        hovermode: 'closest',
        paper_bgcolor: '#1F2937',
        plot_bgcolor: '#1F2937',
        legend: {
          orientation: 'h',
          xanchor: 'center',
          x: 0.5,
          y: -0.2,
          font: { color: 'white', size: 9 }
        },
        margin: { l: 40, r: 20, b: 60, t: 40 },
        xaxis: {
          title: 'Distance (m)',
          color: 'white',
          gridcolor: '#444'
        },
        yaxis: {
          title: 'Rotation (rpm)',
          color: 'white',
          gridcolor: '#444'
        }
      };
      Plotly.react(spinChart, data, layout, {
        displayModeBar: false,
        scrollZoom: false,
        responsive: true
      });
    }
  
    // ---------------------------------------------------------------------
    // Tableau de holdover
    // ---------------------------------------------------------------------
    function buildHoldoverData(fps, poidsGr, angleDeg, scopeOffsetM) {
      const pos = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const scAngle = getScopeAngleDeg();
      const rad = scAngle * Math.PI / 180;
  
      function scopeLineY(x) {
        return (shootingHeight + scopeOffsetM) + x * Math.tan(rad);
      }
  
      const stepDist = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];
      let results = [], idx = 0;
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        while (idx < stepDist.length && p.x >= stepDist[idx]) {
          const diffM = p.y - scopeLineY(p.x);
          results.push({
            distance: stepDist[idx],
            holdOverCm: diffM * 100,
            energy: p.energy,
            spin: p.spin
          });
          idx++;
        }
        if (idx >= stepDist.length) break;
      }
      return results;
    }
    function updateHoldoverTable(fps, poidsGr, angleDeg) {
      const holdData = buildHoldoverData(fps, poidsGr, angleDeg, scopeOffset);
      holdoverTableBody.innerHTML = '';
  
      holdData.forEach(row => {
        const tr = document.createElement('tr');
  
        const distTd = document.createElement('td');
        distTd.textContent = row.distance.toFixed(0);
        tr.appendChild(distTd);
  
        const diffTd = document.createElement('td');
        diffTd.textContent = row.holdOverCm.toFixed(1);
        diffTd.style.color = (row.holdOverCm >= 0) ? 'green' : 'red';
        tr.appendChild(diffTd);
  
        const enTd = document.createElement('td');
        enTd.textContent = row.energy.toFixed(2) + ' J';
        tr.appendChild(enTd);
  
        const spinTd = document.createElement('td');
        spinTd.textContent = row.spin.toFixed(0) + ' rpm';
        tr.appendChild(spinTd);
  
        holdoverTableBody.appendChild(tr);
      });
    }
  
    // ---------------------------------------------------------------------
    // Tableau de comparaison de temps
    // ---------------------------------------------------------------------
    function updateTimeComparisonTable(fps, poidsGr, angleDeg) {
      const distances = Array.from({ length: 21 }, (_, i) => i * 5); //0..100
      const currentTimes = calculateTimesAtDistances(fps, poidsGr, angleDeg);
      const currentMap = {};
      currentTimes.forEach(pt => {
        currentMap[pt.distance] = pt.time;
      });
  
      let columns = [{
        label: getCurrentLabel(fps, poidsGr),
        color: 'magenta',
        dataMap: currentMap
      }];
      savedCurves.forEach(c => {
        let map = {};
        c.timeData.forEach(pt => {
          map[pt.distance] = pt.time;
        });
        columns.push({
          label: c.label,
          color: c.color,
          dataMap: map
        });
      });
  
      let html = `<div style="overflow-x:auto;">
        <table style="border-collapse: collapse; width:100%; font-size:0.9em;">
          <thead>
            <tr>
              <th style="border:1px solid #666; padding:4px;">Distance (m)</th>`;
      columns.forEach(col => {
        html += `<th style="border:1px solid #666; padding:4px;">${col.label}</th>`;
      });
      html += `</tr></thead><tbody>`;
  
      distances.forEach(dist => {
        html += `<tr>`;
        html += `<td style="border:1px solid #666; padding:4px; text-align:center;">${dist}</td>`;
        const rowVals = columns.map(c => c.dataMap[dist] ?? null);
        const valid = rowVals.filter(v => v !== null);
        if (valid.length === 0) {
          columns.forEach(() => {
            html += `<td style="border:1px solid #666; padding:4px; text-align:center;">-</td>`;
          });
        } else {
          const minVal = Math.min(...valid), maxVal = Math.max(...valid);
          columns.forEach((col, i) => {
            const val = rowVals[i];
            if (val === null) {
              html += `<td style="border:1px solid #666; padding:4px; text-align:center;">-</td>`;
            } else {
              let styleColor = 'inherit', fontWeight = 'normal';
              if (Math.abs(minVal - maxVal) > 1e-9) {
                if (Math.abs(val - minVal) < 1e-9) {
                  styleColor = '#0f0'; fontWeight = 'bold';
                } else if (Math.abs(val - maxVal) < 1e-9) {
                  styleColor = '#f00'; fontWeight = 'bold';
                }
              }
              html += `<td style="border:1px solid #666; padding:4px; text-align:center; color:${styleColor}; font-weight:${fontWeight};">
                  ${val.toFixed(3)} s
                </td>`;
            }
          });
        }
        html += `</tr>`;
      });
  
      html += `</tbody></table></div>`;
      timeComparisonTableContainer.innerHTML = html;
    }

     // ---------------------------------------------------------------------
    // Tableau de comparaison des energies
    // ---------------------------------------------------------------------

    function updateEnergyComparisonTable(fps, poidsGr, angleDeg) {
      const distances = Array.from({ length: 21 }, (_, i) => i * 5);   // 0..100
      const currentEnergies = calculateEnergyAtDistances(fps, poidsGr, angleDeg);
      const currentMap = {};
      currentEnergies.forEach(pt => { currentMap[pt.distance] = pt.energy; });
    
      // colonne courante + éventuelles courbes sauvegardées
      let columns = [{
        label: getCurrentLabel(fps, poidsGr),
        color: 'lime',
        dataMap: currentMap
      }];
      savedCurves.forEach(c => {
        const map = {};
        c.energyData.forEach(pt => { map[pt.distance] = pt.energy; });
        columns.push({ label: c.label, color: c.color, dataMap: map });
      });
    
      // ── construction HTML identique à la table “Time” ────────────────────
      let html = `<div style="overflow-x:auto;">
        <table style="border-collapse: collapse; width:100%; font-size:0.9em;">
          <thead><tr><th style="border:1px solid #666; padding:4px;">Distance (m)</th>`;
    
      columns.forEach(col => {
        html += `<th style="border:1px solid #666; padding:4px;">${col.label}</th>`;
      });
      html += `</tr></thead><tbody>`;
    
      distances.forEach(dist => {
        html += `<tr><td style="border:1px solid #666; padding:4px; text-align:center;">${dist}</td>`;
        const rowVals = columns.map(c => c.dataMap[dist] ?? null);
        const valid = rowVals.filter(v => v !== null);
        if (!valid.length) {
          columns.forEach(() => {
            html += `<td style="border:1px solid #666; padding:4px; text-align:center;">-</td>`;
          });
        } else {
          const minVal = Math.min(...valid), maxVal = Math.max(...valid);
          columns.forEach((col, i) => {
            const val = rowVals[i];
            if (val === null) {
              html += `<td style="border:1px solid #666; padding:4px; text-align:center;">-</td>`;
            } else {
              let styleColor = 'inherit', fontWeight = 'normal';
              if (Math.abs(minVal - maxVal) > 1e-9) {
                if (Math.abs(val - maxVal) < 1e-9) {        // 👉 max = vert
                  styleColor = '#0f0'; fontWeight = 'bold';
                } else if (Math.abs(val - minVal) < 1e-9) { // 👉 min = rouge
                  styleColor = '#f00'; fontWeight = 'bold';
                }
              }
              html += `<td style="border:1px solid #666; padding:4px; text-align:center; color:${styleColor}; font-weight:${fontWeight};">
                  ${val.toFixed(2)} J
                </td>`;
            }
          });
        }
        html += `</tr>`;
      });
    
      html += `</tbody></table></div>`;
      energyComparisonTableContainer.innerHTML = html;
    }
    
  
    function getCurrentLabel(fps, poidsGr) {
      const mass = poidsGr / 1000;
      const v = fpsToMetersPerSecond(fps);
      const joules = calculateEnergy(mass, v).toFixed(2);
      return `${joules}J - ${poidsGr.toFixed(2)}g (Actuelle)`;
    }
  
    // ---------------------------------------------------------------------
    // Mise à jour globale (sans titre + ajout du radius)
    // ---------------------------------------------------------------------
    function updateTrajectoryChart(fps, poidsGr, angleDeg) {
      const positions = calculateTrajectory2D(fps, poidsGr, angleDeg);
      const maxRange = calculateRange(fps, poidsGr, angleDeg);
  
      let data = [];
  
      // Courbes sauvegardées
      savedCurves.forEach(c => {
        const splitted = build2DTraceSplit(c.data, c.color, c.label);
        data.push(...splitted);
      });
      // Courbe actuelle
      const splittedCurr = build2DTraceSplit(positions, 'cyan', getCurrentLabel(fps, poidsGr));
      data.push(...splittedCurr);
  
      // Axe canon
      if (showCanonLineCheckbox.checked) {
        data.push(buildCanonLineTrace(angleDeg, maxRange));
      }
      // Axe visée
      if (showScopeLineCheckbox.checked) {
        data.push(buildScopeLineTrace(scopeOffset, getScopeAngleDeg(), maxRange));
      }
  
      const layout = {
        dragmode: false,
        hovermode: 'closest',
        paper_bgcolor: '#1F2937',
        plot_bgcolor: '#1F2937',
        legend: {
          orientation: 'h',
          xanchor: 'center',
          x: 0.5,
          y: -0.2,
          font: { color: 'white', size: 9 }
        },
        margin: { l: 40, r: 20, b: 60, t: 40 },
        xaxis: {
          title: 'Distance X (m)',
          color: 'white',
          gridcolor: '#444'
        },
        yaxis: {
          title: 'Hauteur Y (m)',
          color: 'white',
          gridcolor: '#444',
          scaleanchor: 'x',
          scaleratio: 2
        }
      };
      Plotly.react(trajectory2D, data, layout, {
        displayModeBar: false,
        scrollZoom: false,
        responsive: true
      });
    }
  
    function updateResultsAndEnergies() {
      if (isUpdating) return;
      isUpdating = true;
      try {
        const poidsGr = parseFloat(bbWeightInput.value);
        let fpsVal = parseFloat(bbVelocityInput.value);
        let joulesVal = parseFloat(bbEnergyInput.value);
  
        if (isNaN(poidsGr) || poidsGr <= 0 || poidsGr > 0.88) {
          bbVelocityInput.disabled = true;
          bbEnergyInput.disabled = true;
          resultInfoDiv.innerHTML = (poidsGr > 0.88)
            ? "Choisissez un poids < 0.88 g."
            : "Veuillez renseigner un poids de bille.";
          engagementInfoDiv.querySelectorAll('p')[0].textContent = 'Distance d’engagement: -';
          engagementInfoDiv.querySelectorAll('p')[1].textContent = 'Distance de ressenti (Audible sur Gilet Tactique): -';
          isUpdating = false;
          return;
        } else {
          bbVelocityInput.disabled = false;
          bbEnergyInput.disabled = false;
        }
  
        // Conversion FPS / Joules
        if (!isNaN(fpsVal)) {
          const v = fpsToMetersPerSecond(fpsVal);
          const compJ = calculateEnergy((poidsGr / 1000), v);
          joulesVal = compJ;
          bbEnergyInput.value = compJ.toFixed(2);
        }
        else if (!isNaN(joulesVal)) {
          const v = calculateVelocityFromEnergy(joulesVal, (poidsGr / 1000));
          fpsVal = metersPerSecondToFPS(v);
          bbVelocityInput.value = Math.round(fpsVal);
        }
        else if (savedCurves.length === 0) {
          resultInfoDiv.innerHTML = "Entrez au moins FPS ou Joules.";
          engagementInfoDiv.querySelectorAll('p')[0].textContent = 'Distance d’engagement: -';
          engagementInfoDiv.querySelectorAll('p')[1].textContent = 'Distance de ressenti (audible sur gilet): -';
          isUpdating = false;
          return;
        }
  
        if (fpsVal <= 0 && savedCurves.length === 0) {
          resultInfoDiv.innerHTML = "La vitesse doit être > 0.";
          isUpdating = false;
          return;
        }
  
        // Mise à jour des graphes
        updateTrajectoryChart(fpsVal, poidsGr, shootingAngle);
        updateTimeChart(fpsVal, poidsGr, shootingAngle);
        updateImpactChart(fpsVal, poidsGr, shootingAngle);
        updateSpinChart(fpsVal, poidsGr, shootingAngle);
        updateTimeComparisonTable(fpsVal, poidsGr, shootingAngle);
        updateEnergyComparisonTable(fpsVal, poidsGr, shootingAngle);
        updateHoldoverTable(fpsVal, poidsGr, shootingAngle);
  
        if (!isNaN(fpsVal) && fpsVal > 0) {
          const range = calculateRange(fpsVal, poidsGr, shootingAngle);
          const positions = calculateTrajectory2D(fpsVal, poidsGr, shootingAngle);
          const energies = calculateEnergiesAtDistances(fpsVal, poidsGr, shootingAngle);
          const { engagementDistance, foundEngagement, ressentiDistance, foundRessenti } = energies;
          const usefulRange = findUsefulRange(positions, 1.0);
          const scAngle = getScopeAngleDeg();
          const zeroDist = findZeroingDistanceWithScopeLine(positions, scopeOffset, scAngle);
          const apex = findApex(positions);
  
          let html = `<b>Portée totale</b> (angle ${shootingAngle}°) : ${range} m.<br><br>`
            + `<b>Portée utile</b> (hauteur >1m) : ${usefulRange.toFixed(2)} m.<br><br>`;
          if (zeroDist) {
            html += `<b>Zérotage lunette</b> ~${zeroDist.toFixed(2)} m (scopeAngle: ${scAngle.toFixed(1)}°).<br><br>`;
          } else {
            html += `<b>Zérotage lunette</b> : aucune intersection.<br><br>`;
          }
          html += `<b>Apex (hauteur max)</b> : ~${apex.apexY.toFixed(2)} m à ~${apex.apexX.toFixed(2)} m.`;
          resultInfoDiv.innerHTML = html;
  
          if (!foundEngagement || engagementDistance === 0) {
            engagementInfoDiv.querySelectorAll('p')[0].textContent = 'Distance d’engagement: -';
          } else {
            engagementInfoDiv.querySelectorAll('p')[0].textContent = `Distance d’engagement: ~${Math.round(engagementDistance)} m.`;
          }
          if (foundRessenti) {
            engagementInfoDiv.querySelectorAll('p')[1].textContent = `Distance de ressenti (audible sur gilet) (0.15J): ~${Math.round(ressentiDistance)} m.`;
          } else {
            engagementInfoDiv.querySelectorAll('p')[1].textContent =
              `Le joueur visé ressentira toujours la bille (portée totale ${range} m).`;
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        isUpdating = false;
      }
    }
  
    // ---------------------------------------------------------------------
    // Partage (URL)
    // ---------------------------------------------------------------------
    shareButton.addEventListener('click', () => {
      if (!savedCurves.length) {
        alert("Aucune courbe à partager !");
        return;
      }
      const curvesParams = savedCurves.map(c => c.params);
      const jsonStr = JSON.stringify(curvesParams);
      const encoded = encodeURIComponent(jsonStr);
  
      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = baseUrl + '?curves=' + encoded;
  
      shareLinkContainer.classList.remove('hidden');
      shareLinkContainer.innerHTML = `
          <p>Partagez ce lien :</p>
          <a href="${shareUrl}" style="word-wrap:break-word;" target="_blank">${shareUrl}</a>
        `;
    });
  
    /* ------------------------------------------------------------------ */
    /*  FONCTION utilitaire : afficher UNIQUEMENT les courbes enregistrées */
    /* ------------------------------------------------------------------ */
    function renderSavedCurvesOnly() {
      if (!savedCurves.length) return;
  
      /* Trajectoire --------------------------------------------------- */
      let trajTraces = [];
      savedCurves.forEach(c =>
        trajTraces.push(...build2DTraceSplit(c.data, c.color, c.label))
      );
      Plotly.react(trajectory2D, trajTraces, trajectoryLayout, plotConfig);
  
      /* Temps --------------------------------------------------------- */
      Plotly.react(
        timeChart,
        savedCurves.map(c => buildTimeChartTrace(c.timeData, c.color, c.label)),
        timeLayout,
        plotConfig
      );
  
      /* Impact -------------------------------------------------------- */
      Plotly.react(
        impactChart,
        savedCurves.map(c => buildImpactChartTrace(c.energyData, c.color, c.label)),
        impactLayout,
        plotConfig
      );
  
      /* Spin ---------------------------------------------------------- */
      Plotly.react(
        spinChart,
        savedCurves.map(c => {
          const spinPts = extractSpinAtDistances(c.data);
          return buildSpinChartTrace(spinPts, c.color, c.label);
        }),
        spinLayout,
        plotConfig
      );
  
      /* Tables -------------------------------------------------------- */
      timeComparisonTableContainer.innerHTML = '';
      energyComparisonTableContainer.innerHTML = '';  
      const p0 = savedCurves[0].params;                 // pour la table holdover
      updateHoldoverTable(p0.fps, p0.poids, p0.angle);
    }
    function restoreCurvesFromUrl() {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('curves')) return;
      try {
        const raw = params.get('curves');
        const decoded = decodeURIComponent(raw);
        const arr = JSON.parse(decoded);
        arr.forEach((pObj, idx) => {
  
          hopUpPercentage = pObj.hop;
          pressureHpa = pObj.pressure;
          temperatureCelsius = pObj.temperature;
          shootingAngle = pObj.angle;
          scopeAngleDelta = pObj.scopeAngleDelta ?? 0;
          scopeOffset = pObj.scopeOffset ?? 0.05;
          shootingHeight = pObj.shootingHeight ?? 1.5;
  
          const positions = calculateTrajectory2D(pObj.fps, pObj.poids, pObj.angle);
          const savedData = positions.map(pt => ({
            x: pt.x, y: pt.y, energy: pt.energy, fps: pt.fps, spin: pt.spin, time: pt.time
          }));
          const timesData = calculateTimesAtDistances(pObj.fps, pObj.poids, pObj.angle);
          const energyData = calculateEnergyAtDistances(pObj.fps, pObj.poids, pObj.angle);
  
          const vel = fpsToMetersPerSecond(pObj.fps);
          const mass = pObj.poids / 1000;
          const compJ = calculateEnergy(mass, vel).toFixed(2);
          const label = `${compJ}J - ${pObj.poids.toFixed(2)}g (Rechargée ${idx + 1})`;
          const color = getRandomColor();
  
          savedCurves.push({
            data: savedData,
            timeData: timesData,
            energyData,
            color,
            label,
            params: pObj
          });
        });
        /* --- On efface les inputs pour qu’aucune courbe “courante” ne soit tracée --- */
        bbWeightInput.value =
          bbVelocityInput.value =
          bbEnergyInput.value = '';
  
        /* --- On remet l’interface dans un état neutre --- */
        updateAngleDisplay();
        updateScopeAngleDisplay();
        updateHopupDisplay();
        updatePressureDisplay();
        updateTemperatureDisplay();
  
        /* --- On dessine UNIQUEMENT les courbes enregistrées --- */
        renderSavedCurvesOnly();
      } catch (e) {
        console.error("Erreur restauration courbes:", e);
      }
    }
  
    // ---------------------------------------------------------------------
    // Écouteurs
    // ---------------------------------------------------------------------
    bbWeightInput.addEventListener('input', () => {
      bbVelocityInput.value = '';
      bbEnergyInput.value = '';
      updateResultsAndEnergies();
    });
    bbVelocityInput.addEventListener('input', () => {
      if (bbVelocityInput.value !== '') {
        bbEnergyInput.value = '';
      }
      updateResultsAndEnergies();
    });
    bbEnergyInput.addEventListener('input', () => {
      if (bbEnergyInput.value !== '') {
        bbVelocityInput.value = '';
      }
      updateResultsAndEnergies();
    });
  
  
    shootingHeightInput.addEventListener('input', () => {
      let val = parseFloat(shootingHeightInput.value);
      if (!isNaN(val) && val >= 0) shootingHeight = val;
      else shootingHeight = 1.5;
      updateResultsAndEnergies();
    });
    scopeOffsetInput.addEventListener('input', () => {
      let val = parseFloat(scopeOffsetInput.value);
      if (!isNaN(val) && val >= 0) scopeOffset = val / 100;
      else scopeOffset = 0.05;
      updateResultsAndEnergies();
    });
  
    // Hop-up
    hopupPlusButton.addEventListener('click', () => {
      if (hopUpPercentage < 100) {
        hopUpPercentage += 0.25;
        if (hopUpPercentage > 100) hopUpPercentage = 100;
        updateHopupDisplay();
        updateResultsAndEnergies();
      }
    });
    hopupMinusButton.addEventListener('click', () => {
      if (hopUpPercentage > 0) {
        hopUpPercentage -= 0.25;
        if (hopUpPercentage < 0) hopUpPercentage = 0;
        updateHopupDisplay();
        updateResultsAndEnergies();
      }
    });
  
    // Angle de tir
    anglePlusButton.addEventListener('click', () => {
      shootingAngle += 0.5;
      updateAngleDisplay();
      updateResultsAndEnergies();
    });
    angleMinusButton.addEventListener('click', () => {
      shootingAngle -= 0.5;
      updateAngleDisplay();
      updateResultsAndEnergies();
    });
  
    // Angle lunette
    scopeAnglePlusButton.addEventListener('click', () => {
      scopeAngleDelta += 0.1;
      updateScopeAngleDisplay();
      updateResultsAndEnergies();
    });
    scopeAngleMinusButton.addEventListener('click', () => {
      scopeAngleDelta -= 0.1;
      updateScopeAngleDisplay();
      updateResultsAndEnergies();
    });
  
    // Pression / T°C
    pressurePlusButton.addEventListener('click', () => {
      if (pressureHpa < 1200) {
        pressureHpa += 5;
        updatePressureDisplay();
        updateResultsAndEnergies();
      }
    });
    pressureMinusButton.addEventListener('click', () => {
      if (pressureHpa > 900) {
        pressureHpa -= 5;
        if (pressureHpa < 900) pressureHpa = 900;
        updatePressureDisplay();
        updateResultsAndEnergies();
      }
    });
    temperaturePlusButton.addEventListener('click', () => {
      if (temperatureCelsius < 45) {
        temperatureCelsius++;
        updateTemperatureDisplay();
        updateResultsAndEnergies();
      }
    });
    temperatureMinusButton.addEventListener('click', () => {
      if (temperatureCelsius > -20) {
        temperatureCelsius--;
        updateTemperatureDisplay();
        updateResultsAndEnergies();
      }
    });
  
    // Checkbox
    showCanonLineCheckbox.addEventListener('change', () => {
      updateResultsAndEnergies();
    });
    showScopeLineCheckbox.addEventListener('change', () => {
      updateResultsAndEnergies();
    });
  
    // Sauvegarde
    saveCurveButton.addEventListener('click', () => {
      const poidsGr = parseFloat(bbWeightInput.value);
      let fpsVal = parseFloat(bbVelocityInput.value);
      let joulesVal = parseFloat(bbEnergyInput.value);
      if (isNaN(poidsGr) || (isNaN(fpsVal) && isNaN(joulesVal))) {
        alert("Entrez un poids valide + FPS ou Joules.");
        return;
      }
      if (!confirm("Enregistrer cette courbe ?")) return;
  
      // Conversion si besoin
      if (isNaN(fpsVal)) {
        const v = calculateVelocityFromEnergy(joulesVal, poidsGr / 1000);
        fpsVal = metersPerSecondToFPS(v);
      }
      else if (isNaN(joulesVal)) {
        const v = fpsToMetersPerSecond(fpsVal);
        joulesVal = calculateEnergy(poidsGr / 1000, v);
      }
  
      // Calcul de la courbe
      const positions = calculateTrajectory2D(fpsVal, poidsGr, shootingAngle);
      const savedData = positions.map(pt => ({
        x: pt.x, y: pt.y, energy: pt.energy, fps: pt.fps, spin: pt.spin, time: pt.time
      }));
      const timesData = calculateTimesAtDistances(fpsVal, poidsGr, shootingAngle);
      const energyData = calculateEnergyAtDistances(fpsVal, poidsGr, shootingAngle);
  
      const mass = poidsGr / 1000;
      const velocity = fpsToMetersPerSecond(fpsVal);
      const compJ = calculateEnergy(mass, velocity).toFixed(2);
      const label = `${compJ}J - ${poidsGr.toFixed(2)}g (Courbe ${savedCurves.length + 1})`;
      const color = getRandomColor();
  
      savedCurves.push({
        data: savedData,
        timeData: timesData,
        energyData,
        color,
        label,
        params: {
          poids: poidsGr,
          fps: fpsVal,
          angle: shootingAngle,
          hop: hopUpPercentage,
          pressure: pressureHpa,
          temperature: temperatureCelsius,
          scopeAngleDelta,
          scopeOffset,
          shootingHeight
        }
      });
  
      bbWeightInput.value = '';
      bbVelocityInput.value = '';
      bbEnergyInput.value = '';
      updateResultsAndEnergies();
    });
  
    // Reset
    resetCurvesButton.addEventListener('click', () => {
      savedCurves = [];
      updateResultsAndEnergies();
    });
  
    // ---------------------------------------------------------------------
    // Onglets
    // ---------------------------------------------------------------------
    function clearTabActive() {
      [trajectoryTab, timeTab, energyTab, spinTab].forEach(btn => {
        btn.classList.remove('tab-active');
        btn.classList.add('text-gray-400');
      });
      trajectoryChartContainer.classList.add('hidden');
      timeChartContainer.classList.add('hidden');
      impactChartContainer.classList.add('hidden');
      spinChartContainer.classList.add('hidden');
    }
    trajectoryTab.addEventListener('click', () => {
      clearTabActive();
      trajectoryTab.classList.add('tab-active');
      trajectoryTab.classList.remove('text-gray-400');
      trajectoryChartContainer.classList.remove('hidden');
    });
    timeTab.addEventListener('click', () => {
      clearTabActive();
      timeTab.classList.add('tab-active');
      timeTab.classList.remove('text-gray-400');
      timeChartContainer.classList.remove('hidden');
    });
    energyTab.addEventListener('click', () => {
      clearTabActive();
      energyTab.classList.add('tab-active');
      energyTab.classList.remove('text-gray-400');
      impactChartContainer.classList.remove('hidden');
    });
    spinTab.addEventListener('click', () => {
      clearTabActive();
      spinTab.classList.add('tab-active');
      spinTab.classList.remove('text-gray-400');
      spinChartContainer.classList.remove('hidden');
    });
  
    // ---------------------------------------------------------------------
    // Initialisation : arrondi des containers + restauration URL
    // ---------------------------------------------------------------------
    function init() {
      // On ajoute la classe “rounded-xl” aux conteneurs Plotly pour mimer la card
      [trajectoryChartContainer, timeChartContainer, impactChartContainer, spinChartContainer].forEach(div => {
        div.classList.add('rounded-xl');     // même border radius
        div.classList.add('overflow-hidden'); // pour masquer les angles internes
      });
  
      restoreCurvesFromUrl();
      updateAngleDisplay();
      updateScopeAngleDisplay();
      updateHopupDisplay();
      updatePressureDisplay();
      updateTemperatureDisplay();
      updateResultsAndEnergies();
    }
    init();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', FAT_init);
} else {
  FAT_init();
}
;