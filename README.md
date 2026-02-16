# eInvoicing Program Status Reports

Weekly leadership reports for the Global eInvoicing program at ClearTax.

## Adding a New Report

1. Copy the HTML report to `reports/YYYY-MM-DD.html`
2. Ensure `reports/styles.css` is up to date
3. Add an entry to `manifest.json` (newest first)
4. Commit and push

## Structure

```
├── index.html          # Landing page (reads manifest.json)
├── index-styles.css    # Index page styles
├── manifest.json       # Report registry (drives index)
├── styles.css          # Shared report styles (root copy)
├── reports/
│   ├── styles.css      # Same file, referenced by reports
│   └── YYYY-MM-DD.html # Individual reports
└── README.md
```

## Viewing

- **Locally**: Open `index.html` in a browser
- **Published**: Via GitHub Pages (private repo, requires GitHub Enterprise/Pro)
