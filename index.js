const fs = require('fs')
const readline = require('readline')
const path = require('path')
const HypercoreOld = require('@telios/nebula-old/node_modules/hypercore')
const HypercoreNew = require('hypercore')
const NebulaNew = require('@telios/nebula')
const NebulaOld = require('@telios/nebula-old')
const HyperbeeMessages = require('@telios/nebula-old/node_modules/hyperbee/lib/messages.js')
// const { DateTime } = require('luxon')
const BSON = require('bson')
const { ObjectId } = BSON

const collections = ['file', 'Account', 'Mailbox', 'Folder', 'Files', 'Alias', 'AliasNamespace', 'Email', 'Contact']

module.exports = async ({ rootdir, drivePath, keyPair, encryptionKey, data }) => {
  // 1. Output all transactions (encrypted) from Autobee into a migration folder. If migration folder exists, run migration
  try {
    // Start old drive
    const driveOld = new NebulaOld(path.join(rootdir, drivePath), null, {
      keyPair,
      encryptionKey,
      joinSwarm: false,
      swarmOpts: {
        server: true,
        client: true
      }
    })

    await driveOld.ready()

    // 2. Create a new drive with the latest version
    fs.mkdirSync(path.join(rootdir, '/drive_new'))
    fs.mkdirSync(path.join(rootdir, '/drive_new/Database'))
    fs.mkdirSync(path.join(rootdir, '/drive_new/Files'))

    // 3. Make file for migration script
    await updateMigrationScript(data, driveOld, rootdir, drivePath)

    // Close old drive before extracting and populating Hypercores
    await driveOld.close()

    // 4. Remove new cores so they can be replace. The overwrite option in Hypercore does not seem to work as expected which is why these need to be deleted.
    await copyCores(rootdir, drivePath, encryptionKey)

    const newDrive = new NebulaNew(path.join(rootdir, '/drive_new'), null, {
      keyPair,
      encryptionKey,
      joinSwarm: false,
      fullTextSearch: true,
      swarmOpts: {
        server: true,
        client: true
      }
    })

    // 5. Run transasction scripts to fill new Hypercores
    await newDrive.ready()
    await populateCores(newDrive, rootdir, drivePath)
    copyFiles(rootdir, drivePath)
    await newDrive.close()

    fs.renameSync(path.join(rootdir, drivePath), path.join(rootdir, drivePath + '_old'))
    fs.renameSync(path.join(rootdir, 'drive_new'), path.join(rootdir, drivePath))
    fs.unlinkSync(path.join(rootdir, drivePath + '_old', '/migrate/data.txt'))
  } catch(err) {
    console.log(err)
  }
}

function copyFiles(rootdir, drivePath) {
  const files = fs.readdirSync(path.join(rootdir, drivePath, '/Files'))

  for(const file of files) {
    const currDir = path.join(rootdir, drivePath, '/Files', file)
    const dest = path.join(rootdir, 'drive_new/Files', file)
    fs.copyFileSync(currDir, dest)
  }

  // Copy device file
  if (fs.existsSync(path.join(rootdir, drivePath, '/device'))) {
    fs.copyFileSync(path.join(rootdir, drivePath, '/device'), path.join(rootdir, 'drive_new/device'))
  }
}

async function updateMigrationScript(db, drive, rootdir, drivePath) {
  // Make file for migration script
  //const localStream = drive._localHB.createReadStream()

  fs.mkdirSync(path.join(rootdir, drivePath, '/migrate'))

  let dataFilePath = path.join(rootdir, drivePath, '/migrate/data.txt')
  const metaStream = drive.metadb.createReadStream()
    
  for await (const data of metaStream) {
    if(data.value.toString().indexOf('hyperbee') === -1) {
      const op = HyperbeeMessages.Node.decode(data.value)
      const node = {
        key: op.key.toString('utf8'),
        value: JSON.parse(op.value.toString('utf8')),
        seq: data.seq
      }

      if (node.key !== '__peers') {
        fs.appendFileSync(dataFilePath, JSON.stringify({ collection: 'metadb', value: { ...node.value } }) + '\n')
      }
    }
  }

  for await(const col of collections) {
    const collection = await drive.database.collection(col)
    const docs = await collection.find()

    for(const doc of docs) {
      fs.appendFileSync(dataFilePath, JSON.stringify({ collection: col, value: { ...doc } }) + '\n')
    }
  }
}

async function copyCores(rootdir, drivePath, encryptionKey) {
  try {
    // Rebuild Hypercores with existing keyPairs
    let cores
    
    cores = fs.readdirSync(path.join(rootdir, drivePath, '/Database'))
    for(const core of cores) {
      if(core.indexOf('.DS_Store') === -1) {
        let feed = new HypercoreOld(path.join(rootdir, drivePath, '/Database/' + core), { encryptionKey })
        
        await feed.ready()

        let keyPair = feed.core.header.signer

        await feed.close()

        feed = new HypercoreNew(path.join(rootdir, 'drive_new', '/Database/' + core), { keyPair, encryptionKey })

        await feed.ready()

        await feed.close()
      }
    }

  } catch(err) {
    console.log({ event: 'CORE_MIGRATE_ERROR', data: { message: err.message, stack: err.stack } })
    throw err
  }
}

async function populateCores(drive, rootdir, drivePath) {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(rootdir, drivePath, '/migrate/data.txt')),
      crlfDelay: Infinity
    });

    for await(const line of rl) {
      const data = JSON.parse(line)
      const col = data.collection
      const val = data.value

      if(col === 'metadb') {
        await drive.metadb.insert({ ...val, _id: ObjectId(val._id) })
      } else {
        const collection = await drive.db.collection(col)
        const doc = await collection.insert({ ...val, _id: ObjectId(val._id) })
        await createSearchIndex(col, collection, doc)
        await createIndex(col, collection)
      }
    }
  } catch(err) {
    console.log({ event: 'POPULATE_ERROR', data: { message: err.message, stack: err.stack } })
    throw err
  }
}

async function createSearchIndex(name, collection, doc) {
  switch(name) {
    case 'Email':
      try {
        await collection.ftsIndex(['subject', 'toJSON', 'fromJSON', 'ccJSON', 'bccJSON', 'bodyAsText', 'attachments'], [doc])
      } catch(err) {
        console.log({ event: 'INDEX_ERROR', data: { message: err.message, stack: err.stack } })
      }
      break
    case 'Contact':
      await collection.ftsIndex(['name', 'email'], [doc])
      break
    default:
      return
  }
}

async function createIndex(name, collection) {
  switch(name) {
    case 'Folder':
      await collection.createIndex(['createdAt', 'folderId', 'mailboxId'])
      await collection.createIndex(['updatedAt'])
      await collection.createIndex(['seq'])
      break
    case 'Alias':
      await collection.createIndex(['createdAt', 'name'])
      break
    case 'AliasNamespace':
      await collection.createIndex(['name', 'mailboxId'])
      break
    case 'Email':
      await collection.createIndex(['date', 'folderId', 'emailId'])
      break
    case 'Files':
      await collection.createIndex(['createdAt', 'filename'])
      await collection.createIndex(['updatedAt'])
      break
    default:
      return
  }
}

async function getEmail(drive, path) {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await drive.readFile(path)

      let decrypted = ''

      stream.on('data', chunk => {
        decrypted += chunk.toString('utf-8')
      })

      stream.on('end', () => {
        return resolve(JSON.parse(decrypted))
      })

      stream.on('error', (err) => {
        return reject(err)
      })
    } catch(err) {
      return reject(err)
    }
  })
}