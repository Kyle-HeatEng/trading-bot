import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Monorepo root (directory that contains `apps/`). */
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(SERVER_DIR, '../../../..')

export const BOT_CONFIG_YAML = path.join(REPO_ROOT, 'apps/bot/config/config.yaml')
export const BOT_DATA_DB = path.join(REPO_ROOT, 'data/trading-bot.db')
