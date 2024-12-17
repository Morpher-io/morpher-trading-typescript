import axios from 'axios';
import { MorpherTrading } from "../trading";
import { keccak256, toHex } from 'viem';


class WeightedMarketRebalancingStrategy {
    private trading: MorpherTrading;
    private weightedMarkets: Record<string, number>;
    private rebalancePercentage: number;
    private lastRebalanceTime: number | null = null;

    constructor(tradingEngine) {
        this.trading = tradingEngine;
        this.weightedMarkets = JSON.parse(process.env.MARKETS); // e.g., {"BTC": 0.3, "ETH": 0.3, "DOGE": 0.4}
        this.rebalancePercentage = Number(process.env.INVESTED_PERCENTAGE);
    }

    private async fetchMarketPrice(market: string): Promise<number> {
        const url = `https://api.binance.com/api/v3/ticker/price?symbol=${market}USDT`;
        try {
            const response = await axios.get(url);
            return parseFloat(response.data.price);
        } catch (error) {
            throw new Error(`Error fetching price for ${market}:` + error.toString());
        }
    }

    private calculateTargetAllocation(balance: number): Record<string, number> {
        const allocation: Record<string, number> = {};
        for (const [market, weight] of Object.entries(this.weightedMarkets)) {
            allocation[market] = balance * this.rebalancePercentage * weight;
        }
        return allocation;
    }

    private getMarketId(market: string): string {
        const inputString = `CRYPTO_${market}`;
        return keccak256(toHex(inputString));
    }

    private async rebalancePositions(balance: number, prices: Record<string, number>) {
        let totalBalance = balance;
        const currentPositions: Record<string, number> = {};

        for (const market of Object.keys(this.weightedMarkets)) {
            const marketId = this.getMarketId(market);
            const positionValue = await this.trading.getPositionValue(marketId, prices[market]);
            currentPositions[market] = positionValue;
            totalBalance += positionValue;
        }

        console.log(`Total balance: ${totalBalance.toFixed(2)} MPH.`);
        console.log(`Current invested: ${(totalBalance - balance).toFixed(2)} MPH, current cash: ${balance.toFixed(2)}.`);
        console.log(`New invested: ${(totalBalance * this.rebalancePercentage).toFixed(2)} MPH, new cash: ${(totalBalance * (1 - this.rebalancePercentage)).toFixed(2)}.`);

        const targetAllocation = this.calculateTargetAllocation(totalBalance);

        for (const [market, targetAmount] of Object.entries(targetAllocation)) {
            const currentPosition = currentPositions[market];
            const difference = targetAmount - currentPosition;
            const marketId = this.getMarketId(market);

            if (difference > 0) {
                await this.trading.openPosition(marketId, difference, true, 1);
                console.log(`Increased position in ${market} by ${difference.toFixed(2)} MPH.`);
            } else if (difference < 0) {
                const percentageToClose = Math.abs(difference) / currentPosition;
                await this.trading.closePosition(marketId, percentageToClose);
                console.log(`Decreased position in ${market} by ${Math.abs(difference).toFixed(2)} MPH.`);
            }

            await new Promise(r => setTimeout(r, 5000)); // Sleep for 5 seconds between trades
        }

        console.log(`Rebalancing complete. Target allocation:`, targetAllocation);
    }

    public async startTrading() {
        console.log('Launching weighted market rebalancing bot...');

        while (true) {
            const now = Date.now();

            if (!this.lastRebalanceTime || now > this.lastRebalanceTime + 24 * 60 * 60 * 1000) {
                console.log(`[${new Date(now).toISOString()}] Rebalancing positions...`);
                const balance = await this.trading.getBalance();
                console.log(`Current balance: ${balance.toFixed(2)} MPH.`);

                const prices: Record<string, number> = {};
                for (const market of Object.keys(this.weightedMarkets)) {
                    prices[market] = await this.fetchMarketPrice(market);
                    console.log(`${market} price: ${prices[market].toFixed(2)} USDT.`);
                }

                await this.rebalancePositions(balance, prices);
                this.lastRebalanceTime = now - (now % (1000 * 60 * 60 * 24));
            }

            await new Promise(r => setTimeout(r, 300000)); // Wait 5 minutes before checking again
        }
    }
}

export default WeightedMarketRebalancingStrategy;
