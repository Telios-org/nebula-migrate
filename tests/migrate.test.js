const tape = require('tape')
const _test = require('tape-promise').default
const test = _test(tape)
const fs = require('fs')
const path = require('path')
const Nebula = require('@telios/nebula')
const helper = require('./helper')
const DHT = require('@hyperswarm/dht')
const Migrate = require('../index')
const { rmdir } = require('../util')

test('migrate previous version to new version', async t => {
  t.plan(5)
  const encryptionKey = Buffer.alloc(32, 'hello world')
  const keyPair = DHT.keyPair()
  const rootdir = __dirname
  const drivePath = '/drive'

  await helper.bootstrap({ path: path.join(rootdir, drivePath), encryptionKey, keyPair })

  await Migrate({ rootdir, drivePath, encryptionKey, keyPair })

  const drive = new Nebula(path.join(rootdir, drivePath), null, {
    keyPair,
    encryptionKey,
    joinSwarm: false,
    swarmOpts: {
      server: true,
      client: true
    }
  })

  await drive.ready()

  const docs = await drive.metadb.find()

  t.equals(docs.length, 2)

  for(const doc of docs) {
    if(doc.__version === '2.0') {
      t.ok(doc)
    }

    if(doc.uuid) {
      t.ok(doc)
    }
  }

  let collection2 = await drive.db.collection('Account')

  const doc1 = await collection2.findOne({ name: 'alice' })
  t.ok(doc1)

  const doc2 = await collection2.findOne({ name: 'bob' })
  t.ok(doc2)

  t.teardown(async () => {
    await drive.close()
  })
})

test.onFinish(async () => {
  if (fs.existsSync(path.join(__dirname, '/drive'))) {
    rmdir(path.join(__dirname, '/drive'))
  }

  if (fs.existsSync(path.join(__dirname, '/drive_old'))) {
    rmdir(path.join(__dirname, '/drive_old'))
  }

  process.exit(0)
})