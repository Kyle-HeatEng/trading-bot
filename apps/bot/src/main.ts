import { startBot } from "./app.ts";

startBot().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
