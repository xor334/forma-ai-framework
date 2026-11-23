'use client'
import { useRef, useState } from 'react'
import type { Block, Size } from '../../../packages/runtime/types'
import { layoutAt } from '../../../packages/widget-contract/layout.mjs'
type Props = {
  block: Block
  size: Size
  selected: boolean
  select: () => void
  resize: (width: number, height: number, id: string) => void
}
export default function CanvasBlock({ block, size, selected, select, resize }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const start = useRef<{
    x: number
    y: number
    width: number
    height: number
    container: number
  } | null>(null)
  const [drag, setDrag] = useState<{ width: number; height: number } | null>(null)
  const layout = layoutAt(block.layout, size),
    width = drag?.width ?? layout.widthPercent ?? (layout.span * 100) / 12,
    height = drag?.height ?? layout.minHeightPx
  const props = block.content.props
  function measure(x: number, y: number) {
    const first = start.current!
    return {
      width: Math.min(
        100,
        Math.max(1, Math.round((first.width + ((x - first.x) * 100) / first.container) * 10) / 10),
      ),
      height: Math.min(4096, Math.max(0, Math.round(first.height + y - first.y))),
    }
  }
  return (
    <div ref={box} className="canvas-block" style={{ width: width + '%', minHeight: height }}>
      <button
        className="card"
        aria-pressed={selected}
        onClick={select}
        style={{ minHeight: height, textAlign: layout.align }}
      >
        <small>{block.content.type}</small>
        <strong>{props.title}</strong>
        {props.body ?? props.schedule}
        {Array.isArray(props.items) && (
          <span>
            {props.items
              .map(
                (item: { name: string; priceRub: number }) =>
                  item.name + ' · ' + item.priceRub + ' ₽',
              )
              .join(' / ')}
          </span>
        )}
        {props.action && <span>{props.action.label}</span>}
      </button>
      {selected && (
        <span
          className="resize-handle"
          aria-hidden="true"
          onPointerDown={(e) => {
            const rect = box.current!.getBoundingClientRect()
            start.current = {
              x: e.clientX,
              y: e.clientY,
              width,
              height: rect.height,
              container: box.current!.parentElement!.clientWidth,
            }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (start.current) setDrag(measure(e.clientX, e.clientY))
          }}
          onPointerUp={(e) => {
            if (!start.current) return
            const next = measure(e.clientX, e.clientY)
            start.current = null
            setDrag(null)
            resize(next.width, next.height, block.id)
          }}
          onPointerCancel={() => {
            start.current = null
            setDrag(null)
          }}
        />
      )}
    </div>
  )
}
