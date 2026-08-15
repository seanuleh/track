import { useEffect, useRef, useState } from 'react'

// Formats found on Australian grocery packaging. EAN-13 covers almost
// everything; EAN-8 shows up on small packs, UPC-A on US imports.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

const supportsNative = () => typeof window !== 'undefined' && 'BarcodeDetector' in window

// A single decode is not trustworthy. A barcode wrapped around a curved or
// tapered container distorts the bar widths, and the decoder can return a
// *different wrong* number on each frame — three such reads of one pudding tub
// (2026-08-15) all carried valid EAN-13 check digits, so the checksum rejects
// nothing here. Requiring the same value on consecutive good frames does.
const REQUIRED_AGREEMENTS = 3

/**
 * Camera barcode scanner.
 *
 * Uses the native BarcodeDetector API where available (Chrome on Android —
 * hardware-accelerated, no download). Everything else lazy-loads ZXing, which
 * is slower and ~300 KB, so it must not be in the main bundle.
 *
 * Requires a secure context for camera access; served over HTTPS via the
 * Cloudflare tunnel, so that holds in practice.
 */
export default function Scanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stoppedRef = useRef(false)
  const candidateRef = useRef({ value: null, count: 0 })
  const [error, setError] = useState(null)

  useEffect(() => {
    stoppedRef.current = false
    candidateRef.current = { value: null, count: 0 }
    let cleanupDecoder = null

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stoppedRef.current) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.setAttribute('playsinline', 'true') // iOS refuses inline playback without this
        await video.play()

        cleanupDecoder = supportsNative()
          ? await runNative(video)
          : await runZxing(video)
      } catch (err) {
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : err.message
        )
      }
    }

    // Native path: poll frames and hand them to the platform decoder.
    async function runNative(video) {
      const detector = new window.BarcodeDetector({ formats: FORMATS })
      let raf = null

      const tick = async () => {
        if (stoppedRef.current) return
        try {
          const codes = await detector.detect(video)
          if (codes.length > 0 && codes[0].rawValue) {
            // Keep polling until the same value has come back enough times.
            if (handleHit(codes[0].rawValue, codes[0].format)) return
          }
        } catch {
          // Transient decode errors are normal between good frames — keep going.
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)

      return () => raf !== null && cancelAnimationFrame(raf)
    }

    // Fallback path: ZXing, lazy-loaded so it never enters the main bundle.
    async function runZxing(video) {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      if (stoppedRef.current) return null

      const reader = new BrowserMultiFormatReader()
      const controls = await reader.decodeFromVideoElement(video, result => {
        if (result) handleHit(result.getText(), String(result.getBarcodeFormat?.() ?? 'zxing'))
      })
      return () => controls.stop()
    }

    // Returns true once a value has been confirmed and handed on, false while
    // still gathering agreement (callers on the native path keep polling).
    function handleHit(value, format) {
      if (stoppedRef.current) return true

      const candidate = candidateRef.current
      // A disagreeing read restarts the count at the new value rather than
      // merely resetting: the fresh read is as good a candidate as any.
      candidateRef.current =
        candidate.value === value
          ? { value, count: candidate.count + 1 }
          : { value, count: 1 }

      const { count } = candidateRef.current
      // Logged with the symbology because a UPC-A read of an EAN-13 pack comes
      // back a digit short, which looks like a missing product downstream.
      console.log(
        '[scan] read', value,
        `(${format || 'unknown'}, ${value.length} digits, ${count}/${REQUIRED_AGREEMENTS})`
      )
      if (count < REQUIRED_AGREEMENTS) return false

      stoppedRef.current = true
      if (navigator.vibrate) navigator.vibrate(60)
      onDetected(value)
      return true
    }

    start()

    return () => {
      stoppedRef.current = true
      if (cleanupDecoder) cleanupDecoder()
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [onDetected])

  return (
    <div className="scanner-overlay">
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <div className="scanner-reticle" />
      </div>

      <div className="scanner-hint">
        {error ? error : 'Point at the barcode'}
        {!error && !supportsNative() && (
          <div className="scanner-subhint">Using fallback decoder — hold steady</div>
        )}
      </div>

      <button className="scanner-close" onClick={onClose}>Cancel</button>
    </div>
  )
}
