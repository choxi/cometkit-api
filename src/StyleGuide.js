import Connection from "./db/connection.js"

export default class StyleGuide {
  constructor({ id, github_repo }) {
    this.id         = id
    this.githubRepo = github_repo
  }

  static async findOrCreate({ user, githubRepo }) {
    let guide = await user.findStyleGuide(githubRepo)

    if(!guide)
      guide = await StyleGuide.create({ githubRepo: `${owner}/${repo}`, user: user })

    return guide
  }

  static create({ user, githubRepo }) {
    return new Promise((resolve, reject) => {
      let db     = new Connection()
      let sql    = "INSERT INTO style_guides (github_repo) VALUES ($1) RETURNING *"
      let values = [ githubRepo ]
      let styleGuide 

      db.transaction((client, commit, rollback) => {
        client.query(sql, values)
        .then((result) => {
          styleGuide  = new StyleGuide(result.rows[0])
          let values  = [user.id, styleGuide.id, "StyleGuide"]

          return client.query("INSERT INTO roles (user_id, source_id, source_type) VALUES ($1, $2, $3)", values)
        })
        .then(commit)
        .then(() => {
          resolve(styleGuide)
        })
      })
    })
  }
}
