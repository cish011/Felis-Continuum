export const COATS = {
  silverTabby: { label: 'Silver mackerel tabby', base: '#a6aaa5', dark: '#222825', warm: '#c1b9a6', pattern: 'tabby' },
  brownTabby: { label: 'Brown classic tabby', base: '#8c7354', dark: '#2d241b', warm: '#c59b68', pattern: 'classic' },
  orangeTabby: { label: 'Red tabby', base: '#c97836', dark: '#713514', warm: '#e7b06d', pattern: 'tabby' },
  black: { label: 'Solid black', base: '#161918', dark: '#050606', warm: '#393b36', pattern: 'solid' },
  white: { label: 'Solid white', base: '#dedbd1', dark: '#b7b3aa', warm: '#f3eee2', pattern: 'solid' },
  blue: { label: 'Solid blue-gray', base: '#697176', dark: '#454b4e', warm: '#94999a', pattern: 'solid' },
  tuxedo: { label: 'Black tuxedo', base: '#191b1a', dark: '#070807', warm: '#e4e0d4', pattern: 'tuxedo' },
  calico: { label: 'Calico', base: '#e1d8c7', dark: '#272421', warm: '#c9662f', pattern: 'calico' },
  tortie: { label: 'Tortoiseshell', base: '#2b2620', dark: '#12100e', warm: '#ad572b', pattern: 'tortie' },
  colorpoint: { label: 'Seal point', base: '#d2c5aa', dark: '#443229', warm: '#efe4ca', pattern: 'point' }
};

export const EYE_COLORS = {
  lichen: { label: 'Lichen green', iris: '#9ab56a', rim: '#344226' },
  amber: { label: 'Deep amber', iris: '#d7952c', rim: '#5e3510' },
  copper: { label: 'Copper', iris: '#d46c2e', rim: '#5f2815' },
  aqua: { label: 'Blue-green', iris: '#70c7c6', rim: '#275557' },
  blue: { label: 'Sapphire blue', iris: '#74a8df', rim: '#273e62' },
  gold: { label: 'Old gold', iris: '#d2b047', rim: '#55450f' }
};

export const PERSONALITIES = {
  observer: {
    label: 'Curious observer', mood: 'quietly curious',
    traits: { affectionate:.58, independent:.64, curious:.82, cautious:.47, playful:.73, energetic:.57, social:.55, mischievous:.68 }
  },
  shadow: {
    label: 'Devoted shadow', mood: 'seeking company',
    traits: { affectionate:.92, independent:.24, curious:.62, cautious:.30, playful:.67, energetic:.50, social:.92, mischievous:.42 }
  },
  firefly: {
    label: 'Fearless firefly', mood: 'ready to spring',
    traits: { affectionate:.62, independent:.52, curious:.96, cautious:.12, playful:.97, energetic:.94, social:.70, mischievous:.89 }
  },
  oldSoul: {
    label: 'Gentle old soul', mood: 'content and watchful',
    traits: { affectionate:.78, independent:.61, curious:.39, cautious:.46, playful:.24, energetic:.20, social:.66, mischievous:.16 }
  },
  wisp: {
    label: 'Cautious wisp', mood: 'carefully listening',
    traits: { affectionate:.47, independent:.70, curious:.69, cautious:.94, playful:.52, energetic:.48, social:.25, mischievous:.32 }
  }
};

export const NEED_DEFINITIONS = {
  hunger: { label: 'Hunger', tone: '#ffbd7e', inverse: false },
  thirst: { label: 'Thirst', tone: '#7ed9ff', inverse: false },
  energy: { label: 'Energy', tone: '#d6ff70', inverse: true },
  comfort: { label: 'Comfort', tone: '#d9b2ff', inverse: true },
  social: { label: 'Social', tone: '#ff9dc8', inverse: false },
  play: { label: 'Play', tone: '#fff080', inverse: false }
};

export const ACTION_LABELS = {
  observe: ['Surveying the habitat', 'Eyes, ears, and whiskers are sampling nearby motion.'],
  explore: ['Investigating remembered space', 'Choosing a low-effort route toward a novel scent.'],
  eat: ['Seeking food', 'Using the remembered bowl location and checking access.'],
  drink: ['Seeking water', 'Approaching the water bowl with a committed route.'],
  rest: ['Finding a secure resting place', 'Comparing warmth, height, and recent safety memories.'],
  play: ['Hunting moving prey', 'Predicting the toy trajectory instead of chasing its old position.'],
  social: ['Looking for company', 'Balancing affection, distance, and the most recent interaction.'],
  groom: ['Beginning a grooming sequence', 'Settling weight before cleaning the most uncomfortable region.'],
  litter: ['Seeking the litter tray', 'Following a familiar private route.'],
  scratch: ['Seeking a scratch surface', 'The cat tree has a strong remembered affordance.'],
  flee: ['Creating safe distance', 'A surprising event exceeded the current tolerance.'],
  investigate: ['Investigating a disturbance', 'Curiosity is competing with caution.'],
  jump: ['Committing to a jump', 'Evaluating clearance, landing area, and braking distance.'],
  pet: ['Responding to touch', 'Posture reflects touch location, duration, and tolerance.'],
};
