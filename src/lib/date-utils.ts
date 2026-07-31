/**
 * Date utilities for Ozzyl HMS
 * Standardizing on Bangladesh Time (Asia/Dhaka, UTC+6)
 */

const DHAKA_TIMEZONE = 'Asia/Dhaka';

function getDhakaParts(input?: Date | string) {
  const date = input ? (typeof input === 'string' ? new Date(input) : input) : new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DHAKA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

export function getNowGMT6(): Date {
  const { year, month, day, hour, minute, second } = getDhakaParts();
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+06:00`);
}

export function getTodayGMT6(): string {
  const { year, month, day } = getDhakaParts();
  return `${year}-${month}-${day}`;
}

export function getFullTimestampGMT6(): string {
  const { year, month, day, hour, minute, second } = getDhakaParts();
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * Formats a date string or Date object to YYYY-MM-DD in GMT+6
 */
export function formatToTodayGMT6(date?: Date | string): string {
  const { year, month, day } = getDhakaParts(date);
  return `${year}-${month}-${day}`;
}
