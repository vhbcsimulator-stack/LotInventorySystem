import { useEffect, useState } from 'react'

/**
 * Returns `value` once it has stopped changing for `delay` ms. Used for search
 * boxes that query the database, so typing "B1 L12" sends one request instead
 * of six.
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
