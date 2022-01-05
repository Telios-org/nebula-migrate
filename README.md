# nebula-migrate
Migration tool for upgrading Nebula drives between updates with breaking changes

## Usage
```js
await Migrate({ rootdir: __dirname, drivePath: '/drive', encryptionKey, keyPair })


const drive = new Drive(path.join(__dirname, '/drive'), null, {
  keyPair,
  encryptionKey,
  swarmOpts: {
    server: true,
    client: true
  }
})

await drive.ready() // Upgraded drive is now ready for use!


/**
 *  Existing drive is renamed to <drivePath>_old
 *  New drive replaces the original at <drivePath>
 * 
 *  Old drive persists in the event migration fails. 
 *  Feel free to decide if this old directory can be removed or not.
 * 
 *  Before:
 *  |__ root/
 *     |__ drive/
 * 
 *  After:
 *  |__root/
 *      |__ drive/
 *      |__ drive_old/
 * 
 * /
```

#### `await Migrate({ rootdir, drivePath[,encryptionKey][,keyPair] })`

Migrates an older version of nebula to the newer version.

- `rootdir`: root directory that the drive resides in
- `drivePath`: the relative path of the drive `/drive`
- `encryptionKey`: Encryption key for migrating encrypted drives
- `keyPair`: The original drive's keyPair