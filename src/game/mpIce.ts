/**
 * LAN only. An empty server list gathers host candidates, including the
 * mDNS .local names browsers use on a home network. No STUN, no TURN,
 * and no signaling broker. The invite text carries those candidates.
 */
export const CONNECT_MS = 20000

export const LAN_FAIL = 'Could not reach that PC on this network. Use the same Wi-Fi and try the invite again.'

export const INVITE_BAD = 'That invite could not be read. Copy it again from the host.'
export const REPLY_BAD = 'That reply could not be read. Copy it again from the other PC.'
export const NO_LAN = 'Could not find a LAN address on this PC.'
export const EXPIRED = 'The reply expired before the host connected. Start again and paste it on the host right away.'

export type LinkPath = 'Connecting…' | 'On the LAN'

export function peerOptions(): { config: RTCConfiguration } {
  return { config: { iceServers: [] } }
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
