/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SMC Liquidity & Points of Interest (POIs) Workbench Component
 *
 * Interactive visual terminal for Phase 3 Institutional SMC modules:
 * 1. External & Internal Range Liquidity Engine (EQH/EQL within 0.15*ATR, PDH/PDL, PWH/PWL)
 * 2. Liquidity Lifecycle State Machine (UNTOUCHED -> APPROACHING -> SWEPT -> REVERSED)
 * 3. Displacement Order Block Engine (SWING vs INTERNAL, 50% Mean Threshold, Mitigation Lifecycle)
 * 4. Fair Value Gap Imbalance Engine (3-candle BISI/SIBI, 50% Consequent Encroachment, Inversion)
 * 5. POI Intelligence & Confluence Ranking (A+, A, B, C Conviction Grades, Nested OB+FVG Clusters)
 * 6. SMC Causality Engine & Institutional Setup Lineage
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Eye,
  Flame,
  GitBranch,
  Layers,
  Link,
  Lock,
  Maximize2,
  Radio,
  Scale,
  Shield,
  ShieldAlert,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';

import {
  DirectionalBias,
  InstrumentSymbol,
  LiquiditySweepEvent,
  Timeframe,
} from '../types/smc';
import { PeriodReferenceLevelsReport } from '../engine/canonicalPeriodLevelsEngine';
import { CausalityAnalysisReport, CausalChainRecord } from '../engine/smcCausalityEngine';
import { ActiveDealingRange } from '../engine/smcDealingRangeEngine';
import { FvgAnalysisReport, SmcFairValueGap } from '../engine/smcFvgEngine';
import {
  LiquidityAnalysisReport,
  SmcLiquidityPool,
} from '../engine/smcLiquidityEngine';
import {
  LifecycleEvaluationResult,
  PoolLifecycleSnapshot,
} from '../engine/smcLiquidityLifecycleEngine';
import { TimeframeStructureAnalysis } from '../engine/smcMarketStructureEngine';
import {
  formatPriceWithTimestamp,
  formatTimeSince,
  formatUtcDateTime,
} from '../utils/timeFormat';
import {
  OrderBlockAnalysisReport,
  SmcOrderBlock,
} from '../engine/smcOrderBlockEngine';
import {
  ConfluenceCluster,
  RankedPoiItem,
  RankedPoiReport,
} from '../engine/smcPoiIntelligenceEngine';

export interface SmcLiquidityPoiWorkbenchProps {
  readonly symbol: InstrumentSymbol;
  readonly timeframe: Timeframe;
  readonly onSelectTimeframe: (tf: Timeframe) => void;
  readonly currentPrice: number;
  readonly currentPriceTimestamp?: number;
  readonly is1MQuarantined: boolean;
  readonly structureAnalysis: TimeframeStructureAnalysis | null;
  readonly dealingRange: ActiveDealingRange | null;
  readonly periodLevels: PeriodReferenceLevelsReport;
  readonly liquidityAnalysis: LiquidityAnalysisReport | null;
  readonly liquidityLifecycle: LifecycleEvaluationResult | null;
  readonly orderBlockAnalysis: OrderBlockAnalysisReport | null;
  readonly fvgAnalysis: FvgAnalysisReport | null;
  readonly rankedPoiReport: RankedPoiReport | null;
  readonly causalityReport: CausalityAnalysisReport | null;
}

type WorkbenchSubSection =
  | 'ALL_OVERVIEW'
  | 'LIQUIDITY_POOLS'
  | 'ORDER_BLOCKS'
  | 'FAIR_VALUE_GAPS'
  | 'POI_INTELLIGENCE'
  | 'CAUSALITY_CHAINS';

export const SmcLiquidityPoiWorkbench: React.FC<SmcLiquidityPoiWorkbenchProps> = ({
  symbol,
  timeframe,
  onSelectTimeframe,
  currentPrice,
  currentPriceTimestamp,
  is1MQuarantined,
  structureAnalysis,
  dealingRange,
  periodLevels,
  liquidityAnalysis,
  liquidityLifecycle,
  orderBlockAnalysis,
  fvgAnalysis,
  rankedPoiReport,
  causalityReport,
}) => {
  const [subSection, setSubSection] = useState<WorkbenchSubSection>('ALL_OVERVIEW');
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);

  // Structural Isolation Quarantine (Hard Rule #4)
  if (is1MQuarantined) {
    return (
      <div className="p-6 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 space-y-3">
        <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
          <ShieldAlert className="h-5 w-5 text-rose-400" />
          HARD RULE #4 INVARIANT ENFORCED: 1M STRUCTURAL QUARANTINE
        </div>
        <p className="text-xs text-rose-300/90 leading-relaxed max-w-3xl">
          The 1M (1-minute) execution timeframe is strictly isolated from Liquidity Pools, Order Blocks,
          Fair Value Gaps, and POI calculations. 1M data must never be merged into higher-timeframe
          structural state.
          Please switch to <span className="font-bold underline text-white">1H (HTF)</span>,{' '}
          <span className="font-bold underline text-white">15M (MTF)</span>, or{' '}
          <span className="font-bold underline text-white">5M (LTF)</span>.
        </p>
        <div className="pt-2 flex items-center gap-2">
          <button
            onClick={() => onSelectTimeframe('15M')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
          >
            Switch to 15M (MTF Structure)
          </button>
          <button
            onClick={() => onSelectTimeframe('1H')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            Switch to 1H (HTF Bias)
          </button>
          <button
            onClick={() => onSelectTimeframe('5M')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            Switch to 5M (LTF Execution)
          </button>
        </div>
      </div>
    );
  }

  const activeChain =
    causalityReport?.causalChains.find((c) => c.id === selectedChainId) ??
    causalityReport?.latestActiveChain ??
    null;

  return (
    <div className="space-y-6">
      {/* Sub-Navigation Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => setSubSection('ALL_OVERVIEW')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'ALL_OVERVIEW'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            Executive Overview
          </button>

          <button
            onClick={() => setSubSection('LIQUIDITY_POOLS')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'LIQUIDITY_POOLS'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Target className="h-3.5 w-3.5 text-amber-400" />
            Liquidity Pools ({liquidityAnalysis?.allPools.length ?? 0})
          </button>

          <button
            onClick={() => setSubSection('ORDER_BLOCKS')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'ORDER_BLOCKS'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Shield className="h-3.5 w-3.5 text-indigo-400" />
            Order Blocks ({orderBlockAnalysis?.orderBlocks.length ?? 0})
          </button>

          <button
            onClick={() => setSubSection('FAIR_VALUE_GAPS')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'FAIR_VALUE_GAPS'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            FVGs ({fvgAnalysis?.allGaps.length ?? 0})
          </button>

          <button
            onClick={() => setSubSection('POI_INTELLIGENCE')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'POI_INTELLIGENCE'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-violet-400" />
            POI Ranking ({rankedPoiReport?.rankedPois.length ?? 0})
          </button>

          <button
            onClick={() => setSubSection('CAUSALITY_CHAINS')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              subSection === 'CAUSALITY_CHAINS'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5 text-pink-400" />
            Causality Chains ({causalityReport?.causalChains.length ?? 0})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
          <span>Current Price: <strong className="text-emerald-400">{currentPrice.toFixed(5)}</strong></span>
          {currentPriceTimestamp && (
            <span className="text-[10px] text-slate-400">
              • {formatUtcDateTime(currentPriceTimestamp)} ({formatTimeSince(currentPriceTimestamp)})
            </span>
          )}
          <span>ATR (14): <strong className="text-cyan-300">{liquidityAnalysis ? (liquidityAnalysis.atr * 10000).toFixed(1) + ' pips' : '---'}</strong></span>
          <span>EQH/EQL Window: <strong className="text-amber-300">{(0.15 * (liquidityAnalysis?.atr ?? 0.001) * 10000).toFixed(1)} pips</strong></span>
        </div>
      </div>

      {/* Top High-Level KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
        {/* Card 1: Liquidity Overview */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-amber-400" />
              Liquidity Pools
            </span>
            <span className="text-[10px] bg-amber-950/80 border border-amber-800 text-amber-300 px-1.5 py-0.5 rounded font-bold">
              {liquidityAnalysis?.allPools.length ?? 0} Total
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div>
              <span className="text-xl font-bold text-white">
                {liquidityAnalysis?.externalPools.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">ERL</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-cyan-300">
                {liquidityAnalysis?.internalPools.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">IRL (EQH/EQL)</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span>Swept Pools:</span>
            <strong className="text-emerald-400">{liquidityLifecycle?.sweptCount ?? 0}</strong>
          </div>
        </div>

        {/* Card 2: Order Blocks */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-indigo-400" />
              Order Blocks
            </span>
            <span className="text-[10px] bg-indigo-950/80 border border-indigo-800 text-indigo-300 px-1.5 py-0.5 rounded font-bold">
              {orderBlockAnalysis?.orderBlocks.length ?? 0} Total
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div>
              <span className="text-xl font-bold text-emerald-400">
                {orderBlockAnalysis?.unmitigatedBullishBlocks.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">Bullish Fresh</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-rose-400">
                {orderBlockAnalysis?.unmitigatedBearishBlocks.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">Bearish Fresh</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span>Swing / Internal:</span>
            <strong className="text-indigo-300">
              {orderBlockAnalysis?.swingBlocks.length ?? 0} / {orderBlockAnalysis?.internalBlocks.length ?? 0}
            </strong>
          </div>
        </div>

        {/* Card 3: Fair Value Gaps */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              Fair Value Gaps
            </span>
            <span className="text-[10px] bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
              {fvgAnalysis?.allGaps.length ?? 0} Total
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div>
              <span className="text-xl font-bold text-emerald-400">
                {fvgAnalysis?.unmitigatedBisiGaps.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">BISI (Bullish)</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-rose-400">
                {fvgAnalysis?.unmitigatedSibiGaps.length ?? 0}
              </span>
              <span className="text-[10px] text-slate-500 ml-1">SIBI (Bearish)</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span>Inversion FVGs:</span>
            <strong className="text-violet-300">{fvgAnalysis?.activeInversionGaps.length ?? 0}</strong>
          </div>
        </div>

        {/* Card 4: POI Intelligence & Conviction */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-violet-400" />
              POI Conviction
            </span>
            <span className="text-[10px] bg-violet-950/80 border border-violet-800 text-violet-300 px-1.5 py-0.5 rounded font-bold">
              {rankedPoiReport?.clusters.length ?? 0} Clusters
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-emerald-300">
                {rankedPoiReport?.aPlusCount ?? 0}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400">
                A+ Prime
              </span>
            </div>
            <div className="text-right flex items-center gap-2">
              <span className="text-xl font-bold text-cyan-300">
                {rankedPoiReport?.aCount ?? 0}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-400">
                Grade A
              </span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span>HTF Trend Bias:</span>
            <strong className={`font-bold ${structureAnalysis?.trendBias === 'BULLISH' ? 'text-emerald-400' : structureAnalysis?.trendBias === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'}`}>
              {structureAnalysis?.trendBias ?? 'NEUTRAL'}
            </strong>
          </div>
        </div>
      </div>

      {/* SECTION 1: LIQUIDITY POOLS & LIFECYCLE */}
      {(subSection === 'ALL_OVERVIEW' || subSection === 'LIQUIDITY_POOLS') && (
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-400" />
                External &amp; Internal Range Liquidity Engine &amp; Lifecycle Store
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                ERL (PWH, PWL, PDH, PDL, Major Swings) • IRL (Equal Highs &amp; Lows within 0.15*ATR) • Lifecycle: UNTOUCHED → APPROACHING → SWEPT → REVERSED
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-800 text-amber-300 font-bold text-[11px]">
                Nearest BSL: {liquidityAnalysis?.nearestBuySidePool?.price ?? 'None'}
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 font-bold text-[11px]">
                Nearest SSL: {liquidityAnalysis?.nearestSellSidePool?.price ?? 'None'}
              </span>
            </div>
          </div>

          {/* Liquidity Pools Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 max-h-[320px]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3">Price Level</th>
                  <th className="py-2.5 px-3">Tolerance (0.15*ATR)</th>
                  <th className="py-2.5 px-3">Touches</th>
                  <th className="py-2.5 px-3">Lifecycle State</th>
                  <th className="py-2.5 px-3">Distance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!liquidityAnalysis || liquidityAnalysis.allPools.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500 italic font-sans">
                      No liquidity pools detected.
                    </td>
                  </tr>
                ) : (
                  liquidityAnalysis.allPools.map((pool) => {
                    const snapshot = liquidityLifecycle?.poolSnapshots.find((s) => s.pool.id === pool.id);
                    const state = snapshot?.state ?? (pool.isSwept ? 'SWEPT' : 'UNTOUCHED');
                    const distPips = snapshot?.distanceToCurrentPricePips ?? Math.round(Math.abs(currentPrice - pool.price) * 10000);

                    return (
                      <tr key={pool.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2 px-3 font-bold text-white">
                          <span className="flex items-center gap-1.5">
                            {pool.originType.includes('HIGH') || pool.side === 'BUY_SIDE' ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
                            )}
                            {pool.originType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pool.category === 'EXTERNAL_RANGE' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-slate-800 text-cyan-300 border border-slate-700'}`}>
                            {pool.category === 'EXTERNAL_RANGE' ? 'EXTERNAL' : 'INTERNAL (IRL)'}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pool.side === 'BUY_SIDE' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                            {pool.side === 'BUY_SIDE' ? 'BSL (Stops Above)' : 'SSL (Stops Below)'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-bold text-amber-300">
                          <div>{pool.price.toFixed(5)}</div>
                          {pool.originTimestamp && (
                            <div className="text-[10px] text-slate-400 font-normal">
                              {formatUtcDateTime(pool.originTimestamp)} ({formatTimeSince(pool.originTimestamp)})
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          ±{(pool.priceTolerance * 10000).toFixed(1)} pips
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pool.touchCount >= 2 ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'text-slate-400'}`}>
                            {pool.touchCount} {pool.touchCount > 1 ? 'touches' : 'touch'}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            state === 'REVERSED'
                              ? 'bg-purple-950 border border-purple-800 text-purple-300'
                              : state === 'SWEPT'
                                ? 'bg-rose-950 border border-rose-800 text-rose-300'
                                : state === 'APPROACHING'
                                  ? 'bg-amber-950 border border-amber-800 text-amber-300'
                                  : 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                          }`}>
                            {state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {distPips} pips
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Swept Events Log (Turtle Soup / Wick Rejection Feed) */}
          {liquidityLifecycle && liquidityLifecycle.newSweepEvents.length > 0 && (
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  Validated Liquidity Sweep Events ({liquidityLifecycle.newSweepEvents.length})
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Recorded in Persistent Liquidity Store
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-xs">
                {liquidityLifecycle.newSweepEvents.slice(0, 4).map((sw) => (
                  <div key={sw.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          sw.status === 'CONFIRMED_TURTLE_SOUP'
                            ? 'bg-purple-950 border border-purple-800 text-purple-300'
                            : sw.status === 'WICK_REJECTION'
                              ? 'bg-amber-950 border border-amber-800 text-amber-300'
                              : 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                        }`}>
                          {sw.status.replace(/_/g, ' ')}
                        </span>
                        <span className="font-bold text-white">{sw.levelType}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        High: {sw.sweepHighPrice.toFixed(5)} • Low: {sw.sweepLowPrice.toFixed(5)} • Rejection Wick: {(sw.rejectionWickRatio * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-slate-500">
                      {new Date(sw.timestamp).toISOString().substring(11, 19)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: DISPLACEMENT ORDER BLOCKS */}
      {(subSection === 'ALL_OVERVIEW' || subSection === 'ORDER_BLOCKS') && (
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="h-4 w-4 text-indigo-400" />
                Displacement Order Block Engine &amp; Mitigation Tracker
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Tagged by Break Scope (SWING vs INTERNAL) • 50% Mean Threshold (MT) • State: UNMITIGATED → PARTIALLY_MITIGATED → FULLY_MITIGATED → INVALIDATED
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              Active OBs: {orderBlockAnalysis?.orderBlocks.length ?? 0}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 max-h-[320px]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Scope</th>
                  <th className="py-2.5 px-3">Zone (Low - High)</th>
                  <th className="py-2.5 px-3">50% Mean Threshold</th>
                  <th className="py-2.5 px-3">Displacement</th>
                  <th className="py-2.5 px-3">Mitigation State</th>
                  <th className="py-2.5 px-3">Mitigation %</th>
                  <th className="py-2.5 px-3">Quality Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!orderBlockAnalysis || orderBlockAnalysis.orderBlocks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500 italic font-sans">
                      No displacement order blocks detected.
                    </td>
                  </tr>
                ) : (
                  orderBlockAnalysis.orderBlocks.map((ob) => (
                    <tr key={ob.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-3 font-bold">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ob.type === 'BULLISH_OB' ? 'bg-emerald-950 border border-emerald-800 text-emerald-300' : 'bg-rose-950 border border-rose-800 text-rose-300'}`}>
                          {ob.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ob.scope === 'SWING' ? 'bg-indigo-950 border border-indigo-800 text-indigo-300' : 'bg-slate-800 text-slate-300'}`}>
                          {ob.scope}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-200">
                        <div>{ob.lowPrice.toFixed(5)} — {ob.highPrice.toFixed(5)}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          {formatUtcDateTime(ob.originCandleTimestamp)} ({formatTimeSince(ob.originCandleTimestamp)})
                        </div>
                      </td>
                      <td className="py-2 px-3 font-bold text-amber-300">
                        <div>{ob.meanThresholdPrice.toFixed(5)}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          50% Mid • ({formatTimeSince(ob.originCandleTimestamp)})
                        </div>
                      </td>
                      <td className="py-2 px-3 text-cyan-300 font-bold">
                        {ob.displacementPips.toFixed(1)} pips {ob.leavesImbalance && <span className="text-[10px] text-emerald-400 ml-1">+FVG</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ob.mitigationState === 'UNMITIGATED'
                            ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                            : ob.mitigationState === 'PARTIALLY_MITIGATED'
                              ? 'bg-amber-950 border border-amber-800 text-amber-300'
                              : ob.mitigationState === 'FULLY_MITIGATED'
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-rose-950 text-rose-400'
                        }`}>
                          {ob.mitigationState.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${ob.mitigationPercentage}%` }}></div>
                          </div>
                          <span>{ob.mitigationPercentage}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 font-bold text-white">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${ob.qualityScore >= 80 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : ob.qualityScore >= 60 ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-400'}`}>
                          {ob.qualityScore}/100
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 3: FAIR VALUE GAPS (FVG) */}
      {(subSection === 'ALL_OVERVIEW' || subSection === 'FAIR_VALUE_GAPS') && (
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                Fair Value Gap (FVG) 3-Bar Imbalance Engine
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                BISI (low[3] &gt; high[1]) • SIBI (high[3] &lt; low[1]) • 50% Consequent Encroachment (CE) • Inversion FVG Polarity Flips
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              Active Gaps: {fvgAnalysis?.allGaps.length ?? 0}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 max-h-[320px]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Imbalance Range</th>
                  <th className="py-2.5 px-3">50% Consequent Encroachment (CE)</th>
                  <th className="py-2.5 px-3">Gap Size</th>
                  <th className="py-2.5 px-3">Mitigation Lifecycle</th>
                  <th className="py-2.5 px-3">Polarity</th>
                  <th className="py-2.5 px-3">Quality Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!fvgAnalysis || fvgAnalysis.allGaps.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500 italic font-sans">
                      No 3-candle Fair Value Gaps detected.
                    </td>
                  </tr>
                ) : (
                  fvgAnalysis.allGaps.map((fvg) => (
                    <tr key={fvg.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-3 font-bold">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${fvg.type === 'BISI' ? 'bg-emerald-950 border border-emerald-800 text-emerald-300' : 'bg-rose-950 border border-rose-800 text-rose-300'}`}>
                          {fvg.type === 'BISI' ? 'BISI (Bullish FVG)' : 'SIBI (Bearish FVG)'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-200">
                        <div>{Math.min(fvg.bottomPrice, fvg.topPrice).toFixed(5)} — {Math.max(fvg.bottomPrice, fvg.topPrice).toFixed(5)}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          {formatUtcDateTime(fvg.candle2Timestamp)} ({formatTimeSince(fvg.candle2Timestamp)})
                        </div>
                      </td>
                      <td className="py-2 px-3 font-bold text-amber-300">
                        <div>{fvg.consequentEncroachmentPrice.toFixed(5)}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          CE 50% • ({formatTimeSince(fvg.candle2Timestamp)})
                        </div>
                      </td>
                      <td className="py-2 px-3 text-cyan-300 font-bold">
                        {fvg.gapSizePips.toFixed(1)} pips
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          fvg.mitigationState === 'UNMITIGATED'
                            ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                            : fvg.mitigationState === 'PARTIALLY_MITIGATED'
                              ? 'bg-amber-950 border border-amber-800 text-amber-300'
                              : fvg.mitigationState === 'FULLY_MITIGATED'
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-rose-950 text-rose-400'
                        }`}>
                          {fvg.mitigationState.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        {fvg.isInversionFVG ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-950 border border-violet-800 text-violet-300">
                            INVERSION FVG (IFVG)
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">Standard</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-bold text-white">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${fvg.qualityScore >= 80 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-cyan-950 text-cyan-300 border border-cyan-800'}`}>
                          {fvg.qualityScore}/100
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 4: POI INTELLIGENCE & CONFLUENCE RANKING */}
      {(subSection === 'ALL_OVERVIEW' || subSection === 'POI_INTELLIGENCE') && (
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Compass className="h-4 w-4 text-violet-400" />
                POI Intelligence &amp; Confluence Ranking Engine
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                HTF Bias Alignment • Valuation Zone Context (Discount / OTE / Premium) • Conviction Grades: A+, A, B, C
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold">
                A+ Setups: {rankedPoiReport?.aPlusCount ?? 0}
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
                A Setups: {rankedPoiReport?.aCount ?? 0}
              </span>
            </div>
          </div>

          {/* Confluence Clusters Box */}
          {rankedPoiReport && rankedPoiReport.clusters.length > 0 && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-violet-950/40 via-indigo-950/30 to-slate-900 border border-violet-800/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  Identified Confluence Clusters (Nested Multi-Factor Zones)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Physical Price Overlap Across POIs
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs pt-1">
                {rankedPoiReport.clusters.map((cluster) => (
                  <div key={cluster.id} className="p-3 rounded-lg bg-slate-950/80 border border-violet-800/60 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{cluster.description}</span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold text-[10px]">
                        Grade {cluster.convictionGrade}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>Zone: <strong className="text-amber-300">{cluster.bottomPrice.toFixed(5)} — {cluster.topPrice.toFixed(5)}</strong></span>
                      <span>Span: <strong className="text-cyan-300">{cluster.clusterHeightPips.toFixed(1)} pips</strong></span>
                      <span>Center: <strong className="text-white">{cluster.centerPrice.toFixed(5)}</strong></span>
                    </div>
                    {currentPriceTimestamp && (
                      <div className="text-[10px] text-slate-500">
                        Evaluated: {formatUtcDateTime(currentPriceTimestamp)} ({formatTimeSince(currentPriceTimestamp)})
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                      {cluster.hasOrderBlock && <span className="text-indigo-300">✓ Order Block</span>}
                      {cluster.hasFvg && <span className="text-emerald-300">✓ FVG Imbalance</span>}
                      {cluster.inOte && <span className="text-amber-300">✓ In OTE (61.8%-79%)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ranked POI List Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 max-h-[360px]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Rank</th>
                  <th className="py-2.5 px-3">Grade</th>
                  <th className="py-2.5 px-3">Kind</th>
                  <th className="py-2.5 px-3">Direction</th>
                  <th className="py-2.5 px-3">Trigger Price</th>
                  <th className="py-2.5 px-3">Valuation Zone</th>
                  <th className="py-2.5 px-3">HTF Bias</th>
                  <th className="py-2.5 px-3">Distance</th>
                  <th className="py-2.5 px-3">Conviction Score</th>
                  <th className="py-2.5 px-3">Institutional Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!rankedPoiReport || rankedPoiReport.rankedPois.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-500 italic font-sans">
                      No points of interest available for ranking.
                    </td>
                  </tr>
                ) : (
                  rankedPoiReport.rankedPois.map((item) => {
                    const ctx = item.poiContext;
                    return (
                      <tr key={ctx.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-white">
                          #{item.rank}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.grade === 'A_PLUS'
                              ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                              : item.grade === 'A'
                                ? 'bg-cyan-950 border border-cyan-800 text-cyan-300'
                                : item.grade === 'B'
                                  ? 'bg-amber-950 border border-amber-800 text-amber-300'
                                  : 'bg-slate-800 text-slate-400'
                          }`}>
                            {item.grade}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-200">
                          {ctx.kind.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ctx.direction === 'BULLISH' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                            {ctx.direction}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-amber-300">
                          <div>{ctx.triggerPrice.toFixed(5)}</div>
                          {(() => {
                            const model = ctx.underlyingModel as {
                              originCandleTimestamp?: number;
                              candle2Timestamp?: number;
                              timestamp?: number;
                            };
                            const ts =
                              model?.originCandleTimestamp ??
                              model?.candle2Timestamp ??
                              model?.timestamp;
                            return ts ? (
                              <div className="text-[10px] text-slate-400 font-normal">
                                {formatUtcDateTime(ts)} ({formatTimeSince(ts)})
                              </div>
                            ) : null;
                          })()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            ctx.valuationZone === 'DISCOUNT' || ctx.valuationZone === 'DEEP_DISCOUNT'
                              ? 'bg-emerald-950 text-emerald-300'
                              : ctx.valuationZone === 'PREMIUM' || ctx.valuationZone === 'DEEP_PREMIUM'
                                ? 'bg-rose-950 text-rose-300'
                                : 'bg-slate-800 text-slate-300'
                          }`}>
                            {ctx.dealingSubZone} {ctx.inOteZone && '• OTE'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            ctx.htfAlignment === 'STRONGLY_ALIGNED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : ctx.htfAlignment === 'COUNTER_TREND'
                                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                : 'text-slate-400'
                          }`}>
                            {ctx.htfAlignment.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {ctx.distancePips.toFixed(1)} pips
                        </td>
                        <td className="py-2.5 px-3 font-bold text-white">
                          <div className="flex items-center gap-1.5">
                            <div className="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${item.score >= 80 ? 'bg-emerald-400' : item.score >= 60 ? 'bg-cyan-400' : 'bg-amber-400'}`}
                                style={{ width: `${item.score}%` }}
                              ></div>
                            </div>
                            <span>{item.score}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px] max-w-xs truncate font-sans">
                          {ctx.contextRationales.join(' • ')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 5: SMC CAUSALITY ENGINE & SETUP NARRATIVE */}
      {(subSection === 'ALL_OVERVIEW' || subSection === 'CAUSALITY_CHAINS') && (
        <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-pink-400" />
                SMC Causal Attribution &amp; Setup Lineage Engine
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Reconstructs the full causal graph: Sweep Event → Displacement Impulse → Artifact Creation (OB/FVG) → Structural Break → Opposing Target
              </p>
            </div>
            <span className="text-xs font-mono text-pink-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              Linked Chains: {causalityReport?.causalChains.length ?? 0}
            </span>
          </div>

          {!activeChain ? (
            <div className="p-8 text-center text-slate-500 italic font-sans bg-slate-950/60 rounded-xl border border-slate-800">
              No causal chains formed yet. Awaiting displacement impulse and structure break confirmation.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Chain Selection Tabs if multiple */}
              {causalityReport && causalityReport.causalChains.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="text-slate-500 uppercase text-[10px] font-bold">Select Chain:</span>
                  {causalityReport.causalChains.map((c, i) => (
                    <button
                      key={`${c.id}_${i}`}
                      onClick={() => setSelectedChainId(c.id)}
                      className={`px-2.5 py-1 rounded-lg border font-bold transition ${
                        activeChain.id === c.id
                          ? 'bg-pink-950 border-pink-700 text-pink-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Chain #{i + 1} ({c.direction} {c.confirmedBreak.type})
                    </button>
                  ))}
                </div>
              )}

              {/* Visual Institutional DAG Node Cascade */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 relative font-mono text-xs">
                  {/* Step 1: Trigger Sweep */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-amber-800/60 space-y-1 relative">
                    <div className="text-[10px] text-amber-400 font-bold uppercase flex items-center justify-between">
                      <span>1. Trigger Sweep</span>
                      <Target className="h-3 w-3 text-amber-400" />
                    </div>
                    <div className="font-bold text-white text-xs pt-1">
                      {activeChain.triggerSweep ? activeChain.triggerSweep.levelType : 'Base Expansion'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {activeChain.triggerSweep ? activeChain.triggerSweep.status.replace(/_/g, ' ') : 'Impulsive Accumulation'}
                    </div>
                  </div>

                  {/* Step 2: Displacement */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-cyan-800/60 space-y-1">
                    <div className="text-[10px] text-cyan-400 font-bold uppercase flex items-center justify-between">
                      <span>2. Displacement Leg</span>
                      <Zap className="h-3 w-3 text-cyan-400" />
                    </div>
                    <div className="font-bold text-white text-xs pt-1">
                      {activeChain.displacementLeg.deltaPips.toFixed(1)} pips
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {activeChain.displacementLeg.velocityPipsPerCandle} pips/bar ({activeChain.displacementLeg.candleCount} bars)
                    </div>
                  </div>

                  {/* Step 3: Resulting Artifacts */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-indigo-800/60 space-y-1">
                    <div className="text-[10px] text-indigo-400 font-bold uppercase flex items-center justify-between">
                      <span>3. Artifacts Formed</span>
                      <Layers className="h-3 w-3 text-indigo-400" />
                    </div>
                    <div className="font-bold text-white text-xs pt-1">
                      {activeChain.resultingOrderBlocks.length} OB + {activeChain.resultingFvgs.length} FVG
                    </div>
                    <div className="text-[11px] text-slate-400">
                      50% Mean Threshold &amp; CE defined
                    </div>
                  </div>

                  {/* Step 4: Confirmed Structure Break */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-emerald-800/60 space-y-1">
                    <div className="text-[10px] text-emerald-400 font-bold uppercase flex items-center justify-between">
                      <span>4. Break Confirmed</span>
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    </div>
                    <div className="font-bold text-white text-xs pt-1">
                      {activeChain.confirmedBreak.scope} {activeChain.confirmedBreak.type}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      <div>At {activeChain.confirmedBreak.breakPrice.toFixed(5)} (Body Close)</div>
                      <div className="text-[10px] text-slate-500">
                        {formatUtcDateTime(activeChain.confirmedBreak.triggerCandleTimestamp)} ({formatTimeSince(activeChain.confirmedBreak.triggerCandleTimestamp)})
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Primary Target */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-violet-800/60 space-y-1">
                    <div className="text-[10px] text-violet-400 font-bold uppercase flex items-center justify-between">
                      <span>5. Opposing Target</span>
                      <Compass className="h-3 w-3 text-violet-400" />
                    </div>
                    <div className="font-bold text-white text-xs pt-1">
                      {activeChain.opposingTargetPool ? activeChain.opposingTargetPool.originType.replace(/_/g, ' ') : 'HTF Liquidity'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {activeChain.opposingTargetPool ? (
                        <>
                          <div>Target: {activeChain.opposingTargetPool.price.toFixed(5)}</div>
                          <div className="text-[10px] text-slate-500">
                            {formatUtcDateTime(activeChain.opposingTargetPool.originTimestamp)} ({formatTimeSince(activeChain.opposingTargetPool.originTimestamp)})
                          </div>
                        </>
                      ) : (
                        'Unrestricted Expansion'
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Synthesized Institutional Narrative Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                    Canonical Causal Narrative (Audit Trail Record)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-pink-950 border border-pink-800 text-pink-300 font-mono font-bold text-[10px]">
                    Conviction Score: {activeChain.causalConvictionScore}/100
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed font-sans italic">
                  "{activeChain.narrative}"
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
