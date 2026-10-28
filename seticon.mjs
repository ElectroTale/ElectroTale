import * as ResEdit from "resedit";
import * as PELibrary from "pe-library";
import fs from "fs";
const exe = process.argv[2], ico = process.argv[3];
const data = fs.readFileSync(exe);
const e = PELibrary.NtExecutable.from(data, { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(e);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, iconFile.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: "ElectroTale", ProductName: "ElectroTale", CompanyName: "Béryl", OriginalFilename: "ElectroTale.exe" });
  vi.setFileVersion(1, 0, 0, 0, 1033); vi.setProductVersion(1, 0, 0, 0, 1033);
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(e);
fs.writeFileSync(exe, Buffer.from(e.generate()));
console.log("icon set");
