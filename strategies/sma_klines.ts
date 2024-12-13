import { WebSocket } from "ws";
import { MorpherTrading } from "../trading";
import { keccak256, toHex } from 'viem';

interface Position {
    is_long: boolean;
    stop_loss: number;
    take_profit: number;
}

export default class SimpleMovingAverageStrategy {
    private trading: MorpherTrading;
    private marketId: string;
    private leverage: number;
    private mphTokens: number;
    private movingAveragePeriod: number;
    private thresholdPercentage: number;

    private minutePrices: number[] = [];
    private currentMinute: Date | null = null;
    private lastPrice: number | null = null;

    private lastPrint: number = Date.now();

    private currentPosition: Position | null = null;
    private executing: boolean = false;

    constructor(tradingEngine: MorpherTrading) {
        this.trading = tradingEngine;
        this.marketId = keccak256(toHex(process.env.MARKET_ID || "CRYPTO_BTC"));
        this.leverage = Number(process.env.LEVERAGE || 10.0);
        this.mphTokens = Number(process.env.MPH_TOKENS || 5);
        this.movingAveragePeriod = Number(process.env.MOVING_AVERAGE_PERIOD || 5);
        this.thresholdPercentage = Number(process.env.THRESHOLD_PERCENTAGE || 0.1);
    }

    private calculateMovingAverage(prices: number[]): number {
        return prices.reduce((a, b) => a + b, 0) / prices.length;
    }

    private processPrice(price: number): void {
        const currentMin = new Date();
        currentMin.setSeconds(0, 0);

        if (this.currentMinute === null) {
            this.currentMinute = currentMin;
        }

        if (currentMin > this.currentMinute) {
            if (this.lastPrice !== null) {
                this.minutePrices.push(this.lastPrice);
                if (this.minutePrices.length > this.movingAveragePeriod) {
                    this.minutePrices.shift();
                }
                console.log(`[${new Date()}] Minute closed: ${this.currentMinute}, Price: ${this.lastPrice}`);
            }
            this.currentMinute = currentMin;
        }
        this.lastPrice = price;
    }

    private async openLongPosition(price: number, ma: number): Promise<void> {
        const orderId = await this.trading.openPosition(
            this.marketId,
            this.mphTokens,
            true,
            this.leverage,
        );
        console.log(`[${new Date()}] Opened long position at price ${price} (MA: ${ma}). Order ID: ${orderId}`);
    }

    private async openShortPosition(price: number, ma: number): Promise<void> {
        const orderId = await this.trading.openPosition(
            this.marketId,
            this.mphTokens,
            false,
            this.leverage,
        );
        console.log(`[${new Date()}] Opened short position at price ${price} (MA: ${ma}). Order ID: ${orderId}`);
    }

    private async closePosition(price: number, ma: number): Promise<void> {
        const orderId = await this.trading.closePosition(
            this.marketId,
            1,
        );
        console.log(`[${new Date()}] Closed position at price ${price} (MA: ${ma}). Order ID: ${orderId}`);
    }

    private async processPositionLogic(): Promise<void> {
        const lastPrice = this.minutePrices[this.minutePrices.length - 1];

        const movingAverage = this.minutePrices.length === this.movingAveragePeriod
            ? this.calculateMovingAverage(this.minutePrices)
            : 0;

        const lowerThreshold = movingAverage * (1 - this.thresholdPercentage / 100);
        const upperThreshold = movingAverage * (1 + this.thresholdPercentage / 100);

        if (Date.now() > this.lastPrint + 5000) {
            this.lastPrint = Date.now();
            if (this.executing) {
                console.log("Closing position...");
            } else if (this.currentPosition) {
                const sl = this.currentPosition.stop_loss;
                const tp = this.currentPosition.take_profit;
                const pv = await this.trading.getPositionValue(this.marketId, lastPrice);
                console.log(`[${new Date()}] Price: ${lastPrice}, Position value: ${pv.toFixed(2)}, SL: ${sl.toFixed(2)}, TP: ${tp.toFixed(2)}`);
            } else {
                console.log(`[${new Date()}] Price: ${lastPrice}, MA: ${movingAverage.toFixed(2)}, Lower: ${lowerThreshold.toFixed(2)}, Upper: ${upperThreshold.toFixed(2)}`);
            }
        }

        // fallback in case API has less prices than needed returned
        if (this.minutePrices.length < this.movingAveragePeriod) {
            return;
        }

        // wait until order is confirmed
        if (this.executing) {
            return;
        }

        if (this.currentPosition) {
            // check stop loss / take profit (you can execute istant closePositions as stop loss and take
            // profit or you can closePosition by specifying only_if_price_below and only_if_price_above)
            if (this.currentPosition.is_long) {
                if (lastPrice < this.currentPosition.stop_loss || lastPrice > this.currentPosition.take_profit) {
                    this.executing = true;
                    await this.closePosition(lastPrice, movingAverage);
                    await new Promise(r => setTimeout(r, 10000));
                    this.currentPosition = null;
                    this.executing = false;
                }
            } else {
                if (lastPrice > this.currentPosition.stop_loss || lastPrice < this.currentPosition.take_profit) {
                    this.executing = true;
                    await this.closePosition(lastPrice, movingAverage);
                    await new Promise(r => setTimeout(r, 10000));
                    this.currentPosition = null;
                    this.executing = false;
                }
            }
        } else {
            if (lastPrice < lowerThreshold) {
                this.executing = true;
                await this.openLongPosition(lastPrice, movingAverage);
                await new Promise(r => setTimeout(r, 10000));
                this.currentPosition = {
                    is_long: true,
                    stop_loss: movingAverage * (1 - 2 * this.thresholdPercentage / 100),
                    take_profit: upperThreshold,
                };
                this.executing = false;
            } else if (lastPrice > upperThreshold) {
                this.executing = true;
                await this.openShortPosition(lastPrice, movingAverage);
                await new Promise(r => setTimeout(r, 10000));
                this.currentPosition = {
                    is_long: false,
                    stop_loss: movingAverage * (1 + 2 * this.thresholdPercentage / 100),
                    take_profit: lowerThreshold,
                };
                this.executing = false;
            }
        }
    }

    public async startTrading(): Promise<void> {
        console.log("Launching bot...");
        console.log(`User balance: ${await this.trading.getBalance()} MPH`);
        const url = `https://api.binance.com/api/v3/klines?symbol=${process.env.BINANCE_MARKET?.toUpperCase() || 'SOLUSDT'}&interval=1m&limit=${this.movingAveragePeriod}`
        const result = await fetch(url);
        const candles = await result.json();
        

        /**
         * Result:
         * 
         * [
  [
    1499040000000,      // Kline open time
    "0.01634790",       // Open price
    "0.80000000",       // High price
    "0.01575800",       // Low price
    "0.01577100",       // Close price
    "148976.11427815",  // Volume
    1499644799999,      // Kline Close time
    "2434.19055334",    // Quote asset volume
    308,                // Number of trades
    "1756.87402397",    // Taker buy base asset volume
    "28.46694368",      // Taker buy quote asset volume
    "0"                 // Unused field, ignore.
  ]
]
  e.g.:

[
  [
    1734078840000, "226.01000000", "226.03000000", "225.93000000", "225.93000000", "1230.48900000",
    1734078899999, "278061.14351000", 944, "796.21000000", "179926.38472000", "0"
  ], [
    1734078900000, "225.92000000", "226.06000000", "225.90000000", "226.02000000", "882.06600000",
    1734078959999, "199350.88894000", 738, "516.01900000", "116616.15394000", "0"
  ], [
    1734078960000, "226.01000000", "226.01000000", "225.73000000", "225.77000000", "1999.68300000",
    1734079019999, "451633.59879000", 1337, "913.65100000", "206345.77734000", "0"
  ], [
    1734079020000, "225.77000000", "225.78000000", "225.65000000", "225.70000000", "1820.73300000",
    1734079079999, "410927.19384000", 1087, "795.08600000", "179457.09280000", "0"
  ], [
    1734079080000, "225.70000000", "225.95000000", "225.67000000", "225.94000000", "1695.01500000",
    1734079139999, "382768.40522000", 1267, "1542.13400000", "348247.03911000", "0"
  ]
]
         */
        
        // const url = `wss://stream.binance.com:9443/ws/${process.env.BINANCE_MARKET || 'btcusdt'}@trade`;
        // const ws = new WebSocket(url);

        // ws.on("message", (message: string) => this.onMessage(message));
        // ws.on("error", (error: Error) => this.onError(error));
        // ws.on("close", () => this.onClose());

        console.log("Starting WebSocket stream...");
    }
}
