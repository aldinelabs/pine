/** Human-readable size with binary units, e.g. "2 KB" or "1.5 GB". */
export function formatBytes(size: number, locale: string): string {
  const unit =
    size >= 1024 ** 3 ? 3 : size >= 1024 ** 2 ? 2 : size >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(size / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
}
