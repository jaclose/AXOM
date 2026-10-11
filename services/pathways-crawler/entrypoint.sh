#!/bin/sh
set -eu
if [ -f /input/application-schools.json ]; then
 python /app/crawler.py --db /data/crawler.sqlite bootstrap /input/application-schools.json --allow-private-capture
fi
exec python /app/crawler.py --db /data/crawler.sqlite serve --bind 0.0.0.0
