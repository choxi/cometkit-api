import express    from "express"
import BodyParser from "body-parser"
import morgan     from "morgan"
import download   from "download-github-repo"
import cors       from "cors"
import jsdoc      from "jsdoc-api"
import glob       from "glob"
import Path       from "path"
import fs         from "fs"

export default class App {
  constructor() {
    this.router = express()
    this.router.use(BodyParser.json())
    this.router.use(cors())

    process.on('unhandledRejection', (reason, p) => {
      console.log('Unhandled Rejection at:', p, 'reason:', reason)
    })

    if(process.env.NODE_ENV !== "test")
      this.router.use(morgan(process.env.MORGAN_LOG_FORM || 'combined'))

    this.router.post("/docs", (request, response) => {
      let owner = request.body.owner
      let repo  = request.body.repo

      let tmpPath = Path.join(".", "tmp", repo)
      download(`${owner}/${repo}`, tmpPath, () => {
        let docs = this.process(tmpPath)
        response.json(docs)
      })
    })
  }

  process(directory) {
    let path  = Path.join(directory, "**", "*.{jsx,js}")

    let files = glob.sync(path)
    files     = files.filter(file => !file.match(/component\.jsx$/))

    let docs  = jsdoc.explainSync({ files: files })
    docs      = docs.filter(doc => !doc.undocumented)

    return docs
  }

  start({ port }) {
    port = port || 3000
    this.router.listen(port, () => console.log(`Running on ${ port }...`))
  }
}


