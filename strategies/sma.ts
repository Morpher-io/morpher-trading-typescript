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
        this.marketId = process.env.MARKET_ID || "CRYPTO_BTC";
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

    private async onMessage(message: string): Promise<void> {
        const data = JSON.parse(message);
        const price: number = parseFloat(data["p"]);

        this.processPrice(price);

        const movingAverage = this.minutePrices.length === this.movingAveragePeriod
            ? this.calculateMovingAverage(this.minutePrices)
            : 0;

        const lowerThreshold = movingAverage * (1 - this.thresholdPercentage / 100);
        const upperThreshold = movingAverage * (1 + this.thresholdPercentage / 100);

        if (Date.now() > this.lastPrint + 5000) {
            this.lastPrint = Date.now();
            if (this.minutePrices.length < this.movingAveragePeriod) {
                console.log(`[${new Date()}] Collecting minute prices... (${this.minutePrices.length}/${this.movingAveragePeriod})`);
            } else if (this.executing) {
                console.log("Closing position...");
            } else if (this.currentPosition) {
                const sl = this.currentPosition.stop_loss;
                const tp = this.currentPosition.take_profit;
                const pv = await this.trading.getPositionValue(this.marketId, price);
                console.log(`[${new Date()}] Price: ${price}, Position value: ${pv.toFixed(2)}, SL: ${sl.toFixed(2)}, TP: ${tp.toFixed(2)}`);
            } else {
                console.log(`[${new Date()}] Price: ${price}, MA: ${movingAverage.toFixed(2)}, Lower: ${lowerThreshold.toFixed(2)}, Upper: ${upperThreshold.toFixed(2)}`);
            }
        }

        // wait until we have the correct number of minutely prices
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
                if (price < this.currentPosition.stop_loss || price > this.currentPosition.take_profit) {
                    this.executing = true;
                    await this.closePosition(price, movingAverage);
                    await new Promise(r => setTimeout(r, 10000));
                    this.currentPosition = null;
                    this.executing = false;
                }
            } else {
                if (price > this.currentPosition.stop_loss || price < this.currentPosition.take_profit) {
                    this.executing = true;
                    await this.closePosition(price, movingAverage);
                    await new Promise(r => setTimeout(r, 10000));
                    this.currentPosition = null;
                    this.executing = false;
                }
            }
        } else {
            if (price < lowerThreshold) {
                this.executing = true;
                await this.openLongPosition(price, movingAverage);
                await new Promise(r => setTimeout(r, 10000));
                this.currentPosition = {
                    is_long: true,
                    stop_loss: movingAverage * (1 - 2 * this.thresholdPercentage / 100),
                    take_profit: upperThreshold,
                };
                this.executing = false;
            } else if (price > upperThreshold) {
                this.executing = true;
                await this.openShortPosition(price, movingAverage);
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

    private onError(error: Error): void {
        console.error(`WebSocket error: ${error.message}`);
    }

    private onClose(): void {
        console.log("WebSocket closed");
    }

    public async startTrading(): Promise<void> {
        console.log("Launching bot...");
        console.log(`User balance: ${await this.trading.getBalance()} MPH`);
        const url = "wss://stream.binance.com:9443/ws/btcusdt@trade";
        const ws = new WebSocket(url);

        ws.on("message", (message: string) => this.onMessage(message));
        ws.on("error", (error: Error) => this.onError(error));
        ws.on("close", () => this.onClose());

        console.log("Starting WebSocket stream...");
    }
}
