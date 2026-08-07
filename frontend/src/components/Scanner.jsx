import { useEffect, useRef, useState } from 'react'

// Formats found on Australian grocery packaging. EAN-13 covers almost
// everything; EAN-8 shows up on small packs, UPC-A on US imports.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

const supportsNative = () => typeof window !== 'undefined' && 'BarcodeDetector' in window

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
  const [error, setError] = useState(null)

  useEffect(() => {
    stoppedRef.current = false
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
            handleHit(codes[0].rawValue)
            return
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
        if (result) handleHit(result.getText())
      })
      return () => controls.stop()
    }

    function handleHit(value) {
      if (stoppedRef.current) return
      stoppedRef.current = true
      if (navigator.vibrate) navigator.vibrate(60)
      onDetected(value)
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
