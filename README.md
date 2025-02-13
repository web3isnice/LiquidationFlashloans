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
RPC_ENDPOINT=<your-private-rpc-url>
SECRET_PATH=/Absolute/path/to/keypair.json
```

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
- Use a **private RPC endpoint**, as public ones have rate limits.
- The `keypair.json` should contain your private key in JSON array format.
- Make sure your **RPC endpoint is reliable** and has good performance.

## Process Management (Optional)

Consider using PM2 or a similar tool to keep the bot running:

```sh
npm install -g pm2
pm2 start npm --name "liquidator" -- start
```

