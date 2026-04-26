export interface OHLCData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type IndicatorType = 'SMA' | 'EMA' | 'RSI' | 'VWAP';

export type CandleType = 'CANDLE' | 'HEIKIN_ASHI' | 'RENKO';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';

export interface StrategyRule {
  id: string;
  field: string; // e.g. 'close', 'SMA_20'
  offset: number; // 0 for current, -1 for previous, etc.
  timeframe: Timeframe;
  candleType: CandleType;
  operator: '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below';
  valueType: 'STATIC' | 'FIELD';
  value: number; // used if STATIC
  valueField?: string; // used if FIELD
  valueOffset?: number; // used if FIELD
  buffer: number; // added to the value/field side
  enabled: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  candleType: CandleType;
  entryRules: StrategyRule[];
  exitRules: StrategyRule[];
  stopLossEnabled: boolean;
// ... (rest remains)
  stopLossPercent: number;
  stopLossPoints: number;
  stopLossType: 'PERCENT' | 'POINTS' | 'TOP_MINUS_PTS';
  takeProfitEnabled: boolean;
  takeProfitPercent: number;
  takeProfitPoints: number;
  takeProfitType: 'PERCENT' | 'POINTS';
  brickSize?: number;
}

export interface Trade {
  id: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  type: 'LONG' | 'SHORT';
  pnl: number;
  pnlPercent: number;
  reason: 'EXIT_RULE' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'END_OF_DATA';
}

export interface BacktestResult {
  trades: Trade[];
  stats: {
    totalPnl: number;
    totalPnlPercent: number;
    winRate: number;
    totalTrades: number;
    maxDrawdown: number;
    sharpeRatio: number;
  };
  equityCurve: { time: string; equity: number }[];
}
