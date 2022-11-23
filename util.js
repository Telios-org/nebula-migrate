const fs = require('fs')
const path = require('path')

module.exports.rmdir = (dir) => {
  const list = fs.readdirSync(dir)

  for(let i = 0; i < list.length; i++) {
    const filename = path.join(dir, list[i])
    const stat = fs.statSync(filename)

    if(filename == "." || filename == "..") {
      // pass these files
    } else if(stat.isDirectory()) {
      // rmdir recursively
      this.rmdir(filename)
    } else {
      // rm fiilename
      fs.unlinkSync(filename)
    }
  }
  fs.rmdirSync(dir)
}