import Repo         from "./repo"
import downloadRepo from "download-github-repo"
import path         from "path"
import { exec }     from "child-process-promise"
import fs           from "fs"

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at:', p, 'reason:', reason)
})

async function packFile(repo, filePath) {
  // Download repo 
  let downloadPath = path.resolve("/", "tmp", repo)
  await download(repo, downloadPath)
  console.log(`Downloaded ${repo} to ${downloadPath}.`)

  // Build sources
  let result = await exec("npm install", { cwd: downloadPath })
  console.log(result.stdout)
  console.log(result.stderr)
  console.log("Installed dependencies.")

  let packConfig, outputPath
  outputPath = await Repo.pack(downloadPath, filePath, packConfig)
  
  return outputPath
}

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

async function download(repo, downloadPath) {
  return new Promise((resolve, reject) => {
    downloadRepo(repo, downloadPath, resolve)
  })
}

async function main() {
  let [owner, repo] = process.argv[2].split("/")

  let docs = await Repo.buildDocs(owner, repo)

  console.log(JSON.stringify(docs, null, 4))
}

main()
