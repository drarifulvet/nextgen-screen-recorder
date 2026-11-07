// Stamps the NextGenIT icon and version details onto the Windows .exe.
// Uses a pure-JavaScript resource editor, so no Wine is needed when building on Linux or macOS.
'use strict';
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PELibrary = await import('pe-library');

  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(exe);

  // icon
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, iconFile.icons.map((i) => i.data),
  );

  // version information shown in File > Properties > Details
  const v = appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
  while (v.length < 4) v.push(0);
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const info = vi || ResEdit.Resource.VersionInfo.createEmpty();
  info.setFileVersion(...v);
  info.setProductVersion(...v);
  info.setStringValues({ lang: 1033, codepage: 1200 }, {
    CompanyName: 'NextGen IT',
    FileDescription: 'NextGen Screen Recorder',
    ProductName: 'NextGen Screen Recorder',
    InternalName: 'NextGen Screen Recorder',
    OriginalFilename: `${appInfo.productFilename}.exe`,
    LegalCopyright: `© ${new Date().getFullYear()} NextGen IT`,
    FileVersion: appInfo.version,
    ProductVersion: appInfo.version,
  });
  info.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • stamped icon and version info on', path.basename(exePath));
};
