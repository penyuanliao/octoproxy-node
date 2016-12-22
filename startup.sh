#!/usr/bin/env bash

NOW=$(date +"%Y%m%d");
#export NODE_ENV='';
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

if [ "$1" == "admin" ]
then
    echo $1".js";
    pushd lib/
    sudo sh -c "node --nouse-idle-notification --always-compact remoteSrv.js >'/dev/null' 2>&1 &"
    popd
    exit;
fi
if [ "$1" == "forever=yes" ]
then
    echo $1".js";
    sudo sh -c 'sh node_forever.sh > "/dev/null" 2>&1 &'
    exit;
fi
# 建立資料夾
[ -d historyLog ] || mkdir historyLog
sleep 1
node --max-old-space-size=8192 --nouse-idle-notification --always-compact --expose-gc octoproxy.js -p 80 > "/dev/null" 2>&1 &