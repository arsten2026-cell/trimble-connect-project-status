# Project status: read-only client view (Trimble Connect 3D viewer)

For the client (and admins / general contractor): construction progress of the Tekla pours, read from the statuses
that **Pour status (Arsten / Multiplan)** (Монолитен бетон) stores in the project library "CIP/Монолитно". Writes nothing to the data.

| File | What |
|---|---|
| `progress.js` | Pure logic: client-safe records (steps, "without", dates only), records as of a date, overall % by volume, per pour, timeline. Tests: `node --test test/progress.test.js` |
| `app.js` / `index.html` | Panel + Workspace API |
| `common.js`, `status.js`, `psetapi.js` | Copied from `viewer-pour-status` at publish (same stages, colours, reading) |
| `arsten-access.js` | Copied from `shared/` at publish; access for ADMIN, CLIENT, GENERAL CONTRACTOR (`app: "projectStatus"`) |
| `client-summary.js` | Pure: client summary build / whitelist validation (no names, notes, logs, rejection texts), file list, read-only folder lookup, headline, by-type groups. Tests: `node --test test/client-summary.test.js` |
| `arsten-backup.js`, `arsten-acceptance.js` | Copied from `shared/` at publish: upload of the summary file; rebar acceptance (admin / GC only) |
| `demo.js` | `index.html?demo` (admin: publish), `?demo&client` (two published summaries), `&lang=en`, `&nosum`. Not published. UI smoke test: `node --test test/ui.test.js` |

## What it shows
- **Colour by status** (tick box; the panel never changes the model's colours by itself, so a saved view stays as
  it is): Pour status stages and colours; everything that is not a pour is ghosted.
- **Overall progress** per stage by concrete volume ("Излят 62% · 204 / 329 m³") and pours complete.
- **By pour**: completion date per stage, or "done/total" while in progress.
- **Timeline**, newest first: date, pour, stage, objects, m³ ("without" steps are not events).
- **As of date** slider: everything (numbers, table, colours) as it was at the end of that day.
- **Save view**: Connect view of the current colouring (`view.createView`); the admin shares it from Views.

- **Headline** (A18): "62% излято (204 / 329 m³) · +38 m³ тази седмица · 9 / 14 такта" and "Въз основа на: етап, модели (версия, дата), дата".
  The four bars are under "Подробности" (collapsed for clients, plain stage names).
- **Публикувай за клиента** (admin / GC, week 3): one client-safe JSON per day in `_AM_Docs/Client/summary-<YYYY-MM-DD>.json`
  (same day again = a new version of the same file), with the PM's note to the client. The CLIENT role reads only these
  files when any exist (picker "Както е публикувано на"); without any it falls back to the live view. Admin / GC: "Виж като клиент".
- **Арм. приета** column (✓ / чака / –), from the acceptance records (read only for admin / GC; the client gets it via the summary).
- **По тип / Списък**: pours grouped by their main Pour_Type.
- Clients: no "Запази изглед"; English by default when the Connect language is not Bulgarian.

Not shown: notes, who marked, history, rejection texts, Excel (decided 12.11.2026).
