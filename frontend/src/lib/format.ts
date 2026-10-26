export const formatNumber = (value: number | null | undefined) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value ?? 0);

export const formatRupiah = (value: number | null | undefined) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value ?? 0);

export const formatRupiahBalance = (value: number | null | undefined) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 2,
  }).format(value ?? 0);

export const formatDate = (value: string | null | undefined, withTime = true) => {
  if (!value) return 'Belum pernah';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' }).format(date);
};

export const formatShortDate = (value: string) => {
  const date = new Date(`${value}T12:00:00+07:00`);
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(date);
};
