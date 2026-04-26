import { OHLCData, Strategy, Trade, BacktestResult, StrategyRule, Timeframe, CandleType } from '../types';
import { calculateSMA, calculateRSI, calculateEMA, resampleOHLC, calculateHeikinAshi, calculateRenko } from './indicators';

export function runBacktest(data: OHLCData[], strategy: Strategy, initialCapital = 20000): BacktestResult {
  const trades: Trade[] = [];
  let currentPosition: { type: 'LONG' | 'SHORT'; entryPrice: number; entryTime: string; maxPrice: number; minPrice: number } | null = null;
  let equity = initialCapital;
  const equityCurve: { time: string; equity: number }[] = [{ time: data[0].time, equity }];

  // Pre-calculate data combinations: Timeframe x CandleType
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '1d'];
  const candleTypes: CandleType[] = ['CANDLE', 'HEIKIN_ASHI', 'RENKO'];
  const resampledData: Record<string, Record<string, any[]>> = {};

  const getMultiplier = (tf: Timeframe) => {
    switch (tf) {
      case '5m': return 5;
      case '15m': return 15;
      case '1h': return 60;
      case '1d': return 1440;
      default: return 1;
    }
  };

  // We need to resample and add indicators to each combination
  timeframes.forEach(tf => {
    resampledData[tf] = {};
    const baseTfData = tf === '1m' ? data : resampleOHLC(data, getMultiplier(tf));

    candleTypes.forEach(ct => {
      let ctData: OHLCData[];
      if (ct === 'HEIKIN_ASHI') {
        ctData = calculateHeikinAshi(baseTfData);
      } else if (ct === 'RENKO') {
        ctData = calculateRenko(baseTfData, strategy.brickSize || 10);
      } else {
        ctData = baseTfData;
      }

      // Add indicators to this combination
      const sma20 = calculateSMA(ctData, 20);
      const sma50 = calculateSMA(ctData, 50);
      const ema20 = calculateEMA(ctData, 20);
      const rsi14 = calculateRSI(ctData, 14);
      
      resampledData[tf][ct] = ctData.map((d, i) => ({
        ...d,
        SMA_20: sma20[i],
        SMA_50: sma50[i],
        EMA_20: ema20[i],
        RSI_14: rsi14[i]
      }));
    });
  });

  // Find resampled index for a given timestamp
  const findResampledIdx = (tf: Timeframe, candleType: CandleType, timestamp: number) => {
    const list = resampledData[tf]?.[candleType];
    if (!list || list.length === 0) return -1;
    
    // For RENKO, the mapping is harder since time doesn't sync perfectly.
    // We find the last brick that started before or at this timestamp.
    let low = 0;
    let high = list.length - 1;
    let ans = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTime = new Date(list[mid].time).getTime();
      if (midTime <= timestamp) {
        ans = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return ans;
  };

  // Complex rule evaluation
  const evaluateRule = (rule: StrategyRule, currentTimestamp: number): boolean => {
    const tf = rule.timeframe || '1m';
    const ct = rule.candleType || 'CANDLE';
    const tfData = resampledData[tf]?.[ct];
    if (!tfData) return false;

    const tfIdx = findResampledIdx(tf, ct, currentTimestamp);
    
    // Offset logic (0 for current candle, -1 for previous)
    const idx = tfIdx + rule.offset;
    if (idx < 0 || idx >= tfData.length) return false;

    const val = tfData[idx][rule.field];
    
    let target: number;
    if (rule.valueType === 'STATIC') {
      target = rule.value + rule.buffer;
    } else {
      const tIdx = tfIdx + (rule.valueOffset || 0);
      if (tIdx < 0 || tIdx >= tfData.length) return false;
      target = (tfData[tIdx][rule.valueField || ''] || 0) + rule.buffer;
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
        const prevVal = tfData[pIdx][rule.field];
        let prevTarget: number;
        if (rule.valueType === 'STATIC') {
          prevTarget = rule.value + rule.buffer;
        } else {
          const ptIdx = (tfIdx - 1) + (rule.valueOffset || 0);
          if (ptIdx < 0) return false;
          prevTarget = (tfData[ptIdx][rule.valueField || ''] || 0) + rule.buffer;
        }
        return prevVal <= prevTarget && val > target;
      }
      case 'crosses_below': {
        const pIdx = idx - 1;
        if (pIdx < 0) return false;
        const prevVal = tfData[pIdx][rule.field];
        let prevTarget: number;
        if (rule.valueType === 'STATIC') {
          prevTarget = rule.value + rule.buffer;
        } else {
          const ptIdx = (tfIdx - 1) + (rule.valueOffset || 0);
          if (ptIdx < 0) return false;
          prevTarget = (tfData[ptIdx][rule.valueField || ''] || 0) + rule.buffer;
        }
        return prevVal >= prevTarget && val < target;
      }
      default: return false;
    }
  };

  // Main loop
  for (let i = 1; i < data.length; i++) {
    const bar = data[i];
    const timestamp = new Date(bar.time).getTime();

    if (currentPosition) {
      currentPosition.maxPrice = Math.max(currentPosition.maxPrice, bar.high);
      currentPosition.minPrice = Math.min(currentPosition.minPrice, bar.low);

      // Calculate profit/loss
      const priceDiff = bar.close - currentPosition.entryPrice;
      const profitPoints = currentPosition.type === 'LONG' ? priceDiff : -priceDiff;
      const profitPct = (profitPoints / currentPosition.entryPrice) * 100;

      let exitReason: Trade['reason'] | null = null;

      // Check Stop Loss
      if (strategy.stopLossEnabled) {
        if (strategy.stopLossType === 'PERCENT') {
          if (profitPct <= -strategy.stopLossPercent) exitReason = 'STOP_LOSS';
        } else if (strategy.stopLossType === 'POINTS') {
          if (profitPoints <= -strategy.stopLossPoints) exitReason = 'STOP_LOSS';
        } else if (strategy.stopLossType === 'TOP_MINUS_PTS') {
          if (currentPosition.type === 'LONG') {
            if (bar.low <= currentPosition.maxPrice - strategy.stopLossPoints) exitReason = 'STOP_LOSS';
          } else {
            if (bar.high >= currentPosition.minPrice + strategy.stopLossPoints) exitReason = 'STOP_LOSS';
          }
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

      // Check exit rules
      if (!exitReason) {
        const enabledExitRules = strategy.exitRules.filter(r => r.enabled);
        const shouldExit = enabledExitRules.length > 0 && enabledExitRules.every(rule => evaluateRule(rule, timestamp));
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
      const shouldEnter = enabledEntryRules.length > 0 && enabledEntryRules.every(rule => evaluateRule(rule, timestamp));
      if (shouldEnter) {
        currentPosition = {
          type: 'LONG',
          entryPrice: bar.close,
          entryTime: bar.time,
          maxPrice: bar.high,
          minPrice: bar.low
        };
      }
    }
    equityCurve.push({ time: bar.time, equity });
  }

  // Calculate Stats
  const winTrades = trades.filter(t => t.pnl > 0);
  const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((acc, t) => acc + t.pnl, 0);

  // Sharpe Ratio calculation
  const returns = trades.map(t => t.pnlPercent);
  let sharpeRatio = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(returns.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / (returns.length - 1));
    sharpeRatio = stdDev !== 0 ? (mean / stdDev) * Math.sqrt(252) : 0; // Annualized (sqrt 252 for daily, but here we use per-trade returns as proxy)
  }

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
      sharpeRatio: sharpeRatio
    },
    equityCurve
  };
}
