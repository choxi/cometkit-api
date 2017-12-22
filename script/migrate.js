import path from "path"
import { spawn } from "child_process"

let id = process.argv[2]
let file = id + ".js"
let migrationPath = path.join(__dirname, "..", "src", "db", "migrations", file)
let childProcess = spawn("node", ["-r", "'babel-register'", migrationPath], { shell: true })

childProcess.stdout.on('data', data => console.log(data.toString()))
childProcess.stderr.on('data', data => console.log(data.toString()))
childProcess.on('close', () => console.log("closed"))
childProcess.on('error', (error) => console.log(error))

