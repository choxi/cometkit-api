import Repo         from "./repo"
import downloadRepo from "download-github-repo"
import path         from "path"
import { exec }     from "child-process-promise"

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at:', p, 'reason:', reason)
})

async function doPack(repo, filePath) {
  // Download repo 
  let downloadPath = path.resolve("/", "tmp", repo)
  await download(repo, downloadPath)
  console.log(`Downloaded ${repo} to ${downloadPath}.`)

  // Build sources
  let result = await exec("npm install", { cwd: downloadPath })
  console.log(result.stdout)
  console.log(result.stderr)
  console.log("Installed dependencies.")

  let outputPath  = await Repo.pack(downloadPath, filePath)

  console.log(`Out: ${outputPath}.`)

  return outputPath
}

async function download(repo, downloadPath) {
  return new Promise((resolve, reject) => {
    downloadRepo(repo, downloadPath, resolve)
  })
}

async function main() {
  let output = await doPack("choxi/movieboard", "./src/common/components/MovieGrid/index.js")
  console.log(output)
}

main()

