# Token Radar — pre-token protocols, priced off live comps

<!-- TODO at submission time: confirm these three badge URLs against the official
     requirements for token-radar-01 (make.fun requirements API, readme_template)
     and replace the owner/repo placeholders before the first push. -->
[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/erika0723-muse/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/erika0723-muse/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the make.fun bounty ["Build the best token launch radar"](https://make.fun/bounty/token-radar-01): a dashboard that finds DeFi protocols whose token does not exist yet, ranks them by an implied value, and gives the concrete steps to farm each one.

## The board

From the sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14):

- **198 rows ranked** — every protocol that records no token (no market cap, no CoinGecko id, no symbol) and is not a wrapped, staked or bridged product of a token that already trades, by the house's own exclusion rule (versioned names, exchange-prefixed names and the Bridge / Liquid Staking / CEX categories are out).
- **All 40 watchlist protocols covered** (TVL at or above the $50M floor), plus 158 early rows below the floor — the smaller, earlier finds a radar exists for.
- Protocols whose token already trades are never ranked: they are shown apart, with their real market caps, because they are the comparables the model is priced from.

## The value model (radar-comps-1)

An implied value is what a token would plausibly be worth if the protocol launched against the record the snapshot shows. It is priced off the snapshot's own market, in three steps:

1. **Comps.** Every live-token protocol is a market observation: market cap divided by TVL. Each ratio is winsorized to 0.02x-3x first, so one token whose cap is plainly not priced off its protocol's TVL cannot drag a whole category. A category's multiple is then the median ratio of its traded protocols, shrunk toward the global median (0.17x on this snapshot) by the comp count. A Lending protocol is priced like traded lenders, a DEX like traded DEXes — not by one flat multiple for everything.
2. **Momentum.** The seven-day TVL change, clamped to -40%..+80%, scales the value from 0.70x to 1.60x: TVL gathering into a launch is worth more per dollar than TVL leaking away.
3. **Track record.** Days since the protocol was first tracked, capped at four years, scale the value from 0.70x to 1.00x: a launch is worth more from a protocol that has run for years with no token.

`implied = round( TVL x category_multiple x momentum x track_record )`

One function prices every row; no protocol name is special-cased, and the multiples are derived from the snapshot at run time. The dashboard recomputes each row in the page and shows it agrees with `board.json`.

## Farm plans

Every row carries a seven-step plan generated from its own record — category, first chain, TVL and age set the action, the capital ($50-$500 by TVL tier), the per-action gas for its chain, the weekly cadence and the hold (45-90 days by age). Each step states what it costs and how long it takes, and the plan ends with an exit rule (a 30% weekly TVL drop, or the token launching).

## The dashboard

`dashboard/` is a static page (no framework, no network; its data is `data.js`, written beside it by `main.ts`):

- the ranked board with sortable columns and an implied-value bar per row;
- filters that combine: text search, category, chain, minimum TVL, watchlist-only;
- a detail view per protocol with the full model breakdown and its farm plan;
- a live-token view showing the traded protocols and the ratios the multiples come from.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Node 22.18 or later, standard library only. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (built with `vendor/makefun-board.ts`) into the output directory, and refuses to write a board the gate would refuse.

## Layout

- `main.ts` — the entry program
- `lib/model.ts` — the comps model, board builder and farm-plan generator
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored from the kit
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`)
- `screenshots/` — the board, a detail view and a filtered view

## License

MIT — see `LICENSE`.
