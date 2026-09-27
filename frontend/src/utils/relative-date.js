function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const russianDate = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/);
  if (russianDate) {
    const [, dayText, monthText, yearText, hourText = "0", minuteText = "0"] = russianDate;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const date = new Date(year, month - 1, day, hour, minute);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayWord(value) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  const last = value % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

export function relativeDate(value, fallbackValue, now = Date.now()) {
  const date = parseDate(value) || parseDate(fallbackValue);
  if (!date) return "дата неизвестна";
  const elapsed = Math.max(0, now - date.getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "только что";
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(elapsed / 86_400_000);
  return `${days} ${dayWord(days)} назад`;
}

