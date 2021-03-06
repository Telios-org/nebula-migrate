const Drive = require('@telios/nebula-drive')
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

    const collection = await drive.db.collection('foo')
    
    await collection.put('alice', { name: "alice" })
    await collection.put('bob', { name: "bob" })

    const stream = fs.createReadStream('./index.js')

    await drive.writeFile('/index.js', stream, { encrypted: true })

    await drive.close()
  } catch(err) {
    console.log(err)
  }
}