# Europe Map Studio

A small infographic studio. Tabs at the top of the sidebar switch between tools:

- **EU map**: choropleth maps of Europe. Import a CSV (or type values in),
  pick a multi-color gradient, and download the map as SVG (or PNG).
- **Voting results**: European Parliament roll-call votes as For/Against bars per
  political group, downloadable as SVG.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
npm run dev        # opens http://localhost:5173
```

For a production build: `npm run build`, then `npm run preview`.
Everything (map data included) is bundled, so it runs offline.

## Using it

- **Data → Upload CSV** (or drop a file anywhere on the page). Comma, semicolon and tab
  separated files work, as do European number formats (`1.234,5`), `%`/currency signs and
  Eurostat flags/`:` for missing values.
  - The country column and value column are detected automatically; change them with the
    two dropdowns (with yearly columns the latest year is chosen).
  - Countries are matched by English name, ISO 2/3-letter code (also Eurostat `EL`, `UK`, `XK`),
    names in 14 European languages, common aliases (Czech Republic, Holland, Macedonia,
    Russian Federation, Kosovo*, "Moldova, Republic of" …) and diacritic-insensitive spelling.
    Close misspellings are matched as "guessed" and flagged for review.
  - Rows that could not be matched are listed in red with a country dropdown. Your choice is
    applied immediately and remembered for future imports.
- **Click any country** on the map (or use the country list in the sidebar) to enter or
  change a value by hand. The map updates instantly.
- **Colors & legend**: start from a preset, then add as many colors as you like
  (“+ Add color”, or click on the gradient bar), drag the handles to move them, edit
  hex values, reverse or space them evenly. Choose a continuous scale or classes
  (equal interval / quantile), fixed or data-driven range, legend title, unit prefix/suffix
  and decimals.
- **Export & download**: pixel size, whole Europe or current zoom,
  background, legend on/off, file name → **Download SVG** (vector, editable in Illustrator,
  Inkscape or Figma) or PNG.

Settings and data are saved in the browser (localStorage), so they survive a reload.
“Reset all settings” at the bottom of the sidebar clears them.

## Voting results

- **Roll-call file**: upload the European Parliament roll-call XML (`PV-…-RCV_EN.xml`). If it
  contains several votes, pick one from the list. Counts come from the member names listed
  under each group, and a badge shows whether they match the totals stated in the file.
- **Groups & labels**: drag groups (or use the arrows) to change their order, and edit the
  label under the bars. Each group's logo (`src/votes/logos/`) sits between its bars; a group
  without a logo gets a coloured circle with an editable abbreviation. Non-attached members (NI)
  are listed in the table but not drawn.
- **Bar colours**: pick colours for the For bars, Against bars and labels, or use a preset.
- **Numbers by political group**: every number can be typed in by hand. "Restore file numbers"
  undoes edits; "New blank vote" starts a vote from zero without a file.
- **Download SVG**: a 1080 px wide graphic with a transparent background and live text, ready
  to drop into a social post template. Labels use Gilroy Light and numbers Gilroy ExtraBold.
- **Fonts**: Gilroy is a licensed font and is not included in this repository. The page uses
  the copy installed on your computer; if it isn't installed, load the font files in the
  **Fonts** section (they stay in your browser). Design tools render the exported text in
  Gilroy wherever it is installed.

## Adding another infographic

Each tool is its own page: add `newtool.html` next to `index.html`, its code under
`src/newtool/`, list the page in `vite.config.js` (`build.rollupOptions.input`), and add a link
to the `.app-tabs` nav in every page.

## Map data

Borders come from [Natural Earth](https://www.naturalearthdata.com/) 1:10m admin-0
countries, current master (v5.1.x / 5.2-pre), **German/EU point-of-view edition**:
Kosovo shown as a country, Cyprus undivided, Crimea as part of Ukraine, North Macedonia,
Czechia and Türkiye named as they are today. The prepared file is `src/data/europe.topo.json`.

To regenerate it (e.g. after a new Natural Earth release):

```bash
mkdir -p raw
curl -L -o raw/ne_10m_admin_0_countries_deu.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_deu.geojson
npm run build:geo
```

## Project layout

```
index.html            EU map page: sidebar + map layout
votes.html            Voting results page
src/main.js           app state, UI wiring, CSV import, map interaction
src/votes/            roll-call XML parsing, bar chart and SVG export
src/matching.js       country-name matching and number parsing
src/color.js          gradient presets and color scales
src/render.js         map + legend drawing (shared by screen and export)
src/export.js         standalone SVG / PNG export
src/data/             map TopoJSON and sample CSV
scripts/build-geo.mjs builds the map TopoJSON from Natural Earth
```

## Publish on GitHub Pages

The app is a static site, so GitHub Pages can host it for free.

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repository go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) builds and publishes on every push.
   The site appears at `https://<your-user>.github.io/<repo-name>/`.
