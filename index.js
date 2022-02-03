const fs = require('fs')
const path = require('path')
const del = require('del')
const Hypercore = require('@telios/nebula-drive/node_modules/hypercore')
const HypercoreNew = require('hypercore')
const Drive = require('@telios/nebula-drive')
const Nebula = require('@telios/nebula')

module.exports = async ({ rootdir, drivePath, keyPair, encryptionKey }) => {
  // 1. Output all transactions (encrypted) from Autobee into a migration folder. If migration folder exists, run migration
  try {
    fs.mkdirSync(path.join(rootdir, drivePath, 'migrate'))

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

    // Make file for migration script
    await createMigrationScript(drive, rootdir, drivePath)
    // 2. Create a new drive with the latest version
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

    // Initialize and close new drive only to populate necessary files and directories
    await newDrive.ready()
    await newDrive.close()

    // Close old drive before extracting and populating Hypercores
    await drive.close()

    // Remove new cores so they can be replace. The overwrite option in Hypercore does not seem to work as expected which is why these need to be deleted.
    await copyCores(rootdir, drivePath, encryptionKey)

    // 4. Rename directories and files
    const files = fs.readdirSync(path.join(rootdir, drivePath, '/Files'))


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

async function createMigrationScript(drive, rootdir, drivePath) {
    // Make file for migration script
    const mainStream = drive.database.bee.createReadStream()
    const metaStream = drive.database.metadb.createReadStream()
    const localStream = drive._localHB.createReadStream()

    let bees = {
      "main": {
        "collections": {},
        "tx": []
      },
      "meta": [],
      "local": []
    }

  return new Promise((resolve, reject) => {
    let finished = 0

    mainStream.on('data', data => {
      const item = JSON.parse(data.value.toString())
      const sub = item.value.__sub

      const collection = bees.main.collections[sub]
      
      if(sub && !collection) {
        bees.main.collections[sub] = [item]
      }

      if(sub && collection) {
        collection.push(item)
      }

      if(!sub) {
        bees.main.tx.push(JSON.parse(data.value.toString()))
      }
    })

    mainStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(bees))
      finished += 1
      if(finished === 3) return resolve()
    })

    metaStream.on('data', data => {
      bees.meta.push(JSON.parse(data.value.toString()))
    })

    metaStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(bees))
      finished += 1
      if(finished === 3) return resolve()
    })

    localStream.on('data', data => {
      bees.local.push(JSON.parse(data.value.toString()))
    })

    localStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(bees))
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
    const newCores = fs.readdirSync(path.join(rootdir, 'drive_new', '/Database'))

    for(const core of newCores) {
      if (fs.existsSync(path.join(rootdir, 'drive_new', '/Database/' + core))) {
        await del([
          path.join(rootdir, 'drive_new', '/Database/' + core)
        ])
      }
    }

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

        keyPair = feed.core.header.signer
        await feed.close()
      }
    }

  } catch(err) {
    throw err
  }
}

async function populateCores(drive, rootdir, drivePath) {
  try {
    let data = fs.readFileSync(path.join(rootdir, drivePath, '/migrate/data.json'))
    data = JSON.parse(data)

    const newMetadb = drive.database.metadb
    const newLocalB = drive._localHB

    let deletedItems = []
    
    for (const sub in data.main.collections) {
      const items = data.main.collections[sub]
      const collection = await drive.db.collection(sub)

      for(const item of items) {
        if(sub === 'file') {
          // Not needed anymore
          delete item.value.__sub
          
          if(item.value.deleted) {
            await collection.remove({ uuid: item.value.uuid })
            const delItem = items.filter(i => i.value.path && i.value.uuid === item.value.uuid)
            
            deletedItems.push(`${delItem[0].value.path}`)
          }

          if(!item.value.deleted && item.value.path !== 'backup/encrypted.db') {
            try {
              fs.statSync(path.join(rootdir, drivePath, '/Files', '/' + item.value.uuid))
              await collection.insert({ ...item.value })
              fs.renameSync(path.join(rootdir, drivePath, '/Files', item.value.uuid), path.join(rootdir, 'drive_new', '/Files', item.value.uuid))
            } catch(err) {
              // process.send({ event: 'debug:info', data: { name: 'DEL FILE ERR', file: item.value } })
              deletedItems.push(`/${item.value.path}`)
            }
          }
        }
      }

      for(const item of items) {   
        if(deletedItems.indexOf(item.value.path) > -1) {
          continue
        }
        
        // Not needed anymore
        delete item.value.__sub

        if(sub === 'Email') {
          let email
          
          email = await getEmail(drive, item.value.path)

          email = {
            emailId: email.emailId,
            aliasId: email.aliasId,
            folderId: email.folderId,
            mailboxId: 1,
            date: email.date,
            unread: email.unread,
            subject: email.subject,
            toJSON: email.toJSON,
            fromJSON: email.fromJSON,
            ccJSON: email.ccJSON,
            bccJSON: email.bccJSON,
            bodyAsText: email.bodyAsText,
            attachments: email.attachments,
            size: email.size,
            path: item.value.path,
            createdAt: email.date,
            udpatedAt: new Date().toISOString(),
          }
          
          if(email.emailId && email.folderId || email.emailId && email.aliasId) {
            await collection.insert(email)
          }
        } else {
          await collection.insert({ ...item.value })
        }
      }
      await indexDoc(sub, collection)
    }

    for(const tx of data.meta) {
      await newMetadb.put(tx.key, tx.value)
    }

    for(const tx of data.local) {
      await newLocalB.put(tx.key, tx.value)
    }

  } catch(err) {
    throw err
  }
}

async function indexDoc(name, collection) {
  switch(name) {
    case 'Email':
      await collection.ftsIndex(['subject', 'toJSON', 'fromJSON', 'ccJSON', 'bccJSON', 'bodyAsText', 'attachments'])
      break
    case 'Contact':
      await collection.ftsIndex(['name', 'email'])
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