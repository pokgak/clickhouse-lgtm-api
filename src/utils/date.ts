// Utility for consistent ClickHouse DateTime64 timestamp formatting

export function nowDateTime64(): string {
  const date = new Date();
  return formatDateTime64(date);
}

export function dateTime64HoursAgo(hours: number): string {
  const date = new Date(Date.now() - hours * 60 * 60 * 1000);
  return formatDateTime64(date);
}

export function formatDateTime64(date: Date): string {
  const pad = (n: number, z = 2) => n.toString().padStart(z, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());
  const ms = date.getMilliseconds();
  // Convert ms to microseconds (pad to 6 digits)
  const micro = pad(ms, 3) + '000';
  return `${year}-${month}-${day} ${hour}:${min}:${sec}.${micro}`;
}