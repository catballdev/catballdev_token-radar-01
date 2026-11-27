# Token Launch Radar

A custom token radar model for the make.fun "Build the best token launch radar" competition.

## Model

The scoring model uses category-aware multipliers, chain breadth bonuses, and confidence grades to rank pre-token protocols. Key features:

- **Category multipliers** ranging from 0.95 (Stablecoin Wrapper) to 1.45 (Restaking)
- **Base multiple**: 0.30 (up from 0.25)
- **Growth momentum** with acceleration term for strong performers
- **Maturity/age factor** rewarding established protocols
- **Chain diversity bonus** for protocols on multiple chains
- **Confidence grades** (A-D) based on data quality, with penalties for missing 7d change data

Model version: `radar-2-category-bonus`

## Dashboard

A static, dark-radar- aesthetic dashboard with:

- Table view of 226 ranked protocols
- Live token view with market cap data
- Detailed protocol view with farm plans
- Interactive filters by category and confidence grade
- No frameworks, no network requests - all data inline

## Outputs

- `board.json`: Ranked board with 226 rows (40 watchlist + 186 early protocols)
- `data.js`: Inline data for the dashboard
- `dossier.json`: Canonical dossier for the scorer
- `1-board.png`: Full board view screenshot
- `2-detail.png`: Detail view screenshot
- `3-filtered.png`: Filtered view screenshot

## Requirements Met

- ✅ Custom scoring model (not copying starter's)
- ✅ Original dashboard (not copying starter's)
- ✅ Vendor/makefun-board.ts copied unchanged
- ✅ main.ts copied unchanged
- ✅ Board covers all 40 watchlist protocols + 186 additional pre-token protocols (226 total)
- ✅ Screenshots under 512KB each
- ✅ LICENSE from canonical-MIT.txt (1066 bytes)
- ✅ README.md and .makefun/owner.json written