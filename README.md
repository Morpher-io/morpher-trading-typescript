# Morpher Trading Bot

A TypeScript-based trading bot that executes trades on the Morpher Plasma Sidechain using a Simple Moving Average (SMA) strategy. Instead of traditional brokers, it leverages blockchain transactions for trading operations while using Binance's websocket feed for real-time price data.

More Information on https://tradingbot.morpher.com

## Features

- Trades on Morpher's Plasma Sidechain (Chain ID: 21)
- Uses Binance's real-time BTC/USDT price feed
- Implements Simple Moving Average (SMA) cross strategy
- Supports both long and short positions
- Automatic stop-loss and take-profit management
- Configurable leverage, position size, and SMA parameters

## Prerequisites

- Node.js
- npm/yarn
- A private key with MPH tokens on Morpher Sidechain

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Morpher-io/morpher-trading-typescript.git
cd morpher-trading-typescript
cp .env.example .env
```

2. Install dependencies:
```bash
npm install
```

## Configuration

The bot requires the following parameters:

- Private key for Morpher Sidechain transactions
- Market ID for the trading pair
- Leverage (1x to 10x)
- Trading size in MPH tokens
- SMA period length
- Trigger threshold percentage

## Usage

1. Configure your trading parameters
2. Run the bot:
```bash
npm start
```

## Trading Strategy

The bot implements a Simple Moving Average (SMA) strategy:

1. Collects minute-by-minute price data from Binance's BTC/USDT feed
2. Calculates SMA over the configured period
3. Opens positions based on price crossing thresholds:
   - Long position when price falls below lower threshold
   - Short position when price rises above upper threshold
4. Manages positions with:
   - Take profit at opposite threshold
   - Stop loss at 2x threshold distance

## Smart Contract Integration

The bot interacts with the following Morpher contracts on the sidechain:

- Token: `0xC44628734a9432a3DAA302E11AfbdFa8361424A5`
- Oracle: `0xf8B5b1699A00EDfdB6F15524646Bd5071bA419Fb`
- Trade Engine: `0xc4a877Ed48c2727278183E18fd558f4b0c26030A`
- State: `0xB4881186b9E52F8BD6EC5F19708450cE57b24370`

## Security

**Important:** Never commit your private key to the repository. Use environment variables or a secure configuration file.

## Disclaimer

Trading cryptocurrencies carries significant risk. This bot is for educational purposes only. Always test thoroughly with small amounts first.
