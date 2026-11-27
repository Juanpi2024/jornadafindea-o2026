#!/usr/bin/env python3
"""Copia evaluacion/contenido.json dentro de app.js.

El visor lee el JSON y la app necesita los mismos datos de forma síncrona.
Tener las dos copias a mano se desincroniza sola, así que el JSON manda y
esta línea de app.js se regenera desde él. La llama sello.sh en cada sello.
"""
import json, re, sys, pathlib

raiz = pathlib.Path(__file__).parent
d = json.loads((raiz / 'evaluacion/contenido.json').read_text(encoding='utf-8'))
# Las láminas y los audios solo los usa el visor: no viajan a app.js.
magro = {'vf': d['vf'], 'cases': d['cases']}
linea = 'const ACTIVIDADES_EVALUACION = ' + json.dumps(magro, ensure_ascii=False) + ';'

app = raiz / 'app.js'
texto = app.read_text(encoding='utf-8')
nuevo, n = re.subn(r'^const ACTIVIDADES_EVALUACION = .*;$', lambda _: linea, texto, count=1, flags=re.M)
if n != 1:
    sys.exit('No encontré la línea ACTIVIDADES_EVALUACION en app.js')
if nuevo != texto:
    app.write_text(nuevo, encoding='utf-8')
    print(f"app.js sincronizado · {len(d['vf'])} afirmaciones · {len(d['cases'])} casos")
else:
    print('ya estaba al día')
