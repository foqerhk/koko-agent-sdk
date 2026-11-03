module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: './android',
        packageImportPath: 'import cn.intentcomputing.kokoagentsdk.KokoAgentSdkPackage;',
        packageInstance: 'new KokoAgentSdkPackage()',
      },
    },
  },
};
