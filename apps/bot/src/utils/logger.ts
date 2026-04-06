import pino from "pino";

const LOG_LEVEL = process.env["LOG_LEVEL"] ?? "info";

const prettyTransport = {
  target: "pino-pretty",
  options: {
    colorize: true,
    translateTime: "HH:MM:ss",
    ignore: "pid,hostname",
  },
};

export const logger =
  process.env["NODE_ENV"] !== "production"
    ? pino({ level: LOG_LEVEL, transport: prettyTransport })
    : pino({ level: LOG_LEVEL });

// Child loggers for each module
export const exchangeLogger = logger.child({ module: "exchange" });
export const dataLogger = logger.child({ module: "data" });
export const indicatorLogger = logger.child({ module: "indicators" });
export const strategyLogger = logger.child({ module: "strategy" });
export const aiLogger = logger.child({ module: "ai" });
export const riskLogger = logger.child({ module: "risk" });
export const sentimentLogger = logger.child({ module: "sentiment" });
