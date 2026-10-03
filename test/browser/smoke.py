# Prueba de humo del cliente en Chromium sin GPU: Three.js se sustituye por un stub,
# así que se valida la lógica (menús, red, predicción, HUD, fin de partida), no el render.
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHROME = next((c for c in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(c)), None)
PORT = 3998
STUB = open(os.path.join(ROOT, 'test', 'browser', 'three-stub.mjs')).read()
LOCAL_ONLY = '--local' in sys.argv

async def main():
    srv = None
    if True:
        srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE)
        time.sleep(0.8)
    errors = []
    ok = True
    def check(cond, label):
        nonlocal ok
        print(('✔ ' if cond else '✘ ') + label)
        if not cond: ok = False
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        page = await b.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e) + ' @ ' + (e.stack or '')[:600]))
        await page.route('**/vendor/three.module.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=STUB))
        await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        if LOCAL_ONLY:
            async def kill_ws(ws):
                await ws.close()
            await page.route_web_socket('**/ws', kill_ws)
        await page.goto(f'http://localhost:{PORT}/')
        await page.wait_for_function("document.getElementById('conn-status').className.includes('ok') || document.getElementById('conn-status').className.includes('local')", timeout=8000)
        status = await page.text_content('#conn-status')
        check(True, f'menú cargado — {status}')
        await page.fill('#player-name', 'Tester')
        await page.click('text=Jugar contra bots')
        await page.click('#form-bots label:has-text("Free For All")')
        await page.click('#form-bots label:has-text("Experto")')
        await page.click('#form-bots button[type=submit]')
        await page.wait_for_function("window.app.game && window.app.game.phase === 'playing'", timeout=8000)
        n = await page.evaluate("window.app.game.roster.size")
        check(n == 6, f'partida iniciada con {n} participantes (1 + 5 bots)')
        # Forzar "pointer lock" y mover al jugador con W durante 1 s
        start = await page.evaluate("[window.app.game.ms.x, window.app.game.ms.z]")
        await page.evaluate("window.app.game.input.locked = true")
        await page.keyboard.down('KeyW')
        await page.wait_for_timeout(1000)
        await page.keyboard.up('KeyW')
        await page.wait_for_timeout(300)
        end = await page.evaluate("[window.app.game.ms.x, window.app.game.ms.z, window.app.game.pending.length, window.app.game.corrections || 0]")
        check(end[3] <= 3, f'predicción coherente con el servidor ({end[3]} correcciones > 5 cm)')
        moved = ((end[0]-start[0])**2 + (end[1]-start[1])**2) ** 0.5
        check(moved > 2 or not await page.evaluate("window.app.game.alive"), f'predicción local + reconciliación: se movió {moved:.2f} m, comandos pendientes {end[2]}')
        # Disparar
        mag0 = await page.evaluate("window.app.game.ws.ammo[window.app.game.ws.slot][0]")
        await page.evaluate("window.app.game.input.mouse.left = true")
        await page.wait_for_timeout(400)
        await page.evaluate("window.app.game.input.mouse.left = false")
        await page.wait_for_timeout(300)
        mag1 = await page.evaluate("window.app.game.ws.ammo[window.app.game.ws.slot][0]")
        check(mag1 < mag0 or not await page.evaluate("window.app.game.alive"), f'disparo predicho y confirmado (cargador {mag0} → {mag1})')
        remotes = await page.evaluate("[...window.app.game.remote.values()].filter(r => r.buf.length > 3).length")
        check(remotes == 5, f'{remotes} entidades remotas interpoladas')
        await page.keyboard.down('Tab'); await page.wait_for_timeout(200)
        sb = await page.inner_text('#scoreboard')
        await page.keyboard.up('Tab')
        check('Todos contra todos' in sb and 'Tester' in sb, 'clasificación con Tab')
        timer = await page.inner_text('#hud-timer')
        check(':' in timer, f'HUD activo, temporizador {timer}')
        # Partida corta para comprobar la pantalla final
        await page.evaluate("window.app.leaveGame()")
        await page.evaluate("window.app.net.send({t:'quick', name:'Tester', primary:'kestrel', settings:{mode:'tdm_bots', mapId:'refineria', botCount:4, botDifficulty:'hard', timeLimit:60}})")
        await page.wait_for_function("window.app.game && window.app.game.phase === 'playing'", timeout=8000)
        teams = await page.evaluate("[...window.app.game.roster.values()].map(r => r.team + (r.bot ? 'b' : 'h')).join(',')")
        check(teams.count('1b') == 4 and '0h' in teams, f'TDM contra bots: equipos {teams}')
        await page.wait_for_selector('#screen-end.active', timeout=75000)
        banner = await page.inner_text('#end-banner')
        rows = await page.evaluate("document.querySelectorAll('#end-table tbody tr').length")
        check(rows == 5, f'pantalla final: "{banner.splitlines()[0]}" con {rows} filas de estadísticas')
        await page.click('#end-again')
        await page.wait_for_function("window.app.game && window.app.game.phase !== 'ended' && document.getElementById('game').classList.contains('active')", timeout=8000)
        check(True, 'Jugar otra vez reinicia la partida')
        await page.evaluate("window.app.leaveGame()")
        main_active = await page.evaluate("document.getElementById('screen-main').classList.contains('active')")
        check(main_active, 'Volver al menú')
        await b.close()
    if srv: srv.terminate()
    real = [e for e in errors if 'fonts.googleapis' not in e and 'ERR_FAILED' not in e and 'net::' not in e]
    check(not real, 'sin errores de JavaScript' + ('' if not real else ': ' + ' | '.join(real[:5])))
    sys.exit(0 if ok else 1)

asyncio.run(main())
