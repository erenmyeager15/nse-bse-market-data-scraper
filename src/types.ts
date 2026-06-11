export type DataType = 'equity' | 'index' | 'market-stats';
export type Source = 'nse' | 'bse' | 'both';

export type RecordType =
    | 'equity'
    | 'index'
    | 'top_gainer'
    | 'top_loser'
    | 'most_active_by_value'
    | 'most_active_by_volume';

export interface ActorInput {
    dataType?: DataType;
    symbols?: string[];
    source?: Source;
    maxResults?: number;
}

export interface MarketRecord {
    source: 'nse' | 'bse';
    recordType: RecordType;
    symbol: string;
    name: string | null;
    series: string | null;
    exchangeCode: string | null;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    close: number | null;
    volume: number | null;
    value: number | null;
    turnover: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    marketCap: number | null;
    freeFloatMarketCap: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    eps: number | null;
    faceValue: number | null;
    dividendYield: number | null;
    sector: string | null;
    industry: string | null;
    isin: string | null;
    category: string | null;
    url: string | null;
    exchangeTimestamp: string | null;
    scrapedAt: string;
}
