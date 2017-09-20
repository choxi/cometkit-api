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

  static getFile(repo, key) {
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

  static add(repo, key, value) {
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

  static pack(downloadPath, filePath, options) {
    let name        = filename(filePath)
    let outputDir   = Path.resolve(downloadPath, "comet-dist")
    let outputName  = `${name}.js`
    let outputPath  = Path.join(outputDir, outputName)

    // Merge user config or use default
    let templateOptions = {
      entry: filePath, 
      library: capitalize(name), 
      path: outputDir, 
      filename: outputName
    }

    let config
    if(options && options.webpackConfigPath)
      config = configTemplate(templateOptions, Object.assign(options, { loadUserConfig: true }))
    else if(fs.existsSync(Path.join(downloadPath, "webpack.config.js")))
      config = configTemplate(templateOptions)
    else
      config = configTemplate(templateOptions, { loadUserConfig: false })

    // Write Comet webpack config 
    let webpackConfigName = `${name}.webpack.js`
    let webpackConfigPath = Path.join(downloadPath, webpackConfigName)
    fs.writeFileSync(webpackConfigPath, config)
    console.log(`Injected ${webpackConfigPath}`)

    let modulesPath = Path.join(process.cwd(), "node_modules")
    return new Promise((resolve, reject) => {
      exec(`NODE_ENV=production NODE_PATH='${modulesPath}' webpack -p --config ${webpackConfigName}`, { cwd: downloadPath })
      .then((result) => {
        console.log(`WEBPACK STDOUT: ${ result.stdout }`)
        console.log(`WEBPACK STDERR: ${ result.stderr }`)

        resolve(outputPath)
      })
    })
  }

  static async deploy(downloadPath, filePath, keyPrefix) {
    let name        = filename(filePath)
    let outputName  = `${name}.js`
    let outputPath  = await this.pack(downloadPath, filePath)

    let bucket          = process.env.S3_BUCKET
    let key             = [keyPrefix, outputName].join("/")
    let { uri }         = await this.upload(bucket, key, outputPath)

    return uri
  }

  static upload(bucket, key, localFile) {
    return new Promise((resolve, reject) => {
      let params = {
        localFile: localFile,
        s3Params: {
          ACL: "public-read",
          Bucket: bucket,
          Key: key
        }
      }

      let uploader = client.uploadFile(params)

      uploader.on("error", function(err) {
        console.error("unable to upload:", err.stack)
      })

      uploader.on("progress", function() {
        console.log("progress", uploader.progressMd5Amount, uploader.progressAmount, uploader.progressTotal)
      })

      uploader.on("end", function() {
        console.log("done uploading")

        let uri = `https://s3-us-west-1.amazonaws.com/${bucket}/${key}`
        resolve({ uri: uri })
      })
    })
  }
}

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function filename(path) {
  let name = Path.basename(path).split(".")[0]
  if(name === "index")
    name = Path.dirname(path).split(Path.sep).pop()

  return name
}

function configTemplate({ entry, library, path, filename }, options) {
  let userConfig, module, resolve
  if(options && !options.loadUserConfig) {
    userConfig  = ""
    resolve     = "null"
    module      = `{
      loaders: [
        {
          test: /\.(scss|sass)$/,
          loader: 'style-loader!css-loader!autoprefixer!sass-loader',
        },
        {
          test: /\.(js|jsx)$/,
          loader: require.resolve('babel-loader'),
          query: {
            presets: ['react']
          }
        }
      ]
    }`
  } else {
    let userConfigPath
    if(options && options.webpackConfigPath)
      userConfigPath = [".", options.webpackConfigPath].join("/")
    else
      userConfigPath = [".", "webpack.config.js"].join("/")

    userConfig  = `var defaultConfig = require("${ userConfigPath }")`
    module      = `defaultConfig.module`
    resolve     = `defaultConfig.resolve`
  }

  return `
    ${ userConfig }

    module.exports = {
      entry: "${ entry }",
      output: {
        libraryTarget: "var",
        library: "${ library }",
        libraryExport: "default",
        path: "${ path }",
        filename: "${ filename }"
      },
      externals: {
        react: "React",
        "react-dom": "ReactDOM"
      },
      resolve: ${ resolve },
      module: ${ module }
    }
  `
}
