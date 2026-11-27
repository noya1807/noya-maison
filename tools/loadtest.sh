#!/bin/bash
i=$1; B=https://build.noyaglobal.com
case $((i%5)) in
 0) u="$B/";;
 1) u="$B/api/office?a=showcase";;
 2) u="$B/api/office?a=jackpot";;
 3) u="$B/gifts/";;
 4) curl -s -o /dev/null -w "inbox %{http_code} %{time_total}\n" --max-time 30 -H 'Content-Type: application/json' -d "{\"ref\":\"NOYA-LOADTEST-$i\",\"customer\":{\"name\":\"load\"},\"boxes\":50,\"items\":[[1,\"x\",1,10]]}" "$B/api/office?a=inbox"; exit;;
esac
curl -s -o /dev/null -w "get %{http_code} %{time_total}\n" --max-time 30 "$u"
