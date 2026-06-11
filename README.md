# NSE & BSE Market Data Scraper

Apify Actor for live Indian exchange data from confirmed NSE India and BSE India JSON endpoints.

## What it collects

- Index records from NSE `allIndices` and BSE Sensex realtime endpoints
- BSE equity quotes by symbol or scrip code
- NSE equity records when requested symbols appear in live mover or most-active NSE feeds
- Top gainers, top losers, and most-active/turnover records from NSE and BSE
- One flat dataset shape for all rows
- Pay-Per-Event charging only after a real record is pushed

Derivative/F&O rows are not exposed because the probed NSE/BSE derivative endpoints were not reliable enough to charge for.

## Input

```json
{
    "dataType": "index",
    "source": "both",
    "maxResults": 10
}
```

### Fields

| Field | Type | Description |
| --- | --- | --- |
| `dataType` | string | `index`, `equity`, or `market-stats` |
| `source` | string | `nse`, `bse`, or `both` |
| `symbols` | string[] | Equity symbols or BSE scrip codes. Used only for equity data. |
| `maxResults` | number | Max records per exchange/category. |

## Output

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
    "sector": "Energy",
    "industry": "Oil, Gas & Consumable Fuels",
    "isin": "INE002A01018",
    "scrapedAt": "2026-06-11T11:40:00.000Z"
}
```

## Notes

- NSE direct `quote-equity` returned 403 during probing, so NSE equity lookup is intentionally limited to live mover and most-active feeds.
- BSE equity lookup resolves symbols through `GetQuoteAllSearchDatabeta` and then reads current quote/header/trading/high-low endpoints.
- No placeholder or null-price rows are pushed. If an endpoint is unavailable, the actor logs the skip and moves on.
- Data is for research and informational use only, not financial advice.

## Development

```bash
npm install
npm run build
npm start
```
