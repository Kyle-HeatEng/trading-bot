// Global test setup
// Loaded via bunfig.toml preload

// Use a fresh in-memory DB for each test run
process.env["DB_PATH"] = ":memory:";
process.env["TRADING_MODE"] = "paper";
process.env["LOG_LEVEL"] = "error"; // Suppress logs during tests
