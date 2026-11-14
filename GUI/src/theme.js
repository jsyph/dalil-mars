/**
 * Centralized Theme & Configuration for Dalil Mars // Jezero Surface Terminal.
 * Palette: Neutral charcoal/slate grays + off-white, status-only muted green & crimson.
 * Zero blue, cyan, amber, or orange anywhere.
 */

export const APP_THEME = {
  colors: {
    bg: '#0b0d11',
    panel: '#13161c',
    card: '#191d24',
    hover: '#222731',
    active: '#2c323f',
    borderSubtle: '#242933',
    borderMedium: '#353c4a',
    borderStrong: '#4f5767',
    textPrimary: '#edf0f5',
    textSecondary: '#9da5b4',
    textMuted: '#656d7d',
    ok: '#22c55e',
    okDark: '#16a34a',
    okBg: 'rgba(34, 197, 94, 0.12)',
    okBorder: 'rgba(34, 197, 94, 0.40)',
    fault: '#ef4444',
    faultDark: '#dc2626',
    faultBg: 'rgba(239, 68, 68, 0.12)',
    faultBorder: 'rgba(239, 68, 68, 0.40)',
  },
  fonts: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
  },
  radius: {
    sm: '4px',
    md: '6px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
  },
  regionalBounds: [
    [17.084077, 76.795971],
    [19.319730, 77.801146],
  ],
  routeLine: {
    haloColor: '#0b0d11',
    haloWeight: 5,
    coreColor: '#edf0f5',
    coreWeight: 2.5,
    leg2Color: '#22c55e',
    faultColor: '#ef4444',
    directColor: '#656d7d',
  },
  layers: {
    ellipseBorder: '#edf0f5',
    ellipseFill: '#edf0f5',
    linearFeature: '#656d7d',
    surfaceFeature: '#353c4a',
    traverseLine: '#9da5b4',
  },
  hazards: {
    heat: { label: 'THERMAL ZONE', color: '#dc2626', fill: '#dc2626', opacity: 0.25 },
    radiation: { label: 'RADIATION ZONE', color: '#b91c1c', fill: '#b91c1c', opacity: 0.25 },
    chemical: { label: 'CHEMICAL / CLO4', color: '#991b1b', fill: '#991b1b', opacity: 0.25 },
    rough: { label: 'ROUGH TERRAIN', color: '#ef4444', fill: '#ef4444', opacity: 0.25 },
    safe: { label: 'SAFE CORRIDOR', color: '#16a34a', fill: '#16a34a', opacity: 0.20 },
  },
  chart: {
    background: '#0b0d11',
    gridLines: '#242933',
    text: '#9da5b4',
    profileLine: '#edf0f5',
    fillStart: 'rgba(237, 240, 245, 0.14)',
    fillEnd: 'rgba(237, 240, 245, 0.01)',
  },
};

export default APP_THEME;
