import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'jp.co.qrattendance',
  appName: 'QR打刻システム',
  // Firebase HostingのURLは使わず、ビルド済みファイルをAPKに同梱する
  webDir: 'dist',
  android: {
    // デバッグ時はtrueにすると Chrome DevToolsで検査できる
    // 本番APKを作る前にfalseに戻す
    webContentsDebuggingEnabled: true,
    allowMixedContent: false,
  },
}

export default config
