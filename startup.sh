#!/usr/bin/env bash

export NODE_ENV=development;
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

exec node FxLiveMaster.js