const dateFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Formatta la data di un post in modo deterministico (stesso output su server e client,
 * quindi nessun errore di idratazione): "3h fa" entro le 24 ore dal momento di
 * riferimento, altrimenti la data assoluta in UTC.
 */
export function formatPostDate(publishedAt: string, referenceIso: string): string {
  const published = Date.parse(publishedAt);
  const reference = Date.parse(referenceIso);
  const diffMinutes = Math.floor((reference - published) / 60_000);

  if (diffMinutes < 1) return "adesso";
  if (diffMinutes < 60) return `${diffMinutes}m fa`;
  if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)}h fa`;
  return dateFormatter.format(published);
}

export function formatCount(value: number): string {
  return value >= 10_000
    ? `${(value / 1000).toFixed(0)}k`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : String(value);
}

export function publishedYear(publishedAt: string): number {
  return new Date(publishedAt).getUTCFullYear();
}
