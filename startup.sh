#!/usr/bin/env bash

NOW=$(date +"%Y%m%d");

export NODE_ENV='DEV';
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

node FxLiveMaster.js -p 80 > "/home/Newflash/www/${NOW}_log.log" 2>&1 &