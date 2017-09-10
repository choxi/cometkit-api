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
import pack       from "./pack.js"

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
          let owner = action.owner
          let repo  = action.repo
          let tmpPath

          if(process.env.NODE_ENV == "production")
            tmpPath = Path.join("/", "tmp", repo)
          else
            tmpPath = Path.join(".", "tmp", repo)

          download(`${owner}/${repo}`, tmpPath, () => {
            let docs = this.process(tmpPath)

            let uploads = docs.map(doc => {
              if(doc.meta) {
                let path = Path.join(doc.meta.path, doc.meta.filename)
                return pack(path, repo)
                .then(response => doc.meta.webpackUri = response.uri)
              } else {
                return Promise.resolve
              }
            })
            Promise.all(uploads)
            .then(() => ws.send(JSON.stringify({ docs: docs })))
          })
        }
      })
    })

    this.router.get("/", (request, response) => {
      response.send("Comet API")
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


