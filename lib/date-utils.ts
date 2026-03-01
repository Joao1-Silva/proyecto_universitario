const DATE_INPUT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (value: number) => String(value).padStart(2, "0")

export const dateInputToIso = (input: string): string => {
  const match = DATE_INPUT_REGEX.exec(input.trim())
  if (!match) {
    return new Date(input).toISOString()
  }
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = Number.parseInt(match[3], 10)
  // Keep date-only values stable across local timezone rendering.
  return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString()
}

export const toDayKey = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export const toComparableDateKey = (input: string): string => {
  const trimmed = input.trim()
  if (DATE_INPUT_REGEX.test(trimmed)) {
    return trimmed
  }
  return toDayKey(trimmed)
}
