#!/usr/bin/env bash

NOW=$(date +"%Y%m%d");
#export NODE_ENV='';
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

if [ "$1" == "forever" ]
then
    echo $1".js";
    sh ./cmd/"node_"$1".sh";
fi

# 建立資料夾
[ -d historyLog ] || mkdir historyLog

node --max-old-space-size=8192 --nouse-idle-notification --always-compact --expose-gc FxLiveMaster.js -p 80 > "/dev/null" 2>&1 &