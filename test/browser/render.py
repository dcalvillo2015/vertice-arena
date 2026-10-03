# Captura pantallas reales (WebGL por software) del menú y de una partida.
import asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'screens')
CHROME = next((c for c in ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'] if os.path.exists(c)), None)
PORT = 3997
os.makedirs(OUT, exist_ok=True)

async def main():
    srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE)
    time.sleep(0.8)
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME,
                                    args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': 1280, 'height': 720})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e) + ' ' + (e.stack or '')[:400]))
        await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        await page.goto(f'http://localhost:{PORT}/')
        await page.wait_for_function("document.getElementById('conn-status').className.includes('ok')", timeout=8000)
        await page.wait_for_timeout(5000)
        await page.screenshot(path=f'{OUT}/1-menu.png')
        await page.click('text=Jugar contra bots')
        await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/2-bots.png')
        await page.click('#form-bots label:has-text("Team Deathmatch")')
        await page.click('#form-bots button[type=submit]')
        await page.wait_for_function("window.app.game && window.app.game.phase === 'playing'", timeout=10000)
        await page.evaluate("window.app.game.input.locked = true; document.getElementById('click-to-play').classList.remove('on')")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f'{OUT}/3-juego.png')
        await page.evaluate("window.app.game.input.mouse.right = true")
        await page.wait_for_timeout(500)
        await page.evaluate("window.app.game.input.mouse.left = true")
        await page.wait_for_timeout(120)
        await page.screenshot(path=f'{OUT}/4-apuntar-disparar.png')
        await page.evaluate("window.app.game.input.mouse.left = false; window.app.game.input.mouse.right = false")
        # Esperar combate entre bots y mirar hacia el centro del mapa
        await page.wait_for_timeout(9000)
        await page.screenshot(path=f'{OUT}/5-combate.png')
        await page.keyboard.down('Tab'); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{OUT}/6-clasificacion.png')
        await page.keyboard.up('Tab')
        fps = await page.evaluate("""() => new Promise(res => { let n = 0; const t0 = performance.now();
            const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); })""")
        info = await page.evaluate("JSON.stringify(window.app.renderer.info.render)")
        print('fps (render por software):', fps, 'render info:', info)
        await b.close()
    srv.terminate()
    real = [e for e in errors if 'fonts.googleapis' not in e and 'net::' not in e]
    print('errores:', real[:8] if real else 'ninguno')

asyncio.run(main())
