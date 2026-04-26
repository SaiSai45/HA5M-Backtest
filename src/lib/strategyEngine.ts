import { OHLCData, Strategy, Trade, BacktestResult, StrategyRule } from '../types';

export function runBacktest(data: OHLCData[], strategy: Strategy, initialCapital = 100000): BacktestResult {
  const trades: Trade[] = [];
  let currentPosition: { type: 'LONG' | 'SHORT'; entryPrice: number; entryTime: string } | null = null;
  let equity = initialCapital;
  const equityCurve: { time: string; equity: number }[] = [{ time: data[0].time, equity }];

  // Complex rule evaluation
  const evaluateRule = (rule: StrategyRule, currentIdx: number, dataWithIndicators: any[]): boolean => {
    // Offset logic (0 for current candle, -1 for previous)
    const idx = currentIdx + rule.offset;
    if (idx < 0 || idx >= dataWithIndicators.length) return false;

    const val = dataWithIndicators[idx][rule.field];
    
    let target: number;
    if (rule.valueType === 'STATIC') {
      target = rule.value + rule.buffer;
    } else {
      const tIdx = currentIdx + (rule.valueOffset || 0);
      if (tIdx < 0 || tIdx >= dataWithIndicators.length) return false;
      target = (dataWithIndicators[tIdx][rule.valueField || ''] || 0) + rule.buffer;
    }

    if (val === null || target === null || val === undefined || target === undefined) return false;

    switch (rule.operator) {
      case '>': return val > target;
      case '<': return val < target;
      case '>=': return val >= target;
      case '<=': return val <= target;
      case 'crosses_above': {
        const pIdx = idx - 1;
        if (pIdx < 0) return false;
        const prevVal = dataWithIndicators[pIdx][rule.field];
        let prevTarget: number;
        if (rule.valueType === 'STATIC') {
          prevTarget = rule.value + rule.buffer;
        } else {
          const ptIdx = (currentIdx - 1) + (rule.valueOffset || 0);
          if (ptIdx < 0) return false;
          prevTarget = (dataWithIndicators[ptIdx][rule.valueField || ''] || 0) + rule.buffer;
        }
        return prevVal <= prevTarget && val > target;
      }
      case 'crosses_below': {
        const pIdx = idx - 1;
        if (pIdx < 0) return false;
        const prevVal = dataWithIndicators[pIdx][rule.field];
        let prevTarget: number;
        if (rule.valueType === 'STATIC') {
          prevTarget = rule.value + rule.buffer;
        } else {
          const ptIdx = (currentIdx - 1) + (rule.valueOffset || 0);
          if (ptIdx < 0) return false;
          prevTarget = (dataWithIndicators[ptIdx][rule.valueField || ''] || 0) + rule.buffer;
        }
        return prevVal >= prevTarget && val < target;
      }
      default: return false;
    }
  };

  // Main loop
  for (let i = 1; i < data.length; i++) {
    const bar = data[i];

    if (currentPosition) {
      // Calculate profit/loss
      const priceDiff = bar.close - currentPosition.entryPrice;
      const profitPoints = currentPosition.type === 'LONG' ? priceDiff : -priceDiff;
      const profitPct = (profitPoints / currentPosition.entryPrice) * 100;

      let exitReason: Trade['reason'] | null = null;

      // Check Stop Loss
      if (strategy.stopLossEnabled) {
        if (strategy.stopLossType === 'PERCENT') {
          if (profitPct <= -strategy.stopLossPercent) exitReason = 'STOP_LOSS';
        } else {
          if (profitPoints <= -strategy.stopLossPoints) exitReason = 'STOP_LOSS';
        }
      }

      // Check Take Profit
      if (!exitReason && strategy.takeProfitEnabled) {
        if (strategy.takeProfitType === 'PERCENT') {
          if (profitPct >= strategy.takeProfitPercent) exitReason = 'TAKE_PROFIT';
        } else {
          if (profitPoints >= strategy.takeProfitPoints) exitReason = 'TAKE_PROFIT';
        }
      }

      // Check exit rules if no SL/TP triggered
      if (!exitReason) {
        const enabledExitRules = strategy.exitRules.filter(r => r.enabled);
        const shouldExit = enabledExitRules.length > 0 && enabledExitRules.every(rule => evaluateRule(rule, i, data));
        if (shouldExit) exitReason = 'EXIT_RULE';
      }

      if (exitReason) {
        const pnl = (profitPct / 100) * initialCapital;
        equity += pnl;
        trades.push({
          id: Math.random().toString(36).substr(2, 9),
          entryTime: currentPosition.entryTime,
          exitTime: bar.time,
          entryPrice: currentPosition.entryPrice,
          exitPrice: bar.close,
          type: currentPosition.type,
          pnl,
          pnlPercent: profitPct,
          reason: exitReason
        });
        currentPosition = null;
      }
    } else {
      // Check entry rules
      const enabledEntryRules = strategy.entryRules.filter(r => r.enabled);
      const shouldEnter = enabledEntryRules.length > 0 && enabledEntryRules.every(rule => evaluateRule(rule, i, data));
      if (shouldEnter) {
        currentPosition = {
          type: 'LONG', // Simple long-only for now
          entryPrice: bar.close,
          entryTime: bar.time
        };
      }
    }
    equityCurve.push({ time: bar.time, equity });
  }

  // Calculate Stats
  const winTrades = trades.filter(t => t.pnl > 0);
  const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((acc, t) => acc + t.pnl, 0);

  // Simple drawdown calculation
  let maxEquity = initialCapital;
  let maxDd = 0;
  equityCurve.forEach(p => {
    if (p.equity > maxEquity) maxEquity = p.equity;
    const dd = ((maxEquity - p.equity) / maxEquity) * 100;
    if (dd > maxDd) maxDd = dd;
  });

  return {
    trades,
    stats: {
      totalPnl,
      totalPnlPercent: (totalPnl / initialCapital) * 100,
      winRate,
      totalTrades: trades.length,
      maxDrawdown: maxDd,
      sharpeRatio: 0 // Skeleton
    },
    equityCurve
  };
}
