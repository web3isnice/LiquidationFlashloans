# Bot Setup on a Fresh VPS

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
```

### Create .env file:

```sh
# Create .env file in project root
touch .env

# Add required configuration
APP=production
SECRET_PATH=/Absolute/path/to/keypair.json
JITO_ENDPOINT=https://ny.mainnet.block-engine.jito.wtf  # Optional: Defaults to NY endpoint
```

## Environment Variables

The bot can be configured using the following environment variables:

### Required Variables
- `SECRET_PATH`: Absolute path to your keypair.json file
- `APP`: Deployment environment (`production` or `devnet`)

### Optional Variables
- `JITO_ENDPOINT`: Jito RPC endpoint URL. Available options:
  - `https://amsterdam.mainnet.block-engine.jito.wtf` (Amsterdam)
  - `https://frankfurt.mainnet.block-engine.jito.wtf` (Frankfurt)
  - `https://ny.mainnet.block-engine.jito.wtf` (New York, default)
  - `https://tokyo.mainnet.block-engine.jito.wtf` (Tokyo)
  - `https://slc.mainnet.block-engine.jito.wtf` (Salt Lake City)
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

## Build the Project

```sh
npm run build
```

## Run the Bot

```sh
npm start
```

## Important Notes

- Ensure your wallet has enough SOL for transaction fees (minimum **0.1 SOL** recommended).
- The `keypair.json` should contain your private key in JSON array format.
- The bot uses Jito for all operations including MEV protection and improved transaction success rates.
- Jito requires a minimum tip of 1000 lamports for bundles.
- Available Jito regions: Amsterdam, Frankfurt, New York (default), Tokyo, Salt Lake City

## Process Management (Optional)

Consider using PM2 or a similar tool to keep the bot running:

```sh
npm install -g pm2
pm2 start npm --name "liquidator" -- start
```