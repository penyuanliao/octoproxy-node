#!/usr/bin/env bash

exec_pkg=$(which pkg);

HOME="./bin";

output_path="${HOME}/Release/";

output_name="octoproxy";

#platform="node8-linux-x64";
platform="node8-macos-x64";

echo "Check pkg has install...";

if [ "exec_pkg" == "" ]
then
    echo "pkg not found.";

    echo "installing pkg in the directory..."

    npm install -g pkg;
fi

echo "Start Build Node pkg..."

if [ ! -d ${output_path} ]; then
    mkdir -p ${output_path};
fi

#cp -f ./FLVMuxerDef.json ${HOME}

if [ ! -d "${HOME}/configuration" ]; then
    echo "Create ${HOME}/configuration folder.";
    mkdir -p ${HOME}/configuration;
fi

pkg -t ${platform} package.json --options max-old-space-size=8192,nouse-idle-notification,always-compact,expose-gc --out-path ${output_path}

pushd bin/

#docker build -t video-app .

popd

exit;