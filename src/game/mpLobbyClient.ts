import mqtt, { type MqttClient } from 'mqtt'
import { decodeLobby, encodeLobby, LOBBY_PREFIX, LOBBY_STALE_MS, type LobbyAd, lobbyTopic } from './mpLobby'

/** EMQX first. Mosquitto if that socket never opens. */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081']
const WILD = `${LOBBY_PREFIX}/+`
const BEAT_MS = 4000

export type LobbyPhase = 'idle' | 'connecting' | 'up' | 'down'

let client: MqttClient | null = null
let connecting: Promise<MqttClient> | null = null
let brokerIndex = 0
let phase: LobbyPhase = 'idle'
let listed = new Map<string, LobbyAd>()
let listeners = new Set<(rooms: LobbyAd[]) => void>()
let listGen = 0
let ad: LobbyAd | null = null
let adGen = 0
let beatTimer = 0

export function lobbyPhase(): LobbyPhase {
  return phase
}

export function lobbyRooms(now = Date.now()): LobbyAd[] {
  const live: LobbyAd[] = []
  for (const [code, row] of listed) {
    if (now - row.beat > LOBBY_STALE_MS) listed.delete(code)
    else live.push(row)
  }
  live.sort((a, b) => a.since - b.since)
  return live
}

function emit(): void {
  const rooms = lobbyRooms()
  for (const fn of listeners) fn(rooms)
}

function clientId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `sv${hex}`
}

function connect(): Promise<MqttClient> {
  if (client?.connected) return Promise.resolve(client)
  if (connecting) return connecting
  if (client) {
    try {
      client.end(true)
    } catch {
      /* already closed */
    }
    client = null
  }
  phase = 'connecting'
  const url = BROKERS[Math.min(brokerIndex, BROKERS.length - 1)] ?? BROKERS[0]
  connecting = new Promise((resolve, reject) => {
    const next = mqtt.connect(url, {
      clientId: clientId(),
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 8000,
      protocolVersion: 4,
    })
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      next.end(true)
      reject(new Error('lobby timeout'))
    }, 9000)
    next.on('connect', () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      client = next
      phase = 'up'
      connecting = null
      resolve(next)
    })
    next.on('error', () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      next.end(true)
      reject(new Error('lobby error'))
    })
    next.on('message', (topic, payload) => {
      const code = topic.split('/').pop() ?? ''
      const row = decodeLobby(payload.toString(), Date.now())
      if (!row || row.code !== code) listed.delete(code)
      else listed.set(code, row)
      emit()
    })
  })
  return connecting.then(
    (current) => current,
    async (err: unknown) => {
      connecting = null
      client = null
      brokerIndex += 1
      if (brokerIndex >= BROKERS.length) {
        phase = 'down'
        emit()
        throw err
      }
      return connect()
    },
  )
}

function publishBeat(row: LobbyAd): void {
  const gen = adGen
  const send = (link: MqttClient) => {
    if (gen !== adGen || !link.connected || ad?.code !== row.code) return
    const beat = { ...row, beat: Date.now() }
    ad = beat
    link.publish(lobbyTopic(beat.code), encodeLobby(beat), { retain: true, qos: 0 })
  }
  if (client?.connected) {
    send(client)
    return
  }
  void connect()
    .then(send)
    .catch(() => {
      /* The next heartbeat tries the broker again. */
    })
}

export function advertiseRoom(row: { code: string; name: string; since: number }): void {
  adGen += 1
  ad = { ...row, beat: Date.now() }
  const mine = ad
  if (beatTimer) window.clearInterval(beatTimer)
  beatTimer = window.setInterval(() => {
    if (ad?.code === mine.code) publishBeat(ad)
  }, BEAT_MS)
  void connect()
    .then(() => {
      if (ad?.code === mine.code) publishBeat(mine)
    })
    .catch(() => {
      /* The room code still works if the lobby broker is down. */
    })
}

export async function stopAdvertising(): Promise<void> {
  const current = ad
  adGen += 1
  ad = null
  if (beatTimer) window.clearInterval(beatTimer)
  beatTimer = 0
  if (!current) return
  listed.delete(current.code)
  emit()
  try {
    const link = client?.connected ? client : await connect()
    link.publish(lobbyTopic(current.code), '', { retain: true, qos: 0 })
  } catch {
    /* A missed clear ages out on the stale heartbeat. */
  }
}

async function subscribe(current: MqttClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    current.subscribe(WILD, (err) => (err ? reject(err) : resolve()))
  })
}

export function startListing(onChange: (rooms: LobbyAd[]) => void): void {
  const gen = ++listGen
  listeners.add(onChange)
  onChange(lobbyRooms())
  void connect()
    .then(async (current) => {
      if (gen !== listGen || !listeners.has(onChange)) return
      await subscribe(current)
      if (gen !== listGen || !listeners.has(onChange)) return
      onChange(lobbyRooms())
    })
    .catch(() => {
      phase = 'down'
      if (listeners.has(onChange)) onChange(lobbyRooms())
    })
}

export function stopListing(onChange: (rooms: LobbyAd[]) => void): void {
  listeners.delete(onChange)
  if (listeners.size > 0) return
  listGen += 1
  if (client?.connected) client.unsubscribe(WILD)
}

export async function refreshListing(): Promise<void> {
  if (listeners.size === 0) return
  try {
    const current = await connect()
    await new Promise<void>((resolve, reject) => {
      current.unsubscribe(WILD, (err) => (err ? reject(err) : resolve()))
    })
    if (listeners.size === 0) return
    await subscribe(current)
    phase = 'up'
    emit()
  } catch {
    phase = 'down'
    emit()
  }
}

window.addEventListener('pagehide', () => {
  if (!ad || !client?.connected) return
  client.publish(lobbyTopic(ad.code), '', { retain: true, qos: 0 })
  adGen += 1
  ad = null
})
