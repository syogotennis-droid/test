#!/usr/bin/env node
/**
 * 新規案件セットアップスクリプト
 * 使い方: node setup-new-client.js
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { execSync } = require('child_process')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise(resolve => rl.question(q, resolve))

async function main() {
  console.log('\n=== 新規案件セットアップ ===\n')
  console.log('Firebase consoleのプロジェクト設定からfirebaseConfigをコピーして貼り付けてください。')
  console.log('（例）')
  console.log('  apiKey: "AIzaSy..."')
  console.log('  projectId: "my-project"')
  console.log('  ...\n')
  console.log('firebaseConfigのオブジェクト全体を貼り付けてEnterを2回押してください:\n')

  // 複数行入力を受け付ける
  let input = ''
  rl.on('line', (line) => { input += line + '\n' })
  await new Promise(resolve => rl.once('close', resolve))

  // firebaseConfig オブジェクトを抽出
  const match = input.match(/\{[\s\S]*\}/)
  if (!match) {
    console.error('\nエラー: firebaseConfigが正しく読み取れませんでした。')
    process.exit(1)
  }

  const configStr = match[0]

  // projectId を抽出
  const projectIdMatch = configStr.match(/projectId:\s*["']([^"']+)["']/)
  if (!projectIdMatch) {
    console.error('\nエラー: projectId が見つかりませんでした。')
    process.exit(1)
  }
  const projectId = projectIdMatch[1]

  // 現在の .firebaserc のプロジェクトIDを確認
  const firebasercPath = path.join(__dirname, '.firebaserc')
  const firebasercContent = fs.readFileSync(firebasercPath, 'utf8')
  const currentProjectMatch = firebasercContent.match(/"default":\s*"([^"]+)"/)
  const currentProject = currentProjectMatch ? currentProjectMatch[1] : '(不明)'

  if (currentProject === projectId) {
    console.error(`\n⚠️  エラー: 現在と同じプロジェクト「${projectId}」が指定されています。`)
    console.error('新しいプロジェクトのfirebaseConfigを貼り付けてください。\n')
    process.exit(1)
  }

  console.log(`\n現在のプロジェクト: ${currentProject}`)
  console.log(`新しいプロジェクト: ${projectId}`)

  // .firebaserc を更新
  const newFirebaserc = JSON.stringify({ projects: { default: projectId } }, null, 2) + '\n'
  fs.writeFileSync(firebasercPath, newFirebaserc, 'utf8')
  console.log('✓ .firebaserc を更新しました')

  // db.js を読み込んで firebaseConfig 部分を置換
  const dbPath = path.join(__dirname, 'src', 'lib', 'db.js')
  let dbContent = fs.readFileSync(dbPath, 'utf8')

  dbContent = dbContent.replace(
    /const firebaseConfig = \{[\s\S]*?\}/,
    `const firebaseConfig = ${configStr}`
  )

  fs.writeFileSync(dbPath, dbContent, 'utf8')
  console.log('✓ firebaseConfig を更新しました\n')

  // ビルド
  console.log('ビルド中...')
  try {
    execSync('npm run build', { stdio: 'inherit' })
  } catch {
    console.error('\nビルドに失敗しました。')
    process.exit(1)
  }

  // デプロイ
  console.log('\nデプロイ中...')
  try {
    execSync('firebase deploy --only hosting', { stdio: 'inherit' })
  } catch {
    console.error('\nデプロイに失敗しました。firebase login を確認してください。')
    process.exit(1)
  }

  console.log(`\n=== セットアップ完了 ===`)
  console.log(`URL: https://${projectId}.web.app\n`)
}

main()
