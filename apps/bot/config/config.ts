import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const TradingConfigSchema = z.object({
  pair: z.string(),
  restPair: z.string(),
  timeframeSec: z.number().positive(),
  mode: z.enum(["live", "paper"]),
});

const StrategyConfigSchema = z.object({
  emaFast: z.number().positive(),
  emaSlow: z.number().positive(),
  emaTrend: z.number().positive(),
  rsiPeriod: z.number().positive(),
  rsiMin: z.number(),
  rsiMax: z.number(),
  obImbalanceMin: z.number(),
  aiConfidenceMin: z.number().min(0).max(1),
  polymarketBullishMin: z.number().min(0).max(1),
  takeProfitPct: z.number().positive(),
  stopLossPct: z.number().positive(),
  aiCallOnSignal: z.boolean(),
  aiCallEveryNCandles: z.number().positive(),
});

const SizingConfigSchema = z.object({
  fixedFractional: z.number().positive().max(0.1),
  minBtc: z.number().positive(),
  maxBtc: z.number().positive(),
});

const RiskConfigSchema = z.object({
  maxDailyLossPct: z.number().positive().max(100),
  maxOpenExposurePct: z.number().positive().max(100),
  minHoursBetweenNewPositions: z.number().nonnegative(),
  circuitBreakerLosses: z.number().positive().int(),
  circuitBreakerPauseMin: z.number().positive(),
  slippageTolerancePct: z.number().positive().max(100),
});

const ExecutionConfigSchema = z.object({
  preferLimitOrders: z.boolean(),
  limitOrderTimeoutSec: z.number().positive(),
  maxRetries: z.number().positive().int(),
});

const IndicatorsConfigSchema = z.object({
  warmupCandles: z.number().positive(),
  bollingerPeriod: z.number().positive(),
  bollingerStdDev: z.number().positive(),
  macdFast: z.number().positive(),
  macdSlow: z.number().positive(),
  macdSignal: z.number().positive(),
  stochasticK: z.number().positive(),
  stochasticD: z.number().positive(),
  mfiPeriod: z.number().positive(),
  vwapDeviation: z.boolean(),
});

const SentimentConfigSchema = z.object({
  polymarketRefreshSec: z.number().positive(),
  polymarketDiscoverMin: z.number().positive(),
  fearGreedRefreshMin: z.number().positive(),
  polymarketMinLiquidity: z.number().positive(),
});

const MonitoringConfigSchema = z.object({
  dashboardRefreshSec: z.number().positive(),
  journalFlushSec: z.number().positive(),
});

const ConfigSchema = z.object({
  trading: TradingConfigSchema,
  strategy: StrategyConfigSchema,
  sizing: SizingConfigSchema,
  risk: RiskConfigSchema,
  execution: ExecutionConfigSchema,
  indicators: IndicatorsConfigSchema,
  sentiment: SentimentConfigSchema,
  monitoring: MonitoringConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(configPath = "./config/config.yaml"): Config {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw) as unknown;
  const result = ConfigSchema.safeParse(parsed);

  if (!result.success) {
    console.error("Invalid config.yaml:", result.error.message);
    process.exit(1);
  }

  const config = result.data;

  // Config YAML expresses percentages as whole numbers (e.g. 3 = 3%).
  // Normalize to fractions for internal use.
  config.strategy.takeProfitPct /= 100;
  config.strategy.stopLossPct /= 100;
  config.risk.maxDailyLossPct /= 100;
  config.risk.maxOpenExposurePct /= 100;
  config.risk.slippageTolerancePct /= 100;

  // Environment variable overrides
  if (process.env["TRADING_MODE"] === "live" || process.env["TRADING_MODE"] === "paper") {
    config.trading.mode = process.env["TRADING_MODE"];
  }
  if (process.env["MAX_DAILY_LOSS_PCT"]) {
    config.risk.maxDailyLossPct = Number(process.env["MAX_DAILY_LOSS_PCT"]) / 100;
  }
  if (process.env["MAX_OPEN_EXPOSURE_PCT"]) {
    config.risk.maxOpenExposurePct = Number(process.env["MAX_OPEN_EXPOSURE_PCT"]) / 100;
  }

  return config;
}

// Singleton — loaded once at startup
export const config: Config = loadConfig();
