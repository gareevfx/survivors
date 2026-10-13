/** Who this browser is. `off` is every single-player match. */
export const mp = { role: 'off' as 'off' | 'host' | 'guest' }

/** The side controlled from this keyboard. Host and solo are Silo 01. */
export function localOwner(): 0 | 1 {
  return mp.role === 'guest' ? 1 : 0
}

export function multiplayer(): boolean {
  return mp.role !== 'off'
}
