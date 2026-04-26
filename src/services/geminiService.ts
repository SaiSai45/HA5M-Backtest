import { GoogleGenAI } from "@google/genai";
import { BacktestResult, Strategy } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function optimizeStrategy(strategy: Strategy, results: BacktestResult) {
  const prompt = `
    You are an expert algorithmic trading consultant specializing in Nifty 50 1-minute data.
    Current Strategy: ${JSON.stringify(strategy)}
    Backtest Results:
    - Total PnL: ${results.stats.totalPnlPercent}%
    - Win Rate: ${results.stats.winRate}%
    - Total Trades: ${results.stats.totalTrades}
    - Max Drawdown: ${results.stats.maxDrawdown}%

    Analyze the strategy and results. Suggest 3 specific optimizations (new entry/exit conditions or parameter changes like SL/TP) to improve the Sharpe Ratio and reduce drawdown. 
    Explain 'Why' for each suggestion based on Nifty 50 market dynamics (e.g. volatility at open, mean reversion, etc).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("AI Optimization failed:", error);
    return "Could not generate optimization suggestions at this time.";
  }
}
