# Project status: read-only client view (Trimble Connect 3D viewer)

For the client (and admins / general contractor): construction progress of the Tekla pours, read from the statuses
that **Pour status (Arsten)** stores in the project library "CIP/Монолитно". Writes nothing to the data.

| File | What |
|---|---|
| `progress.js` | Pure logic: client-safe records (steps, "without", dates only), records as of a date, overall % by volume, per pour, timeline. Tests: `node --test test/progress.test.js` |
| `app.js` / `index.html` | Panel + Workspace API |
| `common.js`, `status.js`, `psetapi.js` | Copied from `viewer-pour-status` at publish (same stages, colours, reading) |
| `arsten-access.js` | Copied from `shared/` at publish; access for ADMIN, CLIENT, GENERAL CONTRACTOR (`app: "projectStatus"`) |
| `demo.js` | `index.html?demo`, made-up progress on the 1028 fixture. Not published. |

## What it shows
- **Colour by status** (tick box; the panel never changes the model's colours by itself, so a saved view stays as
  it is): Pour status stages and colours; everything that is not a pour is ghosted.
- **Overall progress** per stage by concrete volume ("Излят 62% · 204 / 329 m³") and pours complete.
- **By pour**: completion date per stage, or "done/total" while in progress.
- **Timeline**, newest first: date, pour, stage, objects, m³ ("without" steps are not events).
- **As of date** slider: everything (numbers, table, colours) as it was at the end of that day.
- **Save view**: Connect view of the current colouring (`view.createView`); the admin shares it from Views.

Not shown: notes, who marked, history, rebar / formwork / embed quantities, Excel (decided 12.11.2026).
