import Path from "path"
import webpack from "webpack"
import s3 from "s3"
import dotenv from "dotenv"
dotenv.config()

const client = s3.createClient({
  s3Options: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  }
})

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const pack = (path, repo) => {
  let name = Path.basename(path).split(".")[0]

  if(name === "index")
    name = Path.dirname(path).split(Path.sep).pop()

  let directory = Path.resolve(".", "tmp", "dist")
  let filename  = `${name}.js`

  let config = {
    entry: path,
    output: {
      libraryTarget: "var",
      library: capitalize(name),
      libraryExport: "default",
      path: directory,
      filename: filename
    },
    externals: {
      react: "React",
      "react-dom": "ReactDOM"
    },
    module: {
      loaders: [
        {
          test: /.*\.scss$/,
          loader: 'style-loader!css-loader!autoprefixer!sass-loader',
        },
        {
          test: /\.(js|jsx)$/,
          loader: require.resolve('babel-loader')
        }
      ]
    }
  }

  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      let key     = [repo, filename].join("/")
      let bucket  = process.env.S3_BUCKET

      let params = {
        localFile: Path.join(directory, filename),
        s3Params: {
          ACL: "public-read",
          Bucket: bucket,
          Key: key
        }
      }

      let uploader = client.uploadFile(params)

      uploader.on('error', function(err) {
        console.error("unable to upload:", err.stack)
      })

      uploader.on('progress', function() {
        console.log("progress", uploader.progressMd5Amount, uploader.progressAmount, uploader.progressTotal)
      })

      uploader.on('end', function() {
        console.log("done uploading")

        let uri = `https://s3-us-west-1.amazonaws.com/${bucket}/${key}`
        resolve({ uri: uri })
      })

      if(err) console.log(err)
    })
  })
}

export default pack
