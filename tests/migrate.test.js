const tape = require('tape')
const _test = require('tape-promise').default
const test = _test(tape)
const fs = require('fs')
const path = require('path')
const del = require('del')
const DriveNew = require('@telios/nebula-drive-new')
const helper = require('./helper')
const DHT = require('@hyperswarm/dht')
const Migrate = require('../index')

test('migrate previous version to new version', async t => {
  t.plan(3)
  const encryptionKey = Buffer.alloc(32, 'hello world')
  const keyPair = DHT.keyPair()
  const rootdir = __dirname
  const drivePath = '/drive'

  await helper.bootstrap({ path: path.join(rootdir, drivePath), encryptionKey, keyPair })
  
  await Migrate({ rootdir, drivePath, encryptionKey, keyPair })

  const drive = new DriveNew(path.join(rootdir, drivePath), null, {
    keyPair,
    encryptionKey,
    joinSwarm: false,
    swarmOpts: {
      server: true,
      client: true
    }
  })

  await drive.ready()

  const collection = await drive.database.collection('foo')
  const item1 = await collection.get('hello')

  t.ok(item1.value)

  const item2 = await collection.get('alice')

  t.ok(item2.value)

  const stream = await drive.readFile('/index.js')

  let content = ''

  stream.on('data', chunk => {
    content += chunk.toString()
  })

  stream.on('end', async () => {
    await drive.close()
    t.ok(content)
  })

  stream.on('error', async (err) => {
    await drive.close()
    t.error(err)
  })
})

test.onFinish(async () => {
  if (fs.existsSync(path.join(__dirname, '/drive'))) {
    await del([
      path.join(__dirname, '/drive')
    ])
  }

  if (fs.existsSync(path.join(__dirname, '/drive_old'))) {
    await del([
      path.join(__dirname, '/drive_old')
    ])
  }

  process.exit(0)
})