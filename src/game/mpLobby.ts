/** Public MQTT lobby. Retained messages, no account, no server of our own. */
export const LOBBY_PREFIX = 'gareevfx-survivors/lobby/v1'

/**
 * A background tab can throttle timers to about once a minute.
 * Two minutes keeps that host listed. Closing or starting still clears at once.
 */
export const LOBBY_STALE_MS = 120_000

const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/

export interface LobbyAd {
  code: string
  name: string
  since: number
  beat: number
}

export function lobbyTopic(code: string): string {
  return `${LOBBY_PREFIX}/${code}`
}

export function encodeLobby(ad: LobbyAd): string {
  return JSON.stringify({ code: ad.code, name: ad.name, since: ad.since, beat: ad.beat })
}

/** Empty payload clears the room. A late heartbeat drops it too. */
export function decodeLobby(payload: string, now: number): LobbyAd | null {
  const text = payload.trim()
  if (!text) return null
  let data: Partial<LobbyAd>
  try {
    data = JSON.parse(text) as Partial<LobbyAd>
  } catch {
    return null
  }
  if (typeof data.code !== 'string' || !CODE.test(data.code)) return null
  if (typeof data.name !== 'string') return null
  if (typeof data.since !== 'number' || !Number.isFinite(data.since)) return null
  if (typeof data.beat !== 'number' || !Number.isFinite(data.beat)) return null
  if (now - data.beat > LOBBY_STALE_MS) return null
  const name = data.name.replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!name) return null
  return { code: data.code, name, since: data.since, beat: data.beat }
}

export function formatWait(since: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - since) / 1000))
  if (sec < 60) return `${sec}s`
  const mins = Math.floor(sec / 60)
  const rest = sec % 60
  return `${mins}:${rest.toString().padStart(2, '0')}`
}
