#!/bin/bash
# stop server, restore pristine data, restart resumed server, wait until ready
cd /Users/iguppp/.openclaw/workspace/edupi-desktop
SP=$(cat mv/build/sp.txt)
pkill -f demo-runner2.mjs; pkill -f "next dev"; pkill -f next-server; sleep 3
rsync -a --delete /Users/iguppp/edupi-demo3-pristine/ /Users/iguppp/edupi-demo3/
export DEMO_ROOT=/Users/iguppp/edupi-demo3 DEMO_ASSETS=$SP/demo-assets
nohup node mv/demo-runner2.mjs --core $SP/core-pin2 --port 30373 --resume /Users/iguppp/edupi-demo3 > mv/build/runner.log 2>&1 &
for i in $(seq 1 60); do if curl -s -o /dev/null http://127.0.0.1:30373/api/home; then break; fi; sleep 2; done
echo "server up: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:30373/)"
