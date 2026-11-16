import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const KEY = 'sel751.colwidths'
const MIN = 40

function readAll(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}
function store(id: string, widths: number[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [id]: widths }))
  } catch {
    /* sem armazenamento */
  }
}

function applyWidths(table: HTMLTableElement, widths: number[]) {
  const ths = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'))
  ths.forEach((th, i) => {
    if (widths[i]) th.style.width = `${widths[i]}px`
  })
  table.style.tableLayout = 'fixed'
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`
}

/**
 * Dá alças de arraste aos cabeçalhos (th) de todas as tabelas internas: arraste a borda direita
 * da coluna para mudar a largura; duplo clique na alça restaura a largura automática.
 * As larguras ficam salvas no navegador por `id` + posição da tabela.
 */
export function ResizableTables({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return

    const decorate = () => {
      el.querySelectorAll<HTMLTableElement>('table').forEach((table, ti) => {
        const ths = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'))
        if (!ths.length) return
        const tid = `${id}.${ti}.${ths.length}`
        if (!table.dataset.rz) {
          table.dataset.rz = '1'
          const saved = readAll()[tid]
          if (saved && saved.length === ths.length) applyWidths(table, saved)
        }
        ths.forEach((th, ci) => {
          if (th.querySelector(':scope > .col-grip')) return
          th.style.position = 'relative'
          const grip = document.createElement('span')
          grip.className = 'col-grip'
          grip.title = 'Arraste para redimensionar (duplo clique: automático)'
          grip.addEventListener('dblclick', () => {
            table.style.tableLayout = ''
            table.style.width = ''
            table.querySelectorAll<HTMLTableCellElement>('thead th').forEach((h) => (h.style.width = ''))
            store(tid, [])
          })
          grip.addEventListener('pointerdown', (ev) => {
            ev.preventDefault()
            const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'))
            const widths = cells.map((c) => c.getBoundingClientRect().width)
            applyWidths(table, widths)
            const x0 = ev.clientX
            const w0 = widths[ci]
            grip.setPointerCapture(ev.pointerId)
            const move = (e: PointerEvent) => {
              widths[ci] = Math.max(MIN, w0 + e.clientX - x0)
              applyWidths(table, widths)
            }
            const up = () => {
              grip.removeEventListener('pointermove', move)
              grip.removeEventListener('pointerup', up)
              store(tid, widths)
            }
            grip.addEventListener('pointermove', move)
            grip.addEventListener('pointerup', up)
          })
          th.appendChild(grip)
        })
      })
    }

    decorate()
    const mo = new MutationObserver(decorate)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [id])

  return <div ref={root} className={`rz ${className ?? ''}`}>{children}</div>
}
