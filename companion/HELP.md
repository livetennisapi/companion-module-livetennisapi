## Live Tennis API

Live tennis scores on your buttons: ATP, WTA, Challenger and ITF, from the
[Live Tennis API](https://livetennisapi.com). Player names, sets, games, points,
who is serving, break point and tiebreak state, match status, tournament and round.

This module is written and maintained by the vendor of the Live Tennis API
(Live Tennis API, hello@livetennisapi.com). It talks only to
`https://api.livetennisapi.com`.

### Setup

1. Create a **free** API key at <https://livetennisapi.com> (no card needed).
2. Add a **Live Tennis API** connection in Companion and paste the key into
   **API key**. It is stored in Companion's secrets store and sent as the
   `X-API-Key` header; the module never logs it.
3. Choose how the match is selected:
   - **First live match** (default): the first match in the live list; cycle with
     the _Next / Previous live match_ actions.
   - **Live match by player name**: type a surname (case-insensitive; `"Sinner"`,
     `"swiatek"`, `"Alcaraz vs Sinner"` all work). The first live match involving
     that player is selected. If none is live the status shows "No live match found".
   - **A specific match id**: the numeric `id` from `GET /matches`.
4. Optionally restrict the live list to one tour (ATP, WTA, Challenger, ITF).
5. Set the **poll interval** (see the budget note below).

### Request budget and the free tier

The free tier allows **30 requests per minute and 100 requests per day**
(paid plans: Basic 1,000/day, Pro 10,000/day, Ultra 500,000/day). The module makes
**one request per poll**: the live list (`GET /matches?status=live`) in the
first-live / player modes, or `GET /matches/{id}` in match-id mode. When a selected
match leaves the live list, one extra `GET /matches/{id}` fetches its final score.

| Poll interval           | Requests per day | Fits the free tier?  |
| ----------------------- | ---------------- | -------------------- |
| 900 s (default, 15 min) | 96               | yes                  |
| 300 s                   | 288              | no (Basic or higher) |
| 60 s                    | 1,440            | no (Pro or higher)   |
| 15 s (minimum)          | 5,760            | no (Pro or higher)   |

The interval is clamped to 15 s - 3,600 s so a typo cannot produce a tight loop.
_Refresh now_ and the select actions each cost one request; _Refresh now_ is
ignored if the previous request was under 5 s ago. _Next / Previous live match_
cycle through the last fetched list and cost nothing.

When the API answers **429** (per-minute limit, daily quota, or abuse throttle)
the module backs off: the poll interval doubles on every 429, up to 1 hour,
honouring the server's `Retry-After` / `resets_at`, and returns to the configured
interval after the next successful poll. The connection status shows a warning,
the `api_error` variable carries the reason (for example
`daily quota exhausted (resets 2026-09-13T00:00:00Z); next poll in 1800s`) and the
**API problem** feedback turns on.

### Connection status

| Situation                              | Status                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| No API key                             | Bad configuration                                        |
| Key rejected (401)                     | Authentication failure (polling slows to at least 5 min) |
| Plan does not unlock the request (403) | Warning                                                  |
| Rate limited (429)                     | Warning, with backoff                                    |
| Network error / timeout                | Connection failure, with backoff                         |
| No live matches, or player not live    | Warning ("No live match found ...")                      |
| Match id not found                     | Warning                                                  |

### Variables

All variables are prefixed with the connection label, e.g. `$(livetennis:points)`.

| Variable                                                                 | Meaning                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `player1_name`, `player2_name`                                           | Player names                                                                                          |
| `player1_country`, `player2_country`                                     | IOC country codes                                                                                     |
| `player1_ranking`, `player2_ranking`                                     | Official singles ranking                                                                              |
| `sets`                                                                   | Sets won, `1-0`                                                                                       |
| `games`                                                                  | Games per set, `6-4 3-4`                                                                              |
| `set1` ... `set5`, `set_scores`                                          | Individual set scores / all of them                                                                   |
| `current_set`, `current_set_games`                                       | Number of the set in progress and its games                                                           |
| `points`                                                                 | Points in the current game, `40-30` (`AD-40`); tiebreak count during a tiebreak (`5-3`)               |
| `score_line`                                                             | `6-4 3-4 40-30`                                                                                       |
| `server`, `server_name`                                                  | Serving player (`1`/`2`) and name; empty when not live                                                |
| `break_point`, `break_point_player`, `break_point_player_name`           | Break point state                                                                                     |
| `tiebreak`                                                               | `true` during a tiebreak                                                                              |
| `match_status`                                                           | `live`, `completed`, `upcoming`, `cancelled`, `live (Interrupted)`, `completed (Retired)`, `no match` |
| `event_status`, `outcome`                                                | Retired / Walk Over / Interrupted ...; completed / retired / walkover ...                             |
| `winner`, `winner_name`                                                  | Once completed                                                                                        |
| `tournament`, `round`, `round_code`, `surface`, `tour`, `draw`, `format` | Match context                                                                                         |
| `match_id`, `match_title`                                                | Selected match                                                                                        |
| `last_updated`, `last_updated_time`, `score_timestamp`                   | Freshness                                                                                             |
| `api_error`                                                              | Empty when healthy, otherwise the reason                                                              |
| `live_count`, `live_index`                                               | Size of the live list and the position of the selected match                                          |
| `poll_interval`, `requests_today`                                        | Effective cadence and the module's own request count (UTC day)                                        |

Break point rule: the receiver is at AD, or the receiver is at 40 while the
server is at 0, 15 or 30. Never during a tiebreak. Unknown (null) points never
count as a break point.

### Feedbacks (boolean)

| Feedback                                   | True when                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Match is live                              | `status == live`                                                    |
| Match is finished                          | `status` is completed or cancelled                                  |
| A match is selected                        | the module holds a match                                            |
| Set finished (set: latest / 1-5)           | that set is over (API sets tally, or 6+ with a 2-game margin / 7-6) |
| Tiebreak in progress                       | live and in a tiebreak                                              |
| Break point (either / player 1 / player 2) | the chosen player holds a break point                               |
| Player is serving (player 1 / 2)           | live and that player serves                                         |
| API problem                                | the last poll failed (see `api_error`)                              |

### Actions

| Action                                | Effect                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Select match by id                    | Poll that match now (supports variables)                                             |
| Select live match by player name      | Pick the first live match for that player (cached list first, otherwise one request) |
| Next live match / Previous live match | Cycle through the last fetched live list (no request)                                |
| Refresh now                           | Poll immediately (one request, 5 s guard)                                            |

Selections made with actions last until the connection config is saved again,
which resets the selection to the configured mode.

### Presets

**Scorebug**: scorebug (names, sets, current set), full score line, player 1 and
player 2 tiles (yellow while serving, orange when facing a break point), points
(blue in a tiebreak, orange on break point), sets and games, match status.
**Control**: next / previous live match, refresh now, API status.

### Notes

- Scores are as fresh as the last poll. For sub-second updates the API offers a
  WebSocket push feed on the Ultra plan, which this module does not use.
- Doubles matches appear in the live list too; player names are then team names.
- Docs and endpoint reference: <https://docs.livetennisapi.com>.
