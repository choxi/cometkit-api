import Path from "path"
import webpack from "webpack"
import s3Client from "s3"
import dotenv from "dotenv"
import { exec } from "child-process-promise"
import fs from "fs"
import AWS from "aws-sdk"

dotenv.config()

const s3Options = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
}

const client  = s3Client.createClient({ s3Options: s3Options })
const s3      = new AWS.S3(s3Options)

export default class Repo {
  static exists(repo) {
    return new Promise((resolve, reject) => {
      let s3Params = { Bucket: process.env.S3_BUCKET, MaxKeys: 100, Prefix: repo }
      s3.listObjects(s3Params, (err, data) => {
        if(err) reject(err)
        else {
          resolve(data.Contents.length !== 0)
        }
      })
    })
  }
}

Repo.getFile = (repo, key) => {
  let params = {
    Bucket: process.env.S3_BUCKET,
    Key: [repo, key].join("/")
  }

  return new Promise((resolve, reject) => {
    s3.getObject(params, (err, data) => {
      if(err && err.code === "NoSuchKey") 
        resolve()
      else if(err) 
        reject(err)
      else {
        resolve(data.Body.toString())
      }
    })
  })
}

Repo.add = (repo, key, value) => {
  let params = {
    Body: value,
    ACL: "public-read",
    Bucket: process.env.S3_BUCKET,
    Key: [repo, key].join("/")
  }

  return new Promise((resolve, reject) => {
    s3.putObject(params, (err, data) => {
      if(err) reject(err)
      else
        resolve(data)
    })
  })
}

Repo.pack = (repoPath, path, repo) => {
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

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
