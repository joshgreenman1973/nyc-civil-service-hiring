# New York City's civil service lists

Live: https://joshgreenman1973.github.io/nyc-civil-service-hiring/

A dashboard of every list of people who passed a New York City civil service exam: how far down agencies have gone on each, how long lists last, scores and credits, provisional employees, and a search for any job title or city agency.

- `build.py` pulls seven Department of Citywide Administrative Services datasets from NYC Open Data and writes `data/*.json` (Python standard library only; no names are written out).
- `index.html` + `app.js` draw the page; `house.css` is a copy of the shared house style.
- `methodology.html` gives sources, definitions and formulas; `how-i-built-this.html` logs every judgment call and the change log.
- `.github/workflows/refresh.yml` rebuilds the data daily.

Run locally: `python3 build.py`, then `python3 -m http.server` and open http://localhost:8000.
