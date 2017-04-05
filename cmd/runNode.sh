#!/usr/bin/env bash

proc_name="MainLatte.js _Latte1";
proc_name2="MainProxy.js";
proc_name3="logSocket.js";
proc_name4="octoproxy.js";
proc_name5="gmSrv.js";
proc_name6="MainLatte.js candy";
proc_name7="MainLatte.js duo";
proc_sh1="node_forever.sh";

COLOR_RED="\033[0;31m";
COLOR_GREEN="\033[0;32m";
COLOR_YELLOW="\033[0;33m";
COLOR_BLUE="\033[0;34m";
COLOR_BLUE2="\033[1;34m";
COLOR_BG="\033[0;36m";
COLOR_END="\e[0m";

if [ -z $1 ]
then
    echo -e "Usage: \n runNode.sh [options]\n";
    echo -e "Please inputs of the variables [$COLOR_YELLOW start \e[0m], [$COLOR_YELLOW stop \e[0m]. ";

    exit 0

fi

if [ $1 == "stop" ]
then

    ps aux | grep "${proc_sh1}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name2}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name3}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name4}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name5}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name6}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    ps aux | grep "${proc_name7}" | awk '{print $2}'| xargs sudo /usr/bin/kill -9

    echo -e "Kill process has completed. [$COLOR_GREEN OK \e[0m]";

    ./backFile.sh
    echo -e "backFile $COLOR_BLUE[ Done ]$COLOR_END";

#echo -e "Push with sync from remote server 182 ..."
#rsync -av --exclude=*.log -e ssh ~/www Newflash@192.168.188.182:~/www

#echo -e "Push with sync from remote server 183 ..."
#rsync -av --exclude=*.log -e ssh ~/www Newflash@192.168.188.183:~/www

fi

if [ $1 == "start" ]
then

    PATH_ROOT="";
    if [ -d "www" ]; then
        PATH_ROOT="www/";
    fi


    pushd ${PATH_ROOT}'Latte'

    pid=$(ps -aef | grep "${proc_name}" | grep -v $0 | grep -v grep | awk '{print $2}');

    if [ "$pid" == "" ]
    then
        sh checkLatte.sh
        printf "$COLOR_BG $proc_name\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd

    pushd ${PATH_ROOT}'LatteProxy'

    pid=$(ps -aef | grep "${proc_name2}" | grep -v $0 | grep -v grep | awk '{print $2}');
    if [ "$pid" == "" ]
    then
        sh checkProxy.sh
        printf "$COLOR_BG $proc_name2\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name2\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd


    pushd ${PATH_ROOT}'FxCouchbase'

    pid=$(ps -aef | grep "${proc_name3}" | grep -v $0 | grep -v grep | awk '{print $2}');
    if [ "$pid" == "" ]
    then
        sudo sh startup.sh
        printf "$COLOR_BG $proc_name3\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name3\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd

    pushd ${PATH_ROOT}'octoproxy-node'

    pid=$(ps -aef | grep "${proc_name4}" | grep -v $0 | grep -v grep | awk '{print $2}');
    if [ "$pid" == "" ]
    then
        sudo sh startup.sh
        sleep 1;
        sudo sh -c 'sh node_forever.sh > "./historyLog/node_forever.log" 2>&1 &'
        printf "$COLOR_BG $proc_name4\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name4\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd

    pushd ${PATH_ROOT}'gm_sys'

    pid=$(ps -aef | grep "${proc_name5}" | grep -v $0 | grep -v grep | awk '{print $2}');
    if [ "$pid" == "" ]
    then
        sudo sh run_port25.sh
        printf "$COLOR_BG $proc_name5\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name5\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd

    pushd ${PATH_ROOT}'Latte'

    pid=$(ps -aef | grep "${proc_name6}" | grep -v $0 | grep -v grep | awk '{print $2}');

    if [ "$pid" == "" ]
    then
        sh checkCandyLatte.sh
        printf "$COLOR_BG $proc_name6\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name6\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd

    pushd ${PATH_ROOT}'Latte'

    pid=$(ps -aef | grep "${proc_name7}" | grep -v $0 | grep -v grep | awk '{print $2}');

    if [ "$pid" == "" ]
    then
        sh checkDuoLatte.sh
        printf "$COLOR_BG $proc_name7\e[0m server was running ... successfully [$COLOR_GREEN OK \e[0m]\n";
    else
        printf "$COLOR_BG $proc_name7\e[0m server is already running ... [$COLOR_RED failed \e[0m]\n";
    fi

    popd



    echo -e "------------ $COLOR_BLUE[ Done ]$COLOR_END ---------------";

fi
