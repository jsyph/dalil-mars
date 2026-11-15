#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5173}"
DEVTOOLS_PORT="${DEVTOOLS_PORT:-9222}"
URL="http://localhost:${PORT}/?mode=visor-ar"

echo "==> [1/6] Checking Meta Quest 2 ADB connection..."
adb wait-for-device
adb devices -l

echo "==> [2/6] Keeping Quest 2 awake (USB stay-on + proximity sensor)..."
adb shell svc power stayon usb
adb shell am broadcast -a com.oculus.vrpowermanager.prox_close >/dev/null || true
adb shell input keyevent KEYCODE_WAKEUP || true

echo "==> [3/6] Forwarding ports (Vite :${PORT}, DevTools :${DEVTOOLS_PORT})..."
adb reverse "tcp:${PORT}" "tcp:${PORT}"
adb forward "tcp:${DEVTOOLS_PORT}" localabstract:chrome_devtools_remote

if ! ss -tln | grep -q ":${PORT} "; then
  echo "==> [4/6] Starting Vite dev server on port ${PORT}..."
  (cd "${ROOT_DIR}" && npm run dev -- --port "${PORT}" >/tmp/dalil-mars-vite.log 2>&1 &)
  sleep 2
else
  echo "==> [4/6] Vite dev server already running on port ${PORT}."
fi

echo "==> [5/6] Opening ${URL} in Meta Quest Browser and entering AR..."
HAS_TAB=$(node -e '
const http = require("http");
function getJson(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}
(async () => {
  try {
    const pages = await getJson("http://localhost:'"${DEVTOOLS_PORT}"'/json");
    const tabs = pages.filter(p => p.type === "page");
    let keep = tabs.find(p => p.url.includes("mode=visor-ar")) || tabs[0];
    for (const t of tabs) {
      if (keep && t.id !== keep.id) {
        http.get("http://localhost:'"${DEVTOOLS_PORT}"'/json/close/" + t.id, () => {}).on("error", () => {});
      }
    }
    if (keep) {
      http.get("http://localhost:'"${DEVTOOLS_PORT}"'/json/activate/" + keep.id, () => {}).on("error", () => {});
      const ws = new WebSocket(keep.webSocketDebuggerUrl);
      await new Promise((resolve) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: "'"${URL}"'" } }));
        };
        ws.onmessage = () => { ws.close(); resolve(); };
        ws.onerror = () => resolve();
      });
      console.log("REUSED");
    } else {
      console.log("NEW");
    }
  } catch {
    console.log("NEW");
  }
})();
')
if [ "${HAS_TAB}" != "REUSED" ]; then
  adb shell am start -a android.intent.action.VIEW -d "${URL}" com.oculus.browser >/dev/null
fi
sleep 2.5

node -e '
(async () => {
  const res = await fetch("http://localhost:'"${DEVTOOLS_PORT}"'/json");
  const pages = await res.json();
  const target = pages.find(p => p.type === "page" && p.url.includes("mode=visor-ar"));
  if (!target) {
    console.log("Could not find visor-ar tab in Quest Browser; tap ENTER VR / AR PASSTHROUGH manually.");
    process.exit(0);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(() => {
          const btn = [...document.querySelectorAll("button")].find(b => b.textContent.includes("ENTER VR") || b.textContent.includes("Enter Quest"));
          if (btn) { btn.click(); return "ENTERED_AR"; }
          return "ALREADY_ACTIVE_OR_NO_BUTTON";
        })()`,
        userGesture: true
      }
    }));
  };
  ws.onmessage = (e) => { console.log("DevTools:", e.data); ws.close(); };
  ws.onerror = () => process.exit(0);
})();
'

echo "==> [6/6] Launching single-eye widescreen scrcpy cast..."
pkill scrcpy 2>/dev/null || true
exec scrcpy \
  --crop=5000:3800:300:1900 \
  --max-size=1280 \
  --max-fps=60 \
  --no-audio \
  --window-title="Meta Quest 2 AR Demo"
