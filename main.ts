import { MorpherTrading } from './trading';

if (process.env.PRIVATE_KEY == undefined) {
    console.error("Private Key is not set, aborting");
    process.exit(1)
}

if (!process.env.STRATEGY == undefined) {
    console.error("STRATEGY is not set in the .env file, aborting");
    process.exit(1);
}

const tradingEngine = new MorpherTrading(process.env.PRIVATE_KEY as `0x${string}`);
const Strategy = (await import(`./strategies/${process.env.STRATEGY}`)).default;
const strategy = new Strategy(tradingEngine);
strategy.startTrading();
