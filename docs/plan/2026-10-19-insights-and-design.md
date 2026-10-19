# Insights and design, round 2

## Resumen (en castellano)

Mission Control suma cinco análisis nuevos y cuatro mejoras de diseño:

- **Pronóstico del límite:** a qué hora te quedás sin uso de 5 h y de 7 días, al ritmo de ahora.
- **Claude dando vueltas:** un aviso cuando el mismo comando falla 3 veces seguidas, con lo que costó.
- **Costo por tarea:** cuánto costó cada pedido tuyo, con las primeras palabras del pedido.
- **Lo que te ahorró el mod:** cuánto ahorraron las compactaciones en la semana.
- **Semana contra semana:** tu gasto contra la semana anterior, y qué proyecto explica la diferencia.

En diseño:

- un resumen **"Hoy"** arriba del panel;
- todos los tooltips con el mismo formato (qué es · cómo está · qué hacer);
- un gráfico de barras por mensaje en la pestaña Session;
- una tarjeta de bienvenida la primera vez.

Además, el plugin pasa a llamarse **Usage Coach** (comando `/usage-coach`). Se van los últimos rastros espaciales (el dibujo de la órbita, la palabra "payload"). El tono queda informativo: hechos y un paso concreto, sin sonar a "coaching".

Para vos cambia esto: ves antes los problemas (límite, vueltas) y ves cuánto te ahorra el mod. Cada número se explica igual en todos lados. Todo sigue costando 0 tokens. Nada se publica sin tu OK.

Esfuerzo: unas 3–4 h de agente, en 1–2 sesiones. Lo que depende de vos: probar con `/reload-plugins` y volver a sacar las capturas del README.

## Context

The previous stretch is still uncommitted in the working tree: plain naming, the Insights tab, idle compact 5 min before expiry, the queued compact and the "details" button. Gabriel is testing it live.

**Prerequisite:** build on top of that work. Never reset, stash or discard it. If Gabriel has confirmed his test, commit it first as its own commit (`feat: insights tab, plain naming, queued compact`), then start this plan.

Ground rules (from the owner):

- UI text is English, plain and direct, using Anthropic's own terms. No space metaphors.
- 0 tokens: local rules over the figures Claude Code already reports, with no model calls.
- Insights are worth showing only when they matter. Each one carries a number (money or time) and one exact step.
- No credits or old plugin names in the UI.
- Do not publish (push or install) without Gabriel's request.

Checks, all of which must pass at the end:

- `claude plugin test .`
- `claude plugin validate .`
- the type-check:

  ```bash
  npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json
  ```

  It includes the skill's `claude-code.d.ts`, `hooks/` and `types/`. Three errors already exist (`ui.render` return types at about register.tsx:450 and :469, and `key` on Text at about :506). The goal is no new ones.

## Features

### 1. Limit forecast

**What:** "At this pace the 5-hour limit runs out at 16:20, 1 h 10 min before it resets." The same applies to the 7-day limit.

**Data:**
- `Live.limits` gives `percentUsed` and `resetsAt` per window.
- Add `Live.limitSamples: Record<kind, {at, pct}[]>`: one sample per turn.complete, with the last 12 kept.

**Rule:**
- The pace is the slope over the samples of the last 60 min. Use at least 3 samples spanning 15 min or more.
- Projected run-out = now + (100 − pct) / slope.
- Warn only when the run-out comes before `resetsAt`.
  - Tone `hot` when the gap is 30 min or more.
  - Tone `warn` otherwise.

**Where:**
- The limit tooltip gets a "Runs out at HH:MM at this pace" line.
- The status card gets the same.
- The Insights tab gets a `limit-pace` insight.
- One toast per window per reset period.

**Tests:**
- A steady climb gives the right HH:MM.
- A flat pace gives no forecast.
- A run-out after the reset gives no warning.

### 2. Claude going in circles

**What:** "The same command failed 3 times in a row ($2.40 since the first failure). Stop Claude (Esc) and give it a hint."

**Data:**
- In `tool.call`, main loop only, read `ran.isError`.
- Key each call by tool + normalized target:
  - Bash: the command with numbers and whitespace collapsed, first 80 characters;
  - Edit/Write/Read: `file_path`;
  - other tools: the tool name.
- Keep a short in-memory streak: `{key, count, usdAtFirst}`. Get the dollars from `live.usd` at the first failure.
- Store it in `$.state` so a reload does not lose it: add `Live.loop?: {key, label, count, since, usdAtFirst}`.

**Rule:**
- Three consecutive errors with the same key raise the flag.
- A success, or a different key, resets the streak.

**Where:**
- One toast per streak: `Mission Control: Claude failed the same step 3 times (…). Press Esc and tell it what to try.`
- The strip's suggestion slot shows it while the streak lasts. It outranks savings moves, like `budget`.
- The Insights tab shows a `loop` insight.

**Tests:**
- 3 failures in a row flag it.
- 2 failures, then a success, does not.
- Failures with different keys do not.

### 3. Cost per task

**What:** In the Session tab, each row is one request of yours: "14:05 · "fix the login redirect…" · 9 steps · $6.30".

**Data:**
- `turn.start` gives `e.text`. Add `Turn.prompt?: string`, the first 60 characters on one line.
- A turn with empty text (a continuation) is merged into the previous task.
- Tasks are derived at draw time from `live.turns`, so no new state is needed.

**Where:**
- Session tab rows grouped by task. The most expensive task is marked.
- The tooltip of the session-cost strip part says "Last task: $X".

**Privacy:** the prompt text stays in `$.state`, local, and is never logged. Do not show it in toasts.

**Tests:** grouping with continuations, and truncation.

### 4. What Mission Control saved

**What:** "This week Mission Control saved about $14: 3 compactions before the cache expired."

**Data:** a ledger in `$.store` (key `savings`): `{at, kind: 'idle' | 'button', usd}[]`, pruned to 7 days.
- **idle:** the context rewrite it avoided, `rewriteUsd(before, model)`, minus the summary's own write, `rewriteUsd(after, model)`.
- **button:** (before − after) tokens × the cache-read price × the main-loop requests actually sent after it, until the next compaction or session end. Accrue it per turn and write it at the next compaction or at session.end.

**Where:**
- The "Today" header (see Design A).
- An Insights `saved` line.
- The README.

The ledger only records what happened. Never estimate savings that did not happen.

**Tests:** ledger math for both kinds, and pruning.

### 5. Week over week

**What:** "You spent 40% more than the week before; project X explains 70% of the difference."

**Data:** `scripts/week.mjs` gets `--days 14` and splits the report:
- `main`/`sub`/`projects` keep the last 7 days;
- a new `prev: { usd, projects: {name, usd}[] }` holds days 8–14.

Pricing stays in the hooks: the scanner returns tokens by model and project for `prev`, and the hooks price them with `tokensUsd`. Add `Week.prev?` to the types, which stays optional for old cached reports.

**Rule:**
- Show it when both weeks are $5 or more and the change is 20% or more.
- Name the project with the largest share of the difference.

**Where:**
- The History tab's top line.
- An Insights `week-trend` insight.

**Tests:** the delta and the attribution, and no line under the thresholds.

## Design

### A. "Today" header in the pane

Three large tiles above the tabs, on every tab:

- **Today**: cost today across sessions. It comes from the week scanner's new `today` usd, plus this session's live cost since the scanner ran.
- **5-hour limit**: % left, plus "runs out HH:MM" from feature 1.
- **Saved this week**: from feature 4.

If a value is unknown, show `—` and a dim reason, never 0.

### B. One tooltip format everywhere

Every strip part's tooltip and the status card rows follow three lines:

- **What it is**: one plain sentence.
- **Now**: the number and its state word (ALL GOOD / WATCH / ACT NOW).
- **What to do**: one step, or "Nothing to do."

Build it with one helper (`tipOf3({what, now, todo})` in strip.ts) and use it for all parts.

Colors keep one meaning: green means fine, amber means watch, red means act now. Every colored state also carries a symbol (✓ / ◆ / ▲), so it reads without color. Audit strip.ts and pane.tsx for any color used otherwise.

### C. Bar chart per message (Session tab)

Each turn row gets a bar of block characters (`█▉▊▋▌▍▎▏`), scaled to the session's most expensive turn. The color shows the main cause:

- red: the cache had expired;
- orchid: subagents made 50% or more of the cost;
- blue: anything else.

A one-line legend goes under the chart. Use only Box/Text props the engine accepts: the existing test that checks for refused props must cover the new tree.

### D. First-run welcome

On the first session after install (store flag `welcomed`), the strip shows a second row with three lines:

- what the strip shows;
- that hovering any part explains it;
- that "details" / O opens the panel.

A **got it** button sets the flag. The row never shows again, including after a reload.

## Rename to Usage Coach

Gabriel's decision, 2026-10-19.

"Token Coach" was the first pick. It was dropped because a well-known `token-coach` skill (alexgreensh/token-optimizer) and a "Token Efficiency Coach" plugin already exist. "Usage Coach" had no match.

**Name**
- Display name: **Usage Coach**.
- Plugin id: `usage-coach`.
- Slash command: `/usage-coach`.
- Marketplace stays `gabriel-mods`.

**Every place the old name appears**
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- The `$.state` key in `types/index.d.ts`: `'mission-control'` becomes `'usage-coach'`.
- `PANE` and the command registered in register.tsx.
- The prefix of every toast, log and status line: `Mission Control:` becomes `Usage Coach:`. This covers register.tsx, idle.ts, moves.ts, strip.ts, pane.tsx and scripts/week.mjs.
- The status card line "open the Mission Control panel".
- README and `docs/overview.html`.
- Tests that assert on these strings.

Grep for `mission` (case-insensitive) at the end. Only the README's install-migration note may still mention it.

**Tone: informative, not coaching**

"Coach" is only the brand. The text never talks like a coach:
- no "great job", "tip", "you should" or "try to";
- no exclamation marks and no motivational lines;
- every message is a fact with a number, then one step: "Compact before 15:40: the next message would cost $3.10 to send the context again."

Review every user-facing string in strip.ts, pane.tsx, insights.ts, moves.ts, idle.ts and register.tsx against this. `HABITS` lines stay as plain statements.

**Last space traces (visible)**
- The "All good" picture in the Suggestions tab (pane.tsx, an orbit with a moon) becomes a plain check mark in a circle.
- The cost line after each answer says `+X payload`. It becomes `+X context`.
- `docs/overview.html` still says Payload / Orbit / Fuel / Maneuvers / Flight log. Use the current names there.

**Internal names (separate commit)**

Identifiers such as `fuse`, `tank`, `race`, `moves`, `cargo`, `fuel` and `refuel` are not visible. Rename them to plain names (`idle`, `context`, `limit`, `suggestions`, `outputs`) in their own `refactor:` commit, after the features. Behaviour must not change, and all checks must still pass.

**Switching Gabriel's install (needs his OK, step by step)**
1. He removes the old one: `/plugin uninstall mission-control@gabriel-mods`.
2. He installs the new one: `/plugin install usage-coach@gabriel-mods`.
3. He opens a new session.
4. Renaming the GitHub repo to `usage-coach` is his call. GitHub redirects the old URL. The README's install lines change with it.

The local folder name can stay as it is.

## Order of work

0. The rename to Usage Coach and the tone review, in their own commit. Everything after this builds on the new name.
1. Types and state: `limitSamples`, `loop`, `Turn.prompt`, `Week.prev`, `Week.today`.
2. Features 1 and 2, the ones that warn about a problem as it happens, with tests.
3. Feature 3, cost per task, and design C, since both live in the Session tab.
4. Feature 4, savings, and feature 5, week over week (scanner change), with tests.
5. Design A, the "Today" header, and design B, the tooltip format (touches all of strip.ts).
6. Design D, the welcome card.
7. README: strip table, tabs and the new insights. Also update the `docs/overview.html` text to the plain names: it still says Payload/Orbit/Fuel/Maneuvers. Captures stay until Gabriel re-shoots them.
8. Run all checks and report to Gabriel in the cockpit format. Do not commit unless asked.

## Out of scope

- Context growth forecast and re-read files: Gabriel did not pick them this round.
- Publishing, and new screenshots.
- The three type errors that already exist.
