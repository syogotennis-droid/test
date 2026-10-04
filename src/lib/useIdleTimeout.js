import { useEffect, useRef } from 'react'

// Calls onIdle after `ms` without any touch, key press or scroll. Used on the punch screens so
// a screen left open (勤務確認, 退勤の入力) goes back to the start for the next person.
export const IDLE_MS = 2 * 60 * 1000

export function useIdleTimeout(onIdle, { ms = IDLE_MS, enabled = true } = {}) {
  const cb = useRef(onIdle)
  cb.current = onIdle
  useEffect(() => {
    if (!enabled) return undefined
    let t
    const reset = () => { clearTimeout(t); t = setTimeout(() => cb.current(), ms) }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']
    events.forEach(e => window.addEventListener(e, reset, true))
    reset()
    return () => { clearTimeout(t); events.forEach(e => window.removeEventListener(e, reset, true)) }
  }, [ms, enabled])
}
