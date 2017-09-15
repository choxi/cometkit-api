import Path from "path"
import webpack from "webpack"
import s3 from "s3"
import dotenv from "dotenv"
import { exec } from "child-process-promise"
import fs from "fs"

dotenv.config()

const client = s3.createClient({
  s3Options: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  }
})

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const pack = (repoPath, path, repo) => {
  let name = Path.basename(path).split(".")[0]

  if(name === "index")
    name = Path.dirname(path).split(Path.sep).pop()

  let directory = Path.resolve(repoPath, "comet-dist")
  let filename  = `${name}.js`

  let config = `
  var defaultConfig = require("./webpack.config.js")

  module.exports = {
    entry: "${path}",
    output: {
      libraryTarget: "var",
      library: "${capitalize(name)}",
      libraryExport: "default",
      path: "${directory}",
      filename: "${filename}"
    },
    externals: {
      react: "React",
      "react-dom": "ReactDOM"
    },
    module: defaultConfig.module
  }
  `

  let webpackConfigName = `${name}.webpack.js`
  let webpackConfigPath = Path.join(repoPath, webpackConfigName)
  fs.writeFileSync(webpackConfigPath, config)

  return new Promise((resolve, reject) => {
    exec(`NODE_ENV=production webpack --config ${webpackConfigName}`, { cwd: repoPath })
    .then((result) => {
      console.log(`WEBPACK STDOUT: ${ result.stdout }`)
      console.log(`WEBPACK STDERR: ${ result.stderr }`)

      let key     = [repo, filename].join("/")
      let bucket  = process.env.S3_BUCKET

      let params = {
        localFile: Path.join(directory, filename),
        s3Params: {
          ACL: "public-read",
          Bucket: bucket,
          Key: key
        }
      }

      let uploader = client.uploadFile(params)

      uploader.on('error', function(err) {
        console.error("unable to upload:", err.stack)
      })

      uploader.on('progress', function() {
        console.log("progress", uploader.progressMd5Amount, uploader.progressAmount, uploader.progressTotal)
      })

      uploader.on('end', function() {
        console.log("done uploading")

        let uri = `https://s3-us-west-1.amazonaws.com/${bucket}/${key}`
        resolve({ uri: uri })
      })
    })
  })
}

export default pack
