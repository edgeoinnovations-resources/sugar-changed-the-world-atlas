# Sugar Changed the World — an interactive atlas

A scrollytelling web map built on Marc Aronson and Marina Budhos, *Sugar Changed the World: A Story of Magic, Spice, Slavery, Freedom, and Science* (Clarion Books, 2010).

Built for a 9th-grade source-analysis unit. Every primary source on the map opens with an **OPTIC** prompt (images) or a **SCRAP** prompt (maps).

**Live site:** `https://<your-username>.github.io/<repo-name>/`

---

## What's in it

**Story mode** — 31 steps through the book's five parts, each moving the map:

| Part | Covers |
|---|---|
| Opening | The Age of Honey |
| One — From Magic to Spice | New Guinea → India → Jundi Shapur → the Islamic world → the Champagne fairs → the Atlantic islands → 1493 |
| Two — Hell | Plantations, the Atlantic slave trade, the "spherical trade," the work stage by stage, the overseer, music as evidence |
| Three — Freedom | Tea and factories, the sugar tax, Clarkson and the boycott, Alligator Woods and Haiti, 1807 |
| Four — New Workers | Indenture, the black water, Bechu, Hawaii |
| Five — The Age of Science | Beet sugar, the two family stories, Rillieux, Satyagraha |

**Explore mode** — eight toggleable layers and a time slider from 7500 BC to 1950.

**Sources mode** — all 52 geolocated sources in a filterable grid.

### The book's five maps, rebuilt

All five printed maps are live layers rather than flat pictures:

1. Spread of Sugar (p. 11)
2. Areas Where Sugar Cane Was Grown (p. 19)
3. Sugar Crosses the Atlantic (p. 33) — with introduced and peak-production dates
4. Sugar and Atlantic Slavery (p. 62) — three eras
5. Indian Indentured Workers, 1835–1917 (p. 107)

Plus a sixth the book argues in prose but never draws: **the spherical trade** (p. 37), its correction of the textbook "Triangle Trade."

---

## Publishing it

1. Create a new repository on GitHub.
2. Upload everything in this folder to the repository root (or `git push` it).
3. Repository **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save**.
4. Wait about a minute. The site is live at the URL Pages shows you.

There is also a workflow at `.github/workflows/deploy.yml` if you prefer Actions-based deployment — in that case set **Settings → Pages → Source: GitHub Actions** instead.

### Running it locally

The map loads its data with `fetch`, so opening `index.html` by double-clicking will not work. Serve the folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## How it's built

| | |
|---|---|
| Map engine | MapLibre GL JS 4.7.1 — vendored in `vendor/`, not loaded from a CDN |
| Basemap | Natural Earth 1:110m, public domain, served from `data/` |
| Data | Three JSON files, hand-authored from the book |
| Images | 47 web derivatives (1600px max, ~19 MB total) |
| Build step | None. Static files. |
| Cost | $0 — no API keys, no tile service, no account, no tracking |

Because MapLibre and the basemap are both local, the site works on a school network that blocks CDNs, and keeps working if any external service disappears.

### Files

```
index.html            markup and the About panel
css/style.css         all styling
js/app.js             map, story, explore, source viewer
data/sources.json     52 primary sources: citation, rights, coordinates, prompt
data/layers.json      every thematic layer, with page references
data/narrative.json   the 31 story steps and their camera positions
data/ne_*.json        Natural Earth basemap
img/full, img/thumb   source images
vendor/               MapLibre GL JS
docs/                 teacher notes
```

### Editing it

- **Change wording or add a step** → `data/narrative.json`. Each step has a `camera` (`center` is `[longitude, latitude]`), a list of `layers`, and optional `sources`.
- **Add a source** → add an entry to `data/sources.json` and drop `<id>.jpg` into both `img/full/` and `img/thumb/`.
- **Fix a fact** → `data/layers.json`. Every entry carries a `p` field with the book page it came from.

No rebuild needed — save the file and reload.

---

## Notes on the history

**Uncertainty is shown, not hidden.** Every source states how confident its location is: *located* (the record names the place), *approximate* (inferred), *symbolic* (no single place — pinned where it belongs in the argument), or *uncertain* (the record doesn't say).

**Disagreements are shown too.** Several sources carry a `correction` — places where the book's caption, the archive's own title, or a common attribution conflict. For example, the St Kitts photograph is captioned "Two Sugar Workers" in the book; the Library of Congress title is *"Two pretty girls I met in a cane field."* Both appear. The elephant plough is usually credited to the *Illustrated London News*; it ran in *Gleason's Pictorial*. The Shahnama miniature is a substitute, because no free copy of the folio the book reproduces exists.

**One thing to check.** The book dates the English conquest of Jamaica to 1665. The invasion was 1655, with Spain ceding the island in 1670. The Jamaica pin flags this rather than silently correcting it — it makes a good exercise in checking a text against another source.

**What the slave-trade layer does not claim.** The book gives three era totals (3 million, 6 million, 3 million) and names four destination regions, but does not break the totals down by region. Neither does this map. The only figures shown are the ones the book states.

---

## Credits and rights

Content follows Aronson & Budhos, *Sugar Changed the World* (Clarion Books, 2010). This is an educational companion, not a substitute for the book.

Basemap: [Natural Earth](https://www.naturalearthdata.com/), public domain.
Map engine: [MapLibre GL JS](https://maplibre.org/), BSD-3-Clause.

OPTIC and SCRAP as a paired routine: Jo, I., Crane, M., Hong, J. E., & Huh, S. (2022). "GeoActivity Types in APHG: Analysis of Maps and Photos." *The Geography Teacher*, 19(2), 56–59.

Source images are mostly public domain. Exceptions carried through from the archive notes:

- British Library plates (Clark's *Ten Views*) — CC0
- Brunias, *Stick Fighting* — CC0, Yale Center for British Art
- V&A items — museum caps public images at 2500px
- Royal Museums Greenwich — caps at 1280px
- Wellcome items — Public Domain Mark

Each source panel names its holder and links to the record.

Two images in the book could not be obtained and appear as pins without pictures: Levni's sugar-garden folios (Topkapı A.3593) and Testard's aloe-wood miniature (Russian National Library fr. F.v.VI,1). Neither is openly digitised.

The code in this repository is released under the MIT License. That covers the code only, not the source images or the book's content.
