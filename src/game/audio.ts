import type { GameEvent } from './types'

/**
 * World sounds carry a position and play only where the hearer can currently see.
 * Selection clicks and the win or lose fanfare have no place on the map.
 */
export function audibleEvents(events: GameEvent[], hears: (x: number, y: number) => boolean): GameEvent[] {
  return events.filter((event) => {
    if (event.type === 'select' || event.type === 'win' || event.type === 'lose') return true
    return hears(event.x, event.y)
  })
}

export class Sfx {
  muted = false
  private ctx: AudioContext | null = null
  private last = new Map<string, number>()

  unlock(): void {
    const AudioCtx = window.AudioContext
    if (!this.ctx) this.ctx = new AudioCtx()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  toggle(): boolean {
    this.muted = !this.muted
    return this.muted
  }

  consume(events: GameEvent[]): void {
    if (!events.length) return
    this.unlock()
    if (this.muted || !this.ctx) return
    const types = new Set(events.map((event) => event.type))
    if (types.has('win')) {
      this.fanfare(true)
      return
    }
    if (types.has('lose')) {
      this.fanfare(false)
      return
    }
    if (types.has('ready')) this.chime()
    if (types.has('build')) this.blip(300, 0.08, 'triangle', 0.04)
    if (types.has('order')) this.blip(460, 0.05, 'square', 0.028)
    else if (types.has('select')) this.blip(690, 0.04, 'sine', 0.03)
    if (types.has('attack')) this.throttled('attack', 80, () => this.blip(180, 0.04, 'sawtooth', 0.018))
    if (types.has('death')) this.throttled('death', 110, () => this.blip(110, 0.12, 'triangle', 0.04))
  }

  private throttled(key: string, gapMs: number, play: () => void): void {
    const now = performance.now()
    if (now - (this.last.get(key) ?? 0) < gapMs) return
    this.last.set(key, now)
    play()
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const amp = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    amp.gain.setValueAtTime(gain, t)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(amp)
    amp.connect(this.ctx.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private chime(): void {
    this.blip(520, 0.08, 'sine', 0.04)
    this.blip(700, 0.12, 'sine', 0.035, 0.07)
  }

  private fanfare(win: boolean): void {
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 220]
    notes.forEach((note, index) => this.blip(note, 0.18, 'sine', 0.05, index * 0.11))
  }
}
