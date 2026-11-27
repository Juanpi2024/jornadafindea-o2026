#!/bin/sh

# El JSON de evaluación manda: app.js se regenera desde él antes de sellar.
python3 "$(dirname "$0")/sincroniza-evaluacion.py" || exit 1
# Sella la versión antes de publicar: cambia el ?v= de los archivos y deja a la
# vista la fecha, para poder comprobar de un vistazo qué versión se está viendo.
V=$(date +%d%H%M)
F=$(TZ=America/Santiago date "+%d-%b %H:%M")
sed -i "s/app\.css?v=[0-9]*/app.css?v=$V/; s/app\.js?v=[0-9]*/app.js?v=$V/" index.html
sed -i "s/<span id=\"sello\">[^<]*<\/span>/<span id=\"sello\">v. $F<\/span>/" index.html
echo "sellado: v=$V · $F"
