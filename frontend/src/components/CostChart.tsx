import { formatRupiah, formatShortDate } from '../lib/format';

interface Point {
  date: string;
  costIdr: number;
  tokens: number;
}

export function CostChart({ data }: { data: Point[] }) {
  const width = 640;
  const height = 230;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 36;
  const values = data.map((point) => point.costIdr);
  const max = Math.max(...values, 0);
  const ceiling = max > 0 ? max * 1.18 : 1;
  const points = data.map((point, index) => {
    const x = data.length < 2
      ? width / 2
      : left + (index / (data.length - 1)) * (width - left - right);
    const y = height - bottom - (point.costIdr / ceiling) * (height - top - bottom);
    return { ...point, x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${height - bottom} L ${points[0].x} ${height - bottom} Z`
    : '';
  const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];

  if (data.length === 0 || max === 0) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <p>Belum ada biaya tercatat</p>
        <span>Grafik akan terisi setelah request pertama selesai.</span>
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      <div className="chart-caption">
        <span>Biaya harian</span>
        <span className="chart-key"><i /> Rupiah</span>
      </div>
      <svg className="cost-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik biaya harian dalam rupiah">
        <defs>
          <linearGradient id="cost-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#c6863d" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#c6863d" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((line) => {
          const y = top + line * ((height - top - bottom) / 2);
          return <line key={line} x1={left} x2={width - right} y1={y} y2={y} className="chart-guide" />;
        })}
        <path d={areaPath} fill="url(#cost-fill)" />
        <path d={linePath} className="chart-line" />
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="3.5" className="chart-point">
            <title>{`${formatShortDate(point.date)} · ${formatRupiah(point.costIdr)}`}</title>
          </circle>
        ))}
        {labelIndexes.map((index, position) => {
          const point = points[index];
          if (!point) return null;
          const anchor = position === 0 ? 'start' : position === labelIndexes.length - 1 ? 'end' : 'middle';
          return <text key={point.date} x={point.x} y={height - 8} textAnchor={anchor} className="chart-date">{formatShortDate(point.date)}</text>;
        })}
      </svg>
    </div>
  );
}
