import chalk from "chalk";
import type { PositionTracker } from "../strategy/position.ts";
import type { CircuitBreaker } from "../risk/circuitBreaker.ts";
import type { RiskManager } from "../risk/riskManager.ts";

interface DashboardState {
  equity: number;
  dailyPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  lastSignal: string;
  lastPrice: number;
  mode: string;
  uptimeMs: number;
}

export class Dashboard {
  private readonly startTime = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: DashboardState = {
    equity: 0,
    dailyPnl: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    lastSignal: "—",
    lastPrice: 0,
    mode: "paper",
    uptimeMs: 0,
  };

  constructor(
    private readonly position: PositionTracker,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly riskManager: RiskManager,
    private readonly refreshSec: number,
  ) {}

  update(partial: Partial<DashboardState>): void {
    this.state = { ...this.state, ...partial };
  }

  start(): void {
    this.timer = setInterval(() => this.render(), this.refreshSec * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  render(): void {
    const uptime = formatDuration(Date.now() - this.startTime);
    const pos = this.position.toJSON();
    const winRate = this.state.totalTrades > 0
      ? ((this.state.wins / this.state.totalTrades) * 100).toFixed(1)
      : "—";

    const pnlColor = this.state.dailyPnl >= 0 ? chalk.green : chalk.red;
    const modeColor = this.state.mode === "paper" ? chalk.yellow : chalk.cyan;

    console.clear();
    console.log(chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(chalk.bold("  BTC/USD Scalping Bot") + "  " + modeColor(`[${this.state.mode.toUpperCase()}]`));
    console.log(chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(`  Price:        ${chalk.white("$" + this.state.lastPrice.toFixed(2))}`);
    console.log(`  Equity:       ${chalk.white("$" + this.state.equity.toFixed(2))}`);
    console.log(`  Daily P&L:    ${pnlColor("$" + this.state.dailyPnl.toFixed(4))}`);
    console.log(
      `  Position:     ${
        pos.status === "FLAT"
          ? chalk.gray("FLAT")
          : formatOpenPositionLine(pos, this.state.lastPrice)
      }`,
    );
    console.log("");
    console.log(`  Trades:       ${this.state.totalTrades} (${this.state.wins}W / ${this.state.losses}L, WR: ${winRate}%)`);
    console.log(`  Last Signal:  ${this.state.lastSignal}`);
    console.log("");

    if (this.riskManager.isHalted) {
      console.log(chalk.red.bold("  ⚠  TRADING HALTED — daily loss limit exceeded"));
    } else if (this.circuitBreaker.isTripped) {
      console.log(chalk.yellow(`  ⏸  Circuit breaker active — ${this.circuitBreaker.pauseRemainingMin.toFixed(1)} min remaining`));
    } else {
      console.log(chalk.green("  ✓  Trading active"));
    }

    console.log(`  Uptime:       ${uptime}`);
    console.log(chalk.bold("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  }
}

type PosJson = ReturnType<PositionTracker["toJSON"]>;

function formatOpenPositionLine(pos: PosJson, lastPrice: number): string {
  if (pos.status !== "OPEN" || !("legs" in pos)) {
    return chalk.gray("—");
  }
  const notional = roundOpenNotional(pos, lastPrice);
  const lc = pos.longCount ?? 0;
  const sc = pos.shortCount ?? 0;
  const parts: string[] = [];
  if (lc > 0) parts.push(chalk.green(`LONG ×${lc}`));
  if (sc > 0) parts.push(chalk.red(`SHORT ×${sc}`));
  return `${parts.join(" + ")} (~$${notional.toFixed(2)} notional)`;
}

function roundOpenNotional(pos: PosJson, lastPrice: number): number {
  if (pos.status !== "OPEN" || !("legs" in pos) || !pos.legs.length) {
    return 0;
  }
  let sum = 0;
  for (const leg of pos.legs) {
    sum += leg.sizeBtc * lastPrice;
  }
  return sum;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
