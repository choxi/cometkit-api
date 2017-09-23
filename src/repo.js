import Path from "path"
import webpack from "webpack"
import s3Client from "s3"
import dotenv from "dotenv"
import { exec } from "child-process-promise"
import { spawn } from "child_process"
import fs from "fs-extra"
import AWS from "aws-sdk"
import fetch from "node-fetch"
import downloadRepo from "download-github-repo"
import glob from "glob"
import jsdoc from "jsdoc-api"
import process from "process"

dotenv.config()

const s3Options = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
}

const client  = s3Client.createClient({ s3Options: s3Options })
const s3      = new AWS.S3(s3Options)

function streamExec(command, options={}) {
  options = Object.assign(options, { shell: true })

  return new Promise((resolve, reject) => {
    let childProcess = spawn(command, [], options)

    childProcess.stdout.on('data', data => console.log(data.toString()))
    childProcess.stderr.on('data', data => console.log(data.toString()))

    childProcess.on('close', code => resolve(code))
    childProcess.on('error', reject)
  })
}

export default class Repo {
  static async newCreateDocs(owner, repo) {
    let buildPath       = Path.join("/tmp", owner, repo)
    let dockerDistPath  = Path.join("/tmp")
    let environment     = [ `-e AWS_ACCESS_KEY_ID="${ process.env.S3_ACCESS_KEY_ID }"`,
                            `-e AWS_SECRET_ACCESS_KEY="${ process.env.S3_SECRET_ACCESS_KEY }"`,
                            `-e AWS_REGION="${ process.env.AWS_REGION }"`,
                            `-e S3_BUCKET="${ process.env.S3_BUCKET }"`,
                            `-e NODE_ENV=production`,
                            `-e NODE_PATH=/cometkit-api/node_modules` ]

    if(process.env.DISABLE_CACHE)
        environment.push("-e DISABLE_CACHE=true")

    environment = environment.join(" ")

    await streamExec(`sudo docker run -v ${ buildPath }:${ dockerDistPath } ${ environment } cometkit-packer node -r 'babel-register' /cometkit-api/src/pack.js ${owner}/${repo}`)

    let docsPath  = Path.join(buildPath, owner, repo, "comet-dist", "docs.comet.json")
    let docs      = JSON.parse(fs.readFileSync(docsPath))

    return docs
  }

  static async createDocs(owner, repo, options={}) {
    let tmpPath   = Path.join("/", "tmp", owner, repo)
    let githubUrl = `https://api.github.com/repos/${ owner }/${ repo }/git/refs/heads/master`
    let ref       = await fetch(githubUrl).then(response => response.json())
    let sha       = ref.object.sha

    let namespace = [owner, repo, sha].join("/")
    let exists    = await Repo.exists(namespace)
    let docs      = await Repo.getFile(namespace, "docs.comet.json")

    if(docs) {
      docs = JSON.parse(docs)
      fs.ensureDirSync(Path.join(tmpPath, "comet-dist"))
      fs.writeFileSync(Path.join(tmpPath, "comet-dist", "docs.comet.json"), JSON.stringify(docs))
    }

    if(exists && docs && !process.env.DISABLE_CACHE) {
      console.log("Found cached docs")
      return docs
    } else {
      console.log("No docs found in cache. Generating.")
      console.log(`Downloading repository: ${namespace}`)
      await download(namespace, tmpPath)

      let cometConfig
      let cometConfigPath = Path.join(tmpPath, "comet.json")
      if(fs.existsSync(cometConfigPath))
        cometConfig = JSON.parse(fs.readFileSync(cometConfigPath))

      let stageSources = []
      if(cometConfig && cometConfig.sources) {
        let sourceUploads = cometConfig.sources.map((source) => {
          let sourcePath  = Path.join(tmpPath, source)
          let filename    = Path.basename(sourcePath)
          let key         = [namespace, filename].join("/")

          return this.upload(process.env.S3_BUCKET, key, sourcePath)
        })

        // Upload sources in parallel
        stageSources = await Promise.all(sourceUploads)
        console.log("Uploaded sources")
      }

      docs = getJsDocs(tmpPath)
      console.log("Parsed JsDoc comments")

      // Install dependencies
      let result = await streamExec("npm install", { cwd: Path.resolve(tmpPath) })
      console.log("Installed dependencies")
      result = await streamExec("npm install --only=dev", { cwd: Path.resolve(tmpPath) })
      console.log("Installed devDependencies")

      let uploads = docs.map(doc => {
        return (async () => {
          if(doc.meta) {
            let { moduleUri, stageUri } = await Repo.deploy(doc, tmpPath, namespace, stageSources)

            doc.meta.webpackUri = moduleUri
            doc.meta.moduleUri  = moduleUri
            doc.meta.stageUri   = stageUri
          }
        })()
      })

      // Upload to S3
      await Promise.all(uploads)
      await Repo.add(namespace, "docs.comet.json", JSON.stringify(docs))
      fs.writeFileSync(Path.join(tmpPath, "comet-dist", "docs.comet.json"), JSON.stringify(docs))

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

  static async pack(downloadPath, filePath, options = {}) {
    let name        = modulename(filePath)
    let outputDir   = Path.resolve(downloadPath, "comet-dist")
    let outputName  = `${name}.js`
    let outputPath  = Path.join(outputDir, outputName)
    let library     = options.library || capitalize(name)

    // Merge user config or use default
    let templateOptions = {
      entry: filePath,
      library: library,
      path: outputDir,
      filename: outputName
    }

    let templateConfig
    if(options.webpackConfigPath)
      templateConfig = Object.assign(options, { loadUserConfig: true })
    else if(fs.existsSync(Path.join(downloadPath, "webpack.config.js")))
      templateConfig = options
    else
      templateConfig = Object.assign(options, { loadUserConfig: false })

    let config = configTemplate(templateOptions, templateConfig)

    // Write Comet webpack config
    let webpackConfigName = `${name}.webpack.js`
    let webpackConfigPath = Path.join(downloadPath, webpackConfigName)
    fs.writeFileSync(webpackConfigPath, config)
    console.log(`Injected ${webpackConfigPath}`)

    // Pack component
    let modulesPath = Path.join(process.cwd(), "node_modules")
    let result      = await exec(`webpack -p --config ${webpackConfigName}`, { cwd: downloadPath })
    console.log(`WEBPACK STDOUT: ${ result.stdout }`)
    console.log(`WEBPACK STDERR: ${ result.stderr }`)

    console.log(`outputPath: ${outputPath}`)
    return outputPath
  }

  static async deploy(doc, downloadPath, keyPrefix, stageSources) {
    let filePath = Path.join(doc.meta.path, doc.meta.filename)
    let fileDir  = Path.dirname(filePath)

    let name        = modulename(filePath)
    let outputName  = `${name}.js`
    let outputPath  = await this.pack(downloadPath, filePath)

    // Upload Module
    let bucket    = process.env.S3_BUCKET
    let key       = [keyPrefix, outputName].join("/")
    let moduleUri = await this.upload(bucket, key, outputPath)

    // Pack demo code
    let demoPath = Path.join(fileDir, `${name}Demo.js`)
    let demoCode = `
      window.RealDemo = (function() { 
        ${ doc.examples[0] } 
      })()
    `

    let demoModuleName = "Demo"
    fs.writeFileSync(demoPath, demoCode)
    let packedDemoCodePath = await this.pack(downloadPath, demoPath, { library: demoModuleName, loadUserConfig: false })
    let packedDemoCode = fs.readFileSync(packedDemoCodePath)

    // Create and Upload Stage
    let stageName = `${name}.html`
    let stage     = stageTemplate(name, moduleUri, packedDemoCode, demoModuleName, stageSources)
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

function modulename(path) {
  let name = Path.basename(path).split(".")[0]
  if(name === "index")
    name = Path.dirname(path).split(Path.sep).pop()

  return name
}

function configTemplate({ entry, library, path, filename }, options = {}) {
  if(options.loadUserConfig === undefined)
    options.loadUserConfig = true

  let userConfig, module, resolve, plugins
  if(!options.loadUserConfig) {
    userConfig  = ""
    resolve     = "undefined"
    plugins     = "undefined"
    module      = `{
      loaders: [
        {
          test: /\.(css|scss|sass)$/,
          loader: 'style-loader!css-loader!sass-loader',
        },
        {
          test: /\.(js|jsx)$/,
          loader: "babel-loader",
          options: {
            presets: ["env", "react"],
            plugins: ["implicit-return"]
          }
        },
        {
          test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/, /\.svg$/],
          loader: 'url-loader',
          options: {
            limit: 5000000,
            name: 'static/media/[name].[hash:8].[ext]'
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
    plugins     = `defaultConfig.plugins`
  }

  let directories = __dirname.split(Path.sep)
  directories.pop()

  let appPath = directories.join("/")
  let cometkitApiModulesPath = Path.join(appPath, "node_modules")
  return `
    var path = require("path")

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
      resolveLoader: {
        modules: [ path.resolve("./node_modules"), path.resolve("${ cometkitApiModulesPath }") ]
      },
      externals: {
        react: "React",
        "react-dom": "ReactDOM"
      },
      resolve: ${ resolve },
      module: ${ module },
      plugins: ${ plugins }
    }
  `
}

function stageTemplate(stageName, srcPath, demoCode, demoModuleName, sourceUris) {
  let sources = sourceUris.map((sourceUri) => {
    if(sourceUri.match(/\.js$/))
      return `<script src="${ sourceUri }" type="text/javascript"></script>`
    else if(sourceUri.match(/\.css$/))
      return `<link rel="stylesheet" type="text/css" href="${ sourceUri }">`
  })

  return `
    <html>
      <head>
        ${ sources.join("\n") }
      </head>
      <body>
        <div id="Stage">
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react.js" type="text/javascript"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react-dom.js" type="text/javascript"></script>
        <script src="${ srcPath }" type="text/javascript"></script>
        <script type="text/javascript">
          ${ demoCode }
        </script>
        <script>
          var container = document.getElementById("Stage")
          ReactDOM.render(RealDemo, container)
        </script>
      </body>
    </html>
  `
}

function download(repo, directory) {
  return new Promise((resolve, reject) => {
    fs.removeSync(directory)
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
