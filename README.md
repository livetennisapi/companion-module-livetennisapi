# companion-module-livetennisapi

A [Bitfocus Companion](https://bitfocus.io/companion) connection for the
[Live Tennis API](https://livetennisapi.com): live tennis scores (ATP, WTA,
Challenger, ITF) as button variables, boolean feedbacks and actions.

**Disclosure:** this module is written and maintained by Live Tennis API, the
vendor of the API it connects to. The free tier of the API (no card) is enough to
run it at the default cadence. The module only ever talks to
`https://api.livetennisapi.com`.

See [companion/HELP.md](./companion/HELP.md) for the user documentation
(setup, request budget, variables, feedbacks, actions, presets) and
[LICENSE](./LICENSE) (MIT).

## What it does

- Config: API key (secret), match selection (first live / by player name / by
  match id), tour filter, poll interval (15 s - 3600 s, default 900 s).
- Variables: `player1_name`, `player2_name`, `sets`, `games`, `points`, `server`,
  `match_status`, `tournament`, `round`, `set1`..`set5`, `break_point`,
  `tiebreak`, `last_updated`, `api_error` and more.
- Feedbacks: `match_live`, `match_finished`, `set_finished`,
  `tiebreak_in_progress`, `break_point`, `player_serving`, `api_error`,
  `match_selected`.
- Actions: select match by id, select by player name, next / previous live
  match, refresh now.
- One request per poll; 429 answers double the interval up to 1 h and are
  surfaced in `api_error`.

## Development

Requires Node.js 22 and Yarn 4 (via corepack).

```sh
yarn                # install
yarn test           # offline unit tests (node --test) for the pure helpers and the HTTP client
yarn lint           # eslint via @companion-module/tools
yarn format         # prettier
yarn check          # companion-module-check: manifest + license policy
yarn package        # companion-module-build: produces pkg/ and livetennisapi-<version>.tgz
```

The module follows the Companion module API 2.x contract
(`@companion-module/base` 2.0): ESM, `export default class` for the instance and
`export const UpgradeScripts`.

Layout:

```
companion/manifest.json   module metadata
companion/HELP.md         user help shown inside Companion
src/main.js               InstanceBase subclass: polling, backoff, selection, status
src/api.js                fetch client for api.livetennisapi.com (X-API-Key header)
src/config.js             config fields + normalisation
src/actions.js            action definitions
src/feedbacks.js          boolean feedback definitions
src/variables.js          variable definitions
src/presets.js            presets (scorebug + control)
src/upgrades.js           upgrade scripts (empty)
lib/tennis.js             pure tennis helpers (break point, set/score formatting, name matching)
lib/backoff.js            pure rate-limit backoff + Retry-After parsing
test/                     node --test suites (no network)
```

## Install as a local (developer) module

Until the module is available from the Companion module store you can run it
from a folder:

1. Clone this repository and run `yarn` inside it (Node 22, corepack enabled).
2. In the Companion launcher click the cog (Advanced settings). Under
   **Developer**, enable **Enable Developer Modules** and point the developer
   modules path at the **parent** folder that contains this repository folder
   (the path must contain module folders, not be a module folder itself).
3. Companion loads every module folder it finds there. Add a
   **Live Tennis API** connection, paste your key, and save. Companion restarts
   the module automatically when files change.

Alternatively build a package with `yarn package` and import the resulting
`livetennisapi-<version>.tgz` from Companion's _Modules_ page.

## API

Base URL `https://api.livetennisapi.com/api/public/v1`, header `X-API-Key`.
Endpoints used: `GET /matches?status=live` and `GET /matches/{matchId}`.
Reference: <https://docs.livetennisapi.com> (OpenAPI at
<https://docs.livetennisapi.com/openapi.yaml>).
