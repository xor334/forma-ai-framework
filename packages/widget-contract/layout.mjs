// Convert at the channel boundary. A stored revision always keeps its original format.
export function pageForSchema(page, version) {
  if (![1, 2].includes(version) || ![1, 2].includes(page.schemaVersion))
    throw Error('Неизвестная версия схемы')
  const copy = structuredClone(page)
  if (copy.schemaVersion === version) return copy
  for (const widget of copy.widgets) {
    for (const step of Object.values(widget.layout)) {
      if (version === 2) {
        step.widthPercent = Number(((step.span * 100) / 12).toFixed(5))
        delete step.span
      } else {
        step.span = Math.max(1, Math.min(12, Math.round((step.widthPercent * 12) / 100)))
        delete step.widthPercent
        delete step.minHeightPx
      }
    }
  }
  copy.schemaVersion = version
  return copy
}

// Breakpoints inherit omitted properties from narrower layouts.
export function layoutAt(layout, size) {
  if (!['phone', 'tablet', 'wide'].includes(size)) throw new Error('Неизвестный размер окна')
  const result = { align: 'start', ...layout.phone }
  if (size !== 'phone') Object.assign(result, layout.tablet)
  if (size === 'wide') Object.assign(result, layout.wide)
  return result
}
