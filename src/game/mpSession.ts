import { setGuestSender } from './mpLink'
import { CONNECT_MS, EXPIRED, INVITE_BAD, LAN_FAIL, NO_LAN, REPLY_BAD, pathFromStats, peerOptions, type IceStat, type LinkPath } from './mpIce'
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
import { decodeSignal, encodeSignal, packLan } from './mpSignal'
import { pushToast } from './state'
import { PLAYER_NAME, type GameEvent, type MatchState } from './types'

/** Wall-clock snapshots. 12 Hz sits between 10 and 15. */
const SNAP = 1 / 12
const SOUND = new Set<GameEvent['type']>(['attack', 'death', 'ready', 'build'])

export interface MpHooks {
  onStatus: (text: string, live: boolean) => void
  onInvite: (text: string) => void
  onReply: (text: string) => void
  onReady: (seed: number) => void
  onDrop: (message: string) => void
  getState: () => MatchState | null
}

let ticket = 0
let pc: RTCPeerConnection | null = null
let channel: RTCDataChannel | null = null
let hooks: MpHooks | null = null
let snapAcc = 0
let soundQueue: GameEvent[] = []
let matched = false
let matchSeed = 0
let linkPath: LinkPath = 'Connecting…'
let replyApplied = false
let iceTimer = 0

export function endMp(): void {
  ticket += 1
  setGuestSender(null)
  mp.role = 'off'
  snapAcc = 0
  soundQueue = []
  matched = false
  matchSeed = 0
  replyApplied = false
  linkPath = 'Connecting…'
  if (iceTimer) window.clearTimeout(iceTimer)
  iceTimer = 0
  resetInterp()
  const currentChannel = channel
  const current = pc
  channel = null
  pc = null
  try {
    currentChannel?.close()
  } catch {
    /* already closed */
  }
  try {
    current?.close()
  } catch {
    /* already closed */
  }
}

export function hostRoom(next: MpHooks): void {
  endMp()
  hooks = next
  const mine = ticket
  hooks.onStatus('Gathering a LAN invite…', false)
  void openHost(mine)
}

export function acceptReply(raw: string): void {
  const mine = ticket
  const conn = pc
  if (!conn || replyApplied || mine !== ticket) {
    hooks?.onStatus(REPLY_BAD, false)
    return
  }
  void applyReply(raw, conn, mine)
}

export function joinInvite(raw: string, next: MpHooks): void {
  endMp()
  hooks = next
  const mine = ticket
  hooks.onStatus('Reading the invite…', false)
  void openGuest(raw, mine)
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
  if (channel?.readyState !== 'open' || snapAcc < SNAP) return
  snapAcc -= SNAP
  if (snapAcc > SNAP) snapAcc = SNAP
  const events = soundQueue.splice(0, soundQueue.length)
  send({ t: 'snap', snap: captureSnapshot(state, events) })
}

async function openHost(mine: number): Promise<void> {
  const conn = new RTCPeerConnection(peerOptions().config)
  if (mine !== ticket) {
    conn.close()
    return
  }
  pc = conn
  watchPc(conn, mine, 'host')
  const ch = conn.createDataChannel('game', { ordered: true })
  bind(ch, mine, 'host')
  try {
    const offer = await conn.createOffer()
    if (mine !== ticket) return
    await conn.setLocalDescription(offer)
    const ready = await waitGather(conn)
    if (mine !== ticket) return
    const sdp = conn.localDescription?.sdp ?? ''
    if (!ready || !packLan('offer', sdp)) {
      fail(mine, NO_LAN)
      return
    }
    const text = await encodeSignal('offer', sdp)
    if (mine !== ticket) return
    hooks?.onInvite(text)
    hooks?.onStatus('Copy the invite to the other PC. Then paste the reply below.', false)
  } catch {
    fail(mine, 'This browser could not open a LAN connection.')
  }
}

async function applyReply(raw: string, conn: RTCPeerConnection, mine: number): Promise<void> {
  const desc = await decodeSignal(raw)
  if (mine !== ticket) return
  if (!desc || desc.type !== 'answer') {
    hooks?.onStatus(REPLY_BAD, false)
    return
  }
  try {
    await conn.setRemoteDescription({ type: 'answer', sdp: desc.sdp })
  } catch {
    if (mine !== ticket) return
    hooks?.onStatus(REPLY_BAD, false)
    return
  }
  if (mine !== ticket) return
  replyApplied = true
  hooks?.onStatus('Connecting…', false)
  armIce(mine, LAN_FAIL)
}

async function openGuest(raw: string, mine: number): Promise<void> {
  const desc = await decodeSignal(raw)
  if (mine !== ticket) return
  if (!desc || desc.type !== 'offer') {
    hooks?.onStatus(INVITE_BAD, false)
    return
  }
  const conn = new RTCPeerConnection(peerOptions().config)
  if (mine !== ticket) {
    conn.close()
    return
  }
  pc = conn
  watchPc(conn, mine, 'guest')
  conn.addEventListener('datachannel', (ev) => {
    if (mine !== ticket) return
    bind(ev.channel, mine, 'guest')
  })
  try {
    await conn.setRemoteDescription({ type: 'offer', sdp: desc.sdp })
    if (mine !== ticket) return
    const answer = await conn.createAnswer()
    if (mine !== ticket) return
    await conn.setLocalDescription(answer)
    const ready = await waitGather(conn)
    if (mine !== ticket) return
    const sdp = conn.localDescription?.sdp ?? ''
    if (!ready || !packLan('answer', sdp)) {
      fail(mine, NO_LAN)
      return
    }
    const text = await encodeSignal('answer', sdp)
    if (mine !== ticket) return
    hooks?.onReply(text)
    hooks?.onStatus('Copy the reply to the host PC. Stay on this page.', false)
  } catch {
    fail(mine, INVITE_BAD)
  }
}

function bind(ch: RTCDataChannel, mine: number, side: 'host' | 'guest'): void {
  channel = ch
  if (side === 'guest') {
    setGuestSender((cmd) => {
      if (channel?.readyState === 'open') send({ t: 'cmd', cmd })
    })
  }
  const hello = () => {
    if (channel?.readyState === 'open') send({ t: 'hello', seed: matchSeed })
  }
  ch.addEventListener('open', () => {
    if (mine !== ticket || side !== 'guest') return
    const poke = window.setInterval(() => {
      if (mine !== ticket || mp.role === 'guest') {
        window.clearInterval(poke)
        return
      }
      if (channel?.readyState === 'open') send({ t: 'ready' })
    }, 400)
    if (channel?.readyState === 'open') send({ t: 'ready' })
  })
  ch.addEventListener('message', (ev) => {
    if (mine !== ticket || channel !== ch) return
    let data: unknown
    try {
      data = JSON.parse(String(ev.data))
    } catch {
      return
    }
    const msg = asRecord(data)
    if (msg?.t === 'ready' && side === 'host') {
      if (!matched) {
        matched = true
        matchSeed = (Math.random() * 1_000_000_000) | 0
        mp.role = 'host'
        if (iceTimer) window.clearTimeout(iceTimer)
        iceTimer = 0
        hooks?.onStatus(onlineLine(PLAYER_NAME[0]), true)
        hooks?.onReady(matchSeed)
      }
      hello()
      return
    }
    onData(data, mine, ch)
  })
  ch.addEventListener('close', () => {
    if (mine !== ticket || channel !== ch) return
    if (!matched && mp.role === 'off') {
      fail(mine, side === 'guest' ? EXPIRED : LAN_FAIL)
      return
    }
    fail(mine, 'Opponent left.')
  })
}

function onData(data: unknown, mine: number, ch: RTCDataChannel): void {
  const msg = asRecord(data)
  if (!msg || mine !== ticket || channel !== ch) return
  if (msg.t === 'hello' && mp.role !== 'host' && mp.role !== 'guest') {
    const seed = msg.seed
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return
    if (iceTimer) window.clearTimeout(iceTimer)
    iceTimer = 0
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
    if (err) send({ t: 'toast', text: err })
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

function watchPc(conn: RTCPeerConnection, mine: number, side: 'host' | 'guest'): void {
  conn.addEventListener('icecandidate', (ev) => {
    const candidate = ev.candidate
    if (!candidate) return
    console.log(`[survivors] ICE candidate ${candidate.type ?? ''} ${candidate.protocol ?? ''} ${candidate.address ?? ''}`)
  })
  conn.addEventListener('iceconnectionstatechange', () => {
    console.log(`[survivors] ICE ${conn.iceConnectionState}`)
    if (mine !== ticket) return
    if (conn.iceConnectionState === 'connected' || conn.iceConnectionState === 'completed') void reportPath(conn, mine)
    if (conn.iceConnectionState === 'failed') {
      if (mp.role !== 'off') fail(mine, 'The connection dropped.')
      else if (side === 'host' && !replyApplied) return
      else if (!matched) fail(mine, side === 'guest' ? EXPIRED : LAN_FAIL)
    }
  })
}

async function reportPath(conn: RTCPeerConnection, mine: number): Promise<void> {
  const stats = await conn.getStats()
  const reports: IceStat[] = []
  stats.forEach((report) => {
    const row = report as IceStat
    if (!row.type) return
    reports.push(row)
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

function waitGather(conn: RTCPeerConnection): Promise<boolean> {
  const hasHost = () => (conn.localDescription?.sdp ?? '').includes(' typ host')
  if (conn.iceGatheringState === 'complete') return Promise.resolve(hasHost())
  return new Promise((resolve) => {
    const finish = () => {
      conn.removeEventListener('icegatheringstatechange', onState)
      window.clearTimeout(timer)
      resolve(hasHost())
    }
    const onState = () => {
      if (conn.iceGatheringState === 'complete') finish()
    }
    conn.addEventListener('icegatheringstatechange', onState)
    const timer = window.setTimeout(finish, 8000)
  })
}

function armIce(mine: number, message: string): void {
  if (iceTimer) window.clearTimeout(iceTimer)
  iceTimer = window.setTimeout(() => {
    if (mine !== ticket || matched || mp.role !== 'off' || channel?.readyState === 'open') return
    fail(mine, message)
  }, CONNECT_MS)
}

function send(msg: unknown): void {
  if (channel?.readyState === 'open') channel.send(JSON.stringify(msg))
}

function fail(mine: number, message: string): void {
  if (mine !== ticket) return
  const notify = hooks
  endMp()
  notify?.onDrop(message)
}

function asRecord(data: unknown): { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown } | null {
  if (!data || typeof data !== 'object') return null
  return data as { t?: unknown; seed?: unknown; cmd?: unknown; snap?: Snapshot; text?: unknown }
}
