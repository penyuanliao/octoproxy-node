#!/usr/bin/env bash

PROJECT=$1

exec_pkg=$(which pkg);

HOME="./bin";

output_path="${HOME}/Release/";

output_name="octoproxy";

#platform="node8-linux-x64";
platform="node8-macos-x64";

v8_options="max-old-space-size=8192,nouse-idle-notification,always-compact,expose-gc"

if [ "$(uname)" == "Darwin" ]; then
    md5="md5";
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    md5="md5sum";
fi

echo "Check pkg has install...";

if [ "exec_pkg" == "" ]; then
    echo "pkg not found.";

    echo "installing pkg in the directory..."

    npm install -g pkg;
fi

echo "Start Build Node pkg "

if [ ! -d ${output_path} ]; then
    mkdir -p ${output_path};
fi

if [ ! -d "${output_path}/historyLog" ]; then
    mkdir -p "${output_path}/historyLog";
fi

#cp -f ./FLVMuxerDef.json ${HOME}

if [ ! -d "${HOME}/configuration" ]; then
    echo "Create ${HOME}/configuration folder.";
    mkdir -p ${HOME}/configuration;
fi

echo "[INFO] Building Node.js Projects without PKG.";
echo "[INFO]  (1/3)task-segment: [execution:pkg] (octoproxy.node)";
pkg -t ${platform} package.json --options ${v8_options} --out-path ${output_path};

echo "[INFO]    -> copy: configuration/Assign.json -> ${HOME}/configuration";
cp -f ../configuration/Assign.json ${HOME}/configuration;

echo "[INFO]    -> copy: configuration/OctoProxy.json -> ${HOME}/configuration";
cp -f ../configuration/OctoProxy.json ${HOME}/configuration;

echo "[INFO]    -> copy: configuration/IPFilter.json -> ${HOME}/configuration";
cp -f ../configuration/IPFilter.json ${HOME}/configuration;
echo "[INFO]    $(${md5} ${output_path}/octoproxy)";

# building remote server
if [ ! -d "${output_path}/lib" ]; then
    mkdir -p "${output_path}/lib";
fi

echo "[INFO]  (2/3)task-segment: [execution:pkg] (remoteSrv.node)";
pkg -t ${platform} ./lib/remoteSrv.js --options ${v8_options} --out-path ${output_path}/lib;
echo "[INFO]    $(${md5} ${output_path}/lib/remoteSrv)";

# build bridgeSrv.js
echo "[INFO]  (3/3)task-segment: [execution:pkg] (FxBridgeSrv.node)"; #--output ${output_path}/FxBridgeSrv.node
pkg -t ${platform} ./FxBridgeSrv.js --options ${v8_options} --out-path ${output_path};
echo "[INFO]    $(${md5} ${output_path}/FxBridgeSrv)";

echo "[INFO] PKG Build Completed.";
echo "[INFO] -----------------------------------";
echo "[INFO] Building PKG File without Docker.";

pushd bin/

#docker build -t video-app .

popd

echo "[INFO] Docker Build Completed.";
echo "[INFO] -----------------------------------";
exit;

