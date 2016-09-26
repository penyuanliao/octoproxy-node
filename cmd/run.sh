#!/usr/bin/env bash

NOW=$(date +"%Y%m%d");
export NODE_ENV='DEV';
export DEBUG_FD=3;
export DEBUG="rtmp:*,daemon,Connect";

srv_file="octoproxy.js";

if [ "$1" == "restart" ]
then
    pid=$(ps -aef | grep $srv_file | grep -v $0 | grep -v grep | awk '{print $2}');

    if [ "$pid" != "" ]
    then

    kill -9 $pid

    echo "kill PID:$pid successful";

    sleep 1
    ps $pid

    else

    echo "PID is NULL";

    fi

    isDel=$();


fi

if [ "$1" == "stop" ]
then
    pid=$(ps -aef | grep $srv_file | grep -v $0 | grep -v grep | awk '{print $2}');

    if [ "$pid" != "" ]
    then

    kill -9 $pid

    echo "kill PID:$pid successful";
    fi
fi

if [ "$1" == "clean" ]
then

find . -type f -name "*.log" -exec rm -f {} \;

fi


if [ "$1" == "restart" ] || [ "$1" == "start" ]
then

# 建立資料夾
[ -d historyLog ] || mkdir historyLog

node --max-old-space-size=8192 --nouse-idle-notification --always-compact --expose-gc FxLiveMaster.js -p 80 > "/dev/null" 2>&1 &

pid=$(ps -aef | grep $srv_file | grep -v $0 | grep -v grep | awk '{print $2}');

echo "running node $pid process sucessful.";

fi

verify_port_listen() {
port=$1;
PROCESS_NUM=$(netstat -lnt | awk 'NR>2{print $4}' | grep -E "0.0.0.0:$1" | sed 's/.*://' | sort -n | uniq)
echo $PROCESS_NUM;
}
if [ -z $( verify 80 ) ]
then
echo -e "port 80 not runing";
else
echo -e "port 80 is listen";
fi


# remove find file
# find . -name '*.log' -exec rm -f {} \;