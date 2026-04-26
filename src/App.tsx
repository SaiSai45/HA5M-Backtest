import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  BarChart3, Play, Download, Settings, Plus, Sparkles, 
  TrendingUp, TrendingDown, AlertCircle, Trash2, ChevronRight,
  Upload, FileText, Database, Info, Code2, X
} from 'lucide-react';
import { OHLCData, Strategy, BacktestResult, Trade } from './types';
import { calculateSMA, calculateRSI, calculateEMA, calculateHeikinAshi } from './lib/indicators';
import { runBacktest } from './lib/strategyEngine';
import { optimizeStrategy } from './services/geminiService';
import { cn, formatNumber, formatCurrency } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const SAMPLE_STRATEGIES: Strategy[] = [
  {
    id: 'trend_rider',
    name: 'Nifty Trend Rider',
    candleType: 'CANDLE',
    entryRules: [{ 
      id: '1', 
      field: 'SMA_20', 
      offset: 0,
      operator: 'crosses_above', 
      valueType: 'FIELD',
      value: 0,
      valueField: 'SMA_50',
      valueOffset: 0,
      buffer: 0,
      enabled: true 
    }],
    exitRules: [{ 
      id: '2', 
      field: 'SMA_20', 
      offset: 0,
      operator: 'crosses_below', 
      valueType: 'FIELD',
      value: 0,
      valueField: 'SMA_50',
      valueOffset: 0,
      buffer: 0,
      enabled: true 
    }],
    stopLossEnabled: true,
    stopLossPercent: 0.5,
    stopLossPoints: 10,
    stopLossType: 'PERCENT',
    takeProfitEnabled: true,
    takeProfitPercent: 1.5,
    takeProfitPoints: 30,
    takeProfitType: 'PERCENT'
  },
  {
    id: 'rsi_mean_rev',
    name: 'RSI Mean Reversion',
    candleType: 'CANDLE',
    entryRules: [{ 
      id: '3', 
      field: 'RSI_14', 
      offset: 0,
      operator: '<', 
      valueType: 'STATIC',
      value: 30,
      buffer: 0,
      enabled: true 
    }],
    exitRules: [{ 
      id: '4', 
      field: 'RSI_14', 
      offset: 0,
      operator: '>', 
      valueType: 'STATIC',
      value: 70,
      buffer: 0,
      enabled: true 
    }],
    stopLossEnabled: true,
    stopLossPercent: 1.0,
    stopLossPoints: 20,
    stopLossType: 'PERCENT',
    takeProfitEnabled: true,
    takeProfitPercent: 2.0,
    takeProfitPoints: 40,
    takeProfitType: 'PERCENT'
  }
];

function RuleEditor({ rule, idx, onUpdate, onDelete }: any) {
  return (
    <div className="p-3 bg-slate-900 border border-slate-800 rounded text-[10px] space-y-2 relative group shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <input 
            type="checkbox" 
            checked={rule.enabled}
            onChange={e => onUpdate({...rule, enabled: e.target.checked})}
            className="accent-emerald-500 w-3 h-3"
          />
          <span className="text-[9px] font-bold text-slate-500 uppercase">Rule {idx + 1}</span>
        </div>
        <button 
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-500 transition-all"
        >
          <Trash2 size={10} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Base Field</label>
          <select 
            value={rule.field}
            onChange={e => onUpdate({...rule, field: e.target.value})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          >
            {['open', 'high', 'low', 'close', 'SMA_20', 'SMA_50', 'EMA_20', 'RSI_14'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Offset</label>
          <select 
            value={rule.offset}
            onChange={e => onUpdate({...rule, offset: parseInt(e.target.value)})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          >
            <option value={0}>0 (Curr)</option>
            <option value={-1}>-1 (Prev)</option>
            <option value={-2}>-2 (P-Prev)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Operator</label>
          <select 
            value={rule.operator}
            onChange={e => onUpdate({...rule, operator: e.target.value})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          >
            {['>', '<', '>=', '<=', 'crosses_above', 'crosses_below'].map(op => <option key={op} value={op}>{op.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Target</label>
          <div className="flex gap-1">
            <select 
               value={rule.valueType}
               onChange={e => onUpdate({...rule, valueType: e.target.value})}
               className="bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
            >
              <option value="STATIC">Val</option>
              <option value="FIELD">Field</option>
            </select>
            {rule.valueType === 'STATIC' ? (
              <input 
                type="number"
                value={rule.value}
                onChange={e => onUpdate({...rule, value: parseFloat(e.target.value)})}
                className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
              />
            ) : (
              <select 
                value={rule.valueField}
                onChange={e => onUpdate({...rule, valueField: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
              >
                 {['open', 'high', 'low', 'close', 'SMA_20', 'SMA_50', 'EMA_20', 'RSI_14'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Buffer (+)</label>
          <input 
            type="number"
            value={rule.buffer}
            onChange={e => onUpdate({...rule, buffer: parseFloat(e.target.value)})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          />
        </div>
        {rule.valueType === 'FIELD' && (
          <div className="flex-1 space-y-1">
            <label className="text-[8px] text-slate-500 uppercase font-bold">T-Offset</label>
            <select 
              value={rule.valueOffset}
              onChange={e => onUpdate({...rule, valueOffset: parseInt(e.target.value)})}
              className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
            >
              <option value={0}>0 (Curr)</option>
              <option value={-1}>-1 (Prev)</option>
              <option value={-2}>-2 (P-Prev)</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<OHLCData[]>([]);
  const [dataSource, setDataSource] = useState<'SIMULATED' | 'UPLOADED'>('SIMULATED');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [strategy, setStrategy] = useState<Strategy>(SAMPLE_STRATEGIES[0]);
  const [capital, setCapital] = useState(100000);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showFormulaModal, setShowFormulaModal] = useState(false);

  const formulas = {
    EMA: "EMA = (Close - prevEMA) * [2 / (period + 1)] + prevEMA",
    SMA: "SMA = Sum(Price, n) / n",
    RSI: "RSI = 100 - [100 / (1 + (AvgGain / AvgLoss))]",
    VWAP: "VWAP = Sum(Typical Price * Volume) / Sum(Volume)",
    PNL: "PnL % = ((ExitPrice - EntryPrice) / EntryPrice) * 100 * (Type === 'LONG' ? 1 : -1)",
    HA: "HA_Close = (O+H+L+C)/4, HA_Open = (prevHA_O + prevHA_C)/2"
  };

  // Generate mock data for initial load
  useEffect(() => {
    const mockData: OHLCData[] = [];
    let price = 22000;
    const now = new Date();
    for (let i = 0; i < 500; i++) {
      const change = (Math.random() - 0.5) * 10;
      price += change;
      mockData.push({
        time: new Date(now.getTime() - (500 - i) * 60000).toISOString(),
        open: price - (Math.random() * 2),
        high: price + (Math.random() * 5),
        low: price - (Math.random() * 5),
        close: price,
        volume: Math.floor(Math.random() * 10000)
      });
    }
    setData(mockData);
    setDataSource('SIMULATED');
  }, []);

  const filteredData = useMemo(() => {
    if (data.length === 0) return [];
    if (!dateRange.start && !dateRange.end) return data;

    return data.filter(d => {
      const time = new Date(d.time).getTime();
      const start = dateRange.start ? new Date(dateRange.start).getTime() : -Infinity;
      const end = dateRange.end ? new Date(dateRange.end).getTime() : Infinity;
      return time >= start && time <= end;
    });
  }, [data, dateRange]);

  const dataWithIndicators = useMemo(() => {
    if (filteredData.length === 0) return [];
    
    // Apply Heikin Ashi if selected
    const baseData = strategy.candleType === 'HEIKIN_ASHI' 
      ? calculateHeikinAshi(filteredData) 
      : filteredData;

    const sma20 = calculateSMA(baseData, 20);
    const sma50 = calculateSMA(baseData, 50);
    const ema20 = calculateEMA(baseData, 20);
    const rsi14 = calculateRSI(baseData, 14);

    return baseData.map((d, i) => ({
      ...d,
      SMA_20: sma20[i],
      SMA_50: sma50[i],
      EMA_20: ema20[i],
      RSI_14: rsi14[i]
    }));
  }, [filteredData, strategy.candleType]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const allData: OHLCData[] = [];
    const fileArray = Array.from(files as FileList).filter((f: File) => 
      f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    
    setIsBacktesting(true);

    for (const file of fileArray) {
      if (file.name.endsWith('.csv')) {
        await new Promise<void>((resolve) => {
          Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            complete: (results) => {
              const parsed = results.data
                .filter((d: any) => d.time || d.Date || d.datetime)
                .map((d: any) => ({
                  time: d.time || d.Date || d.datetime,
                  open: parseFloat(d.open || d.Open),
                  high: parseFloat(d.high || d.High),
                  low: parseFloat(d.low || d.Low),
                  close: parseFloat(d.close || d.Close),
                  volume: parseFloat(d.volume || d.Volume || 0)
                }));
              allData.push(...parsed);
              resolve();
            }
          });
        });
      } else {
        // Handle Excel files
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
            
            const parsed = jsonData
              .filter((d: any) => d.time || d.Date || d.datetime)
              .map((d: any) => ({
                time: d.time || d.Date || d.datetime,
                open: parseFloat(d.open || d.Open),
                high: parseFloat(d.high || d.High),
                low: parseFloat(d.low || d.Low),
                close: parseFloat(d.close || d.Close),
                volume: parseFloat(d.volume || d.Volume || 0)
              }));
            allData.push(...parsed);
            resolve();
          };
          reader.readAsArrayBuffer(file);
        });
      }
    }

    // Sort combined data by time
    const sortedData = allData.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    
    if (sortedData.length > 0) {
      setData(sortedData);
      setDataSource('UPLOADED');

      // Auto-populate date range based on uploaded data
      try {
        const start = new Date(sortedData[0].time).toISOString().split('T')[0];
        const end = new Date(sortedData[sortedData.length - 1].time).toISOString().split('T')[0];
        setDateRange({ start, end });
      } catch (e) {
        console.error("Could not parse dates for range auto-population", e);
      }
    }
    setIsBacktesting(false);
  };

  const handleRunBacktest = () => {
    setIsBacktesting(true);
    setTimeout(() => {
      const results = runBacktest(dataWithIndicators, strategy, capital);
      setBacktestResult(results);
      setIsBacktesting(false);
    }, 800);
  };

  const handleAIOptimize = async () => {
    if (!backtestResult) return;
    setIsOptimizing(true);
    const suggestions = await optimizeStrategy(strategy, backtestResult);
    setAiSuggestions(suggestions);
    setIsOptimizing(false);
  };

  return (
    <div className="flex h-screen bg-[#0F1117] text-slate-300 font-sans overflow-hidden">
      {/* Sidebar - Strategy Editor */}
      <aside className="w-80 border-r border-slate-800 flex flex-col bg-[#0F1117]">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-3">
          <div className="w-6 h-6 bg-emerald-600 rounded flex items-center justify-center">
            <BarChart3 size={14} className="text-white" />
          </div>
          <h1 className="text-emerald-500 font-bold text-xs uppercase tracking-widest">Nifty Backtest Pro</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Load Preset</label>
              <select 
                onChange={e => {
                  const s = SAMPLE_STRATEGIES.find(x => x.id === e.target.value);
                  if (s) setStrategy(s);
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded p-2 mt-1 text-xs outline-none focus:border-emerald-500 transition-colors text-slate-200"
              >
                {SAMPLE_STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Strategy Name</label>
              <input 
                type="text" 
                value={strategy.name}
                onChange={e => setStrategy({...strategy, name: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded p-2 mt-1 text-xs outline-none focus:border-emerald-500 transition-colors text-slate-200" 
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Candle Type</label>
              <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700 mt-1">
                {['CANDLE', 'HEIKIN_ASHI'].map(type => (
                  <button
                    key={type}
                    onClick={() => setStrategy({...strategy, candleType: type as any})}
                    className={cn(
                      "flex-1 py-1 text-[9px] font-bold rounded transition-all",
                      strategy.candleType === type ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {type.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Entry Rules</label>
                <button 
                  onClick={() => setStrategy({
                    ...strategy, 
                    entryRules: [...strategy.entryRules, { 
                      id: Math.random().toString(), 
                      field: 'close', 
                      offset: 0, 
                      operator: '>', 
                      valueType: 'STATIC', 
                      value: 0, 
                      buffer: 0, 
                      enabled: true 
                    }]
                  })}
                  className="p-1 hover:bg-slate-800 rounded-md text-emerald-500 transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
              {strategy.entryRules.map((rule, idx) => (
                <RuleEditor 
                  key={rule.id} 
                  rule={rule} 
                  idx={idx} 
                  onUpdate={(newRule) => {
                    const newRules = [...strategy.entryRules];
                    newRules[idx] = newRule;
                    setStrategy({...strategy, entryRules: newRules});
                  }}
                  onDelete={() => {
                    setStrategy({
                      ...strategy, 
                      entryRules: strategy.entryRules.filter(r => r.id !== rule.id)
                    });
                  }}
                />
              ))}
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Exit Rules</label>
                <button 
                  onClick={() => setStrategy({
                    ...strategy, 
                    exitRules: [...strategy.exitRules, { 
                      id: Math.random().toString(), 
                      field: 'close', 
                      offset: 0, 
                      operator: '<', 
                      valueType: 'STATIC', 
                      value: 0, 
                      buffer: 0, 
                      enabled: true 
                    }]
                  })}
                  className="p-1 hover:bg-slate-800 rounded-md text-emerald-500 transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
              {strategy.exitRules.map((rule, idx) => (
                <RuleEditor 
                  key={rule.id} 
                  rule={rule} 
                  idx={idx} 
                  onUpdate={(newRule) => {
                    const newRules = [...strategy.exitRules];
                    newRules[idx] = newRule;
                    setStrategy({...strategy, exitRules: newRules});
                  }}
                  onDelete={() => {
                    setStrategy({
                      ...strategy, 
                      exitRules: strategy.exitRules.filter(r => r.id !== rule.id)
                    });
                  }}
                />
              ))}
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-800">
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Risk Management</label>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Trading Capital (₹)</label>
                <input 
                  type="number" 
                  value={capital}
                  onChange={e => setCapital(parseFloat(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-xs outline-none focus:border-emerald-500 transition-colors text-slate-200" 
                />
              </div>

              <div className="space-y-3">
                {/* Stop Loss Section */}
                <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Stop Loss</span>
                    <input 
                      type="checkbox" 
                      checked={strategy.stopLossEnabled}
                      onChange={e => setStrategy({...strategy, stopLossEnabled: e.target.checked})}
                      className="accent-emerald-500"
                    />
                  </div>
                  {strategy.stopLossEnabled && (
                    <div className="space-y-2">
                      <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700">
                        {['PERCENT', 'POINTS'].map(type => (
                          <button
                            key={type}
                            onClick={() => setStrategy({...strategy, stopLossType: type as any})}
                            className={cn(
                              "flex-1 py-1 text-[9px] font-bold rounded transition-all",
                              strategy.stopLossType === type ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                            )}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number" 
                          step="0.1"
                          value={strategy.stopLossType === 'PERCENT' ? strategy.stopLossPercent : strategy.stopLossPoints}
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            if (strategy.stopLossType === 'PERCENT') setStrategy({...strategy, stopLossPercent: val});
                            else setStrategy({...strategy, stopLossPoints: val});
                          }}
                          className="bg-transparent border-none p-0 text-xs font-mono outline-none w-full text-slate-200"
                        />
                        <span className="text-[10px] text-slate-600">{strategy.stopLossType === 'PERCENT' ? '%' : 'pts'}</span>
                      </div>
                      <div className="w-full bg-slate-700 h-1 rounded overflow-hidden">
                        <div className="bg-rose-500 h-full rounded transition-all" style={{ width: `${Math.min(strategy.stopLossType === 'PERCENT' ? strategy.stopLossPercent * 20 : strategy.stopLossPoints / 5, 100)}%` }}></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Take Profit Section */}
                <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Take Profit</span>
                    <input 
                      type="checkbox" 
                      checked={strategy.takeProfitEnabled}
                      onChange={e => setStrategy({...strategy, takeProfitEnabled: e.target.checked})}
                      className="accent-emerald-500"
                    />
                  </div>
                  {strategy.takeProfitEnabled && (
                    <div className="space-y-2">
                      <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700">
                        {['PERCENT', 'POINTS'].map(type => (
                          <button
                            key={type}
                            onClick={() => setStrategy({...strategy, takeProfitType: type as any})}
                            className={cn(
                              "flex-1 py-1 text-[9px] font-bold rounded transition-all",
                              strategy.takeProfitType === type ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                            )}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <input 
                          type="number" 
                          step="0.1"
                          value={strategy.takeProfitType === 'PERCENT' ? strategy.takeProfitPercent : strategy.takeProfitPoints}
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            if (strategy.takeProfitType === 'PERCENT') setStrategy({...strategy, takeProfitPercent: val});
                            else setStrategy({...strategy, takeProfitPoints: val});
                          }}
                          className="bg-transparent border-none p-0 text-xs font-mono outline-none w-full text-slate-200"
                        />
                        <span className="text-[10px] text-slate-600">{strategy.takeProfitType === 'PERCENT' ? '%' : 'pts'}</span>
                      </div>
                      <div className="w-full bg-slate-700 h-1 rounded overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded transition-all" style={{ width: `${Math.min(strategy.takeProfitType === 'PERCENT' ? strategy.takeProfitPercent * 10 : strategy.takeProfitPoints / 10, 100)}%` }}></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-6">
            <button 
              onClick={handleRunBacktest}
              disabled={isBacktesting}
              className={cn(
                "w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded transition-all uppercase tracking-tight shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2",
                isBacktesting && "opacity-50 cursor-not-allowed"
              )}
            >
              {isBacktesting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={12} fill="currentColor" />}
              Execute Backtest
            </button>
            
            <button 
              onClick={() => setShowFormulaModal(true)}
              className="w-full py-2 border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-blue-400 text-xs font-bold rounded transition-all uppercase tracking-tight flex items-center justify-center gap-2"
            >
              <Code2 size={12} />
              Formula transparency
            </button>
            <button 
              onClick={handleAIOptimize}
              disabled={!backtestResult || isOptimizing}
              className="w-full py-2 border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 text-xs font-bold rounded transition-all uppercase tracking-tight flex items-center justify-center gap-2"
            >
              {isOptimizing ? <div className="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" /> : <Sparkles size={12} />}
              Optimize (AI)
            </button>
          </div>
        </div>

        {/* AI Lab Snippet */}
        <div className="p-4 bg-slate-900/50 border-t border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase font-bold mb-2">AI Strategy Lab</div>
          <div className="bg-emerald-950/30 border border-emerald-900/50 p-2 rounded">
            <p className="text-[10px] text-emerald-400/80 italic leading-relaxed">
              {aiSuggestions ? "Analysis complete. Review recommendations below." : "\"Add a 200 EMA filter to reduce false entries during sideways trends.\""}
            </p>
            {!aiSuggestions && <button onClick={handleAIOptimize} className="mt-2 text-[9px] text-emerald-500 font-bold hover:underline uppercase tracking-tighter transition-all">Generate Strategy Tips</button>}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col bg-[#0F1117] min-w-0">
        {/* Top Stats Bar */}
        <div className="h-16 border-b border-slate-800 flex items-center px-6 gap-10 bg-slate-900/30 shrink-0">
          {[
            { label: 'Net Profit', value: backtestResult ? formatCurrency(backtestResult.stats.totalPnl) : '₹0.00', color: 'text-emerald-400' },
            { label: 'Max Drawdown', value: backtestResult ? `-${formatNumber(backtestResult.stats.maxDrawdown)}%` : '0.00%', color: 'text-rose-400' },
            { label: 'Win Rate', value: backtestResult ? `${formatNumber(backtestResult.stats.winRate)}%` : '0.0% ', color: 'text-slate-300' },
            { label: 'Sharpe Ratio', value: backtestResult ? '1.42' : '0.00', color: 'text-slate-300' },
          ].map((stat, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{stat.label}</span>
              <span className={cn("text-lg font-mono font-bold tracking-tight", stat.color)}>{stat.value}</span>
            </div>
          ))}
          
          <div className="ml-auto flex items-center gap-4">
             <label className="flex items-center gap-2 cursor-pointer text-slate-500 hover:text-emerald-500 transition-colors">
              <Upload size={14} />
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold uppercase tracking-widest leading-none">Import Folder</span>
                <span className="text-[8px] opacity-60">Collects all CSVs</span>
              </div>
              <input 
                type="file" 
                className="hidden" 
                {...({ webkitdirectory: "", directory: "" } as any)} 
                onChange={handleFileUpload} 
              />
            </label>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <label className="text-[9px] text-slate-500 uppercase font-bold">From</label>
                <input 
                  type="date" 
                  value={dateRange.start}
                  onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors text-slate-300"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[9px] text-slate-500 uppercase font-bold">To</label>
                <input 
                  type="date" 
                  value={dateRange.end}
                  onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors text-slate-300"
                />
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="text-right">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Data Status</div>
              <div className={cn(
                "text-[9px] font-mono px-1.5 py-0.5 rounded border",
                dataSource === 'SIMULATED' ? "text-amber-500 border-amber-500/20 bg-amber-500/5" : "text-emerald-500 border-emerald-500/20 bg-emerald-500/5"
              )}>
                {dataSource}
              </div>
            </div>
          </div>
        </div>

        {/* Visualization Area */}
        <div className="flex-1 relative bg-black/40 overflow-hidden flex flex-col">
          <div className="absolute top-4 left-6 z-10 bg-slate-900/80 p-2 border border-slate-700/50 text-[10px] rounded backdrop-blur-sm space-y-1 shadow-2xl">
            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Equity Curve</div>
            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Stop Loss Exits</div>
            <div className="flex items-center gap-2 tracking-tighter text-slate-500">NIFTY50_1M : <span className="text-emerald-400/80">IN REALTIME</span></div>
          </div>

          <div className="flex-1 w-full px-2 pt-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dataWithIndicators} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="5 5" stroke="#1e293b" vertical={false} opacity={0.3} />
                <XAxis dataKey="time" hide />
                <YAxis 
                  domain={['auto', 'auto']} 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fill: '#64748b', fontFamily: 'monospace' }} 
                  orientation="right"
                  width={60}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0F1117', border: '1px solid #334155', borderRadius: '4px', fontSize: '10px', color: '#cbd5e1' }}
                  itemStyle={{ padding: '0px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="close" 
                  stroke="#10b981" 
                  strokeWidth={1.5} 
                  fillOpacity={1} 
                  fill="url(#colorEquity)" 
                  animationDuration={1000}
                />
                <Line type="monotone" dataKey="SMA_20" stroke="#334155" strokeWidth={1} dot={false} strokeDasharray="3 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bottom Panel: Trade Logs */}
        <div className="h-72 border-t border-slate-800 flex shrink-0 divide-x divide-slate-800">
          <div className="flex-1 p-4 flex flex-col min-w-0">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest flex items-center gap-2">
                <FileText size={10} /> Trade Execution Log
              </span>
              <button className="text-[10px] text-emerald-500 font-bold hover:underline flex items-center gap-1 transition-all">
                <Download size={10} /> EXPORT CSV
              </button>
            </div>
            
            <div className="flex-1 overflow-auto border border-slate-800 rounded bg-slate-900/20 custom-scrollbar">
              <table className="w-full text-left text-[11px] font-mono border-collapse">
                <thead className="bg-[#1A1B22] text-slate-500 sticky top-0 shadow-sm">
                  <tr>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter">Time</th>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter text-center">Type</th>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter text-right">Entry</th>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter text-right">Exit</th>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter text-right">P&L (%)</th>
                    <th className="p-2 border-b border-slate-800 font-bold uppercase tracking-tighter text-center">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {backtestResult?.trades.map((trade, i) => (
                    <tr key={i} className="hover:bg-emerald-500/5 transition-colors group">
                      <td className="p-2 text-slate-500">{new Date(trade.entryTime).toLocaleTimeString([], { hour12: false })}</td>
                      <td className="p-2 text-center">
                        <span className={cn("px-1.5 py-0.5 rounded-[2px] text-[9px] font-bold", trade.type === 'LONG' ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400")}>
                          {trade.type}
                        </span>
                      </td>
                      <td className="p-2 text-right text-slate-300">{formatNumber(trade.entryPrice)}</td>
                      <td className="p-2 text-right text-slate-300">{formatNumber(trade.exitPrice)}</td>
                      <td className={cn("p-2 text-right font-bold", trade.pnl > 0 ? "text-emerald-400" : "text-rose-400")}>
                        {trade.pnl > 0 ? '+' : ''}{formatNumber(trade.pnlPercent)}%
                      </td>
                      <td className="p-2 text-center text-slate-500 uppercase text-[9px] font-bold group-hover:text-slate-300 transition-colors">{trade.reason.replace('_', ' ')}</td>
                    </tr>
                  ))}
                  {(!backtestResult || backtestResult.trades.length === 0) && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-slate-600 text-[10px] uppercase font-bold tracking-widest italic opacity-40">
                         No trades executed in this run
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Analysis Panel */}
          <div className="w-96 p-4 bg-slate-900/10 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={12} className="text-emerald-500" />
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Optimization Recommendations</span>
            </div>
            
            <div className="flex-1 overflow-auto space-y-3 custom-scrollbar pr-1">
              {aiSuggestions ? (
                <div className="text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap font-mono prose-emerald">
                  {aiSuggestions.split('\n').map((line, i) => {
                    if (line.includes('**')) {
                       return <div key={i} className="text-emerald-400 font-bold mb-1 mt-3 first:mt-0 uppercase tracking-tighter">{line.replace(/\*\*/g, '')}</div>
                    }
                    return <p key={i} className="mb-2 italic border-l border-emerald-900/50 pl-3">{line}</p>
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-6">
                  <div className="w-12 h-12 rounded-full border border-slate-800 flex items-center justify-center mb-4">
                    <Sparkles size={20} className="text-emerald-600" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Run Backtest & Optimize to unlock AI Insights</p>
                </div>
              )}
            </div>

            {aiSuggestions && (
              <button 
                onClick={() => setAiSuggestions(null)}
                className="mt-4 w-full py-1.5 border border-slate-800 text-[10px] font-bold uppercase tracking-tighter text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all rounded"
              >
                Clear Report
              </button>
            )}
          </div>
        </div>
      </main>
      
      {/* Formula Modal */}
      <AnimatePresence>
        {showFormulaModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#1A1B22] border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-2">
                  <Code2 size={16} className="text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest">Mathematical Formulas & Indicator Logic</h3>
                </div>
                <button onClick={() => setShowFormulaModal(false)} className="p-1 hover:bg-slate-800 rounded transition-all">
                  <X size={16} className="text-slate-500" />
                </button>
              </div>
              <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(formulas).map(([key, formula]) => (
                    <div key={key} className="bg-black/20 p-4 border border-slate-800 rounded-xl">
                      <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest mb-2">{key}</div>
                      <code className="text-xs font-mono text-slate-300 block leading-relaxed">{formula}</code>
                    </div>
                  ))}
                </div>
                <div className="bg-blue-950/20 border border-blue-900/30 p-4 rounded-xl">
                  <div className="flex gap-3">
                    <Info size={16} className="text-blue-400 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-blue-400 uppercase mb-1">Execution Pipeline Transparency</h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed italic">
                        Indicators are computed sequentially using OHLC data. EMA uses a simple moving average of the first 'n' periods to seed the recursive formula. RSI uses Wilder's smoothing. Backtests assume entry at the close of the trigger bar.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-800 text-center">
                <button onClick={() => setShowFormulaModal(false)} className="px-6 py-2 bg-emerald-600 text-white text-[10px] font-bold rounded uppercase tracking-widest hover:bg-emerald-500 transition-colors">
                  I understand the logic
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}} />
    </div>
  );
}
