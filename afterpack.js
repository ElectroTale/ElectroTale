// Pose l'icône et les infos de version sur le .exe sans wine (resedit).
const { execFileSync } = require("child_process");
const path = require("path");
exports.default = async ctx => {
  if (ctx.electronPlatformName !== "win32") return;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".exe");
  execFileSync(process.execPath, [path.join(__dirname, "seticon.mjs"), exe, path.join(__dirname, "icon.ico")], { stdio: "inherit" });
};
