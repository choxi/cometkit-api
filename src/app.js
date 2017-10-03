import express    from "express"
import BodyParser from "body-parser"
import morgan     from "morgan"
import cors       from "cors"
import Path       from "path"
import fs         from "fs"
import expressWs  from "express-ws"
import helmet     from "helmet"
import Repo       from "./repo.js"
import User       from "./user.js"
import { exec }   from "child-process-promise"
import jwt        from "jsonwebtoken"

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

      ws.on("message", async (msg) => {
        let action, formatted

        try {
          action    = JSON.parse(msg)
          formatted = JSON.stringify(action, null, 4)
        } catch(e) {
          console.log(`Invalid Action: ${msg}`)
          return
        }

        console.log(`ACTION: ${formatted}`)

        let currentUser, currentSession
        if(action.session) {
          try {
            currentSession  = jwt.verify(action.session, process.env.SECRET)
            console.log(`SESSION: ${ JSON.stringify(currentSession, null, 4) }`)
            currentUser     = currentSession.data.user
          } catch(err) {
            console.log(err)
            return
          }
        }

        if(action.type === "CREATE_DOCS") {
          if(!currentUser)
            ws.send(JSON.stringify({ type: "CREATE_DOCS", status: "unauthorized" }))
          else {
            let docs = await Repo.createDocs(action.owner, action.repo)
            ws.send(JSON.stringify({ type: "CREATE_DOCS", status: "ok", docs: docs }))
          }
        } else if(action.type === "CREATE_USER") {
          let { user, error } = await User.create(action.params)

          if(user) {
            let session = jwt.sign({ data: { user: user }}, process.env.SECRET)
            ws.send(JSON.stringify({ status: "ok", type: "CREATE_USER", user: user, session: session }))
          } else if(error)
            ws.send(JSON.stringify({ status: "error", type: "CREATE_USER", error: error }))

        } else if(action.type === "CREATE_SESSION") {
          let user = await User.authenticate(action.params)
          let session = jwt.sign({ data: { user: user }}, process.env.SECRET)

          if(user)
            ws.send(JSON.stringify({ status: "ok", type: "CREATE_SESSION", session: session, user: user }))
          else
            ws.send(JSON.stringify({ status: "unauthorized", type: "CREATE_SESSION" }))
        }
      })
    })

    this.router.get("/", (request, response) => {
      response.send("Comet API")
    })
  }

  start({ port }) {
    port = port || 3000
    this.router.listen(port, () => console.log(`Running on ${ port }...`))
  }
}
