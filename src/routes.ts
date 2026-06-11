import { request } from 'node:https';
import { log } from 'apify';
import { ActorInput, DataType, MarketRecord, RecordType, Source } from './types.js';

type JsonObject = Record<string, unknown>;

const NSE_BASE_URL = 'https://www.nseindia.com';
const BSE_API_BASE_URL = 'https://api.bseindia.com/BseIndiaAPI/api';
const BSE_REALTIME_BASE_URL = 'https://api.bseindia.com/RealTimeBseIndiaAPI/api';
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const nseHeaders: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    referer: `${NSE_BASE_URL}/`,
};

const bseHeaders: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.bseindia.com/',
    origin: 'https://www.bseindia.com',
};

export function normalizeInput(input: ActorInput | null): Required<Pick<ActorInput, 'dataType' | 'source' | 'maxResults'>> & {
    symbols: string[];
} {
    return {
        dataType: input?.dataType ?? 'index',
        source: input?.source ?? 'both',
        maxResults: Math.max(1, Math.min(500, Math.trunc(input?.maxResults ?? 10))),
        symbols: normalizeSymbols(input?.symbols),
    };
}

export async function collectRecords(input: ActorInput | null): Promise<MarketRecord[]> {
    const normalized = normalizeInput(input);
    const sources = normalized.source === 'both' ? (['nse', 'bse'] as const) : ([normalized.source] as const);
    const records: MarketRecord[] = [];

    for (const source of sources) {
        try {
            if (source === 'nse') {
                records.push(...(await collectNseRecords(normalized.dataType, normalized.symbols, normalized.maxResults)));
            } else {
                records.push(...(await collectBseRecords(normalized.dataType, normalized.symbols, normalized.maxResults)));
            }
        } catch (error) {
            log.warning(`${source.toUpperCase()} collection failed: ${errorMessage(error)}`);
        }
    }

    const deduped = deduplicateRecords(records).filter(isUsableRecord);
    enrichNseNamesFromBse(deduped);
    return deduped;
}

/** When both exchanges return the same symbol, fill a missing NSE company name from the BSE record. */
function enrichNseNamesFromBse(records: MarketRecord[]): void {
    const bseNameBySymbol = new Map<string, string>();
    for (const r of records) {
        if (r.source === 'bse' && r.symbol && r.name) bseNameBySymbol.set(r.symbol, r.name);
    }
    for (const r of records) {
        if (r.source === 'nse' && !r.name && r.symbol && bseNameBySymbol.has(r.symbol)) {
            r.name = bseNameBySymbol.get(r.symbol) ?? null;
        }
    }
}

export function isUsableRecord(record: MarketRecord): boolean {
    return Boolean(record.symbol) && record.price !== null;
}

async function collectNseRecords(dataType: DataType, symbols: string[], maxResults: number): Promise<MarketRecord[]> {
    if (dataType === 'index') return fetchNseIndices(maxResults);
    if (dataType === 'market-stats') return fetchNseMarketStats(maxResults);
    return fetchNseEquities(symbols, maxResults);
}

async function collectBseRecords(dataType: DataType, symbols: string[], maxResults: number): Promise<MarketRecord[]> {
    if (dataType === 'index') return fetchBseIndices(maxResults);
    if (dataType === 'market-stats') return fetchBseMarketStats(maxResults);
    return fetchBseEquities(symbols, maxResults);
}

async function fetchJson<T>(url: string, headers: Record<string, string>, allowLooseHttpParser = false): Promise<T> {
    let body: string;
    try {
        body = await fetchText(url, headers);
    } catch (error) {
        if (!allowLooseHttpParser) throw error;
        body = await fetchTextWithLooseParser(url, headers);
    }

    if (body.trim().startsWith('<')) {
        throw new Error(`Expected JSON but received HTML from ${url}`);
    }
    return JSON.parse(body) as T;
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            headers,
            redirect: 'follow',
            signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
        }
        return body;
    } finally {
        clearTimeout(timeout);
    }
}

function fetchTextWithLooseParser(url: string, headers: Record<string, string>, redirectCount = 0): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                method: 'GET',
                headers,
                timeout: REQUEST_TIMEOUT_MS,
                insecureHTTPParser: true,
            },
            (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    if (redirectCount > 5) {
                        reject(new Error(`Too many redirects from ${url}`));
                        return;
                    }
                    const nextUrl = new URL(res.headers.location, url).toString();
                    fetchTextWithLooseParser(nextUrl, headers, redirectCount + 1).then(resolve, reject);
                    return;
                }

                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => {
                    body += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 180)}`));
                        return;
                    }
                    resolve(body);
                });
            },
        );

        req.on('timeout', () => {
            req.destroy(new Error(`Request timed out for ${url}`));
        });
        req.on('error', reject);
        req.end();
    });
}

async function fetchNseIndices(maxResults: number): Promise<MarketRecord[]> {
    const data = await fetchJson<JsonObject>(`${NSE_BASE_URL}/api/allIndices`, nseHeaders);
    return toArray(data.data)
        .slice(0, maxResults)
        .map((row) => {
            const symbol = firstString(row, ['indexSymbol', 'index', 'key']) ?? 'UNKNOWN';
            return {
                ...baseRecord('nse', 'index', symbol),
                name: firstString(row, ['index', 'indexLongName']) ?? symbol,
                price: firstNumber(row, ['last']),
                change: firstNumber(row, ['variation', 'change']),
                changePercent: firstNumber(row, ['percentChange']),
                open: firstNumber(row, ['open']),
                high: firstNumber(row, ['high']),
                low: firstNumber(row, ['low']),
                previousClose: firstNumber(row, ['previousClose']),
                fiftyTwoWeekHigh: firstNumber(row, ['yearHigh', '52wHigh']),
                fiftyTwoWeekLow: firstNumber(row, ['yearLow', '52wLow']),
                peRatio: firstNumber(row, ['pe']),
                pbRatio: firstNumber(row, ['pb']),
                dividendYield: firstNumber(row, ['dy']),
                category: firstString(row, ['key']),
                exchangeTimestamp: firstString(row, ['timeVal', 'timestamp']),
            };
        });
}

async function fetchNseMarketStats(maxResults: number): Promise<MarketRecord[]> {
    const records: MarketRecord[] = [];

    const gainers = await settle(() => fetchNseVariationRecords('gainers', 'top_gainer', maxResults));
    const losers = await settle(() => fetchNseVariationRecords('losers', 'top_loser', maxResults));
    const activeByValue = await settle(() => fetchNseMostActive('value', 'most_active_by_value', maxResults));
    const activeByVolume = await settle(() => fetchNseMostActive('volume', 'most_active_by_volume', maxResults));

    records.push(...gainers, ...losers, ...activeByValue, ...activeByVolume);
    return records;
}

async function fetchNseEquities(symbols: string[], maxResults: number): Promise<MarketRecord[]> {
    const wanted = symbols.slice(0, maxResults).map((symbol) => symbol.toUpperCase());
    if (wanted.length === 0) {
        log.warning('No NSE symbols were supplied for equity data.');
        return [];
    }

    const entries = [
        ...(await settle(() => fetchNseVariationEntries('gainers'))),
        ...(await settle(() => fetchNseVariationEntries('losers'))),
        ...(await settle(() => fetchNseMostActiveEntries('value'))),
        ...(await settle(() => fetchNseMostActiveEntries('volume'))),
    ];

    const bySymbol = new Map<string, MarketRecord>();
    for (const entry of entries) {
        const record = mapNseEquity(entry.row, entry.category, entry.timestamp);
        if (record.symbol && !bySymbol.has(record.symbol)) bySymbol.set(record.symbol, record);
    }

    const records = wanted.flatMap((symbol) => {
        const record = bySymbol.get(symbol);
        if (!record) {
            log.warning(`NSE equity ${symbol} was not present in the live mover/active feeds; skipping.`);
            return [];
        }
        return [record];
    });

    return records;
}

async function fetchNseVariationRecords(
    index: 'gainers' | 'losers',
    recordType: Extract<RecordType, 'top_gainer' | 'top_loser'>,
    maxResults: number,
): Promise<MarketRecord[]> {
    const entries = await fetchNseVariationEntries(index);
    const preferred = entries.filter((entry) => entry.category === 'allSec');
    const sourceEntries = preferred.length > 0 ? preferred : entries;
    return sourceEntries.slice(0, maxResults).map((entry) => mapNseMover(entry.row, recordType, entry.category, entry.timestamp));
}

async function fetchNseVariationEntries(index: 'gainers' | 'losers'): Promise<Array<{ row: JsonObject; category: string; timestamp: string | null }>> {
    const data = await fetchJson<JsonObject>(`${NSE_BASE_URL}/api/live-analysis-variations?index=${index}`, nseHeaders);
    const entries: Array<{ row: JsonObject; category: string; timestamp: string | null }> = [];

    for (const [category, value] of Object.entries(data)) {
        const bucket = asObject(value);
        if (!bucket) continue;
        const rows = toArray(bucket.data);
        if (rows.length === 0) continue;
        const timestamp = firstString(bucket, ['timestamp']);
        entries.push(...rows.map((row) => ({ row, category, timestamp })));
    }

    return entries;
}

async function fetchNseMostActive(
    index: 'value' | 'volume',
    recordType: Extract<RecordType, 'most_active_by_value' | 'most_active_by_volume'>,
    maxResults: number,
): Promise<MarketRecord[]> {
    const entries = await fetchNseMostActiveEntries(index);
    return entries.slice(0, maxResults).map((entry) => mapNseMover(entry.row, recordType, entry.category, entry.timestamp));
}

async function fetchNseMostActiveEntries(index: 'value' | 'volume'): Promise<Array<{ row: JsonObject; category: string; timestamp: string | null }>> {
    const data = await fetchJson<JsonObject>(`${NSE_BASE_URL}/api/live-analysis-most-active-securities?index=${index}`, nseHeaders);
    const timestamp = firstString(data, ['timestamp']);
    return toArray(data.data).map((row) => ({ row, category: index, timestamp }));
}

function nseCompanyName(row: JsonObject): string | null {
    const direct = firstString(row, ['companyName', 'metaCompanyName', 'meta_companyName']);
    if (direct) return direct;
    const meta = asObject(row.meta);
    return meta ? firstString(meta, ['companyName', 'name']) : null;
}

function mapNseMover(row: JsonObject, recordType: RecordType, category: string, timestamp: string | null): MarketRecord {
    const symbol = (firstString(row, ['symbol', 'identifier']) ?? 'UNKNOWN').toUpperCase();
    return {
        ...baseRecord('nse', recordType, symbol),
        name: nseCompanyName(row),
        series: firstString(row, ['series']),
        price: firstNumber(row, ['ltp', 'lastPrice']),
        change: firstNumber(row, ['net_price', 'change']),
        changePercent: firstNumber(row, ['perChange', 'pChange']),
        open: firstNumber(row, ['open_price', 'open']),
        high: firstNumber(row, ['high_price', 'dayHigh', 'high']),
        low: firstNumber(row, ['low_price', 'dayLow', 'low']),
        close: firstNumber(row, ['closePrice']),
        previousClose: firstNumber(row, ['prev_price', 'previousClose']),
        volume: firstNumber(row, ['trade_quantity', 'quantityTraded', 'totalTradedVolume']),
        value: firstNumber(row, ['totalTradedValue']),
        turnover: firstNumber(row, ['turnover', 'totalTradedValue']),
        fiftyTwoWeekHigh: firstNumber(row, ['yearHigh']),
        fiftyTwoWeekLow: firstNumber(row, ['yearLow']),
        category,
        exchangeTimestamp: firstString(row, ['lastUpdateTime']) ?? timestamp,
    };
}

function mapNseEquity(row: JsonObject, category: string, timestamp: string | null): MarketRecord {
    return {
        ...mapNseMover(row, 'equity', category, timestamp),
        recordType: 'equity',
        // The internal feed-bucket name ("NIFTY"/"value"/"allSec") is noise for a single equity.
        category: null,
    };
}

async function fetchBseIndices(maxResults: number): Promise<MarketRecord[]> {
    const rows = await fetchJson<unknown>(`${BSE_REALTIME_BASE_URL}/GetSensexDatanew/w`, bseHeaders, true);
    return toArray(rows)
        .slice(0, maxResults)
        .map((row) => {
            const symbol = firstString(row, ['indxcode', 'indxnm']) ?? 'UNKNOWN';
            return {
                ...baseRecord('bse', 'index', symbol),
                name: firstString(row, ['indxnm']) ?? symbol,
                exchangeCode: firstString(row, ['indxcode']),
                price: firstNumber(row, ['ltp']),
                change: firstNumber(row, ['chg']),
                changePercent: firstNumber(row, ['perchg']),
                open: firstNumber(row, ['I_open']),
                high: firstNumber(row, ['High']),
                low: firstNumber(row, ['Low']),
                previousClose: firstNumber(row, ['Prev_Close']),
                category: 'index',
                exchangeTimestamp: firstString(row, ['dttm']),
            };
        });
}

async function fetchBseMarketStats(maxResults: number): Promise<MarketRecord[]> {
    const gainers = await settle(() => fetchBseHoTurnover('G', 'top_gainer', maxResults));
    const losers = await settle(() => fetchBseHoTurnover('L', 'top_loser', maxResults));
    const activeByValue = await settle(() => fetchBseHoTurnover('T', 'most_active_by_value', maxResults));
    return [...gainers, ...losers, ...activeByValue];
}

async function fetchBseHoTurnover(flag: 'G' | 'L' | 'T', recordType: RecordType, maxResults: number): Promise<MarketRecord[]> {
    const data = await fetchJson<JsonObject>(`${BSE_API_BASE_URL}/HoTurnover/w?flag=${flag}`, bseHeaders, true);
    return toArray(data.Table)
        .slice(0, maxResults)
        .map((row) => mapBseMover(row, recordType, flag));
}

function mapBseMover(row: JsonObject, recordType: RecordType, category: string): MarketRecord {
    const symbol = (firstString(row, ['scrip_id', 'ScripName']) ?? 'UNKNOWN').toUpperCase();
    return {
        ...baseRecord('bse', recordType, symbol),
        name: firstString(row, ['LONGNAME', 'ScripName']) ?? symbol,
        exchangeCode: firstString(row, ['scrip_cd']),
        price: firstNumber(row, ['Ltradert']),
        change: firstNumber(row, ['change_val']),
        changePercent: firstNumber(row, ['change_percent']),
        volume: firstNumber(row, ['Trd_vol']),
        value: firstNumber(row, ['Trd_val']),
        turnover: firstNumber(row, ['Trd_val']),
        category,
        url: firstString(row, ['NSUrl']),
        exchangeTimestamp: firstString(row, ['DT_TM', 'dt_tm']),
    };
}

async function fetchBseEquities(symbols: string[], maxResults: number): Promise<MarketRecord[]> {
    const wanted = symbols.slice(0, maxResults);
    if (wanted.length === 0) {
        log.warning('No BSE symbols or scrip codes were supplied for equity data.');
        return [];
    }

    const records: MarketRecord[] = [];
    for (const symbol of wanted) {
        const resolved = await settleOne(() => resolveBseScrip(symbol));
        if (!resolved?.code) {
            log.warning(`BSE equity ${symbol} could not be resolved to a scrip code; skipping.`);
            continue;
        }

        const [header, company, trading, highLow] = await Promise.all([
            settleOne(() => fetchBseJsonObject(`${BSE_API_BASE_URL}/getScripHeaderData/w?Debtflag=&scripcode=${resolved.code}&seriesid=`)),
            settleOne(() => fetchBseJsonObject(`${BSE_API_BASE_URL}/ComHeadernew/w?quotetype=&scripcode=${resolved.code}&seriesid=`)),
            settleOne(() => fetchBseJsonObject(`${BSE_API_BASE_URL}/StockTrading/w?flag=&quotetype=EQ&scripcode=${resolved.code}`)),
            settleOne(() => fetchBseJsonObject(`${BSE_API_BASE_URL}/HighLow/w?Type=EQ&flag=C&scripcode=${resolved.code}`)),
        ]);

        const currRate = asObject(header?.CurrRate);
        const companyName = asObject(header?.Cmpname);
        const record: MarketRecord = {
            ...baseRecord('bse', 'equity', (firstString(company, ['SecurityId']) ?? resolved.symbol ?? symbol).toUpperCase()),
            name: firstString(companyName, ['FullN', 'SeriesN']) ?? resolved.name ?? symbol,
            series: firstString(company, ['Group']),
            exchangeCode: resolved.code,
            price: firstNumber(currRate, ['LTP']),
            change: firstNumber(currRate, ['Chg']),
            changePercent: firstNumber(currRate, ['PcChg']),
            volume: firstNumber(trading, ['TTQ']),
            value: firstNumber(trading, ['Turnover']),
            turnover: firstNumber(trading, ['Turnover']),
            fiftyTwoWeekHigh: firstNumber(highLow, ['Fifty2WkHigh_adj']),
            fiftyTwoWeekLow: firstNumber(highLow, ['Fifty2WkLow_adj']),
            marketCap: firstNumber(trading, ['MktCapFull']),
            freeFloatMarketCap: firstNumber(trading, ['MktCapFF']),
            peRatio: firstNumber(company, ['PE']),
            pbRatio: firstNumber(company, ['PB']),
            eps: firstNumber(company, ['EPS']),
            faceValue: firstNumber(company, ['FaceVal']),
            sector: firstString(company, ['Sector']),
            industry: firstString(company, ['IndustryNew', 'Industry']),
            isin: firstString(company, ['ISIN']) ?? resolved.isin,
            category: firstString(companyName, ['Category']),
            url: resolved.url ?? buildBseUrl(
                firstString(companyName, ['FullN', 'SeriesN']) ?? resolved.name,
                firstString(company, ['SecurityId']) ?? resolved.symbol,
                resolved.code,
            ),
        };

        records.push(record);
    }

    return records;
}

async function fetchBseJsonObject(url: string): Promise<JsonObject> {
    return fetchJson<JsonObject>(url, bseHeaders, true);
}

/** Build a canonical BSE stock-price URL (matches the SEO format) from name + security id + code. */
function buildBseUrl(name: string | null, securityId: string | null, code: string): string | null {
    if (!code) return null;
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (name && securityId) {
        return `https://www.bseindia.com/stock-share-price/${slug(name)}/${slug(securityId)}/${code}/`;
    }
    return `https://www.bseindia.com/stock-share-price/x/x/${code}/`;
}

async function resolveBseScrip(symbol: string): Promise<{ code: string; symbol: string | null; name: string | null; isin: string | null; url: string | null } | null> {
    const trimmed = symbol.trim();
    if (/^\d+$/.test(trimmed)) {
        return { code: trimmed, symbol: null, name: null, isin: null, url: null };
    }

    const rows = toArray(
        await fetchJson<unknown>(
            `${BSE_API_BASE_URL}/GetQuoteAllSearchDatabeta/w?searchString=${encodeURIComponent(trimmed)}`,
            bseHeaders,
            true,
        ),
    );
    const upper = trimmed.toUpperCase();
    const match =
        rows.find((row) => firstString(row, ['shortName'])?.toUpperCase() === upper) ??
        rows.find((row) => firstString(row, ['strSricpCode']) === trimmed) ??
        rows.find((row) => firstString(row, ['Type'])?.toLowerCase().includes('equity')) ??
        rows[0];

    if (!match) return null;
    const code = firstString(match, ['strSricpCode']);
    if (!code) return null;

    return {
        code,
        symbol: firstString(match, ['shortName']),
        name: firstString(match, ['scripName']),
        isin: firstString(match, ['Isin']),
        url: firstString(match, ['SEOUrl']),
    };
}

function baseRecord(source: Source extends 'both' ? never : 'nse' | 'bse', recordType: RecordType, symbol: string): MarketRecord {
    return {
        source,
        recordType,
        symbol,
        name: null,
        series: null,
        exchangeCode: null,
        price: null,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        previousClose: null,
        close: null,
        volume: null,
        value: null,
        turnover: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        marketCap: null,
        freeFloatMarketCap: null,
        peRatio: null,
        pbRatio: null,
        eps: null,
        faceValue: null,
        dividendYield: null,
        sector: null,
        industry: null,
        isin: null,
        category: null,
        url: null,
        exchangeTimestamp: null,
        scrapedAt: new Date().toISOString(),
    };
}

function normalizeSymbols(symbols: string[] | undefined): string[] {
    return [...new Set((symbols ?? []).map((symbol) => symbol.trim()).filter(Boolean))];
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/^\+/, '').trim();
    if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'na' || cleaned.toLowerCase() === 'n/a') return null;
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(object: JsonObject | null | undefined, keys: string[]): number | null {
    if (!object) return null;
    for (const key of keys) {
        const value = toNumber(object[key]);
        if (value !== null) return value;
    }
    return null;
}

function toStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
}

function firstString(object: JsonObject | null | undefined, keys: string[]): string | null {
    if (!object) return null;
    for (const key of keys) {
        const value = toStringValue(object[key]);
        if (value !== null) return value;
    }
    return null;
}

function asObject(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function toArray(value: unknown): JsonObject[] {
    if (!Array.isArray(value)) return [];
    const objects: JsonObject[] = [];
    for (const item of value) {
        const object = asObject(item);
        if (object) objects.push(object);
    }
    return objects;
}

async function settle<T>(task: () => Promise<T[]>): Promise<T[]> {
    try {
        return await task();
    } catch (error) {
        log.warning(errorMessage(error));
        return [];
    }
}

async function settleOne<T>(task: () => Promise<T>): Promise<T | null> {
    try {
        return await task();
    } catch (error) {
        log.warning(errorMessage(error));
        return null;
    }
}

function deduplicateRecords(records: MarketRecord[]): MarketRecord[] {
    const seen = new Set<string>();
    return records.filter((record) => {
        const key = `${record.source}:${record.recordType}:${record.symbol}:${record.category ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
