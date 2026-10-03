# Vértice Arena

FPS 3D multijugador para navegador, con bots controlados por IA. Diseño, mapas, armas,
personajes y nombres originales. Cliente en **JavaScript + Three.js**, servidor
**Node.js** con **WebSockets** y simulación autoritativa.

## Cómo jugar

Requisitos: Node.js 18 o superior. No hace falta `npm install`: el proyecto no tiene
dependencias externas (Three.js r170 viene incluido en `client/vendor/`).

```bash
npm start
```

Abre <http://localhost:3000> en Chrome, Edge o Firefox (con teclado y ratón).

- **Jugar contra bots**: elige modo, mapa, número de bots, dificultad y arma, y la
  partida empieza al instante.
- **Con amigos**: *Crear sala con amigos* genera un código de 5 letras. Tus amigos abren
  la dirección que muestra la consola del servidor (por ejemplo `http://192.168.1.20:3000`)
  y pulsan *Unirse con código*. Las plazas vacías se rellenan con bots; si alguien entra
  con la partida empezada, ocupa el sitio de un bot.
- Para jugar por Internet, despliega el servidor en cualquier hosting de Node con
  WebSockets (Render, Railway, Fly.io, un VPS…) o abre el puerto 3000 de tu router.
  El puerto se cambia con `PORT=8080 npm start`.
- Si el cliente no encuentra servidor WebSocket, pasa a **modo local**: las salas se
  ejecutan en el propio navegador y sólo están disponibles las partidas contra bots.

### Controles

| Tecla | Acción |
|---|---|
| W A S D | Moverse |
| Ratón | Mirar |
| Clic izquierdo / derecho | Disparar / apuntar |
| Mayús | Esprintar |
| Espacio | Saltar (las cajas bajas se pueden saltar) |
| C | Agacharse |
| R | Recargar |
| 1 · 2 · 3 o rueda | Arma principal, pistola, cuchillo |
| Q | Arma anterior |
| Tab | Clasificación |
| Esc | Pausa |
| 1–6 estando eliminado | Elegir arma principal para la siguiente vida |

## Contenido

**Modos**: Team Deathmatch, Free For All, Gun Game (2 bajas por nivel, 8 niveles, el
cuchillo final da la victoria y hace bajar de nivel a la víctima) y TDM contra bots.

**Mapas**: *Patio Cobalto* (tres carriles y patio central) y *Refinería Ámbar*
(industrial, abierto, con tanques y largas líneas de visión). Ambos son simétricos
para que ningún equipo tenga ventaja.

**Armas**: Kestrel AR-7 (fusil), Brisa SMG, Trueno 12 (escopeta), Halcón LR
(francotirador), Vespa BR (ráfagas), Mazo LMG, Aguja P9 (pistola) y Colmillo
(cuchillo, letal por la espalda). Cada una con daño por distancia, multiplicador a la
cabeza, dispersión que crece al moverte, saltar o disparar seguido, retroceso, tiempo
de apuntado y recarga.

**Gameplay**: vida con regeneración, headshots, hitmarkers (rojos al matar, ámbar en la
cabeza), kill feed, indicadores de daño direccional, minimapa (los enemigos aparecen al
disparar), mira dinámica, mira telescópica, protección de aparición, sonido sintetizado
y posicional, trazadoras, impactos y marcas de bala.

**Fin de partida**: ganador, tabla con bajas, muertes, K/D, asistencias, puntuación,
precisión, disparos a la cabeza y daño de jugadores y bots; *Jugar otra vez* (lo decide
el anfitrión) y *Volver al menú*.

## Bots

Los bots se ejecutan en el servidor y generan exactamente los mismos comandos de
entrada que un jugador humano (moverse, apuntar, disparar, recargar, cambiar de arma),
así que respetan las mismas reglas de física, munición y daño.

- **Navegación**: rejilla de navegación derivada del mapa + A* con coste extra junto a
  las paredes y suavizado de ruta. Rutas alternativas pasando por puntos intermedios,
  detección de atascos (salto, desvío, recálculo). Una prueba automática verifica que
  un bot llega a todas las celdas transitables de ambos mapas.
- **Percepción honesta**: sólo ven lo que está dentro de su campo de visión, a su
  distancia de visión y con línea de visión libre (cabeza o torso). Notar a alguien
  lleva un tiempo de reacción que depende de la distancia, de si se mueve, dispara o va
  agachado, y de si está en la visión periférica. Oyen disparos y pasos con un error de
  posición. Reaccionan al recibir daño o a balas que pasan cerca girándose hacia la
  dirección aproximada. Nunca disparan sin línea de visión.
- **Decisiones**: patrullar, defender o atacar zonas según su rol, combatir con
  movimiento lateral, buscar cobertura (alta o baja, desde la que poder asomarse),
  flanquear cuando un compañero ya está combatiendo, perseguir la última posición
  conocida, investigar ruidos, emboscar, retirarse a cubierto para regenerar,
  recargar a cubierto, cambiar a la pistola cuando se quedan sin balas cerca del enemigo.
- **Personalidades** (Asalto, Táctico, Tirador, Apoyo) y pequeñas variaciones
  individuales, para que no haya dos bots iguales.

| | Fácil | Normal | Difícil | Experto |
|---|---|---|---|---|
| Reacción | ~0,8 s | ~0,45 s | ~0,3 s | ~0,2 s |
| Campo / distancia de visión | 95° / 32 m | 110° / 48 m | 120° / 60 m | 130° / 70 m |
| Puntería | error grande, mal seguimiento | buena | mejor, ráfagas controladas | muy buena, controla el retroceso |
| Cobertura | casi nunca | a veces | a menudo | casi siempre |
| Flanqueo | no | a veces | sí | sí, coordinado |
| Otros | dudan, rutas torpes | | comparten avistamientos, se reposicionan | emboscan, priorizan objetivos, piden apoyo, recargan en pausas |

La dificultad **no** toca la vida ni el daño de los bots: sólo percepción, puntería y
decisiones. En las pruebas, un equipo mixto muestra a los expertos dominando a los
fáciles con la misma arma y la misma vida.

## Red

- El servidor simula a 30 Hz y envía snapshots a 20 Hz. Controla posiciones, disparos,
  daño, muertes, reapariciones, puntuación y estado de la partida.
- El cliente predice su movimiento y su arma a 60 Hz con el mismo código que el
  servidor (`shared/`) y se reconcilia al recibir cada snapshot, suavizando las
  correcciones. La dispersión de cada disparo usa una semilla compartida, así que
  cliente y servidor calculan la misma trayectoria.
- Las entidades remotas se interpolan con 100 ms de retraso. El servidor compensa la
  latencia rebobinando las posiciones de los objetivos al validar disparos (máx. 300 ms).
- Protección básica: presupuesto de tiempo por jugador (evita acelerar el reloj),
  cadencia, munición y daño calculados por el servidor.

## Rendimiento

- IA por intervalos escalonados (percepción cada 0,1–0,3 s, decisiones cada 0,2–0,6 s
  según la dificultad); sólo el movimiento y la puntería se actualizan cada tick.
- En las pruebas, una partida de 8 bots cuesta de media unos 0,03–0,15 ms por tick
  del servidor.
- Render: geometría instanciada para el mapa, LOD de personajes a distancia, pools de
  trazadoras, partículas, marcas de bala y fogonazos, una sola luz de fogonazo
  reutilizada. Sombras y resolución de render ajustables en *Ajustes*.

## Estructura

```
server/
  index.js          Servidor HTTP estático + WebSocket + bucle de simulación
  websocket.js      Implementación mínima de WebSocket (RFC 6455)
shared/             Código común a servidor y cliente
  constants.js      Constantes, modos, botones
  weapons.js        Arsenal y escalera de Gun Game
  maps.js           Mapas en ASCII (simetría rotacional)
  MapData.js        Colisiones, raycast 3D, puntos de cobertura, spawns, zonas
  physics.js        Movimiento determinista e hitboxes (cabeza / cuerpo)
  nav.js            Rejilla de navegación y A*
  game/
    Room.js         Sala autoritativa: entradas, disparos, daño, snapshots
    RoomManager.js  Crear / unirse / partida rápida
    Bot.js          Cerebro de los bots
    difficulty.js   Parámetros por dificultad y personalidades
    modes.js        Reglas de cada modo
    combat.js       Estado de armas y dispersión con semilla
client/
  index.html, css/style.css
  vendor/three.module.js (Three.js r170, licencia MIT)
  js/main.js        Menús, sala de espera, pantalla final
  js/net.js         WebSocket o salas locales en el navegador
  js/game/          Game (predicción, interpolación), Input
  js/render/        World, Characters, ViewModel, Effects
  js/audio/         Sonido sintetizado
  js/ui/            HUD
test/
  map-test.js       Validación de mapas y rutas
  sim-test.js       Partidas completas sólo con bots + alcance de todo el mapa
  net-test.js       Extremo a extremo por WebSocket
  browser/          Pruebas en Chromium (Playwright)
```

## Pruebas

```bash
npm test               # mapas, simulación de partidas con bots y red
npm run test:browser   # cliente en Chromium (requiere Python + Playwright)
```

## Cómo ampliar

- **Nuevo mapa**: añade una entrada en `shared/maps.js` dibujando la mitad norte; la
  otra mitad se genera por simetría. Coberturas, navegación y spawns se calculan solos.
  `node test/map-test.js` comprueba que todo es alcanzable.
- **Nueva arma**: añade una entrada en `shared/weapons.js` (y en `PRIMARIES` o
  `GUN_LADDER`). El modelo en primera persona se genera a partir de `model` y `kind`.
- **Comportamiento de bots**: ajusta `shared/game/difficulty.js` o los estados en
  `shared/game/Bot.js`.
