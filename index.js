const fs = require('fs')
const path = require('path')
const Hypercore = require('@telios/nebula-drive/node_modules/hypercore')
const HypercoreNew = require('hypercore')
const Drive = require('@telios/nebula-drive')
const Nebula = require('@telios/nebula')
const { DateTime } = require('luxon')

module.exports = async ({ rootdir, drivePath, keyPair, encryptionKey, data }) => {
  // 1. Output all transactions (encrypted) from Autobee into a migration folder. If migration folder exists, run migration
  try {
    // Start old drive
    const drive = new Drive(path.join(rootdir, drivePath), null, {
      keyPair,
      encryptionKey,
      joinSwarm: false,
      swarmOpts: {
        server: true,
        client: true
      }
    })

    await drive.ready()

    // 2. Create a new drive with the latest version
    fs.mkdirSync(path.join(rootdir, '/drive_new'))
    fs.mkdirSync(path.join(rootdir, '/drive_new/Database'))
    fs.mkdirSync(path.join(rootdir, '/drive_new/Files'))

    // 3. Make file for migration script
    await updateMigrationScript(data, drive, rootdir, drivePath)

    // Close old drive before extracting and populating Hypercores
    await drive.close()

    // 4. Remove new cores so they can be replace. The overwrite option in Hypercore does not seem to work as expected which is why these need to be deleted.
    await copyCores(rootdir, drivePath, encryptionKey)

    const newDrive = new Nebula(path.join(rootdir, '/drive_new'), null, {
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
    await newDrive.close()

    fs.renameSync(path.join(rootdir, drivePath), path.join(rootdir, drivePath + '_old'))
    fs.renameSync(path.join(rootdir, 'drive_new'), path.join(rootdir, drivePath))
    fs.unlinkSync(path.join(rootdir, drivePath + '_old', '/migrate/data.json'))
  } catch(err) {
    console.log(err)
  }
}

async function updateMigrationScript(db, drive, rootdir, drivePath) {
    // Make file for migration script
    const mainStream = drive.database.bee.createReadStream()
    const metaStream = drive.database.metadb.createReadStream()
    const localStream = drive._localHB.createReadStream()

  return new Promise((resolve, reject) => {
    let finished = 0

    mainStream.on('data', data => {
      const item = JSON.parse(data.value.toString())
      const sub = item.value.__sub

      if(sub === 'file' && item.type !== 'del' && item.key !== 'backup/encrypted.db') {
        delete item.value.__sub
        db.main.collections.file.push(item.value)
      }
    })

    mainStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(db))
      finished += 1
      if(finished === 3) return resolve()
    })

    metaStream.on('data', data => {
      const item = JSON.parse(data.value.toString())
      db.meta[item.key] = item.value
    })

    metaStream.on('end', async () => {
      for(const key in db.meta) {
        const item = db.meta[key]

        if(item.path && item.path !== '/backup/encrypted.db') {
          try {
            fs.statSync(path.join(rootdir, drivePath, '/Files', item.path))
            fs.renameSync(path.join(rootdir, drivePath, '/Files',  item.path), path.join(rootdir, 'drive_new', '/Files',  item.path))
          } catch(err) {
            process.send({ event: 'debug:info', data: { name: 'DEL FILE ERR', err: JSON.stringify(err)} })
          }
        }
      }

      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(db))
      finished += 1
      if(finished === 3) return resolve()
    })

    localStream.on('data', data => {
      const item = JSON.parse(data.value.toString())
      db.local[item.key] = item.value
    })

    localStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(db))
      finished += 1
      if(finished === 3) return resolve()
    })

    // Handle stream errors
    mainStream.on('error', err => {
      return reject(err)
    })

    metaStream.on('error', err => {
      return reject(err)
    })

    localStream.on('error', err => {
      return reject(err)
    })
  })
}

async function copyCores(rootdir, drivePath, encryptionKey) {
  try {
    // Rebuild Hypercores with existing keyPairs
    let cores
    
    cores = fs.readdirSync(path.join(rootdir, drivePath, '/Database'))
    for(const core of cores) {
      if(core.indexOf('.DS_Store') === -1) {
        let feed = new Hypercore(path.join(rootdir, drivePath, '/Database/' + core), { encryptionKey })
        
        await feed.ready()

        let keyPair = feed.core.header.signer

        await feed.close()

        feed = new HypercoreNew(path.join(rootdir, 'drive_new', '/Database/' + core), { keyPair, encryptionKey })

        await feed.ready()

        await feed.close()
      }
    }

  } catch(err) {
    process.send({ event: 'CORE_MIGRATE_ERROR', data: { message: err.message, stack: err.stack } })
    throw err
  }
}

async function populateCores(drive, rootdir, drivePath) {
  try {
    let data = fs.readFileSync(path.join(rootdir, drivePath, '/migrate/data.json'))
    data = JSON.parse(data)

    const newMetadb = drive.database.metadb
    const newLocalB = drive._localHB

    for(const key in data.meta) {
      await newMetadb.put(key, data.meta[key])
    }

    for(const key in data.local) {
      await newLocalB.put(key, data.local[key])
    }
    
    for (const sub in data.main.collections) {
      const items = data.main.collections[sub]
      const collection = await drive.db.collection(sub)

      for(const item of items) {   
        if(sub === 'Email') {
          const fullEmail = await getEmail(drive, item.path)

          const date = DateTime.fromISO(fullEmail.date)
          const createdAt = DateTime.fromISO(fullEmail.createdAt || date)
          const updatedAt = DateTime.fromISO(fullEmail.updatedAt || new Date().toUTCString())

          let email = {
            emailId: fullEmail.emailId,
            aliasId: fullEmail.aliasId,
            folderId: fullEmail.folderId,
            mailboxId: 1,
            date: date.toUTC(),
            unread: item.unread,
            subject: fullEmail.subject,
            toJSON: fullEmail.toJSON,
            fromJSON: fullEmail.fromJSON,
            attachments: fullEmail.attachments,
            path: item.path,
            createdAt: createdAt.toUTC(),
            updatedAt: updatedAt.toUTC()
          }

          if(fullEmail.bodyAsText) {
            email.bodyAsText = fullEmail.bodyAsText.split(" ").slice(0, 20).join(" ")
          }

          if(email.emailId && email.folderId || email.emailId && email.aliasId) {
            const doc = await collection.insert(email)
            
            await createSearchIndex(sub, collection, { ...fullEmail, _id: doc._id })
          }
        } else {
          const doc = await collection.insert({ ...item })
          await createSearchIndex(sub, collection, { ...item, _id: doc._id })
        }
      }
      await createIndex(sub, collection)
    }

  } catch(err) {
    process.send({ event: 'POPULATE_ERROR', data: { message: err.message, stack: err.stack } })
    throw err
  }
}

async function createSearchIndex(name, collection, doc) {
  switch(name) {
    case 'Email':
      try {
        await collection.ftsIndex(['subject', 'toJSON', 'fromJSON', 'ccJSON', 'bccJSON', 'bodyAsText', 'attachments'], [doc])
      } catch(err) {
        process.send({ event: 'INDEX_ERROR', data: { message: err.message, stack: err.stack } })
      }
      break
    case 'Contact':
      await collection.ftsIndex(['name', 'email'], [doc])
      break
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