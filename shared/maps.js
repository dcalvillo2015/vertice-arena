// Mapas originales definidos en ASCII. Cada celda mide CELL (2 m).
// Sólo se dibuja la mitad norte (lado del equipo B); la mitad sur se genera
// con simetría rotacional de 180° para que ambos equipos tengan el mismo terreno.
//
// Leyenda:
//   #  muro alto (4.5 m)          C  caja baja (1 m, se puede saltar y sirve de cobertura agachado)
//   H  caja alta (2.2 m)          .  suelo
//   B  spawn equipo B             A  spawn equipo A (generado por simetría)
//   S  spawn extra (FFA)          P  punto de patrulla
//   Z  zona estratégica (ataque/defensa)

function mirror(half) {
  const swap = { A: 'B', B: 'A' };
  const bottom = half.slice().reverse().map((row) =>
    row.split('').reverse().map((ch) => swap[ch] || ch).join(''));
  return half.concat(bottom);
}

export const MAPS = {
  patio: {
    id: 'patio',
    name: 'Patio Cobalto',
    description: 'Mapa compacto de tres carriles con patio central. Ideal para 4–8 jugadores.',
    theme: { floor: 0x8a8f99, wall: 0xc9cdd6, wallTop: 0x6f7c99, crate: 0x8a6a46, tall: 0x5b6d8a, sky: 0x9fc4e8, fog: 0xb8cde3, accent: 0x4fa3ff },
    rows: mirror([
      '################################',
      '#......#....B.BB.B....#........#',
      '#......#..............#........#',
      '#..P...#....C....C....#...P....#',
      '#......####..........###.......#',
      '#.........#..........#.........#',
      '#..CC.....#...H..H...#....CC...#',
      '####..##..#..........#..##..####',
      '#.....##........Z.......##.....#',
      '#..P......CC........CC......P..#',
      '#...........##....##...........#',
      '###..H......#......#......H..###',
      '#.....#....................#...#',
      '#.....#.....C...P...C......#...#',
      '#..S..####......##......####.S.#',
      '#......C.......HH.......C......#',
    ]),
  },
  refineria: {
    id: 'refineria',
    name: 'Refinería Ámbar',
    description: 'Complejo industrial abierto con tanques y largas líneas de visión.',
    theme: { floor: 0x9a8a72, wall: 0xb9a888, wallTop: 0x7a5f3a, crate: 0x6e5a3c, tall: 0x8a4f2a, sky: 0xf2c48d, fog: 0xe8c9a0, accent: 0xffa94d },
    rows: mirror([
      '################################',
      '#B.B.B.........#..............S#',
      '#..B.B.........#.....CC.......P#',
      '#..............#.....CC........#',
      '#...CC...P.....H...............#',
      '#...CC......................HH.#',
      '#........######.............HH.#',
      '#..HH.......#........CC........#',
      '#..HH...P...#...Z....CC....P...#',
      '#............#.................#',
      '#.....CC.............H.........#',
      '####......HH.....C.........C...#',
      '#.........HH...........######..#',
      '#..P...C..............C........#',
      '#......#####......C.....P......#',
      '#..........C.........H.........#',
    ]),
  },
};

export const MAP_LIST = Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, description: m.description }));
