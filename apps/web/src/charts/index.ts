/**
 * Cadence chart kit — public surface. Import from '@/charts' (see README.md in this folder).
 */
export { FitnessChart, FITNESS_RANGES, DEFAULT_FORM_BANDS } from './FitnessChart';
export type { FitnessChartProps, FitnessRange, FitnessSelection, ChartEvent, ChartPhase, FormBand } from './FitnessChart';
export { WeeklyBars, WEEKLY_METRICS, WEEKLY_ACCESSORS } from './WeeklyBars';
export type { WeeklyBarsProps, WeeklyMetric } from './WeeklyBars';
export { WowDeltaBars, wowItems, compareWeeks } from './WowDeltaBars';
export type { WowDeltaBarsProps, WowItem, CompareMode, CompareTile } from './WowDeltaBars';
export { IntensityDistribution, ZoneBars, classifyIntensity, weeksToSplits, zoneFill } from './IntensityDistribution';
export type { IntensityDistributionProps, IntensitySplit, IntensityClassLabel, ZoneBarsProps } from './IntensityDistribution';
export { EffortCurve, PowerCurve, PaceCurve, valueAt, effortsToPoints } from './PowerCurve';
export type { EffortCurveProps, CurveSeries } from './PowerCurve';
export { StreamChart, streamStats } from './StreamChart';
export type { StreamChartProps, StreamSelection, StreamTrack, StreamXAxis, StreamSmoothing } from './StreamChart';
export { IntensityProfile, levelFor } from './IntensityProfile';
export type { IntensityProfileProps, ProfileBlock, ProfileRepeat } from './IntensityProfile';
export { ConsistencyHeatmap, computeStreaks } from './ConsistencyHeatmap';
export type { ConsistencyHeatmapProps, HeatDay } from './ConsistencyHeatmap';
export { Sparkline, SparkBars, MiniArea, SportMixBar, SplitBar } from './Spark';
export type { SparklineProps, SparkBarsProps, MiniAreaProps, MixSegment } from './Spark';
export { WellnessChart } from './WellnessChart';
export type { WellnessChartProps, WellnessMetric } from './WellnessChart';
export { RouteMap } from './RouteMap';
export type { RouteMapProps } from './RouteMap';
export { FormDial, Gauge, ProgressRing, CompareBars, StatBar } from './Gauge';
export type { FormDialProps, GaugeProps, ProgressRingProps, CompareBarsProps, CompareItem, StatBarProps } from './Gauge';

// Kit core (for bespoke charts in feature folders)
export { createHoverSync, useHoverSync, useHoverValue, useStreamCursor } from './core/hover';
export type { HoverSync } from './core/hover';
export { Ticker, MorphPath, Reveal } from './core/animated';
export { DeltaBadge, DeltaArrow, ChartSegmented, CautionGlyph } from './core/controls';
export { ChartFrame, ChartSkeleton, ChartEmpty } from './core/ChartFrame';
export { ChartDefs, useChartDefs, SPORT_RAMP, SPORT_ORDER, sportKey } from './core/ChartDefs';
export { ChartTooltip, TooltipBody, CrosshairRule, CrosshairDot } from './core/Tooltip';
export { EndLabels, EndLabelRow, avoidCollisions } from './core/EndLabels';
export { EventFlags, PhaseBands, TodayRule } from './core/Annotations';
export { AxisX, AxisY, Grid, dateTicks, linearTicks, thinTicks } from './core/Axis';
export { useChartSize, fitCanvas } from './core/useChartSize';
export { useChartPointer } from './core/useChartPointer';
export { useBrushX, mergeHandlers } from './core/useBrushX';
export { lttbIndices, rollingMeanF64, toF64, lowerBound, nearestIndex } from './core/lttb';
export { T, useCanvasTokens } from './core/tokens';
export * from './format';
export { spring as chartSpring } from './motion';
