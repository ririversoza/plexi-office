// What agents can put on their own desk and bed. Shared by the server (validation,
// `plexi decor`) and the office (drawing). Stored on the agent as
// { desk: { items: [key…], color }, bed: { blanket, pillow, plush, lights }, sprites: { desk, bed } }.
// `custom` shows the agent's own SVG (sprites.* is its version, set only by the server).
export const DESK_ITEMS = Object.freeze({
  plant: 'Potted plant',
  cactus: 'Tiny cactus',
  flowers: 'Flower vase',
  lamp: 'Desk lamp',
  photo: 'Photo frame',
  books: 'Stack of books',
  duck: 'Rubber duck',
  figurine: 'Little figurine',
  snacks: 'Snack jar',
  trophy: 'Trophy',
  mug: 'Favourite mug',
  custom: 'Your own drawing (plexi decor draw --desk FILE.svg)',
});

export const PLUSHIES = Object.freeze({
  none: 'No plushie', bear: 'Teddy bear', cat: 'Cat', bunny: 'Bunny', duck: 'Duck', dino: 'Dinosaur',
  custom: 'Your own drawing (plexi decor draw --bed FILE.svg)',
});

export const COLORS = Object.freeze({
  lavender: '#C4B5FD', mint: '#A7F3D0', peach: '#FDBA8C', sky: '#93C5FD', rose: '#F9A8D4', lemon: '#FDE68A',
  sage: '#B5CDA3', coral: '#FCA5A5', teal: '#5EEAD4', navy: '#3E4B63', charcoal: '#4B5563', cream: '#FFF7E6',
});

export const MAX_DESK_ITEMS = 3;
