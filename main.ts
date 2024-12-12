import { MorpherTrading } from './trading';
import SimpleMovingAverageStrategy from './strategies/sma';
import { keccak256, toHex } from 'viem';

// BTC market
const MARKET_ID = keccak256(toHex(process.env.MARKET_ID || "CRYPTO_BTC"));
const LEVERAGE = Number(process.env.LEVERAGE || 10.0)
const MPH_TOKENS = Number(process.env.MPH_TOKENS || 5)
const MOVING_AVERAGE_PERIOD = Number(process.env.MOVING_AVERAGE_PERIOD || 5) // 5 minutes
const THRESHOLD_PERCENTAGE = Number(process.env.THRESHOLD_PERCENTAGE || 0.1) // Open position if price is over / under 0.1% of moving average

if (process.env.PRIVATE_KEY == undefined) {
    console.error("Private Key is not set, aborting");
    process.exit(1)
}

const tradingEngine = new MorpherTrading(process.env.PRIVATE_KEY as `0x${string}`);

const strategy = new SimpleMovingAverageStrategy(
    tradingEngine,
    MARKET_ID,
    LEVERAGE,
    MPH_TOKENS,
    MOVING_AVERAGE_PERIOD,
    THRESHOLD_PERCENTAGE
);

strategy.startTrading();
