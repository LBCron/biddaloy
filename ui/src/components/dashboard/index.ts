// [169.1-1846] Dashboard kit barrel. Class maps and scale helpers stay internal.
export { WidgetCard, WidgetHelpContext, type WidgetCardProps } from './widget-card';
export type { SignalLevel } from './signal';
export { StatTile, type StatTileProps } from './stat-tile';
export { Sparkline, type SparklineProps } from './sparkline';
export { Meter, type MeterProps } from './meter';
export { BriefingLine, BriefingChip, type BriefingLineProps } from './briefing-line';
export { ChartTableToggle, type ChartTableToggleProps } from './chart-table-toggle';
export { LineChart, type LineChartPoint, type LineChartProps } from './line-chart';
export {
  ColumnChart,
  type ColumnChartProps,
  type ColumnDatum,
  type ColumnSeries,
} from './column-chart';
export {
  StackedBar,
  type StackedBarColor,
  type StackedBarProps,
  type StackedBarSegment,
} from './stacked-bar';
export type { ChartColor } from './chart-utils';
