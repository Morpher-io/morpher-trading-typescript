import { MorpherTrading } from './trading';
import SimpleMovingAverageStrategy from './strategies/sma';

// BTC market
const MARKET_ID = "0x0bc89e95f9fdaab7e8a11719155f2fd638cb0f665623f3d12aab71d1a125daf9"
const LEVERAGE = 10.0
const MPH_TOKENS = 5
const MOVING_AVERAGE_PERIOD = 5 // 5 minutes
const THRESHOLD_PERCENTAGE = 0.1 // Open position if price is over / under 0.1% of moving average

const tradingEngine = new MorpherTrading(process.env.PRIVATE_KEY)

const strategy = new SimpleMovingAverageStrategy(
    tradingEngine,
    MARKET_ID,
    LEVERAGE,
    MPH_TOKENS,
    MOVING_AVERAGE_PERIOD,
    THRESHOLD_PERCENTAGE
);

strategy.startTrading();
