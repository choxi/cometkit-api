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
  let filename  = Path.basename(path).split(".")[0]
  let directory = Path.resolve(".", "tmp", "dist")
  let out       = `${filename}.js`

  let config = {
    entry: path,
    output: {
      libraryTarget: "var",
      library: capitalize(filename),
      path: directory,
      filename: out
    },
    externals: {
      react: "React"
    },
    module: {
      loaders: [
        {
          test: /\.(js|jsx)$/,
          loader: require.resolve('babel-loader')
        }
      ]
    }
  }

  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      let key     = [repo, out].join("/")
      let bucket  = process.env.S3_BUCKET

      let params = {
        localFile: Path.join(directory, out),
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
