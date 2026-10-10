"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

interface Toast {
  id: number
  text: string
  error?: boolean
  action?: { label: string; run: () => void }
}

const Ctx = createContext<{ toast: (text: string, opts?: { error?: boolean; action?: Toast["action"] }) => void }>({ toast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((text: string, opts: { error?: boolean; action?: Toast["action"] } = {}) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.error ? 6000 : opts.action ? 5000 : 2600)
  }, [])
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
