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

    // 5. Rename directories and files
    const files = fs.readdirSync(path.join(rootdir, drivePath, '/Files'))

    for(file of files) {
      fs.renameSync(path.join(rootdir, drivePath, '/Files', file), path.join(rootdir, 'drive_new', '/Files', file))
    }

    // 4. Run transasction scripts to fill new Hypercores
    await newDrive.ready()
    await populateCores(newDrive, rootdir, drivePath)
    await newDrive.close()

    
    fs.renameSync(path.join(rootdir, drivePath), path.join(rootdir, drivePath + '_old'))
    fs.renameSync(path.join(rootdir, 'drive_new'), path.join(rootdir, drivePath))
  } catch(err) {
    console.log(err)
  }
}

async function createMigrationScript(drive, rootdir, drivePath) {
  try {
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
    })

    metaStream.on('data', data => {
      bees.meta.push(JSON.parse(data.value.toString()))
    })

    metaStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(bees))
    })

    localStream.on('data', data => {
      bees.local.push(JSON.parse(data.value.toString()))
    })

    localStream.on('end', () => {
      fs.writeFileSync(path.join(rootdir, drivePath, '/migrate/data.json'), JSON.stringify(bees))
    })
  } catch(err) {
    throw err
  }
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

    const newBee = drive.database.bee
    const newMetadb = drive.database.metadb
    const newLocalB = drive._localHB
    
    for (const sub in data.main.collections) {
      const items = data.main.collections[sub]
      const collection = await drive.db.collection(sub)
      
      for(const item of items) {
        // Not needed anymore
        delete item.value.__sub

        if(sub === 'Email') {
          let email = await getEmail(drive, item.value.path)
          
          email = {
            emailId: email.emailId,
            aliasId: email.aliasId,
            folderId: email.folderId,
            unread: email.unread,
            subject: email.subject,
            toJSON: email.toJSON,
            fromJSON: email.fromJSON,
            ccJSON: email.ccJSON,
            bccJSON: email.bccJSON,
            bodyAsText: email.bodyAsText,
            attachments: email.attachments,
            path: email.path
          }

          await collection.insert(email)
          await indexDoc(sub, collection)
        } else {
          await collection.insert({ ...item.value })
          await indexDoc(sub, collection)
        }
      }
    }

    for(const tx of data.main.tx) {
      await newBee.insert({ ...tx.value })
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