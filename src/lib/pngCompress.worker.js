/*
 * Encodes RGBA pixels as a palette PNG of up to `colors` colours (UPNG's
 * quantiser), off the main thread so the page stays responsive on a large map.
 * Replies { png: ArrayBuffer } or { error }.
 */
import UPNG from 'upng-js'

self.onmessage = ({ data: { buffer, width, height, colors } }) => {
  try {
    const png = UPNG.encode([buffer], width, height, colors)
    self.postMessage({ png }, [png])
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) })
  }
}
