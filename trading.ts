import { createPublicClient, createWalletClient, PublicClient, WalletClient, defineChain, http, Address, formatEther } from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { morpherOracleAbi, morpherStateAbi, morpherTokenAbi, morpherTradeengineAbi } from './abis';

const SIDECHAIN_RPC = 'https://sidechain.morpher.com';
const MORPHER_TOKEN_ADDRESS = '0xC44628734a9432a3DAA302E11AfbdFa8361424A5';
const MORPHER_ORACLE_ADDRESS = '0xf8B5b1699A00EDfdB6F15524646Bd5071bA419Fb';
const MORPHER_TRADE_ENGINE_ADDRESS = '0xc4a877Ed48c2727278183E18fd558f4b0c26030A';
const MORPHER_STATE_ADDRESS = '0xB4881186b9E52F8BD6EC5F19708450cE57b24370';
const ORDER_CREATED = '0xc7392b9822094f2dca86d2a7a97945e80918a8aee61c04de90253f3683b56950';

const sidechain = defineChain({
    id: 21,
    name: 'Morpher Sidechain',
    nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
    },
    rpcUrls: {
        default: {
            http: [SIDECHAIN_RPC],
        },
    }
});

type Position = {
    longShares: bigint
    shortShares: bigint
    averagePrice: bigint
    averageSpread: bigint
    averageLeverage: bigint
    liquidationPrice: bigint
}


export class MorpherTrading {
    private account: PrivateKeyAccount;
    private publicClient: PublicClient;
    private walletClient: WalletClient;
    private morpherToken: any;
    private morpherOracle: any;
    private morpherTradeEngine: any;
    private morpherState: any;

    constructor(privateKey: `0x${string}`) {
        this.account = privateKeyToAccount(privateKey);
        this.publicClient = createPublicClient({
            chain: sidechain,
            transport: http(SIDECHAIN_RPC),
        });
        this.walletClient = createWalletClient({
            account: this.account,
            chain: sidechain,
            transport: http(SIDECHAIN_RPC),
        });
        this.morpherToken = {
            address: MORPHER_TOKEN_ADDRESS as Address,
            abi: morpherTokenAbi,
        };
        this.morpherOracle = {
            address: MORPHER_ORACLE_ADDRESS as Address,
            abi: morpherOracleAbi,
        };
        this.morpherTradeEngine = {
            address: MORPHER_TRADE_ENGINE_ADDRESS as Address,
            abi: morpherTradeengineAbi,
        };
        this.morpherState = {
            address: MORPHER_STATE_ADDRESS as Address,
            abi: morpherStateAbi,
        };
        this._getOrderId('0x5b3a7c0724f7e799f7f230de6711d02242b98044fe2a7e2019494910ea44b5e3')
    }

    async openPosition(
        marketId: string,
        mphTokenAmount: number,
        direction: boolean,
        leverage: number,
        onlyIfPriceAbove = 0,
        onlyIfPriceBelow = 0,
        goodUntil = 0,
        goodFrom = 0
    ): Promise<string> {
        /**
         * Opens a new trading position.
         *
         * @param marketId - The ID (hash) of the market where the position will be opened.
         * @param mphTokenAmount - The amount of MPH tokens to use for this position.
         * @param direction - The direction of the position; `true` for long, `false` for short.
         * @param leverage - The leverage multiplier to apply to the position. (1.0 to 10.0)
         * @param onlyIfPriceAbove - Open the position only if the price is above this value. 0 for no limit.
         * @param onlyIfPriceBelow - Open the position only if the price is below this value. 0 for no limit.
         * @param goodUntil - Unix timestamp in seconds specifying the expiration time of the order. 0 for no expiration.
         * @param goodFrom - Unix timestamp in seconds specifying the activation time of the order. 0 for no activation.
         * @returns The ID of the order.
         */
        const exactMphTokenAmount = BigInt(Math.round(mphTokenAmount * 1e18));
        const exactLeverage = BigInt(Math.round(leverage * 1e8));
        const exactOnlyIfPriceAbove = BigInt(Math.round(onlyIfPriceAbove * 1e8));
        const exactOnlyIfPriceBelow = BigInt(Math.round(onlyIfPriceBelow * 1e8));
        return this.openPositionExact(
            marketId,
            exactMphTokenAmount,
            direction,
            exactLeverage,
            exactOnlyIfPriceAbove,
            exactOnlyIfPriceBelow,
            goodUntil,
            goodFrom
        );
    }

    async openPositionExact(
        marketId: string,
        mphTokenAmount: bigint,
        direction: boolean,
        leverage: bigint,
        onlyIfPriceAbove = 0n,
        onlyIfPriceBelow = 0n,
        goodUntil = 0,
        goodFrom = 0
    ): Promise<string> {
        /**
         * Opens a new trading position.
         *
         * @param marketId - The ID (hash) of the market where the position will be opened.
         * @param mphTokenAmount - The amount of MPH tokens to use for this position in WEI.
         * @param direction - The direction of the position; `true` for long, `false` for short.
         * @param leverage - The leverage multiplier to apply to the position with 8 decimal points. (100000000 to 1000000000)
         * @param onlyIfPriceAbove - Open the position only if the price with 8 decimals is above this value. 0 for no limit.
         * @param onlyIfPriceBelow - Open the position only if the price with 8 decimals is below this value. 0 for no limit.
         * @param goodUntil - Unix timestamp in seconds specifying the expiration time of the order. 0 for no expiration.
         * @param goodFrom - Unix timestamp in seconds specifying the activation time of the order. 0 for no activation.
         * @returns The ID of the order.
         */
        const txHash = await this.walletClient.writeContract({
            ...this.morpherOracle,
            functionName: 'createOrder',
            args: [
                marketId,
                0n,
                mphTokenAmount,
                direction,
                leverage,
                onlyIfPriceAbove,
                onlyIfPriceBelow,
                goodUntil,
                goodFrom,
            ],
            account: this.account.address,
            gasLimit: 2000000n,
        });

        return this._getOrderId(txHash);
    }

    async closePosition(
        marketId: string,
        percentage = 1,
        onlyIfPriceAbove = 0,
        onlyIfPriceBelow = 0,
        goodUntil = 0,
        goodFrom = 0
    ): Promise<string> {
        /**
         * Closes a percentage of an existing position.
         *
         * @param marketId - The ID (hash) of the market of the position.
         * @param percentage - The percentage of the position to close.
         * @param onlyIfPriceAbove - Close the position only if the price is above this value. 0 for no limit.
         * @param onlyIfPriceBelow - Close the position only if the price is below this value. 0 for no limit.
         * @param goodUntil - Unix timestamp in seconds specifying the expiration time of the order. 0 for no expiration.
         * @param goodFrom - Unix timestamp in seconds specifying the activation time of the order. 0 for no activation.
         * @returns The ID of the order.
         */
        const position = await this.getPosition(marketId);
        if (position.longShares > 0 && position.shortShares > 0) {
            throw new Error("Found mixed position (long and short), can't close!");
        } else if (position.longShares === 0n && position.shortShares === 0n) {
            throw new Error('No position found for this market!');
        }

        const closeShares =
            position.longShares > 0 ? position.longShares : position.shortShares;
        const closeSharesAmount = BigInt(Math.round(percentage * Number(closeShares)));
        const exactOnlyIfPriceAbove = BigInt(Math.round(onlyIfPriceAbove * 1e8));
        const exactOnlyIfPriceBelow = BigInt(Math.round(onlyIfPriceBelow * 1e8));

        return this.closePositionExact(
            marketId,
            closeSharesAmount,
            exactOnlyIfPriceAbove,
            exactOnlyIfPriceBelow,
            goodUntil,
            goodFrom
        );
    }

    async closePositionExact(
        marketId: string,
        closeSharesAmount: bigint,
        onlyIfPriceAbove = 0n,
        onlyIfPriceBelow = 0n,
        goodUntil = 0,
        goodFrom = 0
    ): Promise<string> {
        /**
         * Closes an existing position using the amount of shares.
         *
         * @param marketId - The ID (hash) of the market of the position.
         * @param closeSharesAmount - The amount of shares to sell.
         * @param onlyIfPriceAbove - Close the position only if the price with 8 decimals is above this value. 0 for no limit.
         * @param onlyIfPriceBelow - Close the position only if the price with 8 decimals is below this value. 0 for no limit.
         * @param goodUntil - Unix timestamp in seconds specifying the expiration time of the order. 0 for no expiration.
         * @param goodFrom - Unix timestamp in seconds specifying the activation time of the order. 0 for no activation.
         * @returns The ID of the order.
         */
        const position = await this.getPosition(marketId);
        if (position.longShares > 0 && position.shortShares > 0) {
            throw new Error("Found mixed position (long and short), can't close!");
        } else if (position.longShares === 0n && position.shortShares === 0n) {
            throw new Error('No position found for this market!');
        }

        const txHash = await this.walletClient.writeContract({
            ...this.morpherOracle,
            functionName: 'createOrder',
            args: [
                marketId,
                closeSharesAmount,
                0n,
                position.longShares > 0 ? false : true,
                100000000n,
                onlyIfPriceAbove,
                onlyIfPriceBelow,
                goodUntil,
                goodFrom,
            ],
            account: this.account.address,
            gasLimit: 2000000n,
        });

        return this._getOrderId(txHash);
    }

    async getBalance(): Promise<number> {
        /**
         * Shows current MPH balance of the account.
         *
         * @returns The current MPH balance.
         */
        const balanceExact = await this.getBalanceExact();
        return Number(formatEther(balanceExact));
    }

    async getBalanceExact(): Promise<bigint> {
        /**
         * Shows current MPH balance of the account in WEI.
         *
         * @returns The current MPH balance in WEI.
         */
        const balanceExact = (await this.publicClient.readContract({
            ...this.morpherToken,
            functionName: 'balanceOf',
            args: [this.account.address],
        })) as bigint;
        return balanceExact;
    }

    async getPosition(marketId: string): Promise<Position> {
        /**
         * Shows current position for a specific market.
         *
         * @param marketId - The ID (hash) of the market of the position.
         * @returns An object containing all information regarding the current position in the market.
         */
        const result: any = await this.publicClient.readContract({
            ...this.morpherTradeEngine,
            functionName: 'getPosition',
            args: [this.account.address, marketId],
        });

        return {
            longShares: result[0],
            shortShares: result[1],
            averagePrice: result[2],
            averageSpread: result[3],
            averageLeverage: result[4],
            liquidationPrice: result[5],
        };
    }

    async getPositionValue(marketId: string, currentPrice: number, currentSpread?: number): Promise<number> {
        /**
         * Shows current value of the position for a specific market.
         * 
         * @param marketId - The ID (hash) of the market of the position.
         * @param currentPrice - The current market price.
         * @param currentSpread - The current market spread in USD, if undefined it will use the same spread as position.
         * @returns The position value in MPH.
         */
        return Number(formatEther(await this.getPositionValueExact(marketId, currentPrice, currentSpread)));
    }

    async getPositionValueExact(marketId: string, currentPrice: number, currentSpread?: number): Promise<bigint> {
        /**
         * Shows current value of the position for a specific market.
         * 
         * @param marketId - The ID (hash) of the market of the position.
         * @param currentPrice - The current market price.
         * @param currentSpread - The current market spread in USD, if undefined it will use the same spread as position.
         * @returns The position value in MPH WEI.
         */
        const position = await this.getPosition(marketId);
        if (position.longShares > 0 && position.shortShares > 0) {
            throw new Error("Found mixed position (long and short)!");
        } else if (position.longShares === 0n && position.shortShares === 0n) {
            return 0n;
        }

        const price = BigInt(Math.round(currentPrice * 1e8));
        const spread = BigInt(Math.round((currentSpread ?? Number(formatEther(position.averageSpread))) * 1e8));
        const lastUpdated = await this.publicClient.readContract({
            ...this.morpherState,
            functionName: "getLastUpdated",
            args: [this.account.address, marketId],
        });

        if (position.longShares > 0n) {
            const value = (await this.publicClient.readContract({
                ...this.morpherTradeEngine,
                functionName: "longShareValue",
                args: [
                    position.averagePrice,
                    position.averageLeverage,
                    lastUpdated,
                    price,
                    spread,
                    position.averageLeverage,
                    true,
                ],
            })) as bigint;
            return value * position.longShares;
        }

        const value = (await this.publicClient.readContract({
            ...this.morpherTradeEngine,
            functionName: "shortShareValue",
            args: [
                position.averagePrice,
                position.averageLeverage,
                lastUpdated,
                price,
                spread,
                position.averageLeverage,
                true,
            ],
        })) as bigint;
        return value * position.shortShares;
    }

    async cancelOrder(orderId: string): Promise<boolean> {
        /**
         * Cancels a pending order (e.g. limit order or take profit / stop loss).
         * 
         * @param orderId - The ID of the order to cancel.
         * @returns true if order was cancelled, false if it's already executed.
         */
        const order: any = await this.publicClient.readContract({
            ...this.morpherTradeEngine,
            functionName: "getOrder",
            args: [orderId],
        });

        if (order[0] === "0x0000000000000000000000000000000000000000") {
            return false;
        }
        if (order[0].toLowerCase() !== this.account.address.toLowerCase()) {
            throw new Error("Cannot cancel another user's order!");
        }

        await this.walletClient.writeContract({
            ...this.morpherOracle,
            functionName: 'initiateCancelOrder',
            args: [orderId],
            account: this.account.address,
            gasLimit: 2000000n,
        });

        return true;
    }

    private async _getOrderId(txHash: `0x${string}`): Promise<`0x${string}`> {
        for (let retries = 0; retries < 30; retries++) {
            try {
                const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
                const log = txReceipt.logs.find(
                    (log) =>
                        log.address.toLowerCase() ===
                        MORPHER_ORACLE_ADDRESS.toLowerCase() &&
                        log.topics[0] === ORDER_CREATED
                );
                if (log) {
                    return log.topics[1]!;
                }
            } catch (e) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        throw new Error('Transaction not found on chain after 30 seconds!');
    }
}
