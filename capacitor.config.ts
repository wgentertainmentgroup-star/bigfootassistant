import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bigfootsoftware.bigfootsday',
  appName: "Bigfoot's Day",
  webDir: 'dist',
  backgroundColor: '#030b11',
  android: { allowMixedContent: false },
}

export default config
