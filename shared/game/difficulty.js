// Parámetros de IA por dificultad. La dificultad cambia la percepción, la puntería y
// la toma de decisiones; NUNCA la vida ni el daño de los bots.

export const DIFFICULTY = {
  easy: {
    reaction: 0.8, perceiveInt: 0.3, thinkInt: 0.6, fov: 95, viewDist: 32, hearing: 0.55,
    turnSpeed: 2.4, aimErrInit: 0.17, aimErrMin: 0.05, aimErrDecay: 0.5, trackPenalty: 0.04,
    fireTol: 2.8, headChance: 0.03, cover: 0.05, flank: 0, strafe: 0.15, chase: 0.25,
    retreatHp: 0.2, retreatChance: 0.15, reloadAt: 0, switchOnEmpty: false, burstControl: false,
    recoilControl: 0.15, useIntel: false, coordinate: false, ambush: 0, reposition: 0,
    memory: 2.5, semiRate: 2.0, noiseErr: 9, sprint: 0.15, smartPath: false, hesitate: 0.25,
    prefersHeadHeight: false, predict: 0,
  },
  normal: {
    reaction: 0.45, perceiveInt: 0.2, thinkInt: 0.4, fov: 110, viewDist: 48, hearing: 0.85,
    turnSpeed: 4.2, aimErrInit: 0.1, aimErrMin: 0.024, aimErrDecay: 1.2, trackPenalty: 0.02,
    fireTol: 2.0, headChance: 0.1, cover: 0.3, flank: 0.35, strafe: 0.55, chase: 0.5,
    retreatHp: 0.3, retreatChance: 0.4, reloadAt: 0.2, switchOnEmpty: false, burstControl: false,
    recoilControl: 0.5, useIntel: false, coordinate: false, ambush: 0.05, reposition: 0.1,
    memory: 4, semiRate: 3.0, noiseErr: 5, sprint: 0.7, smartPath: true, hesitate: 0.08,
    prefersHeadHeight: false, predict: 0,
  },
  hard: {
    reaction: 0.3, perceiveInt: 0.13, thinkInt: 0.28, fov: 120, viewDist: 60, hearing: 1.0,
    turnSpeed: 6.0, aimErrInit: 0.07, aimErrMin: 0.014, aimErrDecay: 2.0, trackPenalty: 0.012,
    fireTol: 1.6, headChance: 0.22, cover: 0.6, flank: 0.55, strafe: 0.85, chase: 0.7,
    retreatHp: 0.35, retreatChance: 0.65, reloadAt: 0.3, switchOnEmpty: true, burstControl: true,
    recoilControl: 0.7, useIntel: true, coordinate: false, ambush: 0.2, reposition: 0.35,
    memory: 5, semiRate: 3.8, noiseErr: 3, sprint: 0.9, smartPath: true, hesitate: 0,
    prefersHeadHeight: true, predict: 0.5,
  },
  expert: {
    reaction: 0.2, perceiveInt: 0.1, thinkInt: 0.2, fov: 130, viewDist: 70, hearing: 1.15,
    turnSpeed: 8.0, aimErrInit: 0.05, aimErrMin: 0.009, aimErrDecay: 2.8, trackPenalty: 0.008,
    fireTol: 1.35, headChance: 0.35, cover: 0.85, flank: 0.75, strafe: 1.0, chase: 0.8,
    retreatHp: 0.4, retreatChance: 0.85, reloadAt: 0.45, switchOnEmpty: true, burstControl: true,
    recoilControl: 0.85, useIntel: true, coordinate: true, ambush: 0.45, reposition: 0.55,
    memory: 6, semiRate: 4.2, noiseErr: 2, sprint: 1.0, smartPath: true, hesitate: 0,
    prefersHeadHeight: true, predict: 1,
  },
};

// Personalidades: varían el estilo de juego dentro de la misma dificultad.
export const PERSONALITIES = {
  asalto: { label: 'Asalto', rangeMul: 0.7, chase: 0.2, cover: -0.15, flank: 0.1, primaries: ['brisa', 'trueno', 'kestrel'] },
  tactico: { label: 'Táctico', rangeMul: 1.0, chase: 0, cover: 0.15, flank: 0.15, primaries: ['kestrel', 'vespa'] },
  tirador: { label: 'Tirador', rangeMul: 1.6, chase: -0.3, cover: 0.1, flank: -0.1, primaries: ['halcon', 'vespa'] },
  apoyo: { label: 'Apoyo', rangeMul: 1.1, chase: -0.1, cover: 0.05, flank: 0, primaries: ['mazo', 'kestrel'] },
};

export const BOT_NAMES = [
  'Orión', 'Lince', 'Nébula', 'Garra', 'Cobre', 'Sombra', 'Ráfaga', 'Quásar', 'Brasa', 'Tundra',
  'Vector', 'Halo', 'Pixel', 'Estela', 'Cometa', 'Niebla', 'Ónix', 'Delta', 'Zafiro', 'Trueno',
  'Kairo', 'Lumen', 'Soto', 'Vega', 'Ceniza', 'Rayo', 'Bruma', 'Talud', 'Fénix', 'Sable',
];
