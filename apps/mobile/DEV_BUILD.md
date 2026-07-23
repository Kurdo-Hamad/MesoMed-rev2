# Mobile Dev Build

MesoMed is on Expo SDK 57, ahead of what's published to the Expo Go app on
the stores. Expo Go can no longer run this project — previewing on a real
device requires a **custom development build** (a standalone app with the
Expo dev client baked in) instead.

This is a one-time-per-native-change setup. Day-to-day iteration still uses
`expo start` / `pnpm dev` — only the _client app_ changes, not the workflow.

## One-time: build and install the dev client

EAS project: `@kurdo1/mesomed` (linked via `extra.eas.projectId` in `app.json`).
No global `eas-cli` install needed — every command below uses `npx eas-cli@latest`.

### Android

```
cd apps/mobile
npx eas-cli@latest build --profile development --platform android
```

This is a cloud build (~5-10 min). When it finishes, it prints an install
link + QR code (also visible any time at
https://expo.dev/accounts/kurdo1/projects/mesomed/builds). Open that link on
the Android device, tap install — Android will prompt to allow installing
from this source the first time. This installs a "MesoMed (dev)" app icon;
that's your dev client from now on, not Expo Go.

Rebuild only when native dependencies change (a new `expo-*`/native module,
an EAS profile change) — JS/TS changes never require a rebuild, just reload
in the running dev client.

### iOS

Requires an active **Apple Developer Program** enrollment ($99/yr,
https://developer.apple.com/programs/enroll/) — Apple review can take
24-48h+. No Mac or Xcode needed; EAS manages signing on its servers. Once
enrolled:

```
cd apps/mobile
npx eas-cli@latest device:create      # register your iPhone/iPad once (opens a registration QR/link)
npx eas-cli@latest build --profile development --platform ios
```

The first run is interactive (Apple ID sign-in + team selection) so EAS can
generate the signing certificate and ad-hoc provisioning profile.

## Day-to-day

```
pnpm dev        # from repo root — starts Metro for mobile (and other apps) via turbo
```

Open the "MesoMed (dev)" app on your device. It should auto-detect the
running Metro server if the device and this machine can reach each other
over the network (see WSL networking below); otherwise use the dev client's
"Enter URL manually" screen with `exp://<host>:8081`.

The `libnspr4.so` warning printed by `expo start` (RN DevTools missing a
system library) is harmless and unrelated to app functionality — ignore it
unless you're specifically trying to use RN DevTools.

### Reaching the API from a physical device

`apps/mobile/.env` (copy from `.env.example`, gitignored) needs
`EXPO_PUBLIC_API_URL` set to this machine's **LAN IP**, not `localhost` —
on a physical device, `localhost` resolves to the phone itself, not your
dev machine. Same LAN-reachability concern as Metro above; use the same
`<WINDOWS_LAN_IP>` from `ipconfig`, e.g. `http://192.168.1.20:4000`.

## WSL ↔ device networking

WSL2's virtual network isn't reachable from other devices on your LAN by
default, so a phone on the same Wi-Fi can't reach Metro inside WSL without
one of the two options below.

### Option A: portproxy (persistent LAN access)

WSL's internal IP changes on every restart, so this is a "run once per WSL
restart" step, done in an **elevated PowerShell on Windows**:

```powershell
# Get WSL's current IP first, from inside WSL: `ip addr show eth0`
netsh interface portproxy add v4tov4 listenport=8081 listenaddress=0.0.0.0 connectport=8081 connectaddress=<WSL_IP>
New-NetFirewallRule -DisplayName "WSL Metro 8081" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow
```

Then, from WSL, tell Metro to advertise your Windows machine's **LAN** IP
(from `ipconfig` on Windows, the Wi-Fi adapter's IPv4 address — not the WSL
IP) instead of its own:

```bash
export REACT_NATIVE_PACKAGER_HOSTNAME=<WINDOWS_LAN_IP>
pnpm dev
```

The phone (on the same Wi-Fi) then reaches `<WINDOWS_LAN_IP>:8081`, which
Windows proxies through to WSL.

To remove the proxy rule later: `netsh interface portproxy delete v4tov4 listenport=8081 listenaddress=0.0.0.0`.

### Option B: ngrok tunnel (fallback, no network config)

If portproxy isn't set up or you're on a network you don't control (e.g.
testing off your home Wi-Fi):

```bash
npx expo start --tunnel
```

This routes through an ngrok tunnel — no firewall/portproxy needed, but
slower and dependent on ngrok's relay being reachable. Requires the
`@expo/ngrok` package, which `expo start --tunnel` installs on first use.
