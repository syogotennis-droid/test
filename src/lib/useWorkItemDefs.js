import { useEffect, useState } from 'react'
import { getWorkItemDefs, loadWorkItemDefs } from './db'

// Re-renders the screen when the work item list (names / order) changes.
// load=true also fetches the latest list from the server once.
export function useWorkItemDefs({ load = false } = {}) {
  const [defs, setDefs] = useState(getWorkItemDefs)
  useEffect(() => {
    const onChange = () => setDefs(getWorkItemDefs())
    window.addEventListener('work-items-change', onChange)
    if (load) loadWorkItemDefs()
    return () => window.removeEventListener('work-items-change', onChange)
  }, [load])
  return defs
}
