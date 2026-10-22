# FraudIQ Frontend

Static HTML/CSS/JavaScript dashboard generated from the supplied credit-card fraud Python analysis and dataset.

## Included
- `index.html` — dashboard
- `style.css` — responsive styling
- `app.js` — UI logic and Chart.js charts
- `assets/data.json` — precomputed summary + 1,200-row preview

## Backend integration
The dashboard is intentionally static-hosting friendly. Replace the data-loading layer in `app.js` with `fetch()` calls to your future HTTPS Python API. The model section should be populated from backend ROC-AUC results once the backend exposes them.

The original CSV is not copied into this frontend because it is ~151 MB; keeping it out of GitHub Pages makes the site much faster and avoids committing the full dataset.
