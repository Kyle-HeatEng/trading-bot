export type StrategicBias = "long" | "short" | "neutral";

/** Parsed strategic plan from the hourly model (binding within risk system). */
export type StrategicPlanPayload = {
  bias: StrategicBias;
  entry_limit_price: number | null;
  long_take_profit: number | null;
  long_stop_loss: number | null;
  short_take_profit: number | null;
  short_stop_loss: number | null;
  reasoning: string;
  confidence: number;
};
