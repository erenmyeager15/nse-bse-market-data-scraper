import { Actor, log } from 'apify';
import { collectRecords, isUsableRecord, normalizeInput } from './routes.js';
import { ActorInput, MarketRecord } from './types.js';

await Actor.init();

try {
    const input = ((await Actor.getInput()) ?? {}) as ActorInput;
    const normalizedInput = normalizeInput(input);

    log.info(
        `Collecting ${normalizedInput.dataType} records from ${normalizedInput.source} with maxResults=${normalizedInput.maxResults}.`,
    );

    const records = await collectRecords(input);
    let pushed = 0;

    for (const record of records) {
        if (!isUsableRecord(record)) continue;
        await pushAndCharge(record);
        pushed += 1;
    }

    if (pushed === 0) {
        log.warning('No usable records were found. No dataset rows were pushed and no result events were charged.');
    } else {
        log.info(`Saved ${pushed} market data records.`);
    }
} catch (error) {
    log.error(`Actor failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
} finally {
    await Actor.exit();
}

async function pushAndCharge(record: MarketRecord): Promise<void> {
    await Actor.pushData(record);
    try {
        await Actor.charge({ eventName: 'result-scraped' });
    } catch (error) {
        log.warning(
            `Record ${record.source}:${record.recordType}:${record.symbol} was saved, but charging failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}
