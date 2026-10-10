"use client"

import { X } from "lucide-react"
import { useEffect, type ReactNode } from "react"

export function Drawer({ title, onClose, children, wide = false, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className={`drawer${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          {actions}
          <button className="iconbtn" onClick={onClose} aria-label="Cerrar"><X /></button>
        </header>
        <div className="scroll">{children}</div>
      </aside>
    </>
  )
}
