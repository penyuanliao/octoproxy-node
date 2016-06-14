#!/usr/bin/env bash

NOW=$(date +"%Y%m%d");




export NODE_ENV='DEV';
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

if [ "$1" != "" ]
then
    export NODE_ENV=$1;
fi

node FxLiveMaster.js -p 80 2>&1 &