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
        // Get historical klines data
        const market = process.env.BINANCE_MARKET?.toUpperCase() || 'SOLUSDT';
        const url = `https://api.binance.com/api/v3/klines?symbol=${market}&interval=1m&limit=${this.movingAveragePeriod}`;
        const result = await fetch(url);
        const candles = await result.json();

        // Extract close prices (index 4) from klines data
        this.minutePrices = candles.map((candle: any[]) => parseFloat(candle[4]));
        this.currentMinute = new Date();
        this.currentMinute.setSeconds(0, 0);
        this.lastPrice = this.minutePrices[this.minutePrices.length - 1];

        console.log(`Initialized with ${this.minutePrices.length} historical prices`);
        console.log(`Current SMA: ${this.calculateMovingAverage(this.minutePrices).toFixed(2)}`);

        // Process initial position logic with historical data
        await this.processPositionLogic();

        // Set up polling interval (every minute)
        console.log(`Starting price polling for ${market}...`);
        
        setInterval(async () => {
            try {
                // Fetch latest kline
                const url = `https://api.binance.com/api/v3/klines?symbol=${market}&interval=1m&limit=1`;
                const result = await fetch(url);
                const candles = await result.json();
                
                if (candles && candles.length > 0) {
                    const closePrice = parseFloat(candles[0][4]); // Close price is at index 4
                    this.processPrice(closePrice);
                    await this.processPositionLogic();
                }
            } catch (error) {
                console.error('Error fetching price:', error);
            }
        }, 60000); // Poll every minute
    }
}
