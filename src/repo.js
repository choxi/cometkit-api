import Path from "path"
import webpack from "webpack"
import s3Client from "s3"
import dotenv from "dotenv"
import { exec } from "child-process-promise"
import fs from "fs"
import AWS from "aws-sdk"
import fetch from "node-fetch"
import downloadRepo from "download-github-repo"
import glob from "glob"
import jsdoc from "jsdoc-api"

dotenv.config()

const s3Options = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
}

const client  = s3Client.createClient({ s3Options: s3Options })
const s3      = new AWS.S3(s3Options)

export default class Repo {
  static async createDocs(owner, repo, tmpPath) {
    let githubUrl = `https://api.github.com/repos/${ owner }/${ repo }/git/refs/heads/master`
    let ref       = await fetch(githubUrl).then(response => response.json())
    let sha       = ref.object.sha

    let namespace = [owner, repo, sha].join("/")
    let exists    = await Repo.exists(namespace)
    let docs      = await Repo.getFile(namespace, "docs.comet.json")

    if(docs)
      docs = JSON.parse(docs)

    if(exists && docs)
      return docs
    else {
      await download(namespace, tmpPath)
      docs = getJsDocs(tmpPath)

      // Install dependencies
      let result = await exec("npm install", { cwd: Path.resolve(tmpPath) })
      console.log(`STDOUT: ${ result.stdout }`)
      console.log(`STDERR: ${ result.stderr }`)

      let uploads = docs.map(doc => {
        return (async () => {
          if(doc.meta) {
            let { moduleUri, stageUri } = await Repo.deploy(doc, tmpPath, namespace)

            doc.meta.webpackUri = moduleUri
            doc.meta.moduleUri  = moduleUri
            doc.meta.stageUri   = stageUri
          }
        })()
      })

      // Upload to S3
      await Promise.all(uploads)
      await Repo.add(namespace, "docs.comet.json", JSON.stringify(docs))

      return docs
    }
  }

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

  static async pack(downloadPath, filePath, options) {
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

    // Inject babel-preset-env
    await exec(`npm install babel-preset-env`, { cwd: downloadPath })
    console.log("Injected babel-preset-env")

    // Build component
    let modulesPath = Path.join(process.cwd(), "node_modules")
    let result      = await exec(`NODE_ENV=production NODE_PATH='${modulesPath}' webpack -p --config ${webpackConfigName}`, { cwd: downloadPath })
    console.log(`WEBPACK STDOUT: ${ result.stdout }`)
    console.log(`WEBPACK STDERR: ${ result.stderr }`)

    console.log(`outputPath: ${outputPath}`)
    return outputPath
  }

  static async deploy(doc, downloadPath, keyPrefix) {
    let filePath = Path.join(doc.meta.path, doc.meta.filename)
    let demoCode = doc.examples[0]

    let name        = filename(filePath)
    let outputName  = `${name}.js`
    let outputPath  = await this.pack(downloadPath, filePath)

    // Upload Module
    let bucket    = process.env.S3_BUCKET
    let key       = [keyPrefix, outputName].join("/")
    let moduleUri = await this.upload(bucket, key, outputPath)

    // Create and Upload Stage 
    let stageName = `${name}.html`
    let stage     = stageTemplate(name, moduleUri, demoCode)
    let stagePath = Path.join(Path.dirname(outputPath), `${name}.html`)
    fs.writeFileSync(stagePath, stage)

    key = [keyPrefix, stageName].join("/")
    let stageUri = await this.upload(bucket, key, stagePath)

    return { moduleUri: moduleUri, stageUri: stageUri }
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
        resolve(uri)
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
    resolve     = "undefined"
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
            presets: ['env', 'react']
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

function stageTemplate(stageName, srcPath, demoCode) {
  return `
    <html>
      <body>
        <div id="Stage">
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react.js" type="text/javascript"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react-dom.js" type="text/javascript"></script>
        <script src="${ srcPath }" type="text/javascript"></script>
        <script>
          var element = (${ demoCode })
          var container = document.getElementById("Stage")
          ReactDOM.render(element, container)
        </script>
      </body>
    </html>
  `
}

function download(repo, directory) {
  return new Promise((resolve, reject) => {
    downloadRepo(repo, directory, resolve)
  })
}

function getJsDocs(directory) {
  let path  = Path.join(directory, "src", "**", "*.{jsx,js}")

  let files = glob.sync(path)
  let docs  = jsdoc.explainSync({ files: files })
  docs      = docs.filter(doc => !doc.undocumented)

  return docs
}
