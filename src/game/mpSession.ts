import Peer, { type DataConnection, type PeerError } from 'peerjs'
import { setGuestSender } from './mpLink'
import { mp } from './mpRole'
import {
  acceptSnapshot,
  advanceInterp,
  captureSnapshot,
  applyNetCmd,
  parseCmd,
  parseSnap,
  resetInterp,
  type Snapshot,
} from './mpProtocol'
import { pushToast } from './state'
import { PLAYER_NAME, type GameEvent, type MatchState } from './types'

/** Wall-clock snapshots. 12 Hz sits between 10 and 15. */
const SNAP = 1 / 12
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SOUND = new Set<GameEvent['type']>(['attack', 'death', 'ready', 'build'])

export interface MpHooks {
  onStatus: (text: string, live: boolean) => void
  onCode: (code: string) => void
  onReady: (seed: number) => void
  onDrop: (message: string) => void
  getState: () => MatchState | null
}

let ticket = 0
let peer: Peer | null = null
let link: DataConnection | null = null
let hooks: MpHooks | null = null
let snapAcc = 0
let soundQueue: GameEvent[] = []
let room = ''

export function roomCode(): string {
  return room
}

export function endMp(): void {
  ticket += 1
  setGuestSender(null)
  mp.role = 'off'
  snapAcc = 0
  soundQueue = []
  room = ''
  resetInterp()
  const currentLink = link
  const current = peer
  link = null
  peer = null
  try {
    currentLink?.close()
  } catch {
    /* already closed */
  }
  try {
    current?.destroy()
  } catch {
    /* already destroyed */
  }
}

export function hostRoom(next: MpHooks): void {
  endMp()
  hooks = next
  const mine = ticket
  hooks.onStatus('Connecting…', false)
  openHost(mine, 0)
}

export function joinRoom(raw: string, next: MpHooks): void {
  const code = normalizeCode(raw)
  endMp()
  hooks = next
  const mine = ticket
  if (!code) {
    hooks.onStatus('Enter the four-character room code.', false)
    return
  }
  hooks.onStatus('Connecting…', false)
  const guest = new Peer()
  peer = guest
  guest.on('open', () => {
    if (mine !== ticket) return
    const conn = guest.connect(`s${code}`, { reliable: true })
    bind(conn, mine, 'guest')
  })
  guest.on('error', (err) => {
    if (mine !== ticket) return
    fail(mine, errorText(err))
  })
  window.setTimeout(() => {
    if (mine !== ticket || mp.role === 'guest') return
    fail(mine, 'The room did not answer. Check the code and try again.')
  }, 20000)
}

/** Host sends snapshots. Guest eases the last one into the picture. */
export function pumpNet(state: MatchState, dt: number): void {
  if (mp.role === 'guest') {
    advanceInterp(state, dt)
    return
  }
  if (mp.role !== 'host') return
  for (const event of state.events) {
    if (SOUND.has(event.type)) soundQueue.push(event)
  }
  if (soundQueue.length > 32) soundQueue.splice(0, soundQueue.length - 32)
  snapAcc += dt
  if (!link?.open || snapAcc < SNAP) return
  snapAcc -= SNAP
  if (snapAcc > SNAP) snapAcc = SNAP
  const events = soundQueue.splice(0, soundQueue.length)
  link.send({ t: 'snap', snap: captureSnapshot(state, events) })
}

function openHost(mine: number, attempt: number): void {
  const code = makeCode()
  let retired = false
  const host = new Peer(`s${code}`)
  peer = host
  host.on('open', () => {
    if (retired || mine !== ticket) return
    room = code
    hooks?.onCode(code)
    hooks?.onStatus(`Waiting for opponent. Code ${code}.`, false)
  })
  host.on('connection', (incoming) => {
    if (retired || mine !== ticket) return
    if (link) {
      incoming.close()
      return
    }
    bind(incoming, mine, 'host')
  })
  host.on('error', (err) => {
    if (retired || mine !== ticket) return
    if (err.type === 'unavailable-id' && attempt < 6) {
      retired = true
      host.destroy()
      openHost(mine, attempt + 1)
      return
    }
    fail(mine, errorText(err))
  })
  host.on('disconnected', () => {
    if (retired || mine !== ticket || link?.open) return
    fail(mine, 'The connection dropped.')
  })
}

function bind(conn: DataConnection, mine: number, side: 'host' | 'guest'): void {
  link = conn
  let started = false
  let seed = 0
  if (side === 'guest') {
    setGuestSender((cmd) => {
      if (link?.open) link.send({ t: 'cmd', cmd })
    })
  }
  const hello = () => {
    if (link?.open) link.send({ t: 'hello', seed })
  }
  conn.on('open', () => {
    if (mine !== ticket || side !== 'guest') return
    const poke = window.setInterval(() => {
      if (mine !== ticket || mp.role === 'guest') {
        window.clearInterval(poke)
        return
      }
      if (link?.open) link.send({ t: 'ready' })
    }, 400)
    if (link?.open) link.send({ t: 'ready' })
  })
  conn.on('data', (data) => {
    if (mine !== ticket) return
    const msg = asRecord(data)
    if (msg?.t === 'ready' && side === 'host') {
      if (!started) {
        started = true
        seed = (Math.random() * 1_000_000_000) | 0
        mp.role = 'host'
        hooks?.onStatus(`Online · ${PLAYER_NAME[0]}`, true)
        hooks?.onReady(seed)
      }
      hello()
      return
    }
    onData(data, mine, () => {
      started = true
    }, started)
    if (mp.role === 'guest') started = true
  })
  conn.on('close', () => {
    if (mine !== ticket) return
    fail(mine, started ? 'Opponent left.' : 'The room closed before the match started.')
  })
  conn.on('error', () => {
    if (mine !== ticket) return
    fail(mine, 'The connection dropped.')
  })
}

function onData(data: unknown, mine: number, markStarted: () => void, started: boolean): void {
  const msg = asRecord(data)
  if (!msg || mine !== ticket) return
  if (msg.t === 'hello' && !started && mp.role !== 'host') {
    const seed = msg.seed
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return
    markStarted()
    mp.role = 'guest'
    hooks?.onStatus(`Online · ${PLAYER_NAME[1]}`, true)
    hooks?.onReady(seed | 0)
    return
  }
  if (msg.t === 'cmd' && mp.role === 'host') {
    const state = hooks?.getState()
    const cmd = parseCmd(msg.cmd)
    if (!state || !cmd) return
    const err = applyNetCmd(state, cmd)
    if (err && link?.open) link.send({ t: 'toast', text: err })
    return
  }
  if (msg.t === 'snap' && mp.role === 'guest') {
    const state = hooks?.getState()
    const snap = parseSnap(msg.snap)
    if (state && snap) acceptSnapshot(state, snap)
    return
  }
  if (msg.t === 'toast' && mp.role === 'guest' && typeof msg.text === 'string') {
    const state = hooks?.getState()
    if (state) pushToast(state, msg.text)
  }
}

function fail(mine: number, message: string): void {
  if (mine !== ticket) return
  const notify = hooks
  endMp()
  notify?.onDrop(message)
}

function makeCode(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length] ?? 'A'
  return code
}

export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[^A-Z2-9]/g, '')
  if (code.length !== 4) return null
  if ([...code].some((ch) => !ALPHABET.includes(ch))) return null
  return code
}

function errorText(err: PeerError<string>): string {
  if (err.type === 'peer-unavailable') return 'That room is not open.'
  if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
    return 'Could not reach the PeerJS broker.'
  }
  if (err.type === 'unavailable-id') return 'That room code is already in use.'
  if (err.type === 'browser-incompatible') return 'This browser cannot open a WebRTC room.'
  return 'The connection dropped.'
}

function asRecord(data: unknown): { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown } | null {
  if (!data || typeof data !== 'object') return null
  return data as { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown }
}
