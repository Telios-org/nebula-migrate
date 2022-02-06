const tape = require('tape')
const _test = require('tape-promise').default
const test = _test(tape)
const fs = require('fs')
const path = require('path')
const del = require('del')
const Nebula = require('@telios/nebula')
const helper = require('./helper')
const DHT = require('@hyperswarm/dht')
const Migrate = require('../index')

test('migrate previous version to new version', async t => {
  // t.plan(3)
  // const encryptionKey = Buffer.alloc(32, 'hello world')
  // const keyPair = DHT.keyPair()
  // const rootdir = __dirname
  // const drivePath = '/drive'

  // await helper.bootstrap({ path: path.join(rootdir, drivePath), encryptionKey, keyPair })

  // await Migrate({ rootdir, drivePath, encryptionKey, keyPair })

  // const drive = new Nebula(path.join(rootdir, drivePath), null, {
  //   keyPair,
  //   encryptionKey,
  //   joinSwarm: false,
  //   swarmOpts: {
  //     server: true,
  //     client: true
  //   }
  // })

  // await drive.ready()

  // const collection = await drive.database.collection('foo')

  // const doc1 = await collection.findOne({ name: 'alice' })
  // t.ok(doc1)

  // const doc2 = await collection.findOne({ name: 'bob' })
  // t.ok(doc2)

  // const stream = await drive.readFile('/index.js')

  // let content = ''

  // stream.on('data', chunk => {
  //   content += chunk.toString()
  // })

  // stream.on('end', async () => {
  //   await drive.close()
  //   t.ok(content)
  // })

  // stream.on('error', async (err) => {
  //   await drive.close()
  //   t.error(err)
  // })
})

// test.onFinish(async () => {
//   if (fs.existsSync(path.join(__dirname, '/drive'))) {
//     await del([
//       path.join(__dirname, '/drive')
//     ])
//   }

//   if (fs.existsSync(path.join(__dirname, '/drive_old'))) {
//     await del([
//       path.join(__dirname, '/drive_old')
//     ])
//   }

//   process.exit(0)
// })