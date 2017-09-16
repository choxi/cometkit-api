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
    let namespace = [owner, repo].join("/")
    let exists    = await Repo.exists(namespace)
    let docs      = await Repo.getFile(namespace, "docs.comet.json")

    if(docs)
      docs = JSON.parse(docs)

    if(exists && docs)
      ws.send(JSON.stringify({ docs: docs }))
    else {
      download(namespace, tmpPath, () => {
        // Parse docs
        docs = this.process(tmpPath)
        Repo.add(namespace, "docs.comet.json", JSON.stringify(docs))

        // Build sources
        .then(() => exec("npm install", { cwd: Path.resolve(tmpPath) }))
        .then((result) => {
          console.log(`STDOUT: ${ result.stdout }`)
          console.log(`STDERR: ${ result.stderr }`)

          let uploads = docs.map(doc => {
            if(doc.meta) {
              let filePath = Path.join(doc.meta.path, doc.meta.filename)

              return Repo.pack(tmpPath, filePath, namespace)
              .then(response => doc.meta.webpackUri = response.uri)
            } else {
              return Promise.resolve
            }
          })

          return Promise.all(uploads)
        })
        .then(() => ws.send(JSON.stringify({ docs: docs })))
        .catch(error => console.log(error))
      })
    }
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


