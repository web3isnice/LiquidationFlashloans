# Solend Liquidator Bot (Not finished yet)

A high-performance liquidation bot for the Solend protocol on Solana, featuring MEV protection through Jito integration.

## System Setup

```sh
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js and npm 
sudo apt install npm
npm install -g n
n stable

# Install git
sudo apt install git -y
```

## Project Setup

```sh
# Clone the project (replace with your repo URL)
git clone https://github.com/web3isnice/LiquidationFlashloans.git
cd LiquidationFlashloans

# Install dependencies
npm install --legacy-peer-deps
```

## Configuration

### Create keypair file:

```sh
# Create keypair.json
touch keypair.json

# Add your private key in JSON array format
# Example format: [1,2,3,...,32] (32 bytes)
```

### Create .env file:

```sh
# Create .env file in project root
touch .env

# Add required configuration
APP=production
SECRET_PATH=/Absolute/path/to/keypair.json
JITO_ENDPOINT=https://ny.mainnet.block-engine.jito.wtf  # Optional: Defaults to NY endpoint
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com  # Optional: Your preferred Solana RPC
```

## Environment Variables

The bot can be configured using the following environment variables:

### Required Variables
- `SECRET_PATH`: Absolute path to your keypair.json file
- `APP`: Deployment environment (`production` or `devnet`)

### RPC Configuration
- `JITO_ENDPOINT`: Jito RPC endpoint for MEV-protected transactions. Available options:
  - `https://amsterdam.mainnet.block-engine.jito.wtf` (Amsterdam)
  - `https://frankfurt.mainnet.block-engine.jito.wtf` (Frankfurt)
  - `https://ny.mainnet.block-engine.jito.wtf` (New York, default)
  - `https://tokyo.mainnet.block-engine.jito.wtf` (Tokyo)
  - `https://slc.mainnet.block-engine.jito.wtf` (Salt Lake City)
- `SOLANA_RPC_ENDPOINT`: Regular Solana RPC endpoint for standard operations
- `THROTTLE`: Delay between market scans in milliseconds (e.g., `1000` for 1 second)

### Financial Settings
- `MIN_USDC_BUFFER`: Minimum USDC to keep after swaps (default: `1`)
- `MIN_SOL_BALANCE`: Minimum SOL balance for transaction fees in lamports (default: `0.1 * 1e9`)

### Operational Settings
- `MAX_RETRIES`: Maximum retry attempts for failed operations (default: `3`)
- `RETRY_DELAY_MS`: Delay between retries in milliseconds (default: `1000`)
- `TRANSACTION_TIMEOUT_MS`: Transaction timeout in milliseconds (default: `60000`)
- `LIQUIDATION_BATCH_SIZE`: Number of obligations to process in parallel (default: `5`)
- `STATS_INTERVAL_MS`: Interval for logging statistics in milliseconds (default: `300000`)

### Health Check Settings
- `HEALTH_CHECK_INTERVAL_MS`: Health check interval in milliseconds (default: `60000`)
- `MAX_MEMORY_MB`: Maximum memory usage in MB before warning (default: `1024`)

### Error Handling
- `MAX_CONSECUTIVE_ERRORS`: Maximum consecutive errors before cooldown (default: `5`)
- `ERROR_COOLDOWN_MS`: Error cooldown period in milliseconds (default: `5000`)

## Build and Run

```sh
# Build the project
npm run build

# Start the bot
npm start
```

## Important Notes

- Ensure your wallet has enough SOL for transaction fees (minimum **0.1 SOL** recommended)
- The `keypair.json` should contain your private key in JSON array format
- The bot uses two RPC endpoints:
  - Jito RPC for MEV-protected transactions and bundles
  - Regular Solana RPC for standard operations (balance checks, account info, etc.)
- Jito requires a minimum tip of 1000 lamports for bundles
- Available Jito regions: Amsterdam, Frankfurt, New York (default), Tokyo, Salt Lake City

## Key Features and Benefits

### 1. Zero Loss Architecture
- **Flash Loan Integration**: Uses flash loans for risk-free liquidations
- **Atomic Transactions**: All operations (borrow, liquidate, repay) happen in a single atomic transaction
- **Pre-Flight Checks**: Simulates transactions before execution to prevent losses
- **Fail-Safe Mechanisms**: Transactions automatically revert if profitable execution cannot be guaranteed

### 2. MEV Protection
- **Jito Integration**: All liquidation transactions protected against MEV
- **Bundle Transactions**: Groups related operations into atomic bundles
- **Frontrunning Prevention**: Protected against sandwich attacks and frontrunning
- **Priority Queue**: Transactions get priority treatment in block inclusion

### 3. High Performance
- **Parallel Processing**: Handles multiple obligations simultaneously
- **Optimized Market Scanning**: Efficient market monitoring with minimal RPC calls
- **Smart Batching**: Groups operations to minimize transaction fees
- **Dual RPC Strategy**: Uses specialized RPCs for different operations
  - Jito RPC for MEV-protected transactions
  - Regular RPC for market monitoring and balance checks

### 4. Risk Management
- **Health Monitoring**: Continuous system health checks
- **Balance Management**: Maintains optimal token balances
- **Error Recovery**: Automatic recovery from common errors
- **Circuit Breakers**: Stops operations if unusual conditions detected

### 5. Advanced Features
- **Multi-Market Support**: Monitors all Solend markets simultaneously
- **Profit Optimization**: Selects most profitable liquidation opportunities
- **Auto Token Unwrapping**: Automatically unwraps wrapped tokens
- **Smart Routing**: Uses Jupiter for optimal token swaps
- **Position Sizing**: Calculates optimal liquidation amounts

### 6. Reliability Features
- **Automatic Retries**: Exponential backoff for failed operations
- **Connection Redundancy**: Multiple RPC endpoints for reliability
- **Error Handling**: Comprehensive error capture and recovery
- **Transaction Monitoring**: Tracks all transaction stages

### 7. Monitoring and Analytics
- **Performance Metrics**: Tracks success rates and profits
- **Health Statistics**: Monitors system resource usage
- **Transaction Logs**: Detailed logging of all operations
- **Alert System**: Notifications for important events

## Process Management (Optional)

Consider using PM2 or a similar tool to keep the bot running:

```sh
# Install PM2 globally
npm install -g pm2

# Start the bot with PM2
pm2 start npm --name "liquidator" -- start

# Monitor the bot
pm2 monit

# View logs
pm2 logs liquidator

# Restart the bot
pm2 restart liquidator
```

## Logging

The bot includes comprehensive logging:

- Console output with color-coded status messages
- File-based logging with rotation
- Performance metrics and statistics
- Error tracking and reporting

Log files are stored in the `logs` directory:
- `error.log`: Error-level messages only
- `combined.log`: All log messages
