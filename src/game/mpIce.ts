/** Public STUN plus the Metered open relay. No API key, no server of our own. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'stun:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

export const CONNECT_MS = 20000
export const GUEST_TRIES = 3

export const RELAY_FAIL = 'Could not open a direct or relayed connection. Check the code and try again.'

export type LinkPath = 'Connecting…' | 'Direct' | 'Relayed'
export type GuestFail = 'timeout' | 'drop' | 'missing' | 'other'

export function peerOptions(): { debug: 0; config: RTCConfiguration } {
  return {
    debug: 0,
    config: { iceServers: ICE_SERVERS, iceTransportPolicy: 'all' },
  }
}

/** Timeout and a dropped channel retry until the budget is spent. A missing room retries once. */
export function guestShouldRetry(attempt: number, reason: GuestFail): boolean {
  if (reason === 'timeout' || reason === 'drop') return attempt + 1 < GUEST_TRIES
  if (reason === 'missing') return attempt < 1
  return false
}

export interface IceStat {
  type: string
  id?: string
  state?: string
  nominated?: boolean
  selected?: boolean
  localCandidateId?: string
  candidateType?: string
}

/** Relay if the nominated pair's local candidate is a TURN relay. Otherwise direct. */
export function pathFromStats(reports: Iterable<IceStat>): LinkPath {
  const locals = new Map<string, string>()
  let best: IceStat | undefined
  for (const report of reports) {
    if (report.type === 'local-candidate' && report.id && report.candidateType) {
      locals.set(report.id, report.candidateType)
    }
    if (report.type !== 'candidate-pair') continue
    const chosen = report.nominated === true || report.selected === true
    if (chosen) best = report
    else if (!best && report.state === 'succeeded') best = report
  }
  const kind = best?.localCandidateId ? locals.get(best.localCandidateId) : undefined
  if (kind === 'relay') return 'Relayed'
  if (kind === 'host' || kind === 'srflx' || kind === 'prflx') return 'Direct'
  return 'Connecting…'
}
