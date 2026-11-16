// The look plan, in one place. A dusk industrial yard: cold charcoal
// concrete, hazard amber, rusted containers, and two team colours — teal
// for SABLE (the player's team) and signal red for VULTURE. The same
// names are the CSS custom properties in index.html.
export const PALETTE = {
  sky: '#15181d',
  ground: '#23262b',
  wall: '#2e3238',
  wallDark: '#22252a',
  crate: '#3a332a',
  containerRust: '#7a4a2b',
  containerTeal: '#2e5a58',
  hazard: '#f5a623',
  sable: '#35c4b5',
  vulture: '#e5484d',
  ink: '#ece7db',
  muted: '#9aa1a8',
  accent: '#f5a623',
};

export function hex(name) {
  return PALETTE[name];
}
