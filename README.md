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

## Deploy

GitHub → repository **Settings → Pages** → *Deploy from a branch* → `main` / root.
