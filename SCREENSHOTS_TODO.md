# Screenshots — TODO before submitting

The three PNGs currently in `screenshots/` are PLACEHOLDERS (solid slate with a caption).
They exist only so `main.ts` can run end to end locally. They must be replaced with real
captures of this dashboard before any submission — the first screenshot is the entry's
public cover image.

## How to capture

1. Build the output: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json`
2. Serve or open `out/dashboard/index.html` from disk in a browser (it reads `../data.js`; no network needed).
3. Capture at a viewport whose long side is at most 1440 px and short side at least 800 px
   (1440x900 works). Aim for roughly 300-350 KB per PNG: three at the 512 KiB cap would
   overflow the dossier.

## The three shots

| File | View | How to get there |
| --- | --- | --- |
| `1-board.png` | The board | Open the page with no hash. The ranked pre-token board, stats and model strip visible. |
| `2-detail.png` | A protocol detail view | Click the rank-1 row (or open with `#p=<slug>`). The detail panel shows the model breakdown and the farm plan. |
| `3-filtered.png` | A filtered view | Set Category = Dexs and Min TVL = $50M+ (or open with `#category=Dexs`). The row count must visibly drop and the filter controls must show the active filter. |

After replacing the images, rerun step 1 so `dossier.json` is rebuilt from the real captures.
