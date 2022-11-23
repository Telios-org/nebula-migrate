const Drive = require('@telios/nebula-old')
const fs = require('fs')

module.exports.bootstrap = async ({ path, keyPair, encryptionKey }) => {

  try {
    const drive = new Drive(path, null, {
      keyPair,
      encryptionKey,
      joinSwarm: false,
      swarmOpts: {
        server: true,
        client: true
      }
    })

    await drive.ready()

    const collection = await drive.db.collection('Account')
    
    await collection.insert({ name: "alice" })
    await collection.insert({ name: "bob" })

    const stream = fs.createReadStream('./index.js')

    await drive.writeFile('/index.js', stream, { encrypted: true })

    await drive.close()
  } catch(err) {
    console.log(err)
  }
}