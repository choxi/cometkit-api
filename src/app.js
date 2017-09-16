import express    from "express"
import BodyParser from "body-parser"
import morgan     from "morgan"
import download   from "download-github-repo"
import cors       from "cors"
import jsdoc      from "jsdoc-api"
import glob       from "glob"
import Path       from "path"
import fs         from "fs"
import expressWs  from "express-ws"
import helmet     from "helmet"
import Repo       from "./repo.js"
import { exec }   from "child-process-promise"
import fetch      from "node-fetch"
import semi       from "semi"

export default class App {
  constructor() {
    this.router = express()
    expressWs(this.router)

    this.router.use(BodyParser.json())
    this.router.use(cors())
    this.router.use(helmet())
    this.router.use(helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'", "*"],
        connectSrc: ["'self'", "*"]
      }
    }))

    process.on('unhandledRejection', (reason, p) => {
      console.log('Unhandled Rejection at:', p, 'reason:', reason)
    })

    semi.on("error", console.log)

    if(process.env.NODE_ENV !== "test")
      this.router.use(morgan(process.env.MORGAN_LOG_FORM || 'combined'))

    this.router.ws("/ws", (ws, request) => {
      ws.on("connection", (ws, request) => {
        console.log("Client connected.")
      })

      ws.on("message", (msg) => {
        let action, formatted

        try {
          action    = JSON.parse(msg)
          formatted = JSON.stringify(action, null, 4)
        } catch(e) {
          console.log(`Invalid Action: ${msg}`)
          return
        }

        console.log(`Action:\n${formatted}`)

        if(action.type === "CREATE_DOCS") {
          let tmpPath = Path.join("/", "tmp", action.repo)
          this.createDocs(ws, action.owner, action.repo, tmpPath)
        }
      })
    })

    this.router.get("/", (request, response) => {
      response.send("Comet API")
    })
  }

  async createDocs(ws, owner, repo, tmpPath) {
    let githubUrl = `https://api.github.com/repos/${ owner }/${ repo }/git/refs/heads/master`
    let ref       = await fetch(githubUrl).then(response => response.json())
    let sha       = ref.object.sha

    let namespace = [owner, repo, sha].join("/")
    let exists    = await Repo.exists(namespace)
    let docs      = await Repo.getFile(namespace, "docs.comet.json")

    if(docs)
      docs = JSON.parse(docs)

    if(exists && docs)
      ws.send(JSON.stringify({ docs: docs }))
    else {
      // Download repo
      await this.download(namespace, tmpPath)

      // Parse docs
      docs = this.process(tmpPath)

      // Build sources
      let result = await exec("npm install", { cwd: Path.resolve(tmpPath) })
      console.log(`STDOUT: ${ result.stdout }`)
      console.log(`STDERR: ${ result.stderr }`)

      let uploads = docs.map(doc => {
        if(doc.meta) {
          let filePath = Path.join(doc.meta.path, doc.meta.filename)

          // Add semicolons
          if(doc.examples)
            doc.demos = doc.examples.map(example => semi.add(example))

          return Repo.pack(tmpPath, filePath, namespace)
          .then(response => doc.meta.webpackUri = response.uri)
        } else {
          return Promise.resolve
        }
      })

      // Upload to S3
      await Promise.all(uploads)
      await Repo.add(namespace, "docs.comet.json", JSON.stringify(docs))

      ws.send(JSON.stringify({ docs: docs }))
    }
  }

  download(repo, directory) {
    return new Promise((resolve, reject) => {
      download(repo, directory, resolve)
    })
  }

  process(directory) {
    let path  = Path.join(directory, "src", "**", "*.{jsx,js}")

    let files = glob.sync(path)
    let docs  = jsdoc.explainSync({ files: files })
    docs      = docs.filter(doc => !doc.undocumented)

    return docs
  }

  start({ port }) {
    port = port || 3000
    this.router.listen(port, () => console.log(`Running on ${ port }...`))
  }
}


