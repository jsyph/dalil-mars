const CHANNEL_NAME = 'ares-eva-visor-sync';
const STORAGE_KEY = 'ares-eva-visor-snapshot';

/**
 * Broadcasts the current navigation & telemetry state from the main EVA Tablet
 * to any open standalone AR Visor HUD window (`?mode=visor`).
 */
export function publishVisorState(snapshot) {
  const payload = {
    type: 'VISOR_STATE_UPDATE',
    timestamp: Date.now(),
    snapshot,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }
}

export function publishVisorHeartbeat() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'VISOR_HEARTBEAT', timestamp: Date.now() });
  channel.close();
}

export function publishTabletOffline() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'TABLET_OFFLINE', timestamp: Date.now() });
  channel.close();
}

/**
 * Sends a control action from the AR Visor HUD back to the main EVA Tablet
 * (e.g., triggering an emergency shelter divert).
 */
export function sendVisorCommand(command, data = null) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({
    type: 'VISOR_COMMAND',
    command,
    data,
    timestamp: Date.now(),
  });
  channel.close();
}

/**
 * Reads the last persisted visor snapshot for immediate hydration on mount.
 */
export function readCachedVisorState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.snapshot ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribes to live visor state updates from the main EVA Tablet.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeVisorState(onUpdate, onStatus) {
  let channel = null;

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type === 'VISOR_STATE_UPDATE' && event.data.snapshot) {
        onUpdate(event.data.snapshot, event.data.timestamp);
      } else if (event.data?.type === 'VISOR_HEARTBEAT') {
        onStatus?.(true, event.data.timestamp);
      } else if (event.data?.type === 'TABLET_OFFLINE') {
        onStatus?.(false, event.data.timestamp);
      }
    };
  }

  const handleStorage = (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed?.snapshot) {
          onUpdate(parsed.snapshot, parsed.timestamp);
        }
      } catch {
        // Ignore malformed storage payload
      }
    }
  };

  window.addEventListener('storage', handleStorage);

  return () => {
    if (channel) channel.close();
    window.removeEventListener('storage', handleStorage);
  };
}

/**
 * Subscribes to commands sent from the AR Visor HUD to the main EVA Tablet.
 */
export function subscribeVisorCommands(onCommand) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event) => {
    if (event.data?.type === 'VISOR_COMMAND' && event.data.command) {
      onCommand(event.data.command, event.data.data);
    }
  };
  return () => channel.close();
}
