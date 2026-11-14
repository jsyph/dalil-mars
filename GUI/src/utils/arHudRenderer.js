/**
 * Renders the Fullscreen Ares-EVA Visor HUD onto a transparent 1280x720 Canvas
 * for WebXR `immersive-ar` passthrough on Meta Quest 2.
 * Leaves the center open for the live camera feed and 3D Google-Maps-style AR path.
 */

const CARDINALS = [
  { deg: 0, label: 'N' },
  { deg: 45, label: 'NE' },
  { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' },
  { deg: 180, label: 'S' },
  { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' },
  { deg: 315, label: 'NW' },
];

function normalizeSignedAngle(deg) {
  return ((deg + 540) % 360) - 180;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPill(ctx, x, y, w, h, r, fill, stroke, lineWidth = 2) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export function renderArHudToCanvas(canvas, state, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const {
    compact = false,
    opacity = 0.78,
    linkLive = false,
    headingDeg = 0,
    targetDistM = null,
    targetBearingDeg = null,
    targetName = null,
    markers = [],
  } = options;

  ctx.clearRect(0, 0, W, H);

  const liveNav = state?.liveNavState || {};
  const env = state?.martianEnv || {};
  const weather = state?.weatherCondition || {};
  const dust = state?.dustFrontState || {};
  const maneuver = state?.currentManeuver || {};
  const meda = state?.latestMeda || {};
  const deviation = liveNav?.routeDeviation;

  const battery = Math.round(liveNav.currentBattery ?? 94);
  const o2 = Math.round(liveNav.currentO2 ?? 96);
  const hr = Math.round(liveNav.heartRateBpm ?? 76);
  const heaterW = Math.round(env.suitHeaterWatts ?? 75);
  const tempC = env.ambientTempC ?? -40;
  const pressurePa = dust.active ? dust.pressureDropPa : (meda.pressure ?? 778.9);
  const radRate = weather.radRateMgyHr ?? 0.011;
  const etaMin = liveNav.estTimeRemainingMin ?? 0;
  const lstText = env.lstText || '14:22 LST';
  const elevM = liveNav.groundElevM ?? -2540;

  const isOffRoute = Boolean(deviation?.isOffRoute);
  const isEmergency = (weather.id && weather.id !== 'nominal') || Boolean(dust.active);
  const lowReserve = battery <= 20 || o2 <= 20;

  const bgFill = `rgba(2, 6, 23, ${opacity})`;
  const cyanBorder = 'rgba(34, 211, 238, 0.65)';
  const alertBorder = 'rgba(248, 113, 113, 0.9)';

  // =========================================================
  // 1. TOP-LEFT STATUS PILL
  // =========================================================
  drawPill(ctx, 28, 22, 310, 38, 19, bgFill, cyanBorder, 1.5);
  ctx.beginPath();
  ctx.arc(48, 41, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = linkLive ? '#34d399' : '#fbbf24';
  ctx.fill();

  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#e0f2fe';
  ctx.fillText(
    `ARES-EVA AR VISOR • ${linkLive ? 'LIVE' : 'STANDBY'}`,
    64,
    46
  );

  // =========================================================
  // 2. TOP-CENTER HEADING COMPASS RIBBON
  // =========================================================
  const compW = 540;
  const compH = 48;
  const compX = (W - compW) / 2;
  const compY = 20;
  drawPill(ctx, compX, compY, compW, compH, 14, bgFill, cyanBorder, 1.5);

  // Center indicator needle & heading readout
  ctx.fillStyle = '#67e8f9';
  ctx.fillRect(W / 2 - 1.5, compY, 3, 12);
  ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#67e8f9';
  ctx.fillText(`${String(Math.round(headingDeg)).padStart(3, '0')}°`, W / 2, compY + 42);

  // Compass ticks within ±60°
  ctx.save();
  ctx.beginPath();
  ctx.rect(compX + 8, compY, compW - 16, compH);
  ctx.clip();

  for (let offset = -60; offset <= 60; offset += 15) {
    const deg = (((Math.round(headingDeg / 15) * 15 + offset) % 360) + 360) % 360;
    const exactOffset = normalizeSignedAngle(deg - headingDeg);
    if (Math.abs(exactOffset) > 60) continue;
    const x = W / 2 + (exactOffset / 60) * (compW * 0.44);
    const cardinal = CARDINALS.find((c) => c.deg === deg);
    ctx.fillStyle = cardinal ? '#67e8f9' : 'rgba(34, 211, 238, 0.45)';
    ctx.fillRect(x - 0.75, compY + 6, 1.5, cardinal ? 10 : 6);
    ctx.font = cardinal
      ? 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace'
      : '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = cardinal ? '#a5f3fc' : '#94a3b8';
    ctx.fillText(cardinal ? cardinal.label : `${deg}°`, x, compY + 30);
  }

  // Target diamond on compass ribbon
  if (targetBearingDeg !== null) {
    const delta = normalizeSignedAngle(targetBearingDeg - headingDeg);
    if (Math.abs(delta) <= 60) {
      const tx = W / 2 + (delta / 60) * (compW * 0.44);
      ctx.save();
      ctx.translate(tx, compY + 40);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.textAlign = 'left';

  // =========================================================
  // 3. TOP-CENTER TURN-BY-TURN MANEUVER / EMERGENCY PILL
  // =========================================================
  const navW = isEmergency || isOffRoute ? 560 : 480;
  const navH = 38;
  const navX = (W - navW) / 2;
  const navY = 78;
  drawPill(
    ctx,
    navX,
    navY,
    navW,
    navH,
    19,
    isEmergency || isOffRoute ? 'rgba(127, 29, 29, 0.85)' : bgFill,
    isEmergency || isOffRoute ? alertBorder : cyanBorder,
    1.5
  );

  const distLabel =
    targetDistM !== null
      ? targetDistM >= 1000
        ? `${(targetDistM / 1000).toFixed(2)} km`
        : `${Math.round(targetDistM)} m`
      : maneuver.distanceText || '140 m';

  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = isEmergency || isOffRoute ? '#fca5a5' : '#34d399';
  ctx.fillText(distLabel, navX + 20, navY + 24);

  ctx.font = '600 14px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ecfeff';
  const navMsg = isOffRoute
    ? `OFF-ROUTE ${deviation.distMeters}m • TURN TO ${deviation.returnBearing}°`
    : isEmergency
      ? weather.alert || `DUST FRONT ${dust.distanceAheadKm ?? '--'} km • ETA ${dust.etaMin ?? '--'}m`
      : maneuver.instruction || `Proceed toward ${targetName || 'Target Waypoint'}`;
  ctx.fillText(navMsg.slice(0, 48), navX + 95, navY + 24);

  // =========================================================
  // 4. CENTER OPTICAL RETICLE + DIRECTIONAL TURN CALLOUT
  // =========================================================
  const cx = W / 2;
  const cy = H / 2 - 20;
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.moveTo(cx - 28, cy);
  ctx.lineTo(cx - 10, cy);
  ctx.moveTo(cx + 10, cy);
  ctx.lineTo(cx + 28, cy);
  ctx.moveTo(cx, cy - 28);
  ctx.lineTo(cx, cy - 10);
  ctx.moveTo(cx, cy + 10);
  ctx.lineTo(cx, cy + 28);
  ctx.stroke();

  if (targetBearingDeg !== null) {
    const delta = normalizeSignedAngle(
      (isOffRoute && deviation?.returnBearing !== undefined
        ? deviation.returnBearing
        : targetBearingDeg) - headingDeg
    );
    const absDelta = Math.abs(Math.round(delta));
    const dirText =
      absDelta <= 12
        ? `↑ STRAIGHT • ${distLabel}`
        : delta < 0
          ? `↖ TURN LEFT ${absDelta}° • ${distLabel}`
          : `↗ TURN RIGHT ${absDelta}° • ${distLabel}`;

    drawPill(
      ctx,
      cx - 135,
      cy + 34,
      270,
      30,
      15,
      'rgba(2, 6, 23, 0.72)',
      absDelta <= 12 ? 'rgba(52, 211, 153, 0.75)' : 'rgba(34, 211, 238, 0.7)',
      1.5
    );
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = absDelta <= 12 ? '#6ee7b7' : '#a5f3fc';
    ctx.fillText(dirText, cx, cy + 54);
    ctx.textAlign = 'left';
  }

  // =========================================================
  // 5. BOTTOM ROW: PLSS (LEFT) | ELEV/ETA (CENTER) | MEDA (RIGHT)
  // =========================================================
  const botY = H - 64;

  // Bottom-Left: PLSS Vitals Strip
  const plssW = compact ? 235 : 370;
  drawPill(
    ctx,
    28,
    botY,
    plssW,
    42,
    21,
    bgFill,
    lowReserve ? alertBorder : cyanBorder,
    1.5
  );
  ctx.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = battery <= 20 ? '#f87171' : '#67e8f9';
  ctx.fillText(`BAT ${battery}%`, 48, botY + 26);

  ctx.fillStyle = o2 <= 20 ? '#f87171' : '#6ee7b7';
  ctx.fillText(`O2 ${o2}%`, 144, botY + 26);

  if (!compact) {
    ctx.fillStyle = '#fda4af';
    ctx.fillText(`HR ${hr}`, 226, botY + 26);
    ctx.fillStyle = '#fdba74';
    ctx.fillText(`${heaterW}W`, 312, botY + 26);
  }

  // Bottom-Center: Elevation & ETA
  const midW = 240;
  drawPill(ctx, (W - midW) / 2, botY, midW, 42, 21, bgFill, cyanBorder, 1.5);
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#fdba74';
  ctx.fillText(`${elevM}m  •  `, W / 2 - 36, botY + 26);
  ctx.fillStyle = '#6ee7b7';
  ctx.fillText(`ETA ${etaMin}m`, W / 2 + 44, botY + 26);
  ctx.textAlign = 'left';

  // Bottom-Right: MEDA Environment Strip
  if (!compact) {
    const medaW = 390;
    const medaX = W - medaW - 28;
    drawPill(ctx, medaX, botY, medaW, 42, 21, bgFill, cyanBorder, 1.5);
    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText(lstText, medaX + 18, botY + 26);

    ctx.fillStyle = '#bae6fd';
    ctx.fillText(`${tempC}°C`, medaX + 122, botY + 26);

    ctx.fillStyle = '#fde68a';
    ctx.fillText(`${pressurePa}Pa`, medaX + 186, botY + 26);

    ctx.fillStyle = radRate > 0.1 ? '#f87171' : '#ddd6fe';
    ctx.fillText(`${radRate}mGy`, medaX + 286, botY + 26);
  }
}
