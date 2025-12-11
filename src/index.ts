// src/index.ts
// ABOUTME: Application entry point
// ABOUTME: Loads config, initializes server, and starts listening

import { loadConfig } from './config.js';
import { createServer } from './server.js';

const CONFIG_PATH = process.env.CONFIG_PATH || 'slacker.config.yaml';
const DB_PATH = process.env.DB_PATH || 'slacker.db';
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('Loading configuration...');
  const config = loadConfig(CONFIG_PATH);

  console.log('Starting server...');
  const server = createServer(config, DB_PATH);

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`Slacker running on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
