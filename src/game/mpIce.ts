/**
 * LAN only. An empty server list gathers host candidates, including the
 * mDNS .local names browsers use on a home network. No STUN and no TURN,
 * so a guest on another network cannot open the data channel.
 * PeerJS is used only to exchange those candidates.
 */
export const CONNECT_MS = 20000
export const GUEST_TRIES = 3

export const LAN_FAIL = 'Could not reach that PC on this network. Use the same Wi-Fi and check the code.'

export type LinkPath = 'Connecting…' | 'On the LAN'
export type GuestFail = 'timeout' | 'drop' | 'missing' | 'other'

export function peerOptions(): { debug: 0; config: RTCConfiguration } {
  return {
    debug: 0,
    config: { iceServers: [] },
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

/** The match counts as local only when the nominated pair is a host candidate. */
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
  if (kind === 'host') return 'On the LAN'
  return 'Connecting…'
}
