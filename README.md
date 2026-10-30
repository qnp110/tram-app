# tram-app

A small departure board PWA for Zürich public transport, hosted on GitHub Pages.
It shows the next departures for a set of stops, merged into one board, styled like a classic station board.

## How it works

- **Button mode:** departures are fetched once when the app opens and again when you press **Next departures**.
  Between presses, nothing is requested; the clock and the "in X min" countdown update locally.
  The button has a 10 s cooldown so the free API isn't hammered.
- **Data:** [transport.opendata.ch](https://transport.opendata.ch/docs.html) by Opendata.ch (free, no API key, CORS enabled).
  Timetable data: [opentransportdata.swiss](https://opentransportdata.swiss).
- **No dependencies:** plain HTML, CSS and JavaScript, no build step, no libraries, no CDNs, no tracking.
  A Content Security Policy in `index.html` only allows connections to this site and `transport.opendata.ch`.
- **Offline:** a service worker caches the app's own files, and the last board is kept in `localStorage`.

## Files

| File | Purpose |
|---|---|
| `config.js` | Station presets, number of rows, cooldown, line colours. **Edit this to customise.** |
| `index.html` | Page structure and the vehicle pictograms (inline SVG). |
| `style.css` | Board styling (amber on black). |
| `app.js` | Fetching, merging, countdown, station search. |
| `sw.js` | Service worker (offline support). Bump `VERSION` after changing app files. |
| `manifest.webmanifest` | PWA metadata (name, icons, colours). |
| `tools/make_icons.py` | Regenerates `icons/icon-*.png` from the tram pictogram (standard library only). |

## Customising

- **Stations:** edit `presets` in `config.js`. Find a station's ID with
  `https://transport.opendata.ch/v1/locations?type=station&query=Bellevue`.
  In the app, stations can also be added (search field) and removed under **Stations**; edits go to "My stations".
- **Line colours:** add entries to `lineColors` in `config.js`, keyed by the label shown on the board,
  e.g. `"4": "#18286B"` or `"13": { bg: "#F6C442", fg: "#000000" }`.
- **Icons:** replace `icons/Tram_Zürich_Symbol_cropped.png` and run `python3 tools/make_icons.py`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Opening `index.html` directly as a file does not work, because ES modules and
service workers need a web server.)

## Deploy (GitHub Pages)

Live at **<https://qnp110.github.io/tram-app/>**

Setup (once):

1. GitHub → repository **Settings → Pages**.
2. *Source*: **Deploy from a branch**, branch **`main`**, folder **`/ (root)`** → **Save**.
3. After a minute or two the site is live at the URL above. GitHub Pages serves it over HTTPS, which PWAs require.

Every push to `main` redeploys automatically (progress under the repository's **Actions** tab).
All paths in the app are relative, so it works under the `/tram-app/` subpath without changes.

### Publishing an update

1. Change the files and bump `VERSION` in `sw.js` (e.g. `"v1"` → `"v2"`).
2. Commit and push to `main`.
3. Installed copies load the new files the next time they are opened with a connection. If one still shows the old
   version, close the app completely and open it again.

## Install as an app (PWA)

Open <https://qnp110.github.io/tram-app/> and add it to the home screen. It then opens full screen without the
browser bar, with its own icon, and still starts when offline (showing the last board).

- **iPhone / iPad (Safari):** Share button → **Add to Home Screen** → **Add**.
  (In other iOS browsers the option is also in the share menu.)
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app** → **Install**.
- **Desktop (Chrome / Edge):** install icon at the right end of the address bar, or ⋮ menu → **Install Departures Zürich**.
- **Desktop (Safari on macOS):** File → **Add to Dock**.

Notes:

- Settings (selected list, "My stations") are stored per device and per browser. An installed iOS app has its own
  storage, separate from Safari, so stations added in Safari don't carry over; set them up in the installed app, or
  hardcode them as a preset in `config.js`.
- To remove it, delete it like any other app (long-press the icon). This also deletes its stored settings.
- To make new presets, use [Schlieren, Spital Limmattal](https://transport.opendata.ch/v1/locations?type=station&query=schlieren,spitallimattal), replacing the station name at the end of the url.
