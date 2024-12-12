import { MorpherTrading } from './trading';
import SimpleMovingAverageStrategy from './strategies/sma';

if (process.env.PRIVATE_KEY == undefined) {
    console.error("Private Key is not set, aborting");
    process.exit(1)
}

const tradingEngine = new MorpherTrading(process.env.PRIVATE_KEY as `0x${string}`);
const strategy = new SimpleMovingAverageStrategy(tradingEngine);
strategy.startTrading();
