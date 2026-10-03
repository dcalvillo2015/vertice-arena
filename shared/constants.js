// Constantes compartidas por servidor y cliente.

export const TICK_RATE = 30;          // simulación del servidor (Hz)
export const SNAPSHOT_RATE = 20;      // snapshots enviados a clientes (Hz)
export const CLIENT_STEP = 1 / 60;    // paso fijo de predicción del cliente
export const INTERP_DELAY = 0.1;      // retraso de interpolación de entidades remotas (s)
export const MAX_LAG_COMP = 0.3;      // rebobinado máximo para compensación de lag (s)

export const CELL = 2;                // tamaño de celda del mapa (m)

export const PLAYER = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  standEye: 1.62,
  crouchEye: 1.0,
  walk: 5.2,
  sprint: 7.6,
  crouchSpeed: 2.6,
  adsSpeed: 3.2,
  jumpVel: 6.6,
  gravity: 18,
  accelGround: 55,
  accelAir: 10,
  step: 0.3,
};

export const HEALTH = { max: 100, regenDelay: 5, regenRate: 25 };
export const RESPAWN_TIME = 3;
export const SPAWN_PROTECT = 1.5;

export const TEAM = { NONE: -1, A: 0, B: 1 };
export const TEAM_NAMES = ['Cobalto', 'Ámbar'];

export const MODES = {
  TDM: 'tdm',
  FFA: 'ffa',
  GUN: 'gungame',
  TDM_BOTS: 'tdm_bots',
};

export const MODE_INFO = {
  tdm: { name: 'Team Deathmatch', teams: true, scoreLimit: 50, timeLimit: 600 },
  ffa: { name: 'Free For All', teams: false, scoreLimit: 20, timeLimit: 600 },
  gungame: { name: 'Gun Game', teams: false, scoreLimit: 0, timeLimit: 600 },
  tdm_bots: { name: 'TDM contra bots', teams: true, scoreLimit: 40, timeLimit: 600 },
};

// Botones del comando de entrada (bitmask).
export const BTN = {
  JUMP: 1,
  CROUCH: 2,
  SPRINT: 4,
  ADS: 8,
  FIRE: 16,
};

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];
export const DIFFICULTY_NAMES = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil', expert: 'Experto', mixed: 'Mixta' };
