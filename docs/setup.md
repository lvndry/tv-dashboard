# Getting the TV talking to your computer

This dashboard installs over the network through
[Tizen Tap](https://github.com/lvndry/tizen-tap), a service app on the TV that
accepts app installs over HTTP on port 8091 and signs each package with the
TV's own certificate. To get that far you need two things: the TV's IP, and
Tizen Tap installed once.

After that, the whole loop is `bun run deploy` from this repo.

## 1. Find the TV's IP

On the TV: **Settings → General → Network → Network Status** (wording varies by
generation; some models bury it under *Settings → Support → Self Diagnosis →
Network Diagnosis*). The TV's **IP address** is what you put in `TV_HOST`.

It stays the same as long as your router keeps handing out the same DHCP
lease, so pin it in your router if you want it to survive reboots. Your
computer must be on the same LAN (no guest network).

## 2. Install Tizen Tap (once)

Follow the install section of the
[Tizen Tap README](https://github.com/lvndry/tizen-tap#install). In short:

1. Open the Developer Mode dialog (**Apps**, then `1` `2` `3` `4` `5` on the
   remote), turn **Developer mode** on and set **Host PC IP** to your
   computer's LAN IP.
2. Unplug the TV for 30 seconds and plug it back in. The TV only reads these
   settings at a real cold boot; standby does not count.
3. Run the Tizen Tap installer on your computer. It mints a Samsung
   certificate for your TV and installs Tizen Tap.
4. Set **Host PC IP** back to `127.0.0.1` and cold-boot the TV again, so the
   TV can install its own apps from then on.

Tizen Tap stays installed across reboots. A Smart Hub reset removes it (and
this dashboard); repeat this step after one.

## 3. Get the PIN

Every install request carries the Tizen Tap PIN:

```
POST http://TV_HOST:8091/install
x-homebrew-pin: <PIN>
x-homebrew-name: tv-dashboard.wgt
Content-Type: application/octet-stream
<body> raw .wgt bytes
```

Open Tizen Tap on the TV: its screen shows the 6-digit PIN. It is created on
first start and does not change, so you only copy it once. Developer builds
of Tizen Tap use `000000`. Five wrong PINs in a row lock installs for five
minutes.

## 4. This repo

```sh
cp .env.example .env           # fill in TV_HOST and TV_PIN
bun install
bun run deploy                 # build → package → install on the TV
```

- **`TV_HOST`**: the TV's IP from step 1
- **`TV_PORT`**: Tizen Tap's port, `8091` by default
- **`TV_PIN`**: the PIN from step 3
- **`TIZENJS`**: optional path to `tizenjs`, to sign the package locally with
  the certificates in `~/.tizen-certs`. If unset, `bun run pkg` uses
  `../tizen-tap/node_modules/.bin/tizenjs` when a tizen-tap checkout sits
  next to this repo. Without either, the package ships unsigned, which is
  fine: Tizen Tap re-signs every package with the TV's certificate anyway.

When the install fails, `bun run deploy` says why and exits non-zero:

| Tizen Tap answers | What to do |
| --- | --- |
| 403 | The PIN is wrong. Read it off the Tizen Tap screen and fix `TV_PIN`. |
| 429 | Too many wrong PINs. Wait the number of seconds it reports, then retry with the right PIN. |
| "An install is already running" | Another install is in progress on the TV. Wait for it, then deploy again. |
| No answer | The TV is off, or Tizen Tap is not running. Turn the TV on and open Tizen Tap. |

After a deploy the dashboard updates in place. Launch it from the TV's app
panel (it shows up as *TV Dashboard*), or over the Control API:

```sh
curl -X POST http://TV_HOST:8001/api/v2/applications/BonsoirTV1.Bonsoir
```
