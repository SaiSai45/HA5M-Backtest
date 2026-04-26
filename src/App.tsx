import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  BarChart3, Play, Download, Settings, Plus, Sparkles, 
  TrendingUp, TrendingDown, AlertCircle, Trash2, ChevronRight,
  Upload, FileText, Database, Info, Code2, X, LogIn, LogOut, User
} from 'lucide-react';
import { OHLCData, Strategy, BacktestResult, Trade, Timeframe } from './types';
import { calculateSMA, calculateRSI, calculateEMA, calculateHeikinAshi, calculateRenko } from './lib/indicators';
import { runBacktest } from './lib/strategyEngine';
import { optimizeStrategy } from './services/geminiService';
import { cn, formatNumber, formatCurrency } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  collection, query, where, orderBy, limit, getDocs, 
  addDoc, writeBatch, doc, setDoc, onSnapshot, getDocFromServer,
  getCountFromServer
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

const SAMPLE_STRATEGIES: Strategy[] = [
  {
    id: 'trend_rider',
    name: 'Nifty Trend Rider',
    candleType: 'CANDLE',
    entryRules: [{ 
      id: '1', 
      field: 'SMA_20', 
      offset: 0,
      timeframe: '1m',
      candleType: 'CANDLE',
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
      timeframe: '1m',
      candleType: 'CANDLE',
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
    stopLossPoints: 100,
    stopLossType: 'TOP_MINUS_PTS',
    takeProfitEnabled: false,
    takeProfitPercent: 1.5,
    takeProfitPoints: 300,
    takeProfitType: 'POINTS',
    brickSize: 10
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

      <div className="grid grid-cols-3 gap-2">
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

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Timeframe</label>
          <select 
            value={rule.timeframe}
            onChange={e => onUpdate({...rule, timeframe: e.target.value as Timeframe})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          >
            {['1m', '5m', '15m', '1h', '1d'].map(tf => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[8px] text-slate-500 uppercase font-bold">Candle Type</label>
          <select 
            value={rule.candleType}
            onChange={e => onUpdate({...rule, candleType: e.target.value as any})}
            className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-[9px] outline-none"
          >
            {['CANDLE', 'HEIKIN_ASHI', 'RENKO'].map(ct => <option key={ct} value={ct}>{ct.replace('_', ' ')}</option>)}
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

interface UploadStatus {
  isUploading: boolean;
  currentFile: string;
  processedFiles: number;
  totalFiles: number;
  currentDateRange: string;
  progress: number;
  error?: string;
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<OHLCData[]>([]);
  const [dataSource, setDataSource] = useState<'SIMULATED' | 'FILES' | 'DB'>(() => {
    const saved = localStorage.getItem('bt_data_source');
    return (saved as any) || 'DB';
  });
  const [dbError, setDbError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{message: string, type: 'info' | 'error'} | null>(null);
  const [dataBounds, setDataBounds] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const saved = localStorage.getItem('bt_date_range');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.start && parsed.end) return parsed;
      } catch (e) {}
    }
    return { start: '', end: '' };
  });

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    if (!value) return;
    
    let newStart = type === 'start' ? value : dateRange.start;
    let newEnd = type === 'end' ? value : dateRange.end;

    // Enforce Bounds
    if (dataBounds.start && newStart < dataBounds.start) {
      newStart = dataBounds.start;
      setNotification({ message: `Least date available is ${new Date(dataBounds.start).toLocaleDateString()}`, type: 'info' });
      setTimeout(() => setNotification(null), 4000);
    }
    
    if (dataBounds.end && newEnd > dataBounds.end) {
      newEnd = dataBounds.end;
      setNotification({ message: `Latest date available is ${new Date(dataBounds.end).toLocaleDateString()}`, type: 'info' });
      setTimeout(() => setNotification(null), 4000);
    }

    // Ensure logical order
    if (newStart > newEnd) {
      if (type === 'start') newEnd = newStart;
      else newStart = newEnd;
    }

    setDateRange({ start: newStart, end: newEnd });
  };

  // Sync date range with available data bounds
  useEffect(() => {
    if (!dataBounds.start || !dataBounds.end) return;

    setDateRange(prev => {
      let changed = false;
      let s = prev.start;
      let e = prev.end;

      // Handle initialization or out of bound values
      if (!s || s < dataBounds.start) { s = dataBounds.start; changed = true; }
      if (s > dataBounds.end) { s = dataBounds.end; changed = true; }
      if (!e || e > dataBounds.end) { e = dataBounds.end; changed = true; }
      if (e < dataBounds.start) { e = dataBounds.end; changed = true; }
      
      // Safety: logical order
      if (s > e) {
        if (s === prev.start) e = s;
        else s = e;
        changed = true;
      }

      if (changed) {
        console.log("Auto-clamping date range to bounds:", { start: s, end: e }, "Bounds:", dataBounds);
      }

      return changed ? { start: s, end: e } : prev;
    });
  }, [dataBounds]); // Only re-run when bounds change (e.g. source switch or data load)

  const [strategy, setStrategy] = useState<Strategy>(() => {
    const saved = localStorage.getItem('bt_strategy');
    return saved ? JSON.parse(saved) : SAMPLE_STRATEGIES[0];
  });
  const [capital, setCapital] = useState(() => {
    const saved = localStorage.getItem('bt_capital');
    return saved ? parseFloat(saved) : 20000;
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<{data: OHLCData[], fileName: string} | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'STRATEGY' | 'DATA'>('STRATEGY');
  const [dbStats, setDbStats] = useState<{ start: string; end: string; columns: string[]; totalRecords: number } | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  const [dbLoadingProgress, setDbLoadingProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    processedFiles: 0,
    totalFiles: 0,
    currentFile: '',
    currentDateRange: '',
    progress: 0
  });

  // Persistence
  useEffect(() => {
    if (dataSource) localStorage.setItem('bt_data_source', dataSource);
  }, [dataSource]);

  useEffect(() => {
    localStorage.setItem('bt_strategy', JSON.stringify(strategy));
  }, [strategy]);

  useEffect(() => {
    localStorage.setItem('bt_capital', capital.toString());
  }, [capital]);

  useEffect(() => {
    if (dateRange.start && dateRange.end) {
      localStorage.setItem('bt_date_range', JSON.stringify(dateRange));
    }
  }, [dateRange]);

  // Authentication
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        // Attempt to connect to DB on mount/login to verify status
        loadDataFromFirestore(1000); // Small initial load
      }
    });
  }, []); // Run on mount to check connectivity and set default status

  // Reload data when date range changes and using DB
  useEffect(() => {
    if (user && dataSource === 'DB' && dateRange.start && dateRange.end) {
       loadDataFromFirestore(10000); // Load more if range specified
    }
  }, [dateRange.start, dateRange.end]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setData([]);
    setDataBounds({ start: '', end: '' });
    setDataSource('SIMULATED');
    localStorage.removeItem('bt_date_range');
  };

  const resetInputRef = useRef<HTMLInputElement>(null);

  const handleResetAndUploadTrigger = () => {
    console.log("Reset & Upload Clicked", { 
      hasUser: !!user, 
      resettingDb, 
      isBacktesting,
      hasRef: !!resetInputRef.current 
    });

    if (!user) {
      setNotification({ message: "Please sign in to reset data", type: 'error' });
      return;
    }
    
    if (isBacktesting) {
      setNotification({ message: "Cannot reset while backtest is in progress", type: 'warning' });
      return;
    }

    if (window.confirm("ARE YOU SURE? This will PERMANENTLY DELETE all your data from the cloud before uploading new files. Continue?")) {
      if (resetInputRef.current) {
        console.log("Triggering directory picker...");
        resetInputRef.current.click();
      } else {
        console.error("Reset input ref is missing!");
        setNotification({ message: "System Error: Input element not ready", type: 'error' });
      }
    }
  };

  const handleResetAndUploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    console.log("Files selected for Reset & Upload:", files?.length || 0);
    if (!files || files.length === 0 || !user) return;

    setResettingDb(true);
    setNotification({ message: "Beggining Database Wipe...", type: 'info' });

    try {
      let deletedCount = 0;
      // Faster deletion check
      const qCheck = query(collection(db, 'ohlc_data'), where('userId', '==', user.uid), limit(1));
      const checkSnap = await getDocs(qCheck);
      
      if (!checkSnap.empty) {
        while (true) {
          const q = query(collection(db, 'ohlc_data'), where('userId', '==', user.uid), limit(500));
          const snap = await getDocs(q);
          if (snap.empty) break;

          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          deletedCount += snap.size;
          setNotification({ message: `Wiped ${deletedCount} records...`, type: 'info' });
        }
      }
      
      console.log(`Wiped ${deletedCount} docs total.`);
      setNotification({ message: "Wipe Complete. Starting upload...", type: 'success' });

      await processFilesAndUpload(files);
      
    } catch (e: any) {
      console.error("Reset & Upload Failed:", e);
      setNotification({ message: "Error during reset/upload process", type: 'error' });
    } finally {
      setResettingDb(false);
      if (event.target) event.target.value = '';
    }
  };

  const handleDataCheck = async () => {
    if (!user) {
      setNotification({ message: "Please sign in to check database", type: 'error' });
      return;
    }
    setCheckingDb(true);
    setDbError(null);
    const path = 'ohlc_data';
    try {
      console.log("Starting Database Inspector...");
      
      const qMin = query(collection(db, path), where('userId', '==', user.uid), orderBy('time', 'asc'), limit(1));
      const qMax = query(collection(db, path), where('userId', '==', user.uid), orderBy('time', 'desc'), limit(1));
      const qCount = query(collection(db, path), where('userId', '==', user.uid));
      
      const [snapMin, snapMax, totalCountSnap] = await Promise.all([
        getDocs(qMin).catch(err => { handleFirestoreError(err, OperationType.GET, `${path} (min query)`); throw err; }),
        getDocs(qMax).catch(err => { handleFirestoreError(err, OperationType.GET, `${path} (max query)`); throw err; }),
        getCountFromServer(qCount).catch(err => { handleFirestoreError(err, OperationType.GET, `${path} (count)`); throw err; })
      ]);
      
      if (snapMin.empty) {
        setDbStats({ start: 'N/A', end: 'N/A', columns: [], totalRecords: 0 });
        setNotification({ message: "No data found for your account", type: 'info' });
        return;
      }

      const rawStart = snapMin.docs[0].data().time;
      const rawEnd = snapMax.docs[0].data().time;
      
      const allFields = Object.keys(snapMin.docs[0].data());
      const filteredColumns = allFields.filter(k => !['userId', 'datasetId'].includes(k));

      setDbStats({
        start: new Date(rawStart).toLocaleString(),
        end: new Date(rawEnd).toLocaleString(),
        columns: filteredColumns.sort(),
        totalRecords: totalCountSnap.data().count
      });

      // Sync the date range boundaries
      const startDate = rawStart.split('T')[0];
      const endDate = rawEnd.split('T')[0];
      setDataBounds({ start: startDate, end: endDate });

    } catch (e: any) {
      console.error("Data Check Technical Details:", e);
      let userMsg = "Data check failed. Enable index in Firebase console if prompted.";
      if (e.message?.includes('index')) {
        userMsg = "Firestore Index Required. Check console for link to enable.";
      }
      setDbError(userMsg);
      setNotification({ message: "Database Check Failed", type: 'error' });
    } finally {
      setCheckingDb(false);
    }
  };

  const loadDataFromFirestore = async (limitCount: number = 5000) => {
    if (!user) return;
    setDbError(null);
    setCheckingDb(true);
    const path = 'ohlc_data';
    try {
      console.log(`Connecting to Database... (Loading up to ${limitCount} bars)`);
      
      const qMin = query(collection(db, path), where('userId', '==', user.uid), orderBy('time', 'asc'), limit(1));
      const qMax = query(collection(db, path), where('userId', '==', user.uid), orderBy('time', 'desc'), limit(1));
      
      const [snapMin, snapMax] = await Promise.all([
        getDocs(qMin).catch(err => { handleFirestoreError(err, OperationType.GET, `${path} (min)`); throw err; }),
        getDocs(qMax).catch(err => { handleFirestoreError(err, OperationType.GET, `${path} (max)`); throw err; })
      ]);
      
      let dbStart = '';
      let dbEnd = '';
      
      if (!snapMin.empty) dbStart = snapMin.docs[0].data().time;
      if (!snapMax.empty) dbEnd = snapMax.docs[0].data().time;

      const startDate = (dbStart || '').split('T')[0];
      const endDate = (dbEnd || '').split('T')[0];
      
      if (startDate && endDate) {
        setDataBounds({ start: startDate, end: endDate });
        setDataSource('DB');
      } else {
        console.log("Database connected but empty. Defaulting to Simulated.");
        setDataSource('SIMULATED');
        setCheckingDb(false);
        return;
      }

      // 2. Load data - prefer specific range if set, otherwise latest
      let q;
      if (dateRange.start && dateRange.end) {
        const startIso = new Date(dateRange.start).toISOString();
        const endIso = new Date(dateRange.end + 'T23:59:59').toISOString();
        q = query(
          collection(db, path), 
          where('userId', '==', user.uid), 
          where('time', '>=', startIso),
          where('time', '<=', endIso),
          orderBy('time', 'asc')
        );
      } else {
        q = query(collection(db, path), where('userId', '==', user.uid), orderBy('time', 'desc'), limit(limitCount));
      }

      const querySnapshot = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.GET, path); throw err; });
      const loadedData: OHLCData[] = [];
      querySnapshot.forEach((doc) => {
        const d = doc.data() as OHLCData;
        loadedData.push(d);
      });
      
      if (loadedData.length > 0) {
        const sortedLoaded = loadedData.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        setData(sortedLoaded);
        console.log(`DB Sync Complete. Loaded ${loadedData.length} bars.`);
      } else if (dateRange.start) {
        setNotification({ message: "No data found for selected range", type: 'warning' });
        setTimeout(() => setNotification(null), 5000);
      }
    } catch (e: any) {
      console.error("Database Connection Failed:", e);
      let userMsg = "Database Connection Failed.";
      if (e.message?.includes('index')) {
        userMsg = "Firestore Index Required. Check console for link.";
      }
      setDbError(userMsg);
      setDataSource('SIMULATED');
      setNotification({ message: userMsg, type: 'error' });
      setTimeout(() => setNotification(null), 6000);
    } finally {
      setCheckingDb(false);
    }
  };

  const saveDataToFirestore = async (ohlcData: OHLCData[], fileName: string = 'Imported Data') => {
    if (!user) return;
    setIsSaving(true);
    
    // Identify date range for this chunk/file
    let dateRangeStr = 'Unknown';
    if (ohlcData.length > 0) {
      const start = new Date(ohlcData[0].time).toLocaleDateString();
      const end = new Date(ohlcData[ohlcData.length - 1].time).toLocaleDateString();
      dateRangeStr = `${start} - ${end}`;
    }

    setUploadStatus(prev => ({
      ...prev,
      isUploading: true,
      currentFile: fileName,
      currentDateRange: dateRangeStr
    }));

    try {
      // Chunk size for Firestore batches (limit is 500)
      const CHUNK_SIZE = 400;
      const totalSteps = Math.ceil(ohlcData.length / CHUNK_SIZE);
      
      if (totalSteps > 1 && ohlcData.length > 1000) {
        setUploadStatus(prev => ({ ...prev, progress: 0 }));
      }

      for (let i = 0; i < ohlcData.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = ohlcData.slice(i, i + CHUNK_SIZE);
        
        chunk.forEach(bar => {
          const docRef = doc(collection(db, 'ohlc_data'));
          batch.set(docRef, { ...bar, datasetId: 'main', userId: user.uid });
        });

        try {
          await batch.commit();
        } catch (e: any) {
          if (e.code === 'resource-exhausted' || e.message?.includes('Quota')) {
             setUploadStatus(prev => ({ 
               ...prev, 
               isUploading: false, 
               error: "Daily Storage Quota Exceeded. Data saved locally only." 
             }));
             return; // Stop further cloud writes
          }
          throw e;
        }
        
        const step = Math.floor(i / CHUNK_SIZE) + 1;
        setUploadStatus(prev => ({
          ...prev,
          progress: Math.floor((step / totalSteps) * 100)
        }));
      }
    } catch (e: any) {
      if (e.code !== 'resource-exhausted') {
        handleFirestoreError(e, OperationType.WRITE, 'ohlc_data');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const checkDuplicatesAndSave = async (ohlcData: OHLCData[], fileName: string) => {
    if (!user || ohlcData.length === 0) return;
    
    setIsSaving(true);
    setUploadStatus(prev => ({ ...prev, isUploading: true, currentFile: fileName, progress: 0 }));
    
    try {
      const startTime = new Date(ohlcData[0].time).toISOString();
      const endTime = new Date(ohlcData[ohlcData.length - 1].time).toISOString();
      
      // Check if any data exists in this range
      const q = query(
        collection(db, 'ohlc_data'), 
        where('userId', '==', user.uid),
        where('time', '>=', startTime),
        where('time', '<=', endTime),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        setPendingImportData({ data: ohlcData, fileName });
        setShowOverwriteModal(true);
        setIsSaving(false);
      } else {
        await saveDataToFirestore(ohlcData, fileName);
      }
    } catch (e) {
      console.error("Duplicate check failed", e);
      // Fallback to normal save if check fails
      await saveDataToFirestore(ohlcData, fileName);
    }
  };

  const handleOverwriteDecision = async (decision: 'OVERWRITE' | 'MERGE' | 'CANCEL') => {
    if (!pendingImportData) return;
    
    const { data: ohlcData, fileName } = pendingImportData;
    setShowOverwriteModal(false);
    setPendingImportData(null);

    if (decision === 'CANCEL') return;

    setIsSaving(true);
    setUploadStatus(prev => ({ ...prev, isUploading: true, currentFile: fileName, progress: 0 }));

    if (decision === 'OVERWRITE') {
      try {
        const startTime = new Date(ohlcData[0].time).toISOString();
        const endTime = new Date(ohlcData[ohlcData.length - 1].time).toISOString();
        
        // Find existing docs to delete
        const q = query(
          collection(db, 'ohlc_data'), 
          where('userId', '==', user.uid),
          where('time', '>=', startTime),
          where('time', '<=', endTime)
        );
        
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      } catch (e) {
        console.error("Overwrite deletion failed", e);
      }
    } else if (decision === 'MERGE') {
      // In merge mode, we only want to keep data that doesn't already exist.
      // For simplicity, we filter out points that are in the exact same timestamps 
      // if we already queried them, but a better way is to rely on setDoc with specific IDs if we had them.
    }

    await saveDataToFirestore(ohlcData, fileName);
  };

  const formulas = {
    EMA: "EMA = (Close - prevEMA) * [2 / (period + 1)] + prevEMA",
    SMA: "SMA = Sum(Price, n) / n",
    RSI: "RSI = 100 - [100 / (1 + (AvgGain / AvgLoss))]",
    VWAP: "VWAP = Sum(Typical Price * Volume) / Sum(Volume)",
    PNL: "PnL % = ((ExitPrice - EntryPrice) / EntryPrice) * 100 * (Type === 'LONG' ? 1 : -1)",
    HA: "HA_Close = (O+H+L+C)/4, HA_Open = (prevHA_O + prevHA_C)/2",
    Renko: "Renko = Fixed brick size based boxes (Bricks) based on price movement"
  };

  // Generate mock data for initial load or when SIMULATED is selected
  useEffect(() => {
    if (dataSource === 'SIMULATED' && data.length === 0) {
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
      const start = mockData[0].time.split('T')[0];
      const end = mockData[mockData.length - 1].time.split('T')[0];
      setDataBounds({ start, end });
    }
  }, [dataSource, data.length]);

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
    
    // Apply Heikin Ashi or Renko if selected
    const baseData = strategy.candleType === 'HEIKIN_ASHI' 
      ? calculateHeikinAshi(filteredData) 
      : strategy.candleType === 'RENKO'
        ? calculateRenko(filteredData, strategy.brickSize || 10)
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
  }, [filteredData, strategy.candleType, strategy.brickSize]);

  const processFilesAndUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const allData: OHLCData[] = [];
    const fileArray = Array.from(files as FileList)
      .filter((f: File) => f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    
    setIsBacktesting(true);
    setUploadStatus({
      isUploading: true,
      currentFile: '',
      processedFiles: 0,
      totalFiles: fileArray.length,
      currentDateRange: '',
      progress: 0
    });

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setUploadStatus(prev => ({ ...prev, currentFile: file.name, processedFiles: i }));
      
      let fileData: OHLCData[] = [];
      try {
        if (file.name.toLowerCase().endsWith('.csv')) {
          fileData = await new Promise<OHLCData[]>((resolve) => {
            Papa.parse(file, {
              header: true,
              skipEmptyLines: true,
              dynamicTyping: true,
              complete: (results) => {
                const parsed = results.data
                  .map((d: any) => {
                    const rawTime = d.time || d.Time || d.Date || d.date || d.Timestamp || d.timestamp || d.DateTime || d.datetime;
                    if (!rawTime) return null;
                    
                    // Try different date formats
                    let date = new Date(rawTime);
                    
                    if (isNaN(date.getTime()) && typeof rawTime === 'string') {
                        // Format: DD-MM-YYYY or DD/MM/YYYY
                        const parts = rawTime.split(/[- /:T]/);
                        if (parts.length >= 3) {
                          if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                             // DD-MM-YYYY
                             date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${parts[3] || '00'}:${parts[4] || '00'}:00`);
                          } else if (parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
                             // YYYY-MM-DD
                             date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${parts[3] || '00'}:${parts[4] || '00'}:00`);
                          } else if (parts[0].length === 8) {
                             // YYYYMMDD
                             const y = parts[0].substring(0, 4);
                             const m = parts[0].substring(4, 6);
                             const dStr = parts[0].substring(6, 8);
                             date = new Date(`${y}-${m}-${dStr}T00:00:00`);
                          }
                        }
                    }

                    if (isNaN(date.getTime())) {
                       console.warn(`Invalid date format for file ${file.name}: ${rawTime}`);
                       return null;
                    }

                    const open = parseFloat(String(d.open || d.Open || '').replace(/,/g, ''));
                    const close = parseFloat(String(d.close || d.Close || '').replace(/,/g, ''));
                    if (isNaN(open) || isNaN(close)) return null;

                    return {
                      time: date.toISOString(),
                      open,
                      high: parseFloat(String(d.high || d.High || d.open || d.Open || '').replace(/,/g, '')),
                      low: parseFloat(String(d.low || d.Low || d.close || d.Close || '').replace(/,/g, '')),
                      close,
                      volume: parseFloat(String(d.volume || d.Volume || 0).replace(/,/g, ''))
                    };
                  })
                  .filter((d: any): d is OHLCData => d !== null);
                resolve(parsed);
              },
              error: (err) => {
                console.error("CSV Parse Error", err);
                resolve([]);
              }
            });
          });
        } else {
          // Handle Excel files
          fileData = await new Promise<OHLCData[]>((resolve) => {
            const reader = new FileReader();
            reader.onerror = () => resolve([]);
            reader.onload = (e) => {
              try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as any[];
                
                const parsed = jsonData
                  .map((d: any) => {
                    const rawTime = d.time || d.Time || d.Date || d.date || d.Timestamp || d.timestamp || d.DateTime || d.datetime;
                    if (!rawTime) return null;
                    
                    let date = new Date(rawTime);
                    
                    if (isNaN(date.getTime()) && typeof rawTime === 'string') {
                        const parts = rawTime.split(/[- /:T]/);
                        if (parts.length >= 3) {
                          if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
                             date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${parts[3] || '00'}:${parts[4] || '00'}:00`);
                          } else if (parts[0].length === 4 && parts[1].length === 2 && parts[2].length === 2) {
                             date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${parts[3] || '00'}:${parts[4] || '00'}:00`);
                          }
                        }
                    }

                    if (isNaN(date.getTime())) return null;

                    const open = parseFloat(String(d.open || d.Open || '').replace(/,/g, ''));
                    const close = parseFloat(String(d.close || d.Close || '').replace(/,/g, ''));
                    if (isNaN(open) || isNaN(close)) return null;

                    return {
                      time: date.toISOString(),
                      open,
                      high: parseFloat(String(d.high || d.High || d.open || d.Open || '').replace(/,/g, '')),
                      low: parseFloat(String(d.low || d.Low || d.close || d.Close || '').replace(/,/g, '')),
                      close,
                      volume: parseFloat(String(d.volume || d.Volume || 0).replace(/,/g, ''))
                    };
                  })
                  .filter((d: any): d is OHLCData => d !== null);
                resolve(parsed);
              } catch (err) {
                console.error("Excel parse error", err);
                resolve([]);
              }
            };
            reader.readAsArrayBuffer(file);
          });
        }
      } catch (err) {
        console.error(`Error parsing file ${file.name}`, err);
      }
      
      // Update progress even if fileData is empty
      setUploadStatus(prev => {
        let range = prev.currentDateRange;
        if (fileData.length > 0) {
          const s = fileData[0].time.split('T')[0];
          const e = fileData[fileData.length - 1].time.split('T')[0];
          range = `${s} to ${e}`;
        }
        return { 
          ...prev, 
          processedFiles: i + 1, 
          currentDateRange: range,
          progress: Math.floor(((i + 1) / fileArray.length) * 100) 
        };
      });

      if (fileData.length > 0) {
        allData.push(...fileData);
      }
      
      // Let the main thread breathe between files
      if (i % 2 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (allData.length > 0) {
      setUploadStatus(prev => ({ ...prev, currentDateRange: 'Sorting & De-duplicating...', progress: 99 }));
      await new Promise(r => setTimeout(r, 50));

      // Sort and Deduplicate the entire batch
      const sortedBatch = allData.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const uniqueData: OHLCData[] = [];
      const seenTimes = new Set<string>();
      for (const d of sortedBatch) {
        if (!seenTimes.has(d.time)) {
          uniqueData.push(d);
          seenTimes.add(d.time);
        }
      }

      console.log(`Prepared ${uniqueData.length} bars for upload/display.`);
      
      // Update UI state immediately with new available data
      setData(uniqueData);
      setDataSource('FILES');
      
      const start = uniqueData[0].time.split('T')[0];
      const end = uniqueData[uniqueData.length - 1].time.split('T')[0];
      setDataBounds({ start, end });
      setDateRange({ start, end });

      // Save to DB if user active
      if (user) {
        await checkDuplicatesAndSave(uniqueData, `${fileArray.length} files folder`);
      }
    }
    setIsBacktesting(false);
    setUploadStatus(prev => ({ ...prev, isUploading: false, progress: 100 }));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await processFilesAndUpload(event.target.files);
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
        
        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-900/20 shrink-0">
          <button 
            onClick={() => setSidebarTab('STRATEGY')}
            className={cn(
              "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative",
              sidebarTab === 'STRATEGY' ? "text-emerald-500" : "text-slate-500 hover:text-slate-300"
            )}
          >
            Strategy
            {sidebarTab === 'STRATEGY' && <motion.div layoutId="sidebarTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
          </button>
          <button 
            onClick={() => setSidebarTab('DATA')}
            className={cn(
              "flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative",
              sidebarTab === 'DATA' ? "text-blue-500" : "text-slate-500 hover:text-slate-300"
            )}
          >
            Data
            {sidebarTab === 'DATA' && <motion.div layoutId="sidebarTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {sidebarTab === 'STRATEGY' ? (
            <div className="space-y-6">
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
                {['CANDLE', 'HEIKIN_ASHI', 'RENKO'].map(type => (
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
              {strategy.candleType === 'RENKO' && (
                <div className="mt-2 flex items-center justify-between gap-2 p-2 bg-slate-800/50 rounded border border-slate-700">
                  <span className="text-[9px] text-slate-500 font-bold uppercase">Brick Size</span>
                  <input 
                    type="number" 
                    value={strategy.brickSize || 10} 
                    onChange={e => setStrategy({...strategy, brickSize: parseFloat(e.target.value)})}
                    className="w-16 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] font-mono outline-none"
                  />
                </div>
              )}
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
                      timeframe: '1m' as Timeframe,
                      candleType: 'CANDLE',
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
                  onUpdate={(newRule: any) => {
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
                      timeframe: '1m' as Timeframe,
                      candleType: 'CANDLE',
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
                  onUpdate={(newRule: any) => {
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
                        {['PERCENT', 'POINTS', 'TOP_MINUS_PTS'].map(type => (
                          <button
                            key={type}
                            onClick={() => setStrategy({...strategy, stopLossType: type as any})}
                            className={cn(
                              "flex-1 py-1 text-[8px] font-bold rounded transition-all",
                              strategy.stopLossType === type ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                            )}
                          >
                            {type.replace('_', ' ')}
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
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
              {/* DATA TAB CONTENT */}
              <div className="p-4 bg-blue-950/10 border border-blue-900/20 rounded-xl space-y-4">
                 <div className="flex items-center gap-2">
                   <Database size={16} className="text-blue-400" />
                   <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">Database Inspector</h3>
                 </div>
                 <p className="text-[10px] text-slate-500 leading-relaxed italic">
                   Check the data consistency, date ranges, and available fields directly from the cloud.
                 </p>
                 <button 
                   onClick={handleDataCheck}
                   disabled={checkingDb}
                   className={cn(
                     "w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                     checkingDb && "opacity-50 cursor-not-allowed"
                   )}
                 >
                   {checkingDb ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Database size={12} />}
                   Data Check
                 </button>

                 <div className="relative">
                   <input
                     ref={resetInputRef}
                     type="file"
                     className="hidden"
                     webkitdirectory=""
                     onChange={handleResetAndUploadFiles}
                   />
                   <button 
                     onClick={handleResetAndUploadTrigger}
                     disabled={resettingDb || isBacktesting}
                     className={cn(
                       "w-full py-2 border border-red-900/50 hover:bg-red-950/20 text-red-400 text-[10px] font-bold rounded uppercase tracking-widest transition-all flex items-center justify-center gap-2",
                       (resettingDb || isBacktesting) && "opacity-50 cursor-not-allowed"
                     )}
                   >
                     {resettingDb ? <div className="w-3 h-3 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" /> : <Trash2 size={12} />}
                     Reset & Full Import
                   </button>
                 </div>
              </div>

              {dbStats && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-500">
                  <div className="space-y-2">
                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Available Range</label>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-slate-500 uppercase font-bold">From</span>
                        <span className="text-slate-200 font-mono text-right">{dbStats.start}</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-slate-500 uppercase font-bold">To</span>
                        <span className="text-slate-200 font-mono text-right">{dbStats.end}</span>
                      </div>
                      <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-[10px]">
                         <span className="text-slate-500 uppercase font-bold">Total Bars</span>
                         <span className="text-emerald-400 font-mono">{dbStats.totalRecords.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Available Columns</label>
                    <div className="flex flex-wrap gap-1">
                      {dbStats.columns.map(c => (
                        <span key={c} className="text-[9px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-blue-400 font-mono uppercase">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <div className="p-3 bg-amber-950/10 border border-amber-900/20 rounded-lg">
                    <div className="flex gap-2">
                      <Info size={12} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[9px] text-amber-200/60 leading-normal">
                        If the dates mismatch your selection, the "Data Check" has refreshed the boundaries to match the latest records.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {!dbStats && !checkingDb && (
                 <div className="h-40 flex flex-col items-center justify-center opacity-30 text-center px-6">
                    <div className="w-10 h-10 rounded-full border border-slate-800 flex items-center justify-center mb-3">
                      <Database size={16} className="text-slate-600" />
                    </div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Click "Data Check" to fetch latest DB summary</p>
                 </div>
              )}
            </div>
          )}
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
        <div className="h-16 border-b border-slate-800 flex items-center px-6 gap-8 bg-slate-900/30 shrink-0">
          <div className="flex items-center gap-4 border-r border-slate-800 pr-8 mr-2">
            {user ? (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-700">
                  {user.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={16} />}
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-200 leading-none">{user.displayName || 'User'}</span>
                  <button onClick={handleLogout} className="text-[8px] text-rose-500 hover:text-rose-400 font-bold uppercase mt-1 transition-colors">Sign Out</button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-3 py-1.5 transition-all"
              >
                <LogIn size={14} className="text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Sign In</span>
              </button>
            )}
          </div>

          {[
            { 
              label: 'Net Profit', 
              value: backtestResult ? formatCurrency(backtestResult.stats.totalPnl) : '₹0.00', 
              color: backtestResult 
                ? (backtestResult.stats.totalPnlPercent < 0 
                    ? 'text-rose-500' 
                    : (backtestResult.stats.totalPnlPercent <= 50 ? 'text-amber-500' : 'text-emerald-500'))
                : 'text-slate-500'
            },
            { label: 'Max Drawdown', value: backtestResult ? `-${formatNumber(backtestResult.stats.maxDrawdown)}%` : '0.00%', color: 'text-rose-400' },
            { label: 'Win Rate', value: backtestResult ? `${formatNumber(backtestResult.stats.winRate)}%` : '0.0% ', color: 'text-slate-300' },
            { label: 'Sharpe', value: backtestResult ? formatNumber(backtestResult.stats.sharpeRatio) : '0.00', color: 'text-blue-400' },
          ].map((stat, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{stat.label}</span>
              <span className={cn("text-base font-mono font-bold tracking-tight", stat.color)}>{stat.value}</span>
            </div>
          ))}
          
          <div className="ml-auto flex items-center gap-4">
             <label className="flex items-center gap-2 cursor-pointer text-slate-500 hover:text-emerald-500 transition-colors">
              <Upload size={14} />
              <div className="flex flex-col items-start pr-2">
                <span className="text-[10px] font-bold uppercase tracking-widest leading-none">Import Folder</span>
                <span className="text-[8px] opacity-60">Collects all CSV/XLS</span>
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
                  min={dataBounds.start}
                  max={dateRange.end}
                  onChange={e => handleDateChange('start', e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors text-slate-300"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[9px] text-slate-500 uppercase font-bold">To</label>
                <input 
                  type="date" 
                  value={dateRange.end}
                  min={dateRange.start}
                  max={dataBounds.end}
                  onChange={e => handleDateChange('end', e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors text-slate-300"
                />
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800" />
            <div className="flex flex-col min-w-[80px]">
              <label className="text-[9px] text-slate-500 uppercase font-bold">Data Status</label>
              <div className="relative group">
                <select 
                  value={dataSource}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setDataSource(val);
                    if (val === 'DB') loadDataFromFirestore();
                    if (val === 'SIMULATED') {
                      // Trigger re-simulation if needed or clear data
                      setData([]); 
                    }
                  }}
                  className={cn(
                    "w-full bg-slate-900 border appearance-none px-2 py-0.5 text-[9px] font-mono rounded outline-none cursor-pointer transition-all",
                    dataSource === 'SIMULATED' ? "text-amber-500 border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50" : 
                    dataSource === 'FILES' ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50" :
                    "text-blue-500 border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50"
                  )}
                >
                  <option value="SIMULATED" className="bg-slate-900 text-amber-500">SIMULATED</option>
                  <option value="FILES" className="bg-slate-900 text-emerald-500">FILES</option>
                  <option value="DB" className="bg-slate-900 text-blue-500">DATABASE</option>
                </select>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                  <Settings size={8} />
                </div>
              </div>
              {isSaving && <div className="mt-1 h-0.5 w-full bg-blue-500 animate-pulse rounded-full" />}
            </div>
          </div>
        </div>

        {/* Notifications */}
        <AnimatePresence>
          {notification && (
            <motion.div 
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -50, opacity: 0 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-[200]"
            >
              <div className={cn(
                "px-4 py-2 rounded-full shadow-2xl border backdrop-blur-md flex items-center gap-2",
                notification.type === 'error' ? "bg-rose-500/20 border-rose-500/30 text-rose-400" : "bg-blue-500/20 border-blue-500/30 text-blue-400"
              )}>
                <Info size={14} />
                <span className="text-xs font-bold uppercase tracking-tight">{notification.message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* DB Error Alert */}
        <AnimatePresence>
          {dbError && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-rose-500/10 border-b border-rose-500/20 px-6 py-2 overflow-hidden"
            >
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400">
                  <AlertCircle size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Database Error:</span>
                  <span className="text-[10px] font-medium opacity-80">{dbError}</span>
                </div>
                <button 
                  onClick={() => setDbError(null)}
                  className="text-rose-400/50 hover:text-rose-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

      {/* Upload Status Popup */}
      <AnimatePresence>
        {uploadStatus.isUploading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/40 backdrop-blur-[2px]"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              className="bg-[#1A1B22] border border-slate-700 w-full max-w-sm rounded-xl shadow-2xl overflow-hidden p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database size={16} className={uploadStatus.error ? "text-rose-500" : "text-emerald-500"} />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200">
                    {uploadStatus.error ? "Import Warning" : "Importing Data"}
                  </h3>
                </div>
                {!uploadStatus.error && (
                  <div className="text-[10px] font-mono text-slate-500">
                    {uploadStatus.processedFiles} / {uploadStatus.totalFiles} Files
                  </div>
                )}
                {uploadStatus.error && (
                  <button 
                    onClick={() => setUploadStatus(prev => ({ ...prev, isUploading: false, error: undefined }))}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {uploadStatus.error ? (
                <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-[10px] uppercase">
                    <AlertCircle size={14} />
                    <span>Quota Limit Reached</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    {uploadStatus.error}
                  </p>
                  <button 
                    onClick={() => setUploadStatus(prev => ({ ...prev, isUploading: false, error: undefined }))}
                    className="w-full mt-2 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 text-[9px] uppercase font-bold rounded border border-rose-500/30"
                  >
                    Continue Offline
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-2">
                     <div className="flex justify-between items-center">
                       <span className="text-[10px] text-slate-500 uppercase font-bold">Current File</span>
                       <span className="text-[10px] text-emerald-400 font-mono truncate max-w-[150px]">{uploadStatus.currentFile || 'Processing...'}</span>
                     </div>
                     <div className="flex justify-between items-center">
                       <span className="text-[10px] text-slate-500 uppercase font-bold">Date Range</span>
                       <span className="text-[10px] text-slate-400 font-mono">{uploadStatus.currentDateRange || 'Scanning...'}</span>
                     </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[9px] font-bold uppercase tracking-tighter">
                      <span className="text-slate-500">Upload Progress</span>
                      <span className="text-emerald-500">{uploadStatus.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-emerald-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${uploadStatus.progress}%` }}
                        transition={{ type: 'spring', damping: 20, stiffness: 100 }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[9px] text-slate-600 italic text-center">
                {uploadStatus.error ? "Free tier limits reset every 24 hours." : "Syncing with secure cloud database. Please do not close the tab."}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overwrite Confirmation Modal */}
      <AnimatePresence>
        {showOverwriteModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#1A1B22] border border-slate-700 w-full max-w-md rounded-xl shadow-2xl overflow-hidden p-6 space-y-6"
            >
              <div className="flex items-center gap-3 text-amber-500">
                <AlertCircle size={24} />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">Data Conflict Detected</h3>
              </div>
              
              <div className="space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  The data range in <span className="text-emerald-400 font-mono">"{pendingImportData?.fileName}"</span> already exists in your database. 
                </p>
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-[10px] space-y-1">
                   <div className="flex justify-between">
                     <span className="text-slate-500 uppercase font-bold">Conflict Range</span>
                     <span className="text-slate-300 font-mono">
                       {pendingImportData && pendingImportData.data.length > 0 && 
                        `${new Date(pendingImportData.data[0].time).toLocaleDateString()} - ${new Date(pendingImportData.data[pendingImportData.data.length-1].time).toLocaleDateString()}`
                       }
                     </span>
                   </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => handleOverwriteDecision('OVERWRITE')}
                  className="w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-400 text-[10px] font-bold rounded transition-all uppercase tracking-widest text-center"
                >
                  Overwrite (Delete existing, Add new)
                </button>
                <button 
                  onClick={() => handleOverwriteDecision('MERGE')}
                  className="w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold rounded transition-all uppercase tracking-widest text-center"
                >
                  Add Additional (Merge data)
                </button>
                <button 
                  onClick={() => handleOverwriteDecision('CANCEL')}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] font-bold rounded transition-all uppercase tracking-widest"
                >
                  Skip this file
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
