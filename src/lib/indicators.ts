import { OHLCData } from '../types';

export function calculateSMA(data: OHLCData[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
      continue;
    }
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, curr) => acc + curr.close, 0);
    sma.push(sum / period);
  }
  return sma;
}

export function calculateEMA(data: OHLCData[], period: number): (number | null)[] {
  const ema: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(null);
      continue;
    }
    if (prevEma === null) {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, curr) => acc + curr.close, 0);
      prevEma = sum / period;
    } else {
      prevEma = (data[i].close - prevEma) * k + prevEma;
    }
    ema.push(prevEma);
  }
  return ema;
}

export function calculateVWAP(data: OHLCData[]): (number | null)[] {
  const vwap: (number | null)[] = [];
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  let currentDate = '';

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];
    const barDate = new Date(bar.time).toLocaleDateString();
    
    // Reset VWAP daily
    if (barDate !== currentDate) {
      cumulativePv = 0;
      cumulativeVolume = 0;
      currentDate = barDate;
    }

    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    const volume = bar.volume || 1;
    cumulativePv += typicalPrice * volume;
    cumulativeVolume += volume;
    vwap.push(cumulativePv / cumulativeVolume);
  }
  return vwap;
}

export function calculateRSI(data: OHLCData[], period: number = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (i <= period) {
      if (change > 0) gains += change;
      else losses += Math.abs(change);
      
      if (i === period) {
        gains /= period;
        losses /= period;
        const rs = gains / losses;
        rsi.push(100 - (100 / (1 + rs)));
      } else {
        rsi.push(null);
      }
    } else {
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;
      gains = (gains * (period - 1) + currentGain) / period;
      losses = (losses * (period - 1) + currentLoss) / period;
      const rs = gains / losses;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  // Offset by 1 for the null at start
  return [null, ...rsi];
}

export function calculateHeikinAshi(data: OHLCData[]): OHLCData[] {
  const haData: OHLCData[] = [];
  for (let i = 0; i < data.length; i++) {
    const bar = data[i];
    const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
    const haOpen = i === 0 
      ? (bar.open + bar.close) / 2 
      : (haData[i - 1].open + haData[i - 1].close) / 2;
    const haHigh = Math.max(bar.high, haOpen, haClose);
    const haLow = Math.min(bar.low, haOpen, haClose);
    
    haData.push({
      ...bar,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose
    });
  }
  return haData;
}

export function calculateRenko(data: OHLCData[], brickSize: number): OHLCData[] {
  if (data.length === 0 || !brickSize || brickSize <= 0) return [];
  const renko: OHLCData[] = [];
  let prevBrickClose = Math.round(data[0].close / brickSize) * brickSize;
  
  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const diff = price - prevBrickClose;
    const numBricks = Math.floor(Math.abs(diff) / brickSize);
    
    for (let j = 0; j < numBricks; j++) {
      if (renko.length > 5000) return renko; // Performance and recursion safety
      const direction = diff > 0 ? 1 : -1;
      const open = prevBrickClose;
      const close = prevBrickClose + (direction * brickSize);
      renko.push({
        time: data[i].time,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume: data[i].volume
      });
      prevBrickClose = close;
    }
  }
  return renko;
}

export function resampleOHLC(data: OHLCData[], timeframeMinutes: number): OHLCData[] {
  if (data.length === 0) return [];
  const resampled: OHLCData[] = [];
  let currentBin: OHLCData | null = null;
  
  for (const bar of data) {
    const time = new Date(bar.time);
    const timestamp = time.getTime();
    const intervalMs = timeframeMinutes * 60000;
    const binStartTime = Math.floor(timestamp / intervalMs) * intervalMs;
    
    if (!currentBin || new Date(currentBin.time).getTime() !== binStartTime) {
      if (currentBin) resampled.push(currentBin);
      currentBin = {
        time: new Date(binStartTime).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume || 0
      };
    } else {
      currentBin.high = Math.max(currentBin.high, bar.high);
      currentBin.low = Math.min(currentBin.low, bar.low);
      currentBin.close = bar.close;
      currentBin.volume = (currentBin.volume || 0) + (bar.volume || 0);
    }
  }
  if (currentBin) resampled.push(currentBin);
  return resampled;
}
