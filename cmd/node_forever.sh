#!/bin/bash

# sudo crontab -e
# sudo vi /etc/crontab
# */5 **** root /folder


PROC_NAME="octoproxy.js";

COLOR_RED="\033[0;31m";
COLOR_GREEN="\033[0;32m";
COLOR_BG="\033[0;36m";

while :
do
    LISTEN_STATE=$(netstat -an | grep LISTEN | grep ':80 ' | wc -l);
    NOW=$(date +"%Y%m%d");
    if [ $LISTEN_STATE == 0 ]
    then
        echo -e "[$NOW] NodeJS Port 80 not listen...";

        pushd './'

            pid=$(ps -aef | grep $PROC_NAME | grep -v $0 | grep -v grep | awk '{print $2}');
            if [ "$pid" == "" ]
            then
                sh startup.sh
                printf "$COLOR_BG $PROC_NAME\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
            else
                printf "$COLOR_BG $PROC_NAME\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
            fi

        popd

    else

        #echo -e "[ $NOW ]port 80 is listening...";
        TRACE_LOG="[ $NOW ]::LISTEN::"

    fi

    sleep 3m

done

# sh ./cmd/node_forever.sh > "/dev/null" 2>&1 &