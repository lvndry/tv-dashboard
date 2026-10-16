# Getting the TV talking to your computer

This dashboard installs over the network through a small "homebrew" service
app that runs on the TV (port 8091). To get that far you need three things:
the TV's IP, Developer Mode enabled, and the homebrew app installed once.

Everything below was done by hand exactly once. After that, the whole loop is
just `bun run deploy` from this repo.

## 1. Find the TV's IP

On the TV: **Settings → General → Network → Network Status** (wording varies by
generation; some models bury it under *Settings → Support → Self Diagnosis →
Network Diagnosis*). The TV's **IP address** is what you put in `TV_HOST`.

It's a fixed address as long as your router keeps handing out the same DHCP
lease — pin it in your router if you want it to survive reboots. Your
computer must be on the same LAN (no guest network).

## 2. Enable Developer Mode

Developer Mode is what grants a computer the "developer" status on the TV.
It is *not* a normal menu item — Samsung hides it behind a key code.

1. Press **Home** → open the **Apps** panel
2. Scroll to the very bottom → **App Settings** (a list item, not a gear icon)
3. Press the small **`123` button** on your remote (the one below the wheel)
   → an on-screen number keypad appears
4. Type **`12345`** (slowly — fast taps drop keystrokes)
5. A gray **Developer Mode** dialog appears with a toggle and an **IP field**
6. Turn the toggle **On** and set the IP field to **your computer's LAN IP**
   (not the TV's)
7. **Unplug the TV's power for 30 seconds and plug it back in**

That last step is the part everyone misses: the TV's dev daemon only reads the
settings at a *true* cold boot. Standby doesn't count. After the cold boot,
the dev channels come up.

Also note the dialog has a 50-hour auto-off: after 50 hours of continuous use
Developer Mode resets itself and you repeat the ritual. In practice nobody
notices for months.

You don't need Developer Mode to *run* the dashboard — only to install it
(and to drive the TV over the Control API).

## 3. Install the homebrew app (once)

The homebrew service (port 8091) is a tiny Tizen app that accepts app installs
over HTTP. It's the permanent sideload door. It comes from
[SushyDev/tizen-homebrew](https://github.com/SushyDev/tizen-homebrew), build
it with `HOMEBREW_DEV=1` so it exposes `/dev/eval`, mint a certificate for
your TV's DUID (Settings → Support → About This TV), sign, and install it via
`sdb` (Samsung Device Bridge, the dev daemon behind the cold-boot step).

Once installed, it stays installed across reboots. Its API:

```
POST http://TV_HOST:8091/install
x-homebrew-pin: <PIN>          # the dev build ships with 000000
x-homebrew-name: name.wgt
Content-Type: application/octet-stream
<body> raw .wgt bytes
```

## 4. This repo

```sh
cp .env.example .env           # fill in TV_HOST (+ TV_PIN, TV_PORT if needed)
bun install
bun run deploy                 # build → sign (if TIZENJS set) → push to TV
```

- **`TV_HOST`** — the TV's IP from step 1
- **`TV_PORT`** — homebrew service, default `8091`
- **`TV_PIN`** — homebrew PIN, `000000` on the dev build
- **`TIZENJS`** — optional path to the Tizen SDK's `tizenjs`. If unset, the
  package ships unsigned and the homebrew service re-signs it at install time
  with the certificate you minted in step 3

After a deploy the dashboard updates in place. Launch it from the TV's app
panel (it shows up as *TV Dashboard*), or over the Control API:

```sh
curl -X POST http://TV_HOST:8001/api/v2/applications/BonsoirTV1.Bonsoir
```
