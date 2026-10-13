/** Copy-paste LAN signaling. No broker. Host candidates only, deflated, then base64url. */

export interface LanDesc {
  type: 'offer' | 'answer'
  sdp: string
}

const PREFIX = 'sv1.'

export function hostOnlySdp(raw: string): string {
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0 && (!line.startsWith('a=candidate:') || line.includes(' typ host')))
  return lines.join('\r\n') + '\r\n'
}

/** Drop boilerplate and every candidate that is not a LAN host address. Empty when nothing local was gathered. */
export function packLan(type: 'offer' | 'answer', rawSdp: string): string {
  const lines = hostOnlySdp(rawSdp).split(/\r?\n/).filter((line) => line.length > 0)
  const take = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? ''
  const ufrag = take('a=ice-ufrag:')
  const pwd = take('a=ice-pwd:')
  const setup = take('a=setup:')
  const finger = take('a=fingerprint:').replace(/^sha-256\s+/i, '').replace(/:/g, '')
  const port = take('a=sctp-port:') || '5000'
  const max = take('a=max-message-size:') || '262144'
  const candidates = lines.filter((line) => line.startsWith('a=candidate:') && line.includes(' typ host')).map((line) => line.slice(2))
  if (!ufrag || !pwd || !setup || finger.length !== 64 || candidates.length === 0) return ''
  if (!/^[0-9a-fA-F]+$/.test(finger)) return ''
  return [type === 'offer' ? 'O' : 'A', ufrag, pwd, finger, setup, port, max, ...candidates].join('\n')
}

export function unpackLan(packed: string): LanDesc | null {
  const lines = packed.split('\n')
  if (lines.length < 8) return null
  const kind = lines[0]
  const ufrag = lines[1] ?? ''
  const pwd = lines[2] ?? ''
  const finger = lines[3] ?? ''
  const setup = lines[4] ?? ''
  const port = lines[5] ?? ''
  const max = lines[6] ?? ''
  const candidates = lines.slice(7).filter((line) => line.startsWith('candidate:') && line.includes(' typ host'))
  if ((kind !== 'O' && kind !== 'A') || !ufrag || !pwd || !setup || !port || !max) return null
  if (!/^[0-9a-fA-F]{64}$/.test(finger) || candidates.length === 0) return null
  const hex = finger.toUpperCase().match(/.{2}/g)?.join(':') ?? ''
  const body = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...candidates.map((line) => `a=${line}`),
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${hex}`,
    `a=setup:${setup}`,
    'a=mid:0',
    `a=sctp-port:${port}`,
    `a=max-message-size:${max}`,
  ]
  return { type: kind === 'O' ? 'offer' : 'answer', sdp: `${body.join('\r\n')}\r\n` }
}

export async function encodeSignal(type: 'offer' | 'answer', rawSdp: string): Promise<string> {
  const packed = packLan(type, rawSdp)
  if (!packed) throw new Error('no lan candidate')
  const compressed = await deflateRaw(new TextEncoder().encode(packed))
  return PREFIX + base64Url(compressed)
}

export async function decodeSignal(text: string): Promise<LanDesc | null> {
  const trimmed = text.trim().replace(/\s+/g, '')
  if (!trimmed.startsWith(PREFIX)) return null
  try {
    const packed = new TextDecoder().decode(await inflateRaw(base64UrlDecode(trimmed.slice(PREFIX.length))))
    return unpackLan(packed)
  } catch {
    return null
  }
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(bytes).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(bytes).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function blobOf(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy])
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlDecode(text: string): Uint8Array {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4))
  const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
