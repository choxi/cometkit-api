import Repo         from "./repo"
import downloadRepo from "download-github-repo"
import path         from "path"
import { exec }     from "child-process-promise"
import fs           from "fs"

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

  let packConfig, outputPath
  try {
    outputPath = await Repo.pack(downloadPath, filePath, packConfig)
  } catch(e) {}
  
  // Create Stage
  let stageName = capitalize(path.basename(outputPath).split(".")[0])
  let stage     = stageTemplate(stageName, outputPath)
  let stagePath = path.join(path.dirname(outputPath), `${stageName}.html`)

  fs.writeFileSync(stagePath, stage)

  console.log(`Created test stage at: ${stagePath}`)

  return outputPath
}

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function stageTemplate(stageName, srcPath) {
  return `
    <html>
      <body>
        <div id="Stage">
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react.js" type="text/javascript"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react-dom.js" type="text/javascript"></script>
        <script src="${ srcPath }" type="text/javascript"></script>
        <script>
          var element = React.createElement(${ stageName }, {}, null)
          var container = document.getElementById("Stage")
          ReactDOM.render(element, container)
        </script>
      </body>
    </html>
  `
}

async function download(repo, downloadPath) {
  return new Promise((resolve, reject) => {
    downloadRepo(repo, downloadPath, resolve)
  })
}

async function main() {
  let output = await doPack("choxi/progress", "./src/Circle.js")
  console.log(output)
}

main()

