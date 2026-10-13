import Peer, { type DataConnection, type PeerError } from 'peerjs'
import { setGuestSender } from './mpLink'
import {
  CONNECT_MS,
  GUEST_TRIES,
  LAN_FAIL,
  guestShouldRetry,
  pathFromStats,
  peerOptions,
  type GuestFail,
  type IceStat,
  type LinkPath,
} from './mpIce'
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
let matched = false
let matchSeed = 0
let linkPath: LinkPath = 'Connecting…'
let brokerWatch = 0
let guestLive: (() => void) | null = null

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
  matched = false
  matchSeed = 0
  guestLive = null
  linkPath = 'Connecting…'
  if (brokerWatch) window.clearInterval(brokerWatch)
  brokerWatch = 0
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
  brokerWatch = window.setInterval(() => {
    if (mine !== ticket) {
      window.clearInterval(brokerWatch)
      brokerWatch = 0
      return
    }
    reconnectBroker('interval')
  }, 5000)
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
  joinAttempt(code, mine, 0)
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
  if (mine !== ticket) return
  const code = makeCode()
  let retired = false
  const host = new Peer(`s${code}`, peerOptions())
  peer = host
  host.on('open', () => {
    if (retired || mine !== ticket) return
    room = code
    hooks?.onCode(code)
    hooks?.onStatus(`Waiting for the other PC. Code ${code}.`, false)
  })
  host.on('connection', (incoming) => {
    if (retired || mine !== ticket) return
    if (matched) {
      incoming.close()
      return
    }
    if (link && link !== incoming) {
      try {
        link.close()
      } catch {
        /* the previous attempt already died */
      }
      link = null
    }
    bind(incoming, mine, 'host')
  })
  host.on('disconnected', () => {
    if (retired || mine !== ticket || !room) return
    console.log('[survivors] broker disconnected, reconnecting')
    window.setTimeout(() => reconnectBroker('event'), 400)
  })
  host.on('error', (err) => {
    if (retired || mine !== ticket) return
    if (err.type === 'unavailable-id' && attempt < 6 && !room) {
      retired = true
      try {
        host.destroy()
      } catch {
        /* already gone */
      }
      openHost(mine, attempt + 1)
      return
    }
    if (brokerError(err)) {
      console.log('[survivors] broker disconnected, reconnecting')
      if (room) return
      if (attempt < 4) {
        retired = true
        try {
          host.destroy()
        } catch {
          /* already gone */
        }
        window.setTimeout(() => openHost(mine, attempt + 1), 700)
        return
      }
      fail(mine, 'Could not reach the PeerJS broker.')
      return
    }
    if (!room) fail(mine, errorText(err))
  })
}

function joinAttempt(code: string, mine: number, attempt: number): void {
  if (mine !== ticket) return
  let attemptDone = false
  const guest = new Peer(peerOptions())
  peer = guest
  const markLive = () => {
    if (attemptDone) return
    attemptDone = true
    window.clearTimeout(timer)
  }
  guestLive = markLive
  const finish = (reason: GuestFail, message: string) => {
    if (attemptDone || mine !== ticket) return
    attemptDone = true
    if (guestLive === markLive) guestLive = null
    window.clearTimeout(timer)
    try {
      link?.close()
    } catch {
      /* already closed */
    }
    link = null
    try {
      guest.destroy()
    } catch {
      /* already destroyed */
    }
    if (peer === guest) peer = null
    if (guestShouldRetry(attempt, reason)) {
      const next = attempt + 2
      hooks?.onStatus(`Connecting… (${next}/${GUEST_TRIES})`, false)
      window.setTimeout(() => joinAttempt(code, mine, attempt + 1), 400)
      return
    }
    fail(mine, message)
  }
  const timer = window.setTimeout(() => {
    finish('timeout', LAN_FAIL)
  }, CONNECT_MS)
  guest.on('open', () => {
    if (attemptDone || mine !== ticket) return
    const conn = guest.connect(`s${code}`, { reliable: true })
    bind(conn, mine, 'guest', finish)
  })
  guest.on('error', (err) => {
    if (mine !== ticket) return
    if (attemptDone || mp.role === 'guest') {
      if (brokerError(err)) {
        console.log('[survivors] broker disconnected, reconnecting')
        reconnectBroker('event')
      }
      return
    }
    if (err.type === 'peer-unavailable') {
      finish('missing', 'That room is not open.')
      return
    }
    if (brokerError(err)) {
      finish('drop', 'Could not reach the PeerJS broker.')
      return
    }
    if (err.type === 'browser-incompatible' || err.type === 'invalid-id' || err.type === 'ssl-unavailable') {
      finish('other', errorText(err))
      return
    }
    finish('drop', LAN_FAIL)
  })
  guest.on('disconnected', () => {
    if (mine !== ticket || !attemptDone) return
    console.log('[survivors] broker disconnected, reconnecting')
    window.setTimeout(() => reconnectBroker('event'), 400)
  })
}

function bind(
  conn: DataConnection,
  mine: number,
  side: 'host' | 'guest',
  onGuestFail?: (reason: GuestFail, message: string) => void,
): void {
  link = conn
  watchIce(conn, mine)
  if (side === 'guest') {
    setGuestSender((cmd) => {
      if (link?.open) link.send({ t: 'cmd', cmd })
    })
  }
  const hello = (seed: number) => {
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
      if (!matched) {
        matched = true
        matchSeed = (Math.random() * 1_000_000_000) | 0
        mp.role = 'host'
        hooks?.onStatus(onlineLine(PLAYER_NAME[0]), true)
        hooks?.onReady(matchSeed)
      }
      hello(matchSeed)
      return
    }
    onData(data, mine, conn)
  })
  conn.on('close', () => {
    if (mine !== ticket || link !== conn) return
    if (side === 'host' && !matched) {
      link = null
      hooks?.onStatus(`Waiting for the other PC. Code ${room}.`, false)
      return
    }
    if (side === 'guest' && mp.role !== 'guest') {
      onGuestFail?.('drop', LAN_FAIL)
      return
    }
    fail(mine, 'Opponent left.')
  })
  conn.on('error', () => {
    if (mine !== ticket || link !== conn) return
    if (side === 'host' && !matched) {
      link = null
      try {
        conn.close()
      } catch {
        /* already closed */
      }
      hooks?.onStatus(`Waiting for the other PC. Code ${room}.`, false)
      return
    }
    if (side === 'guest' && mp.role !== 'guest') {
      onGuestFail?.('drop', LAN_FAIL)
      return
    }
    fail(mine, 'The connection dropped.')
  })
}

function onData(data: unknown, mine: number, conn: DataConnection): void {
  const msg = asRecord(data)
  if (!msg || mine !== ticket || link !== conn) return
  if (msg.t === 'hello' && mp.role !== 'host' && mp.role !== 'guest') {
    const seed = msg.seed
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return
    guestLive?.()
    guestLive = null
    mp.role = 'guest'
    hooks?.onStatus(onlineLine(PLAYER_NAME[1]), true)
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

function watchIce(conn: DataConnection, mine: number): void {
  conn.on('iceStateChanged', (state) => {
    console.log(`[survivors] ICE ${state}`)
    if (state === 'connected' || state === 'completed') void reportPath(conn, mine)
  })
  const hookPc = () => {
    const pc = conn.peerConnection
    if (!pc) return
    const marked = pc as RTCPeerConnection & { __svIce?: boolean }
    if (marked.__svIce) return
    marked.__svIce = true
    pc.addEventListener('icecandidate', (ev) => {
      const candidate = ev.candidate
      if (!candidate) return
      console.log(`[survivors] ICE candidate ${candidate.type ?? ''} ${candidate.protocol ?? ''} ${candidate.address ?? ''}`)
    })
  }
  hookPc()
  conn.on('open', hookPc)
}

async function reportPath(conn: DataConnection, mine: number): Promise<void> {
  const pc = conn.peerConnection
  if (!pc) return
  const stats = await pc.getStats()
  const reports: IceStat[] = []
  stats.forEach((report) => {
    const row = report as {
      type?: string
      id?: string
      state?: string
      nominated?: boolean
      selected?: boolean
      localCandidateId?: string
      candidateType?: string
    }
    if (!row.type) return
    reports.push({
      type: row.type,
      id: row.id,
      state: row.state,
      nominated: row.nominated,
      selected: row.selected,
      localCandidateId: row.localCandidateId,
      candidateType: row.candidateType,
    })
  })
  const path = pathFromStats(reports)
  console.log(`[survivors] path ${path}`)
  if (mine !== ticket || path === 'Connecting…') return
  linkPath = path
  if (mp.role === 'host') hooks?.onStatus(onlineLine(PLAYER_NAME[0]), true)
  else if (mp.role === 'guest') hooks?.onStatus(onlineLine(PLAYER_NAME[1]), true)
  else hooks?.onStatus(path, false)
}

function onlineLine(name: string): string {
  return `Online · ${name} · ${linkPath}`
}

function reconnectBroker(why: string): void {
  const current = peer
  if (!current || current.destroyed || !current.disconnected) return
  console.log(`[survivors] broker disconnected, reconnecting (${why})`)
  try {
    current.reconnect()
  } catch {
    /* the next tick tries again */
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

function brokerError(err: PeerError<string>): boolean {
  return (
    err.type === 'network' ||
    err.type === 'server-error' ||
    err.type === 'socket-error' ||
    err.type === 'socket-closed' ||
    err.type === 'disconnected'
  )
}

function errorText(err: PeerError<string>): string {
  if (err.type === 'peer-unavailable') return 'That room is not open.'
  if (brokerError(err)) return 'Could not reach the PeerJS broker.'
  if (err.type === 'unavailable-id') return 'That room code is already in use.'
  if (err.type === 'browser-incompatible') return 'This browser cannot open a WebRTC room.'
  return 'The connection dropped.'
}

function asRecord(data: unknown): { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown } | null {
  if (!data || typeof data !== 'object') return null
  return data as { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  reconnectBroker('visible')
})
