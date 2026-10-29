#!/bin/bash
# Construit ElectroTale pour Windows (x64) avec le moteur intégré.
set -e
cd "$(dirname "$0")"
ROOT=$PWD
STAGE="${TMPDIR:-/tmp}/electrotale-build/app"
VERSION=$(node -p 'require("./package.json").version')
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -r main.js preload.js contenu.js telephone.js app engines "$STAGE"/
node -e '
const p=require("./package.json");
const o={name:p.name,productName:p.productName,version:p.version,description:p.description,main:p.main,author:p.author,license:p.license,dependencies:p.dependencies};
require("fs").writeFileSync(process.argv[1],JSON.stringify(o,null,2));' "$STAGE/package.json"
cd "$STAGE"
NODE_LLAMA_CPP_SKIP_DOWNLOAD=true npm install --omit=dev --os=win32 --cpu=x64 --ignore-scripts --no-audit --no-fund
# on garde Vulkan (Intel/AMD/NVIDIA) + processeur ; pas CUDA (trop lourd)
rm -rf node_modules/@node-llama-cpp/win-x64-cuda* node_modules/@node-llama-cpp/*linux* node_modules/@node-llama-cpp/mac* node_modules/@node-llama-cpp/win-arm64
rm -rf node_modules/node-llama-cpp/llama/llama.cpp node_modules/node-llama-cpp/templates 2>/dev/null || true
ls node_modules/@node-llama-cpp node_modules/@stable-diffusion-cpp-node-api; ls -d node_modules/sherpa-onnx-*
du -sh node_modules
# voix Kokoro (française ff_siwis) livrée dans l'installateur : téléchargée une fois, gardée en cache
KOKORO=~/.cache/electrotale/kokoro-multi-lang-v1_0.tar.bz2
mkdir -p ~/.cache/electrotale
[ -s "$KOKORO" ] || curl -fL -o "$KOKORO" https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2
mkdir -p voix && tar -xjf "$KOKORO" -C voix
du -sh voix
node "$ROOT/collect-licences.js" "$STAGE"
cd "$ROOT"
rm -rf dist/ElectroTale-win32-x64
npx @electron/packager "$STAGE" ElectroTale --platform=win32 --arch=x64 --out=dist --overwrite --no-asar --no-prune --icon=icon.ico --electron-version=33.4.11 --app-copyright="Béryl" --win32metadata.CompanyName="Béryl" --win32metadata.ProductName=ElectroTale --win32metadata.FileDescription=ElectroTale
node seticon.mjs dist/ElectroTale-win32-x64/ElectroTale.exe icon.ico
MAKENSIS=~/.cache/electron-builder/nsis/nsis-3.0.4.1/linux/makensis
[ -x "$MAKENSIS" ] || MAKENSIS=makensis   # sinon celui du système (paquet « nsis »)
"$MAKENSIS" -V2 -DVERSION="$VERSION" installer.nsi
ls -la ElectroTale-Installation.exe
