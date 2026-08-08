import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bigfootsoftware.bigfootsday',
  appName: "Bigfoot's Day",
  webDir: 'dist',
  android: { allowMixedContent: true },
}

export default config
