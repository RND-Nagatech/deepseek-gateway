import { UsageRow } from '../types';
import { formatDate, formatNumber, formatRupiah } from '../lib/format';
import { Icon } from './Icon';

function UsageState({ row }: { row: UsageRow }) {
  if (row.usageStatus === 'pending') return <span className="state state-pending"><i />Menunggu</span>;
  if (row.usageStatus === 'insufficient_balance') return <span className="state state-warning"><i />Saldo di bawah Rp10</span>;
  if (row.usageStatus === 'unavailable') return <span className="state state-unknown"><Icon name="warning" size={13} />Token belum diterima</span>;
  if (row.usageStatus === 'not_metered') return <span className="state state-neutral">Tanpa token</span>;
  if ((row.statusCode ?? 0) >= 400) return <span className="state state-error">HTTP {row.statusCode}</span>;
  return <span className="state state-success"><i />Selesai</span>;
}

export function UsageTable({ rows, compact = false }: { rows: UsageRow[]; compact?: boolean }) {
  const columns = compact
    ? 'usage-table usage-table-compact'
    : 'usage-table';

  if (rows.length === 0) {
    return (
      <div className="table-empty">
        <div className="empty-ledger" aria-hidden="true"><span /><span /><span /></div>
        <strong>Riwayat masih kosong</strong>
        <p>Request melalui gateway akan muncul di sini dengan rincian token dan biayanya.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className={columns}>
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Client / key</th>
            <th>Endpoint</th>
            <th>Model</th>
            <th className="numeric">Input</th>
            {!compact && <th className="numeric">Cache hit</th>}
            {!compact && <th className="numeric">Cache miss</th>}
            <th className="numeric">Output</th>
            <th className="numeric">Total token</th>
            <th className="numeric">Biaya</th>
            {!compact && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="time-cell"><span>{formatDate(row.startedAt)}</span><small>{row.latencyMs === null ? '-' : `${formatNumber(row.latencyMs)} ms`}</small></td>
              <td><div className="client-cell"><span className="client-cell-name">{row.clientName}</span>{row.keyHint && <small>{row.keyHint}</small>}</div></td>
              <td><code>{row.method} {row.path}</code></td>
              <td>{row.model ?? '-'}</td>
              <td className="numeric">{row.inputTokens === null ? '-' : formatNumber(row.inputTokens)}</td>
              {!compact && <td className="numeric cache-cell">{row.cacheHitTokens === null ? '-' : formatNumber(row.cacheHitTokens)}</td>}
              {!compact && <td className="numeric">{row.cacheMissTokens === null ? '-' : formatNumber(row.cacheMissTokens)}</td>}
              <td className="numeric">{row.outputTokens === null ? '-' : formatNumber(row.outputTokens)}</td>
              <td className="numeric total-cell">{row.billableTokens === null ? '-' : formatNumber(row.billableTokens)}</td>
              <td className="numeric cost-cell">{row.usageStatus === 'confirmed' ? formatRupiah(row.costIdr) : '-'}</td>
              {!compact && <td><UsageState row={row} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
