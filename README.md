# NSE & BSE Indian Stock Market Data Scraper - Prices, Indices & Movers

Scrape **live Indian stock market data from NSE India and BSE India** - no login, no API key, no brokerage account required. Get real-time index levels, equity quotes (price, change, volume, market cap, P/E, P/B, EPS, ISIN, sector), and market movers (top gainers, top losers, most-active by volume and turnover) from confirmed official exchange JSON endpoints. Export to **JSON, CSV, Excel, or HTML**, or pull via the Apify API.

Built with Node.js 20, TypeScript, and the Apify SDK. Data comes straight from NSE and BSE public JSON feeds, so records are clean and structured - no fragile HTML scraping.

## What It Extracts

- Exchange (`nse` or `bse`) and record type (index / equity / mover)
- Symbol and full company/index name
- Last price, absolute change, and percent change
- Volume, traded value, and turnover
- Open, high, low, and previous close
- 52-week high and 52-week low
- Market cap, P/E ratio, P/B ratio, and EPS
- Sector, industry, and ISIN
- Exchange timestamp and scrape timestamp
- Source URL (BSE quote page when available)

## Use Cases

1. **Portfolio & watchlist tracking** — pull live prices and day stats for your NSE/BSE holdings on a schedule.
2. **Market dashboards** — feed indices, gainers, losers, and most-active feeds into your own dashboard or Google Sheet.
3. **Quant & backtesting inputs** — collect clean daily snapshots of valuation ratios and price data for analysis.
4. **Fintech & app data** — power an Indian-markets app or newsletter without paying for an expensive market-data vendor.
5. **Research & screening** — compare sector/industry valuation (P/E, P/B, EPS) across stocks.

## Pricing

This Actor uses Apify Pay Per Event. You pay only for real records saved to the dataset - empty or unavailable endpoints are never billed.

| Event name | Price per event | 1,000 records | 10,000 records |
| --- | ---: | ---: | ---: |
| `result-scraped` | $0.002 | $2.00 | $20.00 |

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `dataType` | string | yes | `index` | `index`, `equity`, or `market-stats` (gainers/losers/most-active). |
| `source` | string | yes | `both` | `nse`, `bse`, or `both`. |
| `symbols` | array<string> | no | `["RELIANCE"]` | Equity symbols (e.g. `RELIANCE`, `INFY`) or BSE scrip codes (e.g. `500325`). Used only for `equity`. |
| `maxResults` | integer | no | 10 | Max records per exchange/category (1-500). |

## How to Scrape NSE & BSE Data (Step by Step)

1. Click **Try for free** / **Run**.
2. Choose a **Data Type**: `index` for indices, `equity` for specific stocks, or `market-stats` for gainers/losers/most-active.
3. Choose the **Exchange**: `nse`, `bse`, or `both`.
4. For equity data, enter **symbols** (e.g. `RELIANCE`, `INFY`) or BSE scrip codes (e.g. `500325`).
5. Run, then export the results as CSV, JSON, or Excel - or pull them via the Apify API.

## Example Input

### Live indices from both exchanges

```json
{
  "dataType": "index",
  "source": "both",
  "maxResults": 10
}
```

### Specific equity quotes

```json
{
  "dataType": "equity",
  "source": "both",
  "symbols": ["RELIANCE", "INFY", "TCS"],
  "maxResults": 10
}
```

### Top gainers, losers & most-active

```json
{
  "dataType": "market-stats",
  "source": "nse",
  "maxResults": 20
}
```

## Sample Output

```json
{
  "source": "bse",
  "recordType": "equity",
  "symbol": "RELIANCE",
  "name": "Reliance Industries Ltd",
  "exchangeCode": "500325",
  "price": 1262.6,
  "change": 3.05,
  "changePercent": 0.24,
  "volume": 16.42,
  "turnover": 207.84,
  "marketCap": 1708618.34,
  "peRatio": 38.97,
  "pbRatio": 3.26,
  "eps": 32.4,
  "sector": "Energy",
  "industry": "Oil, Gas & Consumable Fuels",
  "isin": "INE002A01018",
  "url": "https://www.bseindia.com/stock-share-price/reliance-industries-ltd/reliance/500325/",
  "scrapedAt": "2026-06-11T11:40:00.000Z"
}
```

## API Example

```bash
curl -X POST "https://api.apify.com/v2/acts/YOUR_ACTOR_ID/runs?token=YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"equity","source":"both","symbols":["RELIANCE","INFY"],"maxResults":10}'
```

```js
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_API_TOKEN' });
const run = await client.actor('YOUR_ACTOR_ID').call({
    dataType: 'equity',
    source: 'both',
    symbols: ['RELIANCE', 'INFY'],
    maxResults: 10,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(`Got ${items.length} records`);
```

## How It Works

1. Reads your input and selects the confirmed NSE/BSE JSON endpoints for the chosen data type.
2. For indices: NSE `allIndices` and the BSE Sensex realtime feed.
3. For equities: resolves each symbol/scrip code and reads current quote, header, trading, and high-low endpoints (BSE), or live mover/most-active feeds (NSE).
4. For market-stats: top gainers, losers, and most-active by volume/turnover.
5. Normalizes every row into one flat shape and charges `result-scraped` only after a real record is saved.

## Reliability & Honest Limits

- Data comes from official public JSON endpoints, so it is structured and stable - not brittle HTML parsing.
- NSE's direct `quote-equity` endpoint blocks server requests (HTTP 403), so **NSE single-stock lookups are limited to symbols that appear in live mover/most-active feeds.** BSE equity lookup covers any listed scrip.
- Derivatives/F&O are intentionally not included - the probed endpoints were not reliable enough to charge for.
- No placeholder or null-price rows are pushed. If an endpoint is unavailable, the Actor logs the skip and continues.
- Data is for research and informational use only and is not financial advice.

## License

Apache-2.0. See `LICENSE`.
